/**
 * Mail service: UI state (useMail), connect / disconnect, runs (one at a time, across tabs via Web Locks),
 * the schedule ("when One opens" · "every N minutes while open" · manual) and "Load images".
 *
 * Google needs a click to hand out a token (its window would be blocked otherwise) and tokens are never
 * stored, so an automatic run after a reload starts with a one-click prompt; while the tab holds a token
 * (about an hour) the interval runs on its own, then asks once more.
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { openPage } from '../../lib/router'
import { isApplyingCloudChange } from '../../cloud'
import { isAIConfigured } from '../ai/client'
import { clearToken, currentToken, onTokenChange, requestToken, revokeToken, setTokenForTests } from './auth'
import { CLIENT_ID_RE, readMail, setMail } from './settings'
import { clearAll, emptyState, loadState, saveState, wsKey } from './storage'
import type { GmailCtx, GmailLabel } from './gmail'
import type { TargetProblem } from './schema'
import type { ID } from '../../store/types'

export type MailPhase = 'idle' | 'connecting' | 'running' | 'organising'

export interface MailState {
  loaded: boolean
  /** the Gmail address last connected on this device (workspace) */
  account: string | null
  /** this tab holds a valid token */
  connected: boolean
  phase: MailPhase
  progress: { done: number; total: number } | null
  /** Gmail asked to slow down: the run waits until then */
  retryUntil: number | null
  lastAt: number | null
  lastAdded: number
  /** mails synced into the database (this device) */
  total: number
  backlog: number
  /** synced mails Claude has not organised */
  unorganised: number
  /** friendly message of the last failure (never mail content) */
  error: string | null
  /** where it belongs: signing in ('access') or a run ('sync') */
  errorAt: 'access' | 'sync' | null
  /** the failure needs a new Google sign-in */
  reconnect: boolean
  /** the Mails database can't take mails: offer a new one */
  target: TargetProblem | null
  /** Gmail labels (after connecting) */
  labels: GmailLabel[] | null
}

export const useMail = create<MailState>()(() => ({
  loaded: false,
  account: null,
  connected: false,
  phase: 'idle',
  progress: null,
  retryUntil: null,
  lastAt: null,
  lastAdded: 0,
  total: 0,
  backlog: 0,
  unorganised: 0,
  error: null,
  errorAt: null,
  reconnect: false,
  target: null,
  labels: null,
}))

const patch = (p: Partial<MailState>) => useMail.setState(p)
const engine = () => import('./sync')
const gmailApi = () => import('./gmail')
const gctx = (signal?: AbortSignal): GmailCtx => ({ token: currentToken, signal })

/* ------------------------------------------------------------------ errors */

/** A failure → a friendly sentence (codes only — nothing from a mail ever reaches a message or a log). */
export function errorInfo(e: unknown): { text: string; reconnect?: boolean; target?: TargetProblem } {
  const err = e as { name?: string; code?: string; status?: number; message?: string }
  if (err?.name === 'AuthError') return { text: t(`features.mail.err.auth.${err.code}`, { origin: window.location.origin }) }
  if (err?.name === 'GmailError') {
    if (err.code === 'auth') return { text: t('features.mail.err.expired'), reconnect: true }
    return { text: t(`features.mail.err.gmail.${err.code}`, { status: err.status ?? 0 }) }
  }
  if (err?.name === 'TargetError') return { text: t(`features.mail.err.target.${err.code}`), target: err.code as TargetProblem }
  if (err?.name === 'AIError') return { text: t('features.mail.err.claude', { msg: err.message ?? '' }) }
  if (err?.name === 'CloudError') return { text: t('features.mail.err.cloud') }
  return { text: t('features.mail.err.unknown') }
}

/* ------------------------------------------------------------------ state from IndexedDB */

const CHANNEL = 'one-mail-status'
let channel: BroadcastChannel | null = null

async function refresh(): Promise<void> {
  const s = await loadState()
  const pages = useWorkspace.getState().pages
  const live = Object.values(s.known).filter((k) => pages[k.r] && !pages[k.r].trashed)
  patch({
    loaded: true,
    account: s.account,
    lastAt: s.lastAt,
    lastAdded: s.lastAdded,
    total: Object.keys(s.known).length,
    backlog: s.backlog.length,
    unorganised: live.filter((k) => !k.o).length,
    error: s.lastError,
    errorAt: s.lastError ? 'sync' : null,
  })
}

