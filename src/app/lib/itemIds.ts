/**
 * Task ids (`workItem.itemId`) — pure, no dependency but nanoid. A task's identity across the workspace:
 * a COPY gets a new id (paste of a copy, duplicate, page duplicate, templates, unsync of a synced reference),
 * a MOVE keeps it. Links (`blockedBy` / `related`) among the tasks of one copy follow the copy; links to tasks
 * outside it stay as they are.
 *
 * Works on TipTap JSON (type literal 'workItem'); every walk is iterative — a page nested thousands of blocks
 * deep never overflows the stack. Nothing here mutates its input (store content is frozen): changed nodes are
 * new objects, everything else is shared.
 *
 * Synced blocks: the content of a REFERENCE (`syncedBlock` with `sourcePageId` set) is a cached copy of its
 * original — its tasks ARE the original's (same ids), owned by the synced-block service. The walks here skip
 * it unless told otherwise; a reference that stops being one (Unsync) is a copy and is re-minted then.
 */
import type { JSONContent } from '@tiptap/core'
import { customAlphabet } from 'nanoid'

/** 'wi_' + 10 URL-safe characters (editor/workitem/attrs.ts re-exports it). */
export const ITEM_ID = /^wi_[A-Za-z0-9_-]{10}$/

/**
 * The 64 characters of an id, SPELLED OUT: nanoid takes its alphabet literally (it does not expand ranges —
 * '0-9A-Za-z_-' would be an alphabet of 8 characters and collide constantly).
 */
export const ITEM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'

const fresh = customAlphabet(ITEM_ALPHABET, 10)

/** A new task id ('wi_' + 10 characters of ITEM_ALPHABET — 64^10 ≈ 1.2e18 ids). */
export function newItemId(): string {
  return `wi_${fresh()}`
}

const ITEM = 'workItem'
const SYNCED = 'syncedBlock'
/** Blocks whose content is inline: no task inside, never walked. */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])

const isNode = (n: unknown): n is JSONContent => !!n && typeof n === 'object' && !Array.isArray(n)
/** A synced reference: its content is the original's (same task ids). */
export const isSyncedRef = (n: JSONContent): boolean => n.type === SYNCED && typeof n.attrs?.sourcePageId === 'string' && !!n.attrs.sourcePageId
const walkable = (n: JSONContent, skipRefs: boolean) => Array.isArray(n.content) && !TEXTBLOCKS.has(n.type ?? '') && !INLINE.has(n.type ?? '') && !(skipRefs && isSyncedRef(n))

/**
 * Every node of `root` mapped bottom-up: `fn` gets each task (its content already mapped) and returns it or a
 * replacement. Same object back when nothing changed; changed ancestors are new objects, the rest is shared.
 */
export function mapItemNodes(root: JSONContent, fn: (item: JSONContent) => JSONContent, opts: { skipSyncedRefs?: boolean } = {}): JSONContent {
  const skipRefs = opts.skipSyncedRefs ?? true
  type Frame = { n: JSONContent; i: number; out: unknown[] | null }
  const stack: Frame[] = [{ n: root, i: 0, out: null }]
  let result = root
  while (stack.length) {
    const f = stack[stack.length - 1]
    const kids = walkable(f.n, skipRefs) ? (f.n.content as unknown[]) : null
    if (kids && f.i < kids.length) {
      const c = kids[f.i++]
      if (isNode(c) && !INLINE.has(c.type ?? '')) stack.push({ n: c, i: 0, out: null })
      else if (f.out) f.out.push(c)
      continue
    }
    stack.pop()
    let node: JSONContent = f.out ? { ...f.n, content: f.out as JSONContent[] } : f.n
    if (node.type === ITEM) node = fn(node)
    const parent = stack[stack.length - 1]
    if (!parent) {
      result = node
      break
    }
    if (node !== f.n && !parent.out) parent.out = (parent.n.content as unknown[]).slice(0, parent.i - 1)
    if (parent.out) parent.out.push(node)
  }
  return result
}

/** Calls `fn` for every task of `root` in document order (iterative; synced references skipped by default). */
export function eachItemNode(root: JSONContent | null | undefined, fn: (item: JSONContent) => void, opts: { skipSyncedRefs?: boolean } = {}): void {
  if (!isNode(root)) return
  const skipRefs = opts.skipSyncedRefs ?? true
  const stack: JSONContent[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === ITEM) fn(n)
    if (!walkable(n, skipRefs)) continue
    const kids = n.content as unknown[]
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i]
      if (isNode(c) && !INLINE.has(c.type ?? '')) stack.push(c)
    }
  }
}

/** The itemIds of every task in `doc` (synced references skipped: their tasks are the original's). */
export function collectItemIds(doc: JSONContent | null | undefined, into: Set<string> = new Set()): Set<string> {
  eachItemNode(doc, (n) => {
    const id = n.attrs?.itemId
    if (typeof id === 'string' && ITEM_ID.test(id)) into.add(id)
  })
  return into
}

