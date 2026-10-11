/**
 * The app's helpers the pure model takes as `deps` (content identity, value keys, icon keys, block keys,
 * the schema-normalised doc), with a cache per content object: classification, the event's digest and
 * the segment's parts read the same content once.
 */
import type { JSONContent } from '@tiptap/core'
import type { BlockCanon, CanonDeps } from '../model/canon'
import { normalizeContent } from '../../history/snapshots'
import { iconKey, valueKey } from '../../history/props'
import { blockKey, docKey, sameBlock, sameStoredBlock } from '../../history/diff'

const keys = new WeakMap<object, string>()
const normal = new WeakMap<object, JSONContent | null>()

/** A block both sides share around a compared region (the trailing-paragraph rule then acts as on the whole doc). */
const SENTINEL: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: '\u0000' }] }
const emptyPara = (b: JSONContent) => b.type === 'paragraph' && !b.content?.length

/** The equal blocks at the start and the end of two block lists (as stored, ids aside): [lo, endA, endB). */
function trim(A: JSONContent[], B: JSONContent[]): [number, number, number] {
  let lo = 0
  while (lo < A.length && lo < B.length && sameStoredBlock(A[lo], B[lo])) lo++
  let ea = A.length
  let eb = B.length
  while (ea > lo && eb > lo && sameStoredBlock(A[ea - 1], B[eb - 1])) {
    ea--
    eb--
  }
  return [lo, ea, eb]
}

/**
 * contentKey(a) === contentKey(b) without the whole doc's key when the docs share most blocks (typing in a long page):
 * the blocks equal as stored at the start and the end are left out (equal as stored ⇒ equal as the schema reads them —
 * its normalisation is block by block), and only the region between them is normalised and keyed — framed so the
 * trailing empty paragraphs go exactly as they would on the whole doc.
 */
function contentSame(a: JSONContent | null | undefined, b: JSONContent | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.type !== b.type || a.attrs || b.attrs) return deps.contentKey(a) === deps.contentKey(b)
  const A = a.content ?? []
  const B = b.content ?? []
  const [lo, ea, eb] = trim(A, B)
  if (lo === A.length && lo === B.length) return true
  // the shared tail holds only empty paragraphs: the region reaches the end (they may go, as on the whole doc)
  let toEnd = true
  for (let i = ea; i < A.length; i++)
    if (!emptyPara(A[i])) {
      toEnd = false
      break
    }
  const region = (X: JSONContent[], end: number): JSONContent => ({ type: 'doc', content: [...(lo ? [SENTINEL] : []), ...X.slice(lo, toEnd ? X.length : end), ...(toEnd ? [] : [SENTINEL])] })
  return docKey(normalizeContent(region(A, ea))) === docKey(normalizeContent(region(B, eb)))
}

/** A block's canonical form (blockList's), and whether the schema reads it as an empty paragraph. */
interface FullCanon extends BlockCanon {
  empty: boolean
}

const canonOf = (b: JSONContent): FullCanon => ({ id: typeof b.attrs?.id === 'string' && b.attrs.id ? (b.attrs.id as string) : null, canon: blockKey(b), empty: emptyPara(b) })

/**
 * Every block of a stored list as the schema reads it (normalised one by one — the shared block after them keeps the
 * trailing empty paragraphs), or null when the schema cannot read them (the whole doc is then read as stored).
 */
function canonsOf(blocks: JSONContent[]): FullCanon[] | null {
  const doc: JSONContent = { type: 'doc', content: [...blocks, SENTINEL] }
  const n = normalizeContent(doc)
  if (!n || n === doc || (n.content?.length ?? 0) !== blocks.length + 1) return null
  return n.content!.slice(0, blocks.length).map(canonOf)
}

/** A page's last block list (its stored blocks and their canonical forms), to key the next one by what changed. */
interface PageBlocks {
  raw: JSONContent[]
  full: FullCanon[]
  /** the canonical forms' length (the cache's budget) */
  size: number
}
const PAGES_MAX = 256
const BYTES_MAX = 16_000_000
const lastBlocks = new Map<string, PageBlocks>()
let lastBytes = 0

function keepBlocks(key: string, raw: JSONContent[], full: FullCanon[]): void {
  const old = lastBlocks.get(key)
  if (old) {
    lastBlocks.delete(key)
    lastBytes -= old.size
  }
  let size = 0
  for (const b of full) size += b.canon.length * 2
  lastBlocks.set(key, { raw, full, size })
  lastBytes += size
  while (lastBlocks.size > PAGES_MAX || lastBytes > BYTES_MAX) {
    const [first, v] = lastBlocks.entries().next().value as [string, PageBlocks]
    lastBlocks.delete(first)
    lastBytes -= v.size
  }
}
const blockLists = new WeakMap<object, BlockCanon[]>()

/**
 * blockList (model/canon.ts) of a page's content, keyed by what changed: the blocks equal as stored at the start and
 * the end of the page's last list keep their canonical forms, only the region between is read through the schema —
 * the same result as reading the whole doc (its normalisation is block by block), at the cost of the change.
 */
function blocks(content: JSONContent | null | undefined, key?: string): BlockCanon[] {
  if (!content) return []
  const hit = blockLists.get(content)
  if (hit) return hit
  const raw = content.content ?? []
  const prev = key ? lastBlocks.get(key) : undefined
  let full: FullCanon[] | null = null
  let stored = false
  if (prev && !content.attrs) {
    const [lo, ea, eb] = trim(prev.raw, raw)
    const mid = lo === eb ? [] : canonsOf(raw.slice(lo, eb))
    if (mid) full = [...prev.full.slice(0, lo), ...mid, ...prev.full.slice(ea)]
  }
  if (!full) {
    full = content.attrs ? null : canonsOf(raw)
    if (!full) {
      // as blockList reads it: the doc as the schema reads it, else as stored
      const n = normalizeContent(content)
      stored = n === content
      full = (n?.content ?? []).map(canonOf)
    }
  }
  // read as stored (the schema could not read the doc): never a base for the next list
  if (key && !stored && full.length === raw.length) keepBlocks(key, raw, full)
  // the trailing empty paragraphs go (as blockList drops them)
  let end = full.length
  while (end > 1 && full[end - 1].empty) end--
  const out = full.slice(0, end).map(({ id, canon }) => ({ id, canon }))
  blockLists.set(content, out)
  return out
}

export const deps: CanonDeps = {
  // = history's contentKey(), sharing the one schema parse with normalize()
  contentKey(content) {
    if (!content) return docKey(content)
    let k = keys.get(content)
    if (k === undefined) {
      k = docKey(deps.normalize!(content))
      keys.set(content, k)
    }
    return k
  },
  normalize(content) {
    if (!content) return null
    let n = normal.get(content)
    if (n === undefined) {
      n = normalizeContent(content)
      normal.set(content, n)
    }
    return n
  },
  valueKey,
  iconKey,
  blockKey,
  sameBlock,
  contentSame,
  blocks,
}
