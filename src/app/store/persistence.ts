/**
 * IndexedDB persistence + live cross-tab sync.
 * - Whole workspace saved under one key (debounced).
 * - Other tabs are notified via BroadcastChannel and reload from IndexedDB.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useWorkspace, getWorkspaceSnapshot, emptyWorkspace, WORKSPACE_VERSION, defaultSettings } from './store'
import type { Workspace } from './types'
import { newId } from '../lib/ids'

const KEY = 'one.workspace.v1'
const TAB_ID = newId()
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-sync') : null

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error'
let status: SyncStatus = 'idle'
const statusListeners = new Set<(s: SyncStatus) => void>()
function setStatus(s: SyncStatus) {
  status = s
  statusListeners.forEach((l) => l(s))
}
export function getSaveStatus(): SyncStatus {
  return status
}
export function onSaveStatus(fn: (s: SyncStatus) => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/** Upgrade older persisted shapes. */
export function migrate(raw: unknown): Workspace {
  const ws = { ...emptyWorkspace(), ...(raw as Partial<Workspace>) }
  ws.settings = { ...defaultSettings(), ...(ws.settings ?? {}) }
  ws.people = ws.people ?? []
  ws.recent = ws.recent ?? []
  ws.version = WORKSPACE_VERSION
  for (const p of Object.values(ws.pages)) {
    p.contentRev = p.contentRev ?? 0
    p.contentOrigin = p.contentOrigin ?? null
    p.properties = p.properties ?? {}
    p.settings = { ...{ fullWidth: false, smallText: false, font: 'sans' as const, locked: false }, ...(p.settings ?? {}) }
  }
  return ws
}

export async function loadWorkspace(): Promise<Workspace | null> {
  try {
    const raw = await idbGet(KEY)
    return raw ? migrate(raw) : null
  } catch (e) {
    console.error('[one] failed to load workspace', e)
    return null
  }
}

let saveTimer: number | undefined
let applyingRemote = false

/** True while a workspace update from another tab is being applied (automations etc. should ignore it). */
export function isApplyingRemote(): boolean {
  return applyingRemote
}

/*
 * Local changes not yet written to IndexedDB. When another tab broadcasts a change we
 * merge: everything comes from IndexedDB except what this tab changed and hasn't saved yet,
 * so a fast typist in two tabs never loses keystrokes to a sync.
 */
const dirtyPages = new Set<string>()
const dirtyDbs = new Set<string>()
let dirtyMeta = false

function trackDirty<T>(next: Record<string, T>, prev: Record<string, T>, into: Set<string>) {
  if (next === prev) return
  for (const id in next) if (next[id] !== prev[id]) into.add(id)
  for (const id in prev) if (!(id in next)) into.add(id)
}

async function saveNow() {
  const pages = [...dirtyPages]
  const dbs = [...dirtyDbs]
  const meta = dirtyMeta
  dirtyPages.clear()
  dirtyDbs.clear()
  dirtyMeta = false
  try {
    setStatus('saving')
    await idbSet(KEY, getWorkspaceSnapshot())
    setStatus('saved')
    channel?.postMessage({ type: 'changed', from: TAB_ID })
  } catch (e) {
    console.error('[one] failed to save workspace', e)
    pages.forEach((id) => dirtyPages.add(id))
    dbs.forEach((id) => dirtyDbs.add(id))
    dirtyMeta ||= meta
    setStatus('error')
  }
}

/** Force an immediate save (e.g. before unload or after import). */
export function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer)
  return saveNow()
}

/** Start autosave + cross-tab sync. Call once after hydrate(). */
export function startPersistence(): () => void {
  const unsub = useWorkspace.subscribe((state, prev) => {
    if (!state.ready || applyingRemote) return
    if (
      state.pages === prev.pages &&
      state.databases === prev.databases &&
      state.settings === prev.settings &&
      state.people === prev.people &&
      state.recent === prev.recent
    )
      return
    trackDirty(state.pages, prev.pages, dirtyPages)
    trackDirty(state.databases, prev.databases, dirtyDbs)
    if (state.settings !== prev.settings || state.people !== prev.people || state.recent !== prev.recent) dirtyMeta = true
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveNow, 400)
  })

  const onMessage = async (ev: MessageEvent) => {
    if (ev.data?.type !== 'changed' || ev.data.from === TAB_ID) return
    const ws = await loadWorkspace()
    if (!ws) return
    const local = useWorkspace.getState()
    // keep this tab's unsaved changes
    for (const id of dirtyPages) {
      if (local.pages[id]) ws.pages[id] = local.pages[id]
      else delete ws.pages[id]
    }
    for (const id of dirtyDbs) {
      if (local.databases[id]) ws.databases[id] = local.databases[id]
      else delete ws.databases[id]
    }
    if (dirtyMeta) {
      ws.settings = local.settings
      ws.people = local.people
      ws.recent = local.recent
    }
    // mark content coming from the other tab so open editors refresh
    for (const p of Object.values(ws.pages)) {
      const cur = local.pages[p.id]
      if (cur && cur !== p && cur.contentRev !== p.contentRev) p.contentOrigin = 'sync'
    }
    applyingRemote = true
    try {
      local.replaceAll(ws)
    } finally {
      applyingRemote = false
    }
  }
  channel?.addEventListener('message', onMessage)

  const onUnload = () => {
    if (saveTimer) void saveNow()
  }
  window.addEventListener('beforeunload', onUnload)

  return () => {
    unsub()
    channel?.removeEventListener('message', onMessage)
    window.removeEventListener('beforeunload', onUnload)
  }
}
