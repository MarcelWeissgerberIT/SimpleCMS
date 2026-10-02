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

async function saveNow() {
  try {
    setStatus('saving')
    await idbSet(KEY, getWorkspaceSnapshot())
    setStatus('saved')
    channel?.postMessage({ type: 'changed', from: TAB_ID })
  } catch (e) {
    console.error('[one] failed to save workspace', e)
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
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveNow, 400)
  })

  const onMessage = async (ev: MessageEvent) => {
    if (ev.data?.type !== 'changed' || ev.data.from === TAB_ID) return
    const ws = await loadWorkspace()
    if (!ws) return
    applyingRemote = true
    // mark content as coming from sync so open editors refresh
    const current = useWorkspace.getState().pages
    for (const p of Object.values(ws.pages)) {
      const cur = current[p.id]
      if (cur && cur.contentRev !== p.contentRev) p.contentOrigin = 'sync'
    }
    useWorkspace.getState().replaceAll(ws)
    applyingRemote = false
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