/** A link list mapped through `map` (same array when nothing changes). */
function mapLinks(v: unknown, map: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(v)) return v
  let out: unknown[] | null = null
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    const to = typeof x === 'string' ? map.get(x) : undefined
    if (to !== undefined && to !== x) {
      if (!out) out = v.slice(0, i)
      out.push(to)
    } else if (out) out.push(x)
  }
  return out ?? v
}

/** A task's attrs: links through `map`, the given changes on top — the same node when nothing changes. */
function withAttrs(n: JSONContent, change: Record<string, unknown>, map: ReadonlyMap<string, string> | null): JSONContent {
  const a = n.attrs ?? {}
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [k, v] of Object.entries(change)) {
    if (a[k] === v || (v === null && (a[k] === undefined || a[k] === null))) continue
    next[k] = v
    changed = true
  }
  if (map?.size) {
    for (const k of ['blockedBy', 'related'] as const) {
      const v = mapLinks(a[k], map)
      if (v !== a[k]) {
        next[k] = v
        changed = true
      }
    }
  }
  return changed ? { ...n, attrs: { ...a, ...next } } : n
}

const RESET = { status: 'todo', doneAt: null, due: null, reminder: null } as const

export interface RemintOptions {
  /** old → new itemId; ids missing in it get a fresh one (and are added) — one map for one copy */
  map?: Map<string, string>
  /** start the tasks fresh: open, no done time, no due date, no reminder (people and links stay) */
  reset?: boolean
  /** leave synced references alone (default true): their tasks are the original's */
  skipSyncedRefs?: boolean
}

/**
 * The copy of `doc` with a fresh itemId for every task (a task without a valid one gets one too), links among
 * the mapped ids remapped, links to other tasks kept. `reset`: see RemintOptions.
 */
export function remintItems(doc: JSONContent, opts: RemintOptions = {}): { doc: JSONContent; map: Map<string, string> } {
  const skipSyncedRefs = opts.skipSyncedRefs ?? true
  const map = opts.map ?? new Map<string, string>()
  eachItemNode(
    doc,
    (n) => {
      const id = n.attrs?.itemId
      if (typeof id === 'string' && ITEM_ID.test(id) && !map.has(id)) map.set(id, newItemId())
    },
    { skipSyncedRefs },
  )
  const out = mapItemNodes(
    doc,
    (n) => {
      const old = n.attrs?.itemId
      const itemId = typeof old === 'string' && map.has(old) ? map.get(old)! : newItemId()
      return withAttrs(n, { itemId, ...(opts.reset ? RESET : {}) }, map)
    },
    { skipSyncedRefs },
  )
  return { doc: out, map }
}

/** Every task of `doc` started fresh (open, no done time, no due date, no reminder) — ids, people and links stay. */
export function resetItems(doc: JSONContent, opts: { skipSyncedRefs?: boolean } = {}): JSONContent {
  return mapItemNodes(doc, (n) => withAttrs(n, RESET, null), opts)
}

/** Every task's own itemId and its links mapped through `map` (entries it lacks are kept). */
export function remapItemLinks(doc: JSONContent, map: ReadonlyMap<string, string>, opts: { skipSyncedRefs?: boolean } = {}): JSONContent {
  if (!map.size) return doc
  return mapItemNodes(
    doc,
    (n) => {
      const old = n.attrs?.itemId
      const to = typeof old === 'string' ? map.get(old) : undefined
      return withAttrs(n, to !== undefined ? { itemId: to } : {}, map)
    },
    opts,
  )
}

/**
 * The outermost tasks of a block list, in document order, as they are (the same objects) — what a 'replace'
 * of that list keeps. Tasks inside a synced reference are the original's and stay out.
 */
export function outermostItems(blocks: readonly JSONContent[] | null | undefined): JSONContent[] {
  const out: JSONContent[] = []
  if (!Array.isArray(blocks)) return out
  const stack: JSONContent[] = []
  for (let i = blocks.length - 1; i >= 0; i--) if (isNode(blocks[i])) stack.push(blocks[i])
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === ITEM) {
      out.push(n)
      continue
    }
    if (!walkable(n, true)) continue
    const kids = n.content as unknown[]
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i]
      if (isNode(c) && !INLINE.has(c.type ?? '')) stack.push(c)
    }
  }
  return out
}

/** Does a block list / doc hold a task (synced references skipped)? */
export function holdsItemNode(doc: JSONContent | readonly JSONContent[] | null | undefined): boolean {
  const list = Array.isArray(doc) ? doc : doc ? [doc as JSONContent] : []
  return outermostItems(list).length > 0
}
