/**
 * Version history. Page snapshots live in their own IndexedDB store
 * (one-history/snapshots), separate from the workspace blob:
 *   idx:<pageId>  → SnapshotMeta[] (oldest → newest)
 *   snap:<id>     → SnapshotBody (content + title + icon)
 *
 * Policy (startHistory): on the first edit of a page in this session the PRE-edit state is
 * saved; while editing continues, at most one snapshot every settings.historyIntervalMin
 * minutes (trailing, so the latest state is always captured). Max 100 per page — thinned
 * so that recent history stays dense and older history gets sparser.
 */
import type { JSONContent } from '@tiptap/core'
import { createStore, delMany, get, setMany, type UseStore } from 'idb-keyval'
import { plainText, useWorkspace } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import type { ID, PageIcon } from '../../store/types'
import { newId } from '../../lib/ids'

export type SnapshotReason = 'session' | 'auto' | 'ai' | 'restore' | 'manual'

export interface SnapshotMeta {
  id: ID
  pageId: ID
  at: number
  reason: SnapshotReason
  title: string
  words: number
  blocks: number
  hash: string
}

export interface SnapshotBody {
  content: JSONContent | null
  title: string
  icon: PageIcon | null
}

export const MAX_SNAPSHOTS = 100

let store: UseStore | undefined
function db(): UseStore | undefined {
  if (!store && typeof indexedDB !== 'undefined') store = createStore('one-history', 'snapshots')
  return store
}

const idxKey = (pageId: ID) => `idx:${pageId}`
const bodyKey = (id: ID) => `snap:${id}`

/* ---------------- change notifications ---------------- */

