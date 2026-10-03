/**
 * Sync service: state for the UI (useSync), the run queue, scheduling and leadership.
 *
 *  - One tab per workspace leads (Web Locks, held for the tab's lifetime): only it writes the folder
 *    on changes (debounced) and pushes to GitHub on the automatic interval. Folder edits are picked
 *    up by whichever tab is visible (focus, visibility, a poll every 15 s).
 *  - Every run — automatic or a button in any tab — holds a second lock for its duration, so two
 *    tabs never write the same folder / branch at once. Results are saved (status, log) and other
 *    tabs are told to reload them (BroadcastChannel).
 *  - Heavy modules (rendering, the importer, the GitHub client) load on the first run.
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { countOf } from '../io/count'
import { folderSupported, permissionOf, pickFolder } from './fs'
import {
  appendLog,
  clearTarget,
  loadFolderHandle,
  loadGitHubConfig,
  loadLog,
  loadManifest,
  loadStatus,
  saveFolderHandle,
  saveGitHubConfig,
  saveManifest,
  saveStatus,
  wsKey,
} from './storage'
import { defaultGitHubConfig, emptyStatus, type GitHubConfig, type LogEntry, type LogKind, type TargetKind, type TargetStatus } from './types'
import type { ConnectionInfo } from './github'

export type FolderState = 'unsupported' | 'off' | 'permission' | 'ready' | 'running' | 'error'
export type GitHubState = 'off' | 'ready' | 'running' | 'error'

export interface MissingFiles {
  target: TargetKind
  items: Array<{ path: string; id: string }>
}

export interface SyncState {
  loaded: boolean
  folder: TargetStatus & { state: FolderState; name: string | null }
  github: TargetStatus & { state: GitHubState; config: GitHubConfig; connection: ConnectionInfo | null }
  log: LogEntry[]
  missing: MissingFiles | null
}

export const useSync = create<SyncState>()(() => ({
  loaded: false,
  folder: { ...emptyStatus(), state: folderSupported() ? 'off' : 'unsupported', name: null },
  github: { ...emptyStatus(), state: 'off', config: defaultGitHubConfig(), connection: null },
  log: [],
  missing: null,
}))

const setFolder = (patch: Partial<SyncState['folder']>) => useSync.setState((s) => ({ folder: { ...s.folder, ...patch } }))
const setGitHub = (patch: Partial<SyncState['github']>) => useSync.setState((s) => ({ github: { ...s.github, ...patch } }))

/* ------------------------------------------------------------------ */
/* Lazy modules                                                        */
/* ------------------------------------------------------------------ */

const folderMod = () => import('./folder')
const githubMod = () => import('./github')

/* ------------------------------------------------------------------ */
/* Run queue                                                           */
/* ------------------------------------------------------------------ */

let queue: Promise<unknown> = Promise.resolve()

/** One run at a time in this tab, and across tabs (Web Locks). */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const job = queue.then(() => (locks?.request ? (locks.request(`one-sync-run:${wsKey()}`, fn) as Promise<T>) : fn()))
  queue = job.catch(() => {})
  return job
}

let channel: BroadcastChannel | null = null

async function log(target: TargetKind, kind: LogKind, vars?: LogEntry['vars']) {
  const next = await appendLog({ at: Date.now(), target, kind, vars })
  useSync.setState({ log: next })
}

async function saveTargetStatus(target: TargetKind, patch: Partial<TargetStatus>) {
  const cur = target === 'folder' ? useSync.getState().folder : useSync.getState().github
  const next: TargetStatus = { lastAt: cur.lastAt, files: cur.files, pending: cur.pending, error: cur.error, ...patch }
  if (target === 'folder') setFolder(next)
  else setGitHub(next)
  await saveStatus(target, next)
  channel?.postMessage({ type: 'changed', ws: wsKey() })
}