const announce = () => channel?.postMessage({ type: 'changed', ws: wsKey() })

async function saveError(text: string | null): Promise<void> {
  const s = await loadState()
  s.lastError = text
  await saveState(s)
}

/* ------------------------------------------------------------------ connect */

/** "Connect Gmail" (call from a click: Google's window opens). Resolves true when connected. */
export async function connectGmail(): Promise<boolean> {
  const cfg = readMail()
  if (!CLIENT_ID_RE.test(cfg.clientId)) {
    patch({ error: t('features.mail.err.clientId'), errorAt: 'access' })
    return false
  }
  patch({ phase: 'connecting', error: null, errorAt: null })
  try {
    await requestToken(cfg.clientId, { prompt: '', hint: useMail.getState().account })
    const prof = await (await gmailApi()).profile(gctx())
    const s = await loadState()
    if (s.account !== prof.emailAddress) {
      // another account: its history and backlog are not this one's (rows stay; ids never collide)
      await saveState({ ...s, account: prof.emailAddress, historyId: null, scope: null, backlog: [], lastError: null })
    } else if (s.lastError) await saveError(null)
    patch({ account: prof.emailAddress, connected: true, reconnect: false, error: null, errorAt: null })
    announce()
    void loadLabels()
    return true
  } catch (e) {
    const info = errorInfo(e)
    if (info.reconnect) clearToken()
    patch({ error: info.text, errorAt: 'access', reconnect: !!info.reconnect })
    return false
  } finally {
    patch({ phase: 'idle' })
  }
}

/** "Disconnect": revoke and forget the token (the database, its rows and the sync state stay). */
export function disconnectGmail(): void {
  revokeToken()
  patch({ connected: false, labels: null, reconnect: false })
}

