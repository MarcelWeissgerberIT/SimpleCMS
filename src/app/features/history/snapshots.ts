/**
 * Version history. Page snapshots live in their own IndexedDB store
 * (one-history/snapshots), separate from the workspace blob:
 *   idx:<pageId>  → SnapshotMeta[] (oldest → newest)
 *   snap:<id>     → SnapshotBody (content + title + icon; database rows also their stored
 *                   property values with the schema they were read with — props.ts)
 *
 * Policy (startHistory): on the first edit of a page in this session the PRE-edit state is
 * saved; while editing continues, at most one snapshot every settings.historyIntervalMin
 * minutes (trailing, so the latest state is always captured). An edit is a content change, a
 * new title or icon, or — for a database row — a changed property value. Writes by Claude, an
 * agent, an automation or the MCP bridge (aiWrite) keep the state right before them as an "AI"
 * version. Max 100 per page — thinned so that recent history stays dense and older history
 * gets sparser.
 */
import type { JSONContent } from '@tiptap/core'
import { createStore, delMany, get, setMany, type UseStore } from 'idb-keyval'
import { pageChanges, plainText, useWorkspace } from '../../store/store'
import { isApplyingRemote, onReplacedByOlder } from '../../store/persistence'
import type { ID, Page, PageIcon } from '../../store/types'
import { newId } from '../../lib/ids'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { getExtensions } from '../../editor'
import { docKey } from './diff'
import { t } from '../../i18n'
import { blankRow, iconKey, propsChanged, propsKey, propsOf, restoreProps, type NotRestored, type SnapshotProps } from './props'

/** 'older': the version this build had before an older build of One (another tab) let a task go (store/persistence.ts) */
export type SnapshotReason = 'session' | 'auto' | 'ai' | 'restore' | 'manual' | 'script' | 'older'

export interface SnapshotMeta {
  id: ID
  pageId: ID
  at: number
  reason: SnapshotReason
  /** who wrote next, shown with the reason ('script': the script's name) */
  by?: string
  title: string
  words: number
  blocks: number
  hash: string
}

export interface SnapshotBody {
  content: JSONContent | null
  title: string
  icon: PageIcon | null
  /** database rows: stored property values + the schema then (absent: content only — older versions, plain pages) */
  props?: SnapshotProps
}