/** Readable message for an error (GitHub errors by code; rate limits say until when). */
function errorMessage(e: unknown): string {
  const err = e as { name?: string; code?: string; resetAt?: number | null; message?: string }
  if (err?.name === 'GitHubError') {
    if (err.code === 'rate' && err.resetAt) return t('features.sync.err.rateUntil', { time: new Date(err.resetAt).toLocaleTimeString(useWorkspace.getState().settings.language === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })
    return t(`features.sync.err.${err.code}`)
  }
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return t('features.sync.err.permission')
  if (err?.name === 'NotFoundError') return t('features.sync.err.folderGone')
  return err?.message || String(e)
}

/** Edits from files go into the workspace: not for viewers of a team workspace. */
const canPickUp = () => {
  const c = useCloud.getState()
  return c.status !== 'signed-out' && !c.readOnly
}

/* ------------------------------------------------------------------ */
/* Folder                                                              */
/* ------------------------------------------------------------------ */

let handle: FileSystemDirectoryHandle | null = null

async function adoptFolder(h: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  handle = h
  const perm = await permissionOf(h, ask)
  setFolder({ name: h.name, state: perm === 'granted' ? 'ready' : 'permission' })
  return perm === 'granted'
}

/** "Choose folder…" (a user gesture). */
export async function connectFolder(injected?: FileSystemDirectoryHandle): Promise<void> {
  edits++
  let h: FileSystemDirectoryHandle
  try {
    h = injected ?? (await pickFolder())
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return
    useUI.getState().toast({ message: errorMessage(e), kind: 'error' })
    return
  }
  await clearTarget('folder')
  await saveFolderHandle(h)
  await saveManifest('folder', { entries: {}, since: Date.now() })
  useSync.setState({ missing: null })
  setFolder({ ...emptyStatus() })
  if (!(await adoptFolder(h, !injected))) return
  await log('folder', 'connect', { name: h.name })
  await syncFolder({ manual: true })
}

/** "Resume" after a reload: the browser wants a gesture before writing again. */
export async function resumeFolder(): Promise<void> {
  if (!handle) return
  if (await adoptFolder(handle, true)) await syncFolder({ pickup: true, manual: true })
}

export async function disconnectFolder(): Promise<void> {
  edits++
  handle = null
  await clearTarget('folder')
  setFolder({ ...emptyStatus(), state: folderSupported() ? 'off' : 'unsupported', name: null })
  if (useSync.getState().missing?.target === 'folder') useSync.setState({ missing: null })
  channel?.postMessage({ type: 'changed', ws: wsKey() })
}

/** Write changes to the folder (and with `pickup`, take over edits made there first). */
export function syncFolder(opts: { pickup?: boolean; manual?: boolean } = {}): Promise<void> {
  return exclusive(async () => {
    const h = handle
    if (!h || useSync.getState().folder.state === 'permission') return
    if ((await permissionOf(h, false)) !== 'granted') {
      setFolder({ state: 'permission' })
      return
    }
    setFolder({ state: 'running' })
    const { writeFolder, pickupFolder } = await folderMod()
    const manifest = await loadManifest('folder')
    try {
      if (opts.pickup && canPickUp()) {
        const res = await pickupFolder(h, manifest)
        await saveManifest('folder', manifest)
        reportPickup('folder', res, res.copies.length)
      }
      const res = await writeFolder(h, manifest)
      await saveManifest('folder', manifest)
      if (res.written || res.removed || opts.manual) await log('folder', 'write', { files: res.written, removed: res.removed })
      if (res.conflicts) {
        await log('folder', 'conflict', { n: res.conflicts })
        useUI.getState().toast({ message: t('features.sync.toast.conflict', { n: res.conflicts }), kind: 'info', timeout: 8000 })
      }
      if (res.failed.length) {
        const msg = t('features.sync.err.someFiles', { files: countOf(t, 'file', res.failed.length), path: res.failed[0] })
        setFolder({ state: 'error' })
        await saveTargetStatus('folder', { lastAt: Date.now(), files: res.files, pending: res.failed.length, error: msg })
        await log('folder', 'error', { msg })
        return
      }
      setFolder({ state: 'ready' })
      await saveTargetStatus('folder', { lastAt: Date.now(), files: res.files, pending: 0, error: null })
    } catch (e) {
      console.warn('[one] folder sync failed', e)
      await saveManifest('folder', manifest).catch(() => {})
      const msg = errorMessage(e)
      setFolder({ state: 'error' })
      await saveTargetStatus('folder', { error: msg })
      await log('folder', 'error', { msg })
      if (opts.manual) useUI.getState().toast({ message: msg, kind: 'error' })
    }
  })
}

/* ------------------------------------------------------------------ */
/* Pick-up results                                                     */
/* ------------------------------------------------------------------ */

const toasted = new Set<string>()

function reportPickup(target: TargetKind, res: { updated: string[]; created: string[]; moved: string[]; conflicts: unknown[]; missing: MissingFiles['items'] }, copies: number) {
  const changed = res.updated.length + res.created.length + res.moved.length
  if (changed || res.conflicts.length) void log(target, 'pickup', { updated: res.updated.length + res.moved.length, created: res.created.length })
  if (changed) useUI.getState().toast({ message: t('features.sync.toast.pickedUp', { pages: countOf(t, 'page', changed) }), kind: 'success' })
  if (res.conflicts.length) {
    void log(target, 'conflict', { n: res.conflicts.length })
    useUI.getState().toast({ message: t(target === 'folder' || copies ? 'features.sync.toast.conflict' : 'features.sync.toast.conflictGitHub', { n: res.conflicts.length }), kind: 'info', timeout: 8000 })
  }
  if (res.missing.length) {
    useSync.setState({ missing: { target, items: res.missing } })
    const key = `${target}:${res.missing.map((m) => m.path).join('|')}`
    if (!toasted.has(key)) {
      toasted.add(key)
      useUI.getState().toast({ message: t('features.sync.toast.missing', { files: countOf(t, 'file', res.missing.length) }), kind: 'info', timeout: 10_000, action: { label: t('features.sync.review'), run: openSyncSettings } })
    }
  } else if (useSync.getState().missing?.target === target) useSync.setState({ missing: null })
}

/** Files deleted outside One: trash their pages (asked) — or write them again. */
export async function resolveMissing(trash: boolean): Promise<void> {
  const m = useSync.getState().missing
  if (!m) return
  useSync.setState({ missing: null })
  if (trash) {
    for (const it of m.items) if (useWorkspace.getState().pages[it.id]) useWorkspace.getState().trashPage(it.id)
  } else {
    const manifest = await loadManifest(m.target)
    for (const it of m.items) delete manifest.entries[it.path]
    await saveManifest(m.target, manifest)
  }
  if (m.target === 'folder') await syncFolder({ manual: true })
  else await refreshPending()
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

export async function updateGitHubConfig(patch: Partial<GitHubConfig>): Promise<void> {
  edits++
  const config = { ...useSync.getState().github.config, ...patch }
  const changedTarget = ['repo', 'branch', 'prefix'].some((k) => k in patch && patch[k as keyof GitHubConfig] !== useSync.getState().github.config[k as keyof GitHubConfig])
  setGitHub({ config, connection: changedTarget || 'token' in patch ? null : useSync.getState().github.connection })
  await saveGitHubConfig(config)
  if (changedTarget) {
    // another repository / branch / folder: nothing has been pushed there yet
    await saveManifest('github', null)
    await saveTargetStatus('github', { ...emptyStatus() })
  }
  const { isConfigured } = await githubMod()
  setGitHub({ state: isConfigured(config) ? (useSync.getState().github.error ? 'error' : 'ready') : 'off' })
  rescheduleAuto()
}

export async function testGitHub(): Promise<ConnectionInfo | null> {
  const { testConnection } = await githubMod()
  setGitHub({ state: 'running' })
  try {
    const info = await testConnection(useSync.getState().github.config)
    setGitHub({ state: 'ready', connection: info })
    await saveTargetStatus('github', { error: null })
    await log('github', 'connect', { name: info.repo })
    void refreshPending()
    return info
  } catch (e) {
    const msg = errorMessage(e)
    setGitHub({ state: 'error', connection: null })
    await saveTargetStatus('github', { error: msg })
    return null
  }
}

export function pushGitHub(opts: { manual?: boolean } = {}): Promise<void> {
  return exclusive(async () => {
    const { pushToGitHub, isConfigured } = await githubMod()
    const cfg = useSync.getState().github.config
    if (!isConfigured(cfg)) return
    setGitHub({ state: 'running' })
    const manifest = await loadManifest('github')
    try {
      const res = await pushToGitHub(cfg, manifest)
      await saveManifest('github', manifest)
      if (res.commit || opts.manual) await log('github', 'push', { pages: res.pages, removed: res.removed, commit: res.commit ? res.commit.slice(0, 7) : '—' })
      if (res.conflicts) await log('github', 'conflict', { n: res.conflicts })
      if (res.skipped.length) {
        await log('github', 'error', { msg: t('features.sync.err.tooLarge', { n: res.skipped.length }) })
        useUI.getState().toast({ message: t('features.sync.err.tooLarge', { n: res.skipped.length }), kind: 'info' })
      }
      setGitHub({ state: 'ready' })
      await saveTargetStatus('github', { lastAt: Date.now(), files: res.files, pending: 0, error: null })
      if (opts.manual) useUI.getState().toast({ message: res.commit ? t('features.sync.toast.pushed', { pages: countOf(t, 'page', res.pages) }) : t('features.sync.toast.upToDate'), kind: 'success' })
    } catch (e) {
      console.warn('[one] GitHub push failed', e)
      const msg = errorMessage(e)
      setGitHub({ state: 'error' })
      await saveTargetStatus('github', { error: msg })
      await log('github', 'error', { msg })
      if (opts.manual) useUI.getState().toast({ message: msg, kind: 'error' })
    }
  })
}

export function pullGitHub(): Promise<void> {
  return exclusive(async () => {
    const { pullFromGitHub, isConfigured } = await githubMod()
    const cfg = useSync.getState().github.config
    if (!isConfigured(cfg) || !canPickUp()) return
    setGitHub({ state: 'running' })
    const manifest = await loadManifest('github')
    try {
      const res = await pullFromGitHub(cfg, manifest)
      // conflicts: One's version stays; GitHub's version is committed as a copy on the next push
      for (const c of res.conflicts) {
        manifest.conflicts = [...(manifest.conflicts ?? []), { path: c.path, sha: c.sha }]
        const entry = manifest.entries[c.path]
        if (entry) entry.sha = c.sha
      }
      for (const [path, e] of Object.entries(res.entries)) manifest.entries[path] = e
      for (const p of res.removed) if (!res.entries[p]) delete manifest.entries[p]
      const { refreshOut } = await folderMod()
      await refreshOut(manifest, res.touched)
      await saveManifest('github', manifest)
      reportPickup('github', res, 0)
      if (!res.updated.length && !res.created.length && !res.moved.length) useUI.getState().toast({ message: t('features.sync.toast.nothingNew'), kind: 'info' })
      setGitHub({ state: 'ready' })
      await saveTargetStatus('github', { error: null })
    } catch (e) {
      console.warn('[one] GitHub pull failed', e)
      const msg = errorMessage(e)
      setGitHub({ state: 'error' })
      await saveTargetStatus('github', { error: msg })
      await log('github', 'error', { msg })
      useUI.getState().toast({ message: msg, kind: 'error' })
    }
    await refreshPendingNow()
  })
}

export async function disconnectGitHub(): Promise<void> {
  edits++
  await saveGitHubConfig(defaultGitHubConfig())
  await clearTarget('github')
  setGitHub({ ...emptyStatus(), state: 'off', config: defaultGitHubConfig(), connection: null })
  if (useSync.getState().missing?.target === 'github') useSync.setState({ missing: null })
  rescheduleAuto()
  channel?.postMessage({ type: 'changed', ws: wsKey() })
}

/** Files that differ from the last push (shown as PENDING). */
async function refreshPendingNow(): Promise<void> {
  const { isConfigured } = await githubMod()
  if (!isConfigured(useSync.getState().github.config)) return
  const { planSync } = await import('./engine')
  const plan = await planSync(await loadManifest('github'))
  const pending = plan.writes.length + plan.deletes.length
  setGitHub({ pending, files: plan.total })
}

function refreshPending(): Promise<void> {
  return exclusive(refreshPendingNow).catch((e) => console.warn('[one] sync: pending count failed', e))
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

const WRITE_DEBOUNCE_MS = 1200
const POLL_MS = 15_000
const AUTO_CHECK_MS = 30_000

let started = false
let leader = false
let generation = 0
let releaseLock: (() => void) | null = null
let writeTimer = 0
let pollTimer = 0
let autoTimer = 0
let unsubscribe: (() => void) | null = null

/** Connected and allowed to write (after an error the next change tries again). */
const folderLive = () => ['ready', 'error'].includes(useSync.getState().folder.state)

function onWorkspaceChange() {
  window.clearTimeout(writeTimer)
  writeTimer = window.setTimeout(() => {
    if (!leader) return
    if (handle && folderLive()) void syncFolder()
    if (useSync.getState().github.state !== 'off') void refreshPending()
  }, WRITE_DEBOUNCE_MS)
}

/** Folder edits are picked up by the tab the person looks at (leader or not — runs are exclusive anyway). */
function pickupSoon() {
  if (!handle || document.visibilityState !== 'visible' || !folderLive()) return
  void syncFolder({ pickup: true })
}

function rescheduleAuto() {
  window.clearInterval(autoTimer)
  const cfg = useSync.getState().github.config
  if (!started || !cfg.auto) return
  autoTimer = window.setInterval(() => {
    const g = useSync.getState().github
    if (!leader || g.state === 'off' || g.state === 'running' || !g.config.auto) return
    const due = !g.lastAt || Date.now() - g.lastAt >= Math.max(1, g.config.everyMin) * 60_000
    if (due && g.pending > 0) void pushGitHub()
  }, AUTO_CHECK_MS)
}

/** Bumped by connect / disconnect / config changes: a load that started before them is stale. */
let edits = 0

async function loadAll() {
  const at = edits
  const [h, cfg, log, folder, github] = await Promise.all([loadFolderHandle(), loadGitHubConfig(), loadLog(), loadStatus('folder'), loadStatus('github')])
  const { isConfigured } = await githubMod()
  if (at !== edits) return
  setGitHub({ ...github, config: cfg, state: isConfigured(cfg) ? (github.error ? 'error' : 'ready') : 'off' })
  setFolder({ ...folder })
  useSync.setState({ log, loaded: true })
  if (h && folderSupported()) await adoptFolder(h, false)
  else if (!h) {
    handle = null
    setFolder({ state: folderSupported() ? 'off' : 'unsupported', name: null })
  }
  if (useSync.getState().folder.state === 'ready' && folder.error) setFolder({ state: 'error' })
}

function onMessage(e: MessageEvent) {
  const d = e.data as { type?: string; ws?: string } | null
  if (d?.type === 'changed' && d.ws === wsKey()) void loadAll()
}

function onFocus() {
  pickupSoon()
}

function onVisible() {
  if (document.visibilityState === 'visible') pickupSoon()
}

function lead(gen: number) {
  if (gen !== generation) return
  leader = true
  // catch up: write what changed while no tab was leading, pick up what changed in the folder
  window.setTimeout(() => {
    if (!leader) return
    if (handle && folderLive()) void syncFolder({ pickup: true })
    if (useSync.getState().github.state !== 'off') void refreshPending()
  }, 1500)
  rescheduleAuto()
}

/** Start once after the workspace loaded (main.tsx). Returns a stop function. */
export function startSync(): () => void {
  if (started) return stopSync
  started = true
  const gen = ++generation
  void loadAll().catch((e) => console.warn('[one] sync: could not load its settings', e))
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-sync') : null
  channel?.addEventListener('message', onMessage)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)
  pollTimer = window.setInterval(pickupSoon, POLL_MS)
  let prev = useWorkspace.getState()
  unsubscribe = useWorkspace.subscribe((s) => {
    if (s.pages === prev.pages && s.databases === prev.databases && s.people === prev.people) return
    prev = s
    onWorkspaceChange()
  })
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) lead(gen)
  else
    locks
      .request(`one-sync:${wsKey()}`, () =>
        new Promise<void>((resolve) => {
          if (gen !== generation) return resolve()
          releaseLock = resolve
          lead(gen)
        }),
      )
      .catch((e) => console.warn('[one] sync: no tab lock', e))
  return stopSync
}

export function stopSync(): void {
  if (!started) return
  started = false
  leader = false
  generation++
  window.clearTimeout(writeTimer)
  window.clearInterval(pollTimer)
  window.clearInterval(autoTimer)
  releaseLock?.()
  releaseLock = null
  unsubscribe?.()
  unsubscribe = null
  channel?.removeEventListener('message', onMessage)
  channel?.close()
  channel = null
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisible)
}