export async function loadLabels(): Promise<void> {
  if (!currentToken()) return
  try {
    const list = await (await gmailApi()).labels(gctx())
    const order = ['INBOX', 'IMPORTANT', 'STARRED', 'SENT', 'CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'SPAM', 'TRASH']
    const rank = (l: GmailLabel) => (order.includes(l.id) ? order.indexOf(l.id) : l.type === 'user' ? 100 : 200)
    patch({
      labels: list
        .filter((l) => !['UNREAD', 'CHAT', 'DRAFT'].includes(l.id) && (l.type === 'user' || order.includes(l.id)))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
    })
  } catch (e) {
    const info = errorInfo(e)
    if (info.reconnect) {
      clearToken()
      patch({ reconnect: true })
    }
  }
}

/* ------------------------------------------------------------------ runs */

let running: Promise<void> | null = null
let abort: AbortController | null = null

/**
 * Sync now. Without a token: `connect` (a click) signs in first; otherwise the run is skipped and the
 * UI asks for a reconnect.
 */
export function syncNow(opts: { connect?: boolean } = {}): Promise<void> {
  if (running) return running
  running = (async () => {
    if (!currentToken()) {
      if (!opts.connect) {
        patch({ reconnect: true })
        return
      }
      if (!(await connectGmail())) return
    }
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (locks?.request) await locks.request(`one-mail-run:${wsKey()}`, run)
    else await run()
  })().finally(() => {
    running = null
  })
  return running
}

async function run(): Promise<void> {
  abort?.abort()
  const ctrl = new AbortController()
  abort = ctrl
  patch({ phase: 'running', error: null, errorAt: null, target: null, reconnect: false, progress: { done: 0, total: 0 } })
  try {
    const { runSync, organiseRows } = await engine()
    const res = await runSync({
      token: currentToken,
      signal: ctrl.signal,
      progress: (p) => patch({ progress: p }),
      retrying: (ms) => patch({ retryUntil: Date.now() + ms }),
      account: (a) => patch({ account: a }),
    })
    patch({ retryUntil: null })
    if (res.added > 0) {
      useUI.getState().toast({
        message: t(res.added === 1 ? 'features.mail.toast.added.one' : 'features.mail.toast.added', { n: res.added }),
        kind: 'success',
        action: { label: t('common.open'), run: () => openPage(res.databaseId) },
      })
    }
    const cfg = readMail()
    if (cfg.organise.enabled && res.created.length && isAIConfigured()) {
      patch({ phase: 'organising' })
      await organiseRows(res.created, ctrl.signal, (p) => patch({ progress: p }))
    }
  } catch (e) {
    if (ctrl.signal.aborted) return
    const info = errorInfo(e)
    if (info.reconnect) clearToken()
    patch({ error: info.text, errorAt: 'sync', reconnect: !!info.reconnect, target: info.target ?? null })
    await saveError(info.text).catch(() => {})
  } finally {
    if (abort === ctrl) abort = null
    patch({ phase: 'idle', progress: null, retryUntil: null })
    const err = useMail.getState().error
    await refresh().catch(() => {})
    // the run's own error stays on screen even if the saved state is older
    if (err) patch({ error: err, errorAt: 'sync' })
    announce()
  }
}

/** "Organise earlier mails": synced mails Claude has not seen yet, newest first, at most one run's worth. */
export async function organiseEarlier(): Promise<void> {
  if (running || !isAIConfigured()) return
  const ctrl = new AbortController()
  abort = ctrl
  running = (async () => {
    patch({ phase: 'organising', error: null, errorAt: null })
    try {
      const { organiseCandidates, organiseRows } = await engine()
      const ids = await organiseCandidates(readMail().maxPerRun)
      await organiseRows(ids, ctrl.signal, (p) => patch({ progress: p }))
    } catch (e) {
      if (!ctrl.signal.aborted) patch({ error: errorInfo(e).text, errorAt: 'sync' })
    } finally {
      patch({ phase: 'idle', progress: null })
      await refresh().catch(() => {})
      announce()
    }
  })().finally(() => {
    running = null
  })
  return running
}

/** Stop the current run (what was written stays). */
export function cancelRun(): void {
  abort?.abort()
}

/** Forget what was synced on this device (rows stay; the next run lists from the date again and skips rows it finds). */
export async function resetMailSync(): Promise<void> {
  cancelRun()
  await running?.catch(() => {})
  const account = useMail.getState().account
  await clearAll()
  await saveState({ ...emptyState(), account })
  patch({ error: null, errorAt: null, target: null })
  await refresh()
  announce()
}

/** The Mails database can't be used (trashed, shared): the next run creates a new one. */
export async function startNewDatabase(): Promise<void> {
  setMail({ databaseId: null, props: {} })
  const account = useMail.getState().account
  await saveState({ ...emptyState(), account })
  patch({ error: null, errorAt: null, target: null })
  await refresh()
}

/* ------------------------------------------------------------------ schedule */

let timer = 0
let nudged = false

const configured = () => {
  const cfg = readMail()
  return CLIENT_ID_RE.test(cfg.clientId) && (!!cfg.databaseId || !!useMail.getState().account)
}

/** Once per session: a one-click prompt to sign in again and sync (Google needs the click). */
function nudge(): void {
  if (nudged) return
  nudged = true
  const account = useMail.getState().account
  useUI.getState().toast({
    message: account ? t('features.mail.toast.reconnect', { account }) : t('features.mail.toast.reconnectAny'),
    kind: 'info',
    timeout: 15_000,
    action: { label: t('features.mail.toast.sync'), run: () => void syncNow({ connect: true }) },
  })
}

function schedule(): void {
  window.clearInterval(timer)
  timer = 0
  const cfg = readMail()
  if (cfg.auto !== 'interval' || !configured()) return
  timer = window.setInterval(() => {
    if (currentToken()) void syncNow()
    else {
      patch({ reconnect: true })
      nudge()
    }
  }, cfg.everyMin * 60_000)
}

/* ------------------------------------------------------------------ "Load images" */

/** Rows whose next "Show images" change is ours (a revert) — not a request. */
const ignoreNext = new Set<ID>()

async function onImagesToggle(rowId: ID, on: boolean, force = false): Promise<void> {
  const { applyImages } = await engine()
  const prop = readMail().props?.images
  const revert = () => {
    if (!prop) return
    ignoreNext.add(rowId)
    useWorkspace.getState().setRowProperty(rowId, prop, !on)
  }
  try {
    const r = await applyImages(rowId, on, currentToken() ? gctx() : null, force)
    if (r === 'edited') {
      revert()
      useUI.getState().toast({ message: t('features.mail.toast.edited'), kind: 'info', timeout: 10_000, action: { label: t('features.mail.toast.replace'), run: () => void replaceAnyway(rowId, on) } })
    } else if (r === 'missing') {
      revert()
      useUI.getState().toast({
        message: t('features.mail.toast.noCopy'),
        kind: 'info',
        timeout: 10_000,
        action: { label: t('features.mail.connect'), run: () => void connectGmail().then((ok) => ok && void replaceAnyway(rowId, on)) },
      })
    }
  } catch (e) {
    revert()
    useUI.getState().toast({ message: errorInfo(e).text, kind: 'error' })
  }
}

/** Set the checkbox again (ours) and render. */
async function replaceAnyway(rowId: ID, on: boolean): Promise<void> {
  const prop = readMail().props?.images
  if (prop) {
    ignoreNext.add(rowId)
    useWorkspace.getState().setRowProperty(rowId, prop, on)
  }
  await onImagesToggle(rowId, on, true)
}

/* ------------------------------------------------------------------ lifecycle */

let started = false
let unsubs: Array<() => void> = []

export function startMail(): () => void {
  if (started) return stopMail
  started = true
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  channel?.addEventListener('message', (e: MessageEvent<{ type?: string; ws?: string }>) => {
    if (e.data?.type === 'changed' && e.data.ws === wsKey()) void refresh()
  })
  void refresh()
    .then(() => {
      schedule()
      // "when One opens" / "every N minutes": after a reload there is no token yet — one click
      const cfg = readMail()
      if (cfg.auto !== 'manual' && configured() && !currentToken()) window.setTimeout(nudge, 1500)
    })
    .catch((e) => console.warn('[one] mail: could not load its state', e instanceof Error ? e.message : e))

  unsubs.push(onTokenChange(() => patch({ connected: !!currentToken() })))

  let prevMail = useWorkspace.getState().settings.mail
  let prevPages = useWorkspace.getState().pages
  unsubs.push(
    useWorkspace.subscribe((s) => {
      if (s.settings.mail !== prevMail) {
        const a = prevMail
        prevMail = s.settings.mail
        if (a?.auto !== s.settings.mail?.auto || a?.everyMin !== s.settings.mail?.everyMin || a?.databaseId !== s.settings.mail?.databaseId) schedule()
      }
      if (s.pages === prevPages) return
      const prev = prevPages
      prevPages = s.pages
      const dbId = s.settings.mail?.databaseId
      const prop = s.settings.mail?.props?.images
      if (!dbId || !prop || isApplyingCloudChange()) return
      for (const id in s.pages) {
        const p = s.pages[id]
        const before = prev[id]
        if (p === before || !before || p.databaseId !== dbId) continue
        const on = !!p.properties[prop]
        if (on === !!before.properties[prop]) continue
        if (ignoreNext.delete(id)) continue
        void onImagesToggle(id, on)
      }
    }),
  )
  return stopMail
}

export function stopMail(): void {
  if (!started) return
  started = false
  window.clearInterval(timer)
  cancelRun()
  unsubs.forEach((u) => u())
  unsubs = []
  channel?.close()
  channel = null
}

/* ------------------------------------------------------------------ settings hand-off */

let wantTab = false

/** Open Settings on the Mail tab. */
export function openMailSettings(): void {
  wantTab = true
  useUI.getState().openModal({ type: 'settings' })
}

/** SettingsModal asks when it opens (the answer holds for this tick: StrictMode runs initialisers twice). */
export function consumeMailSettingsRequest(): boolean {
  if (!wantTab) return false
  window.setTimeout(() => (wantTab = false), 0)
  return true
}

/* ------------------------------------------------------------------ test hook (dev, or ?e2e) */

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneMail?: unknown }).__oneMail = {
    state: () => JSON.parse(JSON.stringify(useMail.getState())),
    stored: async () => JSON.parse(JSON.stringify(await loadState())),
    /** a token without Google's window (the cloud suite: the team server's CSP keeps Google's script out) */
    setToken: (value: string, account?: string) => {
      setTokenForTests(value)
      if (account) patch({ account })
    },
    sync: () => syncNow(),
    organiseEarlier,
    reset: resetMailSync,
  }
}
