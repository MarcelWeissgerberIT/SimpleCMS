/**
 * Synced blocks — pure JSON helpers (no store, no editor): find the synced blocks of a doc,
 * compare their content, write new content into them without disturbing what didn't change.
 */
import type { JSONContent } from '@tiptap/core'
import { BLOCK_ID_TYPES } from '../schema/base'

export const SYNCED = 'syncedBlock'
/** setContent origin of every write the synced-block service makes. */
export const SYNCED_ORIGIN = 'synced'

const ID_TYPES = new Set(BLOCK_ID_TYPES)
/** Inline content: no block ids below these. */
const INLINE = new Set(['text', 'mention', 'inlineMath', 'hardBreak'])

export interface SyncedHit {
  syncId: string
  /** null = the original; a page id = a reference. */
  sourcePageId: string | null
  /** Block id of the syncedBlock node. */
  blockId: string | null
  node: JSONContent
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** Every synced block of a doc in document order (outermost only — they never nest). */
export function findSynced(doc: JSONContent | null | undefined): SyncedHit[] {
  const out: SyncedHit[] = []
  const walk = (n: JSONContent) => {
    for (const c of n.content ?? []) {
      if (!c || typeof c !== 'object' || c.type === 'text') continue
      if (c.type === SYNCED) {
        const syncId = str(c.attrs?.syncId)
        if (syncId) out.push({ syncId, sourcePageId: str(c.attrs?.sourcePageId), blockId: str(c.attrs?.id), node: c })
        continue
      }
      if (c.content) walk(c)
    }
  }
  if (doc) walk(doc)
  return out
}

/* ------------------------------------------------------------------ comparison */

/** JSON with sorted keys and without block ids: equal text = equal content. */
function stable(v: unknown, blockAttrs = false): string {
  if (Array.isArray(v)) return `[${v.map((x) => stable(x)).join(',')}]`
  if (!v || typeof v !== 'object') return JSON.stringify(v ?? null)
  const o = v as Record<string, unknown>
  const isBlock = typeof o.type === 'string' && ID_TYPES.has(o.type)
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined && !(blockAttrs && k === 'id'))
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k], k === 'attrs' && isBlock)}`).join(',')}}`
}

/** Comparison key of block content: block ids and key order don't matter. */
export function contentKey(content: JSONContent[] | undefined): string {
  return stable(content ?? [])
}

/* ------------------------------------------------------------------ ids */

/** A block with fresh ids everywhere (new blocks never collide with ids already on a page). */
function withFreshIds(n: JSONContent, fresh: () => string): JSONContent {
  const out: JSONContent = { ...n }
  if (n.type && ID_TYPES.has(n.type)) out.attrs = { ...n.attrs, id: fresh() }
  if (n.content && n.type !== 'text') out.content = n.content.map((c) => withFreshIds(c, fresh))
  return out
}

/**
 * `next` with the block ids of `prev` wherever a block stayed in place (unchanged blocks from the
 * start and the end; changed blocks in between paired by position and type). Written into a page,
 * only what really changed differs — an open editor patches just that range and keeps its caret.
 */
export function adoptIds(next: JSONContent[], prev: JSONContent[] | undefined, fresh: () => string): JSONContent[] {
  const old = prev ?? []
  const nk = next.map((n) => stable(n))
  const ok = old.map((n) => stable(n))
  let head = 0
  while (head < next.length && head < old.length && nk[head] === ok[head]) head++
  let tail = 0
  while (tail < next.length - head && tail < old.length - head && nk[next.length - 1 - tail] === ok[old.length - 1 - tail]) tail++
  return next.map((n, i) => {
    if (i < head) return old[i]
    if (i >= next.length - tail) return old[old.length - (next.length - i)]
    const twin = old[i]
    if (!twin || twin.type !== n.type || i >= old.length - tail) return withFreshIds(n, fresh)
    const out: JSONContent = { ...n }
    if (n.type && ID_TYPES.has(n.type)) out.attrs = { ...n.attrs, id: twin.attrs?.id ?? fresh() }
    // inline content carries no block ids: only block children (list items, rows, cells …) are paired
    if (n.content && n.content.some((c) => !INLINE.has(c.type ?? 'text'))) out.content = adoptIds(n.content, twin.content, fresh)
    return out
  })
}

/* ------------------------------------------------------------------ rewriting */

type Mapper = (node: JSONContent) => JSONContent | JSONContent[]

/** The doc with every synced block passed through `fn` (an array = unwrap). Same object when nothing changed. */
export function mapSynced(doc: JSONContent, fn: Mapper): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    if (!n.content || n.type === 'text') return n
    let changed = false
    const kids: JSONContent[] = []
    for (const c of n.content) {
      if (c && c.type === SYNCED) {
        const r = fn(c)
        if (r !== c) changed = true
        if (Array.isArray(r)) kids.push(...r)
        else kids.push(r)
        continue
      }
      const w = c ? walk(c) : c
      if (w !== c) changed = true
      kids.push(w)
    }
    return changed ? { ...n, content: kids } : n
  }
  return walk(doc)
}

/** The doc with the synced blocks of `syncId` (all, or only references) replaced by their content. */
export function unsyncDoc(doc: JSONContent, syncId: string, which: 'all' | 'references' = 'all'): JSONContent {
  return mapSynced(doc, (n) => {
    if (str(n.attrs?.syncId) !== syncId) return n
    if (which === 'references' && !str(n.attrs?.sourcePageId)) return n
    return n.content?.length ? n.content : [{ type: 'paragraph' }]
  })
}