/* ------------------------------------------------------------------ */
/* Settings hand-off                                                   */
/* ------------------------------------------------------------------ */

let wantTab = false

/** Open Settings on the Sync tab (status bar, toasts). */
export function openSyncSettings(): void {
  wantTab = true
  useUI.getState().openModal({ type: 'settings' })
}

/** SettingsModal asks when it opens (the answer holds for this tick: StrictMode runs initialisers twice). */
export function consumeSyncSettingsRequest(): boolean {
  if (!wantTab) return false
  window.setTimeout(() => (wantTab = false), 0)
  return true
}

/* ------------------------------------------------------------------ */
/* Test hook (dev, or ?e2e)                                            */
/* ------------------------------------------------------------------ */

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneSync?: unknown }).__oneSync = {
    /** connect a directory handle without the picker (OPFS in tests) */
    connect: (h: FileSystemDirectoryHandle) => connectFolder(h),
    sync: () => syncFolder({ manual: true }),
    pickup: () => syncFolder({ pickup: true, manual: true }),
    push: () => pushGitHub({ manual: true }),
    pull: () => pullGitHub(),
    pending: () => refreshPending(),
    github: (patch: Partial<GitHubConfig>) => updateGitHubConfig(patch),
    resolveMissing,
    manifest: (target: TargetKind) => loadManifest(target),
    state: () => JSON.parse(JSON.stringify({ ...useSync.getState(), github: { ...useSync.getState().github, config: { ...useSync.getState().github.config, token: undefined } } })),
    isLeader: () => leader,
  }
}