/** A page's current state as a snapshot body (rows with their properties). */
export function bodyOf(p: Page): SnapshotBody {
  const props = p.databaseId ? propsOf(p) : null
  return { content: p.content, title: p.title, icon: p.icon, ...(props ? { props } : {}) }
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

let schema: Schema | null = null

/**
 * Content identity independent of how it was written: the schema fills in default attributes
 * (e.g. colspan on table cells) that the editor adds on load, block ids are ignored and so is
 * the empty trailing paragraph the editor appends.
 */
export function contentKey(content: JSONContent | null | undefined): string {
  if (!content) return docKey(content)
  try {
    schema ??= getSchema(getExtensions())
    const json = schema.nodeFromJSON(content).toJSON() as JSONContent
    // the editor keeps an empty trailing paragraph after a final atom block (trailing node)
    const blocks = [...(json.content ?? [])]
    while (blocks.length > 1 && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) blocks.pop()
    return docKey({ ...json, content: blocks })
  } catch {
    return docKey(content)
  }
}

export function hashContent(content: JSONContent | null, title: string): string {
  const json = contentKey(content)
  return `${fnv1a(json)}.${json.length.toString(36)}.${fnv1a(title)}`
}

/** Hash of a whole version: content + title, plus icon and property values when there are any (older hashes stay valid). */
export function hashBody(body: Pick<SnapshotBody, 'content' | 'title' | 'icon' | 'props'>): string {
  const base = hashContent(body.content, body.title)
  const icon = iconKey(body.icon)
  const props = propsKey(body.props)
  return icon || (props && props !== '[]') ? `${base}.${fnv1a(`${icon}\n${props}`)}` : base
}

/** Hash of a page as it is now (to find the versions that differ from it). */
export const hashPage = (p: Page): string => hashBody(bodyOf(p))

export function countWords(content: JSONContent | null): number {
  const text = plainText(content, 2_000_000)
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function isEmptyDoc(content: JSONContent | null): boolean {
  if (!content?.content?.length) return true
  return content.content.every((b) => b.type === 'paragraph' && !b.content?.length)
}

/** Nothing worth a version: an empty page; a database entry also needs no title, icon or stored value. */
const nothingToKeep = (p: Page) => isEmptyDoc(p.content) && (!p.databaseId || blankRow(p))

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

async function writeSnapshot(pageId: ID, body: SnapshotBody, reason: SnapshotReason, at = Date.now(), by?: string): Promise<SnapshotMeta | null> {
  const s = db()
  if (!s) return null
  return enqueue(pageId, async () => {
    const idx = (await get<SnapshotMeta[]>(idxKey(pageId), s)) ?? []
    const hash = hashBody(body)
    const latest = idx[idx.length - 1]
    if (latest && latest.hash === hash) return null // identical to the newest version
    const meta: SnapshotMeta = {
      id: newId(),
      pageId,
      at,
      reason,
      ...(by ? { by: by.slice(0, 120) } : {}),
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
 * `by` names the writer that follows (a script's name for 'script').
 */
export async function snapshotNow(pageId: ID, reason: SnapshotReason = 'manual', by?: string): Promise<SnapshotMeta | null> {
  const p = useWorkspace.getState().pages[pageId]
  if (!p || nothingToKeep(p)) return null
  const s = session.get(pageId)
  if (s) {
    s.last = Date.now()
    s.dirty = false
  }
  return writeSnapshot(pageId, bodyOf(p), reason, Date.now(), by)
}

export interface RestoreResult {
  /** the state before the restore, as a version (its undo) */
  before: SnapshotMeta | null
  /** properties that were left as they are (deleted since, another type, an option deleted) */
  notRestored: NotRestored[]
}

/**
 * Restore a snapshot into the page: content, title, icon and — for a database row — the property
 * values that can go back. The current state is saved first and returned, so the restore can always
 * be undone — when that state is already the newest version, that version is returned instead.
 */
export async function restoreSnapshot(pageId: ID, snapId: ID): Promise<RestoreResult> {
  const body = await loadSnapshot(snapId)
  if (!body) throw new Error('Snapshot not found')
  const cur = useWorkspace.getState().pages[pageId]
  if (!cur) throw new Error('Page not found')
  const s = session.get(pageId)
  if (s) {
    s.last = Date.now()
    s.dirty = false
  }
  // even an empty page is kept here: undo must be able to bring it back
  const now = bodyOf(cur)
  const before = (await writeSnapshot(pageId, now, 'restore')) ?? (await listSnapshots(pageId)).filter((m) => m.hash === hashBody(now)).at(-1) ?? null
  const st = useWorkspace.getState()
  restoring++
  try {
    st.setContent(pageId, body.content, 'history')
    const page = useWorkspace.getState().pages[pageId]
    if (page && body.title !== page.title) st.updatePage(pageId, { title: body.title })
    if (page && iconKey(body.icon) !== iconKey(page.icon)) st.updatePage(pageId, { icon: body.icon ?? null })
    const notRestored = body.props ? restoreProps(pageId, body.props) : []
    return { before, notRestored }
  } finally {
    restoring--
  }
}

/** A restore is writing: its own title / icon / property writes start no session and no AI version. */
let restoring = 0

/* ---------------- writes by Claude, agents, automations, the MCP bridge ---------------- */

let aiDepth = 0
/** pages already kept as an "AI" version in the current aiWrite (outermost scope) */
let aiKept = new Set<ID>()

/**
 * Run writes by Claude, an agent, an automation or the MCP bridge (synchronous store writes). Before
 * the first of them touches a row's properties or a page's title / icon, that page's state is kept as
 * an "AI" version — once per page per call, however many writes follow (no snapshot storm).
 * Content writes keep their version themselves (snapshotNow(…, 'ai') before setContent).
 */
export function aiWrite<T>(fn: () => T): T {
  aiDepth++
  try {
    return fn()
  } finally {
    aiDepth--
    if (!aiDepth) aiKept = new Set()
  }
}

export const isAIWriting = () => aiDepth > 0

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

/* ---------------- demo history (fresh workspace) ---------------- */

const blockText = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(blockText).join('')

/** The page as it read a few hours ago: the first paragraph without its last sentence-run (or null). */
function earlierWording(blocks: JSONContent[]): JSONContent[] | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'paragraph' || !b.content?.length) continue
    const texts = b.content.filter((c) => c.type === 'text' && c.text?.trim())
    if (texts.length >= 2) {
      // drop the last text run (e.g. a bold closing sentence) and the space before it
      const cut = b.content.lastIndexOf(texts[texts.length - 1])
      const content = b.content.slice(0, cut).map((c) => ({ ...c }))
      const last = content[content.length - 1]
      if (last?.type === 'text' && last.text) last.text = last.text.replace(/\s+$/, '')
      return [...blocks.slice(0, i), { ...b, content }, ...blocks.slice(i + 1)]
    }
    const words = blockText(b).trim().split(/\s+/)
    if (words.length >= 8 && b.content.length === 1 && b.content[0].type === 'text') {
      const text = words.slice(0, Math.ceil(words.length * 0.6)).join(' ')
      return [...blocks.slice(0, i), { ...b, content: [{ ...b.content[0], text }] }, ...blocks.slice(i + 1)]
    }
  }
  return null
}

/**
 * A fresh workspace ships with a short, back-dated history for one page (the Welcome page), so
 * the version tape has something to scrub on day one: 3 days, 2 days and 1 day ago the page ended
 * 3 / 2 / 1 blocks earlier (the oldest under a draft title); until 3 hours ago its first paragraph
 * read slightly differently. Only when the page has no versions yet; same storage format as
 * every snapshot.
 */
export async function seedDemoHistory(pageId: ID): Promise<void> {
  const s = db()
  const p = useWorkspace.getState().pages[pageId]
  if (!s || !p || isEmptyDoc(p.content)) return
  // the editor fills in default attributes (toggle state, link rel …) when it opens the page:
  // derive the versions from that form, so the diffs show only the intended edits
  let base: JSONContent = p.content!
  try {
    schema ??= getSchema(getExtensions())
    base = schema.nodeFromJSON(p.content).toJSON() as JSONContent
  } catch {
    /* keep the stored form */
  }
  const all = [...(base.content ?? [])]
  while (all.length > 1 && all[all.length - 1].type === 'paragraph' && !all[all.length - 1].content?.length) all.pop()
  if (all.length < 5) return
  const doc = (blocks: JSONContent[]): JSONContent => ({ ...base, content: structuredClone(blocks) })
  const H = 3_600_000
  const now = Date.now()
  const currentHash = hashPage(p)
  // a story that only moves forward: blocks get added day by day, the wording is polished last
  const early = earlierWording(all) ?? all
  const versions: Array<{ at: number; body: SnapshotBody }> = [
    { at: now - 72 * H, body: { content: doc(early.slice(0, -3)), title: t('features.history.demoDraft', { title: p.title }), icon: p.icon } },
    { at: now - 48 * H, body: { content: doc(early.slice(0, -2)), title: p.title, icon: p.icon } },
    { at: now - 24 * H, body: { content: doc(early.slice(0, -1)), title: p.title, icon: p.icon } },
    { at: now - 3 * H, body: { content: doc(early), title: p.title, icon: p.icon } },
  ]
  await enqueue(pageId, async () => {
    const idx = (await get<SnapshotMeta[]>(idxKey(pageId), s)) ?? []
    if (idx.length) return // the page already has a history of its own
    const metas: SnapshotMeta[] = []
    const entries: Array<[string, SnapshotBody | SnapshotMeta[]]> = []
    for (const v of versions) {
      const hash = hashBody(v.body)
      if (hash === currentHash || metas.some((m) => m.hash === hash)) continue
      const meta: SnapshotMeta = {
        id: newId(),
        pageId,
        at: v.at,
        reason: 'auto',
        title: v.body.title,
        words: countWords(v.body.content),
        blocks: v.body.content?.content?.length ?? 0,
        hash,
      }
      metas.push(meta)
      entries.push([bodyKey(meta.id), v.body])
    }
    if (!metas.length) return
    const { keep, drop } = thinSnapshots(metas)
    await setMany([...entries.filter(([k]) => !drop.some((d) => bodyKey(d.id) === k)), [idxKey(pageId), keep]], s)
    emit(pageId)
  }).catch((e) => console.warn('[one] demo history failed', e))
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
  if (!p || p.trashed || nothingToKeep(p)) return
  void writeSnapshot(pageId, bodyOf(p), reason)
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
    const { changed, removed } = pageChanges(state.pages, prev.pages)
    // pages deleted for good take their history with them
    for (const id of removed) {
      session.delete(id)
      void clearHistory(id).catch(() => undefined)
    }
    for (const id of changed) {
      const p = state.pages[id]
      const before = prev.pages[id]
      if (!before || p === before || restoring) continue
      const content = p.contentRev !== before.contentRev
      // title, icon, a row's property values
      const meta = p.title !== before.title || iconKey(p.icon) !== iconKey(before.icon) || propsChanged(before, p)
      if (!content && !meta) continue
      // Restores, sync from other tabs and imports are not user edits; a folder / GitHub pick-up ('file') snapshots itself.
      if (!meta && (p.contentOrigin === 'history' || p.contentOrigin === 'sync' || p.contentOrigin === 'import' || p.contentOrigin === 'file')) continue
      // Claude / an agent / an automation: the state right before, as an "AI" version
      if (meta && aiDepth && !aiKept.has(id)) {
        aiKept.add(id)
        if (!nothingToKeep(before)) void writeSnapshot(id, bodyOf(before), 'ai', Date.now() - 1)
      }
      let s = session.get(id)
      if (!s) {
        // Opening a page can make the editor rewrite it (block ids, normalisation) without any
        // visible change — that is not an edit and must not start a session.
        if (!meta && contentKey(before.content) === contentKey(p.content)) continue
        s = { last: Date.now(), dirty: true }
        session.set(id, s)
        // First edit of this session: keep the state the page had before it.
        if (!nothingToKeep(before) && !aiDepth) void writeSnapshot(id, bodyOf(before), 'session', Date.now() - 1)
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
  // an older build of One (another tab) let a task go — deleted there, or the page replaced: the version that had it
  const offOlder = onReplacedByOlder((v) => {
    if (v.content) void writeSnapshot(v.pageId, { content: v.content, title: v.title, icon: v.icon }, 'older', Date.now() - 1)
  })

  return () => {
    running = false
    unsub()
    offOlder()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flush)
    for (const s of session.values()) if (s.timer) window.clearTimeout(s.timer)
    session.clear()
  }
}