const listeners = new Set<(pageId: ID) => void>()
export function onHistoryChange(fn: (pageId: ID) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (pageId: ID) => listeners.forEach((l) => l(pageId))

/* ---------------- helpers ---------------- */

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function hashContent(content: JSONContent | null, title: string): string {
  const json = JSON.stringify(content ?? null)
  return `${fnv1a(json)}.${json.length.toString(36)}.${fnv1a(title)}`
}

export function countWords(content: JSONContent | null): number {
  const text = plainText(content, 2_000_000)
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function isEmptyDoc(content: JSONContent | null): boolean {
  if (!content?.content?.length) return true
  return content.content.every((b) => b.type === 'paragraph' && !b.content?.length)
}

/** Serialize read-modify-write cycles per page. */
const queues = new Map<ID, Promise<unknown>>()
function enqueue<T>(pageId: ID, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(pageId) ?? Promise.resolve()
  const next = prev.then(job, job)
  queues.set(
    pageId,
    next.catch(() => undefined),
  )
  return next
}

/**
 * Thin a snapshot list (oldest → newest) down to `max`: everything from the last hour stays,
 * then one per 10 min (24 h), one per hour (7 d), one per day (30 d), one per week after that.
 * Within a bucket the newest snapshot survives. Pure; exported for testing.
 */
export function thinSnapshots(list: SnapshotMeta[], max = MAX_SNAPSHOTS, now = Date.now()): { keep: SnapshotMeta[]; drop: SnapshotMeta[] } {
  if (list.length <= max) return { keep: list, drop: [] }
  const MIN = 60_000
  const H = 60 * MIN
  const D = 24 * H
  const bucketOf = (m: SnapshotMeta): string => {
    const age = now - m.at
    if (age < H) return `x${m.id}`
    if (age < D) return `m${Math.floor(m.at / (10 * MIN))}`
    if (age < 7 * D) return `h${Math.floor(m.at / H)}`
    if (age < 30 * D) return `d${Math.floor(m.at / D)}`
    return `w${Math.floor(m.at / (7 * D))}`
  }
  const seen = new Set<string>()
  const keepRev: SnapshotMeta[] = []
  const drop: SnapshotMeta[] = []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    const b = bucketOf(m)
    if (seen.has(b)) drop.push(m)
    else {
      seen.add(b)
      keepRev.push(m)
    }
  }
  let keep = keepRev.reverse()
  if (keep.length > max) {
    drop.push(...keep.slice(0, keep.length - max))
    keep = keep.slice(keep.length - max)
  }
  return { keep, drop }
}

/* ---------------- public storage API ---------------- */

export async function listSnapshots(pageId: ID): Promise<SnapshotMeta[]> {
  const s = db()
  if (!s) return []
  try {
    return (await get<SnapshotMeta[]>(idxKey(pageId), s)) ?? []
  } catch {
    return []
  }
}

export async function loadSnapshot(id: ID): Promise<SnapshotBody | undefined> {
  const s = db()
  if (!s) return undefined
  return get<SnapshotBody>(bodyKey(id), s)
}

async function writeSnapshot(pageId: ID, body: SnapshotBody, reason: SnapshotReason, at = Date.now()): Promise<SnapshotMeta | null> {
  const s = db()
  if (!s) return null
  return enqueue(pageId, async () => {
    const idx = (await get<SnapshotMeta[]>(idxKey(pageId), s)) ?? []
    const hash = hashContent(body.content, body.title)
    const latest = idx[idx.length - 1]
    if (latest && latest.hash === hash) return null // identical to the newest version
    const meta: SnapshotMeta = {
      id: newId(),
      pageId,
      at,
      reason,
      title: body.title,
      words: countWords(body.content),
      blocks: body.content?.content?.length ?? 0,
      hash,
    }
    const { keep, drop } = thinSnapshots([...idx, meta])
    await setMany(
      [
        [bodyKey(meta.id), body],
        [idxKey(pageId), keep],
      ],
      s,
    )
    if (drop.length) await delMany(drop.map((d) => bodyKey(d.id)), s)
    emit(pageId)
    return meta
  }).catch((e) => {
    console.warn('[one] history snapshot failed', e)
    return null
  })
}

/**
 * Save the page's current state as a version right now (e.g. before an AI replace or a
 * restore). Resolves with the new snapshot, or null when nothing changed since the last one.
 */
export async function snapshotNow(pageId: ID, reason: SnapshotReason = 'manual'): Promise<SnapshotMeta | null> {
  const p = useWorkspace.getState().pages[pageId]
  if (!p || isEmptyDoc(p.content)) return null
  const s = session.get(pageId)
  if (s) {
    s.last = Date.now()
    s.dirty = false
  }
  return writeSnapshot(pageId, { content: p.content, title: p.title, icon: p.icon }, reason)
}

/** Restore a snapshot into the page (saves the current state first). */
export async function restoreSnapshot(pageId: ID, snapId: ID): Promise<SnapshotMeta | null> {
  const body = await loadSnapshot(snapId)
  if (!body) throw new Error('Snapshot not found')
  const before = await snapshotNow(pageId, 'restore')
  const st = useWorkspace.getState()
  st.setContent(pageId, body.content, 'history')
  const page = useWorkspace.getState().pages[pageId]
  if (page && body.title !== page.title) st.updatePage(pageId, { title: body.title })
  return before
}

/** Delete all versions of a page. */
export async function clearHistory(pageId: ID): Promise<void> {
  const s = db()
  if (!s) return
  await enqueue(pageId, async () => {
    const idx = (await get<SnapshotMeta[]>(idxKey(pageId), s)) ?? []
    await delMany([idxKey(pageId), ...idx.map((m) => bodyKey(m.id))], s)
  })
  emit(pageId)
}

/* ---------------- background service ---------------- */

interface SessionState {
  last: number
  dirty: boolean
  timer?: number
}
const session = new Map<ID, SessionState>()

function intervalMs(): number {
  const min = Number(useWorkspace.getState().settings.historyIntervalMin)
  return Math.max(0.25, Number.isFinite(min) && min > 0 ? min : 5) * 60_000
}

function captureCurrent(pageId: ID, reason: SnapshotReason) {
  const s = session.get(pageId)
  if (s) {
    s.dirty = false
    s.last = Date.now()
    if (s.timer) window.clearTimeout(s.timer)
    s.timer = undefined
  }
  const p = useWorkspace.getState().pages[pageId]
  if (!p || p.trashed || isEmptyDoc(p.content)) return
  void writeSnapshot(pageId, { content: p.content, title: p.title, icon: p.icon }, reason)
}

function schedule(pageId: ID, s: SessionState) {
  if (s.timer) return
  const wait = Math.min(2_000_000_000, Math.max(1000, s.last + intervalMs() - Date.now()))
  s.timer = window.setTimeout(() => {
    s.timer = undefined
    if (s.dirty) captureCurrent(pageId, 'auto')
  }, wait)
}

let running = false

/** Start the snapshot service. Call once after hydrate(). Returns a stop function. */
export function startHistory(): () => void {
  if (running || typeof window === 'undefined') return () => {}
  running = true

  const unsub = useWorkspace.subscribe((state, prev) => {
    if (!state.ready || state.pages === prev.pages || isApplyingRemote()) return
    for (const id in state.pages) {
      const p = state.pages[id]
      const before = prev.pages[id]
      if (!before || p === before || p.contentRev === before.contentRev) continue
      // Restores, sync from other tabs and imports are not user edits.
      if (p.contentOrigin === 'history' || p.contentOrigin === 'sync' || p.contentOrigin === 'import') continue
      let s = session.get(id)
      if (!s) {
        s = { last: Date.now(), dirty: true }
        session.set(id, s)
        // First edit of this session: keep the state the page had before it.
        if (!isEmptyDoc(before.content)) void writeSnapshot(id, { content: before.content, title: before.title, icon: before.icon }, 'session', Date.now() - 1)
        schedule(id, s)
        continue
      }
      s.dirty = true
      if (Date.now() - s.last >= intervalMs()) captureCurrent(id, 'auto')
      else schedule(id, s)
    }
  })

  const flush = () => {
    for (const [id, s] of session) if (s.dirty) captureCurrent(id, 'auto')
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flush)

  return () => {
    running = false
    unsub()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flush)
    for (const s of session.values()) if (s.timer) window.clearTimeout(s.timer)
    session.clear()
  }
}
