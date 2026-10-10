/**
 * Document schema generations — which node types a build of One reads, what a copy written by an OLDER build
 * is missing, and how to take its other changes over without losing what it could not read. Pure (TipTap
 * JSON). The editor's schema (editor/schema/base.ts) re-exports the two constants; the team cloud's page
 * documents (cloud/content.ts) and the local workspace's records (persistence.ts) guard against older copies.
 *
 * An older build that meets a node type it does not know:
 *  - 'drop'   — y-prosemirror (team cloud) deletes the node from its copy of the shared document; the person
 *               there never saw it, so nothing they did can mean it — `restoreNewer` puts every such node back,
 *               as it is, where its neighbours are now (`putBack`: the older copy stays the truth for everything else);
 *  - 'unwrap' — the editor's sanitize (local workspace) keeps its blocks, the node itself goes; the person there
 *               saw its title and notes as plain blocks and may have edited them — `rewrapNewer` wraps the node
 *               again around what is left of its blocks (their edits kept), and lets a node go only when none of
 *               its blocks is left (deleted there, or the whole page replaced: a restore, an import).
 * Its stored copy then lacks those nodes. Taken as it is, that loss would reach this build's copy, the
 * server or the other tabs.
 */
import type { JSONContent } from '@tiptap/core'
import { diff, type Hunk } from './merge'

/**
 * Generation of the document schema this build reads and writes. A tab that does not know a node type
 * DELETES it from a shared document (y-prosemirror), so the team server lets a collab connection write only
 * when it sends a generation ≥ the server's minimum (docs/CLOUD.md § Schema gate). Bump it with every new
 * node type or attribute an older client would lose (and add the type below) — and raise the server's
 * MIN_CLIENT_SCHEMA one release later.
 *  1 = the task block (`workItem`)
 */
export const DOC_SCHEMA_VERSION = 1

/** Node types an older generation does not know: type → the generation that brought it. */
export const NODE_GENERATIONS: Readonly<Record<string, number>> = { workItem: 1 }

export type LossMode = 'drop' | 'unwrap'

const newerThan = (type: string | undefined, gen: number) => !!type && (NODE_GENERATIONS[type] ?? 0) > gen

/** How many nodes of each type newer than generation `gen` a doc holds. */
export function newerCounts(doc: JSONContent | null | undefined, gen: number): Map<string, number> {
  const out = new Map<string, number>()
  each(doc, (n) => {
    if (newerThan(n.type, gen)) out.set(n.type!, (out.get(n.type!) ?? 0) + 1)
  })
  return out
}

/** Does any node newer than `gen` that `before` holds miss in `after`? */
export function lostNewer(before: JSONContent | null | undefined, after: JSONContent | null | undefined, gen: number): boolean {
  const a = newerCounts(after, gen)
  for (const [type, n] of newerCounts(before, gen)) if ((a.get(type) ?? 0) < n) return true
  return false
}

/** The doc as a client of generation `gen` holds it: newer nodes dropped, or unwrapped into their blocks. */
export function asGeneration(doc: JSONContent, gen: number, mode: LossMode): JSONContent {
  const walk = bottomUp<JSONContent[]>((n, kid) => {
    const kids = (n.content ?? []).flatMap((c) => kid(c) ?? [c])
    if (newerThan(n.type, gen)) return mode === 'drop' ? [] : kids
    if (!n.content) return [n]
    return [kids.length === n.content.length && kids.every((k, i) => k === n.content![i]) ? n : { ...n, content: kids }]
  })
  return walk(doc)[0] ?? { type: 'doc', content: [] }
}

/**
 * `after` — what a client of generation `gen` made of `before` (losing its newer nodes, `mode`) plus its own
 * edits — with every newer node of `before` back. 'drop': each lost node put back where its neighbours are now
 * (`putBack`; nothing else of `before` comes back). 'unwrap': `rewrapNewer` (what is left of a node's blocks,
 * edits and all, wrapped again). `after` itself when it lost nothing.
 */
export function restoreNewer(before: JSONContent | null, after: JSONContent | null, gen: number, mode: LossMode): JSONContent | null {
  if (mode === 'unwrap') return rewrapNewer(before, after, gen).doc
  if (!before || !lostNewer(before, after, gen)) return after
  if (!after) return before
  return putBack(before, after, gen)
}

/* ------------------------------------------------------------------ the local stamp's fingerprint */

/** A 53-bit hash of a string (cyrb53) — a fingerprint, not a secret. */
function hash53(str: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * What the generation stamp of a stored copy is bound to (persistence.ts): a hash of its content's JSON — with
 * or without newer nodes. An older build copies the stamp along (an unknown field), even onto a copy it changed
 * (its own cross-tab merge takes the newer side's stamp), so a stamp counts only for the very content it was
 * written with. IndexedDB (structured clone) and localStorage (JSON) keep the key order; a copy that reads
 * differently only costs a check that finds nothing lost.
 */
export function contentFingerprint(doc: JSONContent | null | undefined): number {
  try {
    return hash53(JSON.stringify(doc ?? null))
  } catch {
    return -1
  }
}

/* ------------------------------------------------------------------ blocks: identity, prints, likeness */

/** The block a newer node's content has to start with (its schema) — put back when none of it is left there. */
const LEAD: Readonly<Record<string, string>> = { workItem: 'paragraph' }
/** Parts of a container: no text of their own tells two apart — the same part when they sit in the same place. */
const PARTS = new Set(['column', 'tab', 'detailsSummary', 'detailsContent', 'tableRow', 'tableCell', 'tableHeader'])
/** Parts their container cannot do without: one emptied keeps an empty line. */
/** the parts an editor gives no id */
const UNNAMED = new Set(['column', 'detailsSummary', 'detailsContent', 'tableRow', 'tableCell', 'tableHeader'])
const FIXED_PARTS = new Set(['column', 'tab', 'detailsContent', 'tableCell', 'tableHeader'])
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
/** Content a newer node never goes into (a task never sits in a table). */
const NO_WRAP = new Set(['table', 'tableRow', 'tableCell', 'tableHeader'])
/** Content that takes any block — where a newer node may be put back. */
const BLOCK_LISTS = new Set(['doc', 'callout', 'blockquote', 'column', 'tab', 'listItem', 'taskItem', 'detailsContent', 'syncedBlock', 'meetingNotes'])
/** Content that has to start with a paragraph. */
const PARA_FIRST = new Set(['listItem', 'taskItem'])
/** A container whose first block must be a paragraph (a list item, a task's title). */
const leadFirst = (type: string | undefined) => PARA_FIRST.has(type ?? '') || LEAD[type ?? ''] === 'paragraph'
/** Blocks of a changed stretch compared pair by pair at most (beyond that it was replaced as a whole). */
const PAIR_CELLS = 40_000
/** Line comparisons spent telling containers apart (beyond it: equal lines only) — the worst page stays fast. */
const LINE_BUDGET = 20_000

const idOf = (n: JSONContent): string | null => (typeof n.attrs?.id === 'string' && n.attrs.id ? n.attrs.id : null)
const isBlock = (n: unknown): n is JSONContent => !!n && typeof n === 'object' && !INLINE.has((n as JSONContent).type ?? '')
const blocksOf = (n: JSONContent): JSONContent[] => (n.content ?? []).filter(isBlock)
const blocky = (n: JSONContent) => !!n.content?.length && n.content.every(isBlock)

/** A newer node's identity across copies: its item id, else its block id, else (a hash of) its value. */
function identity(n: JSONContent): string {
  const a = n.attrs
  if (typeof a?.itemId === 'string' && a.itemId) return `i:${a.itemId}`
  const id = idOf(n)
  return id ? `b:${id}` : `v:${hash53(JSON.stringify(n))}`
}

/** Every node of `n` (itself first, document order) — without recursion: a page nested thousands deep is walked too. */
function each(n: JSONContent | null | undefined, fn: (n: JSONContent) => void): void {
  if (!n || typeof n !== 'object') return
  const stack: JSONContent[] = [n]
  while (stack.length) {
    const x = stack.pop()!
    fn(x)
    const kids = x.content
    if (Array.isArray(kids)) for (let i = kids.length - 1; i >= 0; i--) if (kids[i] && typeof kids[i] === 'object') stack.push(kids[i])
  }
}

/**
 * Every block below `root` (document order) with its parent and its index among the parent's blocks; `fn` returning
 * false skips what is inside that block. Without recursion.
 */
function descend(root: JSONContent, fn: (n: JSONContent, parent: JSONContent, index: number, place: number) => boolean | void): void {
  const stack: Array<{ n: JSONContent; i: number; b: number }> = [{ n: root, i: 0, b: 0 }]
  while (stack.length) {
    const top = stack[stack.length - 1]
    const kids = top.n.content
    if (!Array.isArray(kids) || top.i >= kids.length) {
      stack.pop()
      continue
    }
    const c = kids[top.i++]
    if (!isBlock(c)) continue
    if (fn(c, top.n, top.b++, top.i - 1) === false) continue
    stack.push({ n: c, i: 0, b: 0 })
  }
}

/** How deep blocks nest in `doc` (its own blocks: 1). */
function depthOf(doc: JSONContent | null | undefined): number {
  if (!doc) return 0
  let max = 0
  const stack: Array<[JSONContent, number]> = [[doc, 0]]
  while (stack.length) {
    const [n, d] = stack.pop()!
    if (d > max) max = d
    for (const c of n.content ?? []) if (isBlock(c)) stack.push([c, d + 1])
  }
  return max
}

/** A 64-bit hash of a string (two 32-bit halves, cyrb53's mixing), as 16 hex digits — a print, not a secret. */
function hash64(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/**
 * A value of every node computed bottom up (`own`: from the node's fields and its children's values — `kid(c)`),
 * cached per node: a run costs the size of the doc however deep it nests, and nothing recurses.
 */
function bottomUp<T>(own: (n: JSONContent, kid: (c: unknown) => T | undefined) => T): (n: JSONContent) => T {
  const cache = new Map<JSONContent, T>()
  const kid = (c: unknown) => (c && typeof c === 'object' ? cache.get(c as JSONContent) : undefined)
  const nodes: JSONContent[] = []
  const at: number[] = []
  return (root) => {
    const hit = cache.get(root)
    if (hit !== undefined) return hit
    const base = nodes.length
    nodes.push(root)
    at.push(0)
    while (nodes.length > base) {
      const top = nodes.length - 1
      const n = nodes[top]
      const kids = n.content
      if (Array.isArray(kids) && at[top] < kids.length) {
        const c = kids[at[top]++]
        if (c && typeof c === 'object' && !cache.has(c)) {
          nodes.push(c)
          at.push(0)
        }
        continue
      }
      nodes.pop()
      at.pop()
      cache.set(n, own(n, kid))
    }
    return cache.get(root)!
  }
}

/**
 * Prints of nodes: a node's value — without empty attrs, without the ids `keepId` refuses, without the nodes `skip`
 * names (key order aside). Built bottom up (a node prints its own fields and its children's prints, never a subtree
 * stringified per level). Equal prints, equal values.
 */
function printer(keepId: (id: string) => boolean, skip?: (n: JSONContent) => boolean): (n: JSONContent) => string {
  const idSkip = (k: string, v: unknown) => k === 'id' && typeof v === 'string' && !keepId(v)
  return bottomUp<string>((n, kid) => {
    // its own fields as JSON, then (content) `|` and each child's print — a short one as it is (JSON: it starts with
    // `[`), a longer one as its hash (16 hex digits): every print reads back one way
    let out =
      n.type === 'text' && !n.attrs && !n.marks?.length
        ? `["text",null,${JSON.stringify(n.text ?? null)},null]`
        : JSON.stringify([n.type ?? null, cleanAttrs(n.attrs, idSkip) ?? null, n.text ?? null, n.marks?.map((m) => [m.type, cleanAttrs(m.attrs, () => false) ?? null]) ?? null])
    if (Array.isArray(n.content)) {
      out += '|'
      for (const c of n.content) if (!(skip && c && typeof c === 'object' && skip(c))) out += `${kid(c) ?? 'x'},`
    }
    return out.length > 160 ? hash64(out) : out
  })
}

/** A print as kept in a version entry (blockVersions): 16 hex digits. */
const compact = (print: string) => (print.length === 16 && print[0] !== '[' ? print : hash64(print))

/** `blank`, cached bottom up (for walks that ask it of every block). */
const blanks = () =>
  bottomUp<boolean>((n, kid) =>
    n.type === 'text' ? !n.text : INLINE.has(n.type ?? '') ? false : Array.isArray(n.content) ? n.content.every((c) => kid(c) !== false) : TEXTBLOCKS.has(n.type ?? ''),
  )

/** `doc` — copied when one node object sits in it twice, or in `other` too (a merge can put the same object in two places). */
function unshared(doc: JSONContent, other?: JSONContent): JSONContent {
  const seen = new Set<JSONContent>()
  if (other) each(other, (n) => seen.add(n))
  let twice = false
  each(doc, (n) => {
    if (seen.has(n)) twice = true
    seen.add(n)
  })
  const copy = (n: JSONContent): JSONContent => (n.content ? { ...n, content: n.content.map(copy) } : { ...n })
  return twice ? copy(doc) : doc
}

function memo<T>(fn: (n: JSONContent) => T): (n: JSONContent) => T {
  const cache = new Map<JSONContent, T>()
  return (n) => {
    if (cache.has(n)) return cache.get(n)!
    const v = fn(n)
    cache.set(n, v)
    return v
  }
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V): void {
  const list = map.get(k)
  if (list) list.push(v)
  else map.set(k, [v])
}

/** Attrs without empty values (an editor writes its defaults as null) and without `skip`, in a stable order. */
function cleanAttrs(attrs: Record<string, unknown> | undefined, skip: (k: string, v: unknown) => boolean): Record<string, unknown> | undefined {
  if (!attrs || typeof attrs !== 'object') return undefined
  const keys = Object.keys(attrs)
    .filter((k) => attrs[k] !== null && attrs[k] !== undefined && !skip(k, attrs[k]))
    .sort()
  if (!keys.length) return undefined
  return Object.fromEntries(keys.map((k) => [k, attrs[k]]))
}

/** A block without anything in it: no text, no inline atom, no leaf block (an emptied line, an empty container). */
function blank(n: JSONContent): boolean {
  // (without recursion: the first thing found in it decides)
  const stack: JSONContent[] = [n]
  while (stack.length) {
    const x = stack.pop()!
    if (x.type === 'text') {
      if (x.text) return false
      continue
    }
    if (INLINE.has(x.type ?? '')) return false
    if (!Array.isArray(x.content)) {
      if (!TEXTBLOCKS.has(x.type ?? '')) return false
      continue
    }
    for (const c of x.content) if (c && typeof c === 'object') stack.push(c)
  }
  return true
}

/**
 * Where the versions of a block are bound (blockVersions): its id; else — inside a newer node — the node (`owner`) and
 * its place there: the path from the nearest block around it with an id (or that node), counted from the start and
 * from the end (`#tb1/1/0`, `i:wi_1/-1`). Null: none (no id, in no newer node). `parentOf` / `indexOf` (among the
 * parent's blocks) / `countOf` (the parent's blocks): the doc's structure.
 */
function bindings(
  n: JSONContent,
  gen: number,
  parentOf: (n: JSONContent) => JSONContent | undefined,
  indexOf: (n: JSONContent) => number,
  countOf: (n: JSONContent) => number,
): { id: string } | { owner: string; start: string; end: string } | null {
  const id = idOf(n)
  if (id) return { id: `#${id}` }
  const start: number[] = []
  const end: number[] = []
  let anchor: string | null = null
  for (let x = n, p = parentOf(n); p; x = p, p = parentOf(p)) {
    if (anchor === null) {
      const i = indexOf(x)
      start.push(i)
      end.push(i - countOf(p))
    }
    if (newerThan(p.type, gen)) {
      const owner = identity(p)
      anchor ??= owner
      return { owner, start: `${anchor}/${start.reverse().join('/')}`, end: `${anchor}/${end.reverse().join('/')}` }
    }
    const pid = idOf(p)
    if (anchor === null && pid) anchor = `#${pid}`
  }
  return null
}

/**
 * The versions of blocks this doc holds — what a build of this generation wrote of them, `<binding>|<print>`: a block
 * with an id by its id; one without, inside a newer node, by that node and by its place there counted from the start
 * and from the end (`bindings`). An empty block has none: an emptied line never proves anything. An older build's own
 * cross-tab merge brings such a version back as its own when it saved with typing of its own anywhere on the page (to
 * it, every unwrapped node is a change): persistence.ts keeps the recent ones per page, so `rewrapNewer` (`wrote`)
 * tells that stale copy of a block from an edit made there.
 */
export function blockVersions(doc: JSONContent | null | undefined, gen = 0): string[] {
  const out: string[] = []
  if (!doc || typeof doc !== 'object') return out
  const print = printer(() => false)
  const isBlank = blanks()
  /** how a block's children are bound: the newer node they sit in, the anchor (an id, or that node), the paths below it */
  interface Bound {
    owner: string | null
    anchor: string | null
    start: string
    end: string
    count: number
  }
  const bound = new Map<JSONContent, Bound>([[doc, { owner: null, anchor: null, start: '', end: '', count: blocksOf(doc).length }]])
  descend(doc, (n, parent, index) => {
    const up = bound.get(parent)!
    const id = idOf(n)
    const start = `${up.start}/${index}`
    const end = `${up.end}/${index - up.count}`
    if (!isBlank(n)) {
      const p = compact(print(n))
      if (id) out.push(`#${id}|${p}`)
      else if (up.owner && up.anchor) out.push(`${up.owner}|${p}`, `${up.anchor}${start}|${p}`, `${up.anchor}${end}|${p}`)
    }
    const count = n.content ? blocksOf(n).length : 0
    if (newerThan(n.type, gen)) bound.set(n, { owner: identity(n), anchor: identity(n), start: '', end: '', count })
    else if (id) bound.set(n, { owner: up.owner, anchor: `#${id}`, start: '', end: '', count })
    else bound.set(n, { owner: up.owner, anchor: up.anchor, start: up.anchor !== null ? start : '', end: up.anchor !== null ? end : '', count })
  })
  return out
}

/**
 * How alike two lines of text are, 0 – 1: what is the same at their start and end, against the longer one. 0 when
 * that covers less than half of the shorter one (another line, not an edit of it); one side empty: barely alike.
 */
function textLikeness(p: string, q: string): number {
  if (p === q) return 1
  const min = Math.min(p.length, q.length)
  if (!min) return 0.05
  let pre = 0
  while (pre < min && p.charCodeAt(pre) === q.charCodeAt(pre)) pre++
  let suf = 0
  while (suf < min - pre && p.charCodeAt(p.length - 1 - suf) === q.charCodeAt(q.length - 1 - suf)) suf++
  return 2 * (pre + suf) >= min ? Math.max((pre + suf) / Math.max(p.length, q.length), 0.05) : 0
}

/** `q` is `p` with text typed in (or `p` is `q` with some taken out): the shorter one is the other's start plus its end. */
function typedInto(p: string, q: string): boolean {
  const min = Math.min(p.length, q.length)
  if (!min || p === q) return p === q && !!min
  let pre = 0
  while (pre < min && p.charCodeAt(pre) === q.charCodeAt(pre)) pre++
  let suf = 0
  while (suf < min - pre && p.charCodeAt(p.length - 1 - suf) === q.charCodeAt(q.length - 1 - suf)) suf++
  return pre + suf >= min
}

/** The order-keeping pairing of `n` × `m` items with the most `score` in all (0 = never a pair); none when there are too many. */
function pairUp(n: number, m: number, score: (i: number, j: number) => number): Array<[number, number]> {
  if (!n || !m || n * m > PAIR_CELLS) return []
  const w = m + 1
  const sc = new Float64Array(n * m)
  const best = new Float64Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = (sc[i * m + j] = score(i, j))
      const skip = Math.max(best[(i + 1) * w + j], best[i * w + j + 1])
      best[i * w + j] = s > 0 ? Math.max(skip, s + best[(i + 1) * w + j + 1]) : skip
    }
  }
  const out: Array<[number, number]> = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    const s = sc[i * m + j]
    if (s > 0 && best[i * w + j] === s + best[(i + 1) * w + j + 1]) out.push([i++, j++])
    else if (best[(i + 1) * w + j] >= best[i * w + j + 1]) i++
    else j++
  }
  return out
}

const common = (a: JSONContent[], b: JSONContent[]): JSONContent[] => {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return a.slice(0, i)
}

/**
 * The changed stretches between two key lists (`diff`), each block kept as it is matched to the copy of it nearest its
 * place: where several blocks share a key (identical lines without ids) the diff may keep any of them — the one in the
 * same place relative to its nearest neighbour with another key is taken (typing into the 1st and 3rd of three
 * identical lines keeps the 2nd as it is, never the 3rd).
 */
function keptStretches(a: string[], b: string[]): Hunk[] {
  const hunks = diff(a, b)
  if (!hunks.length) return hunks
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  for (const h of hunks) {
    for (; i < h.a0; i++, j++) pairs.push([i, j])
    i = h.a1
    j = h.b1
  }
  for (; i < a.length; i++, j++) pairs.push([i, j])
  let moved = false
  for (let k = 0; k < pairs.length; k++) {
    const [x, y] = pairs[k]
    const lo = k > 0 ? pairs[k - 1][0] : -1
    const hi = k + 1 < pairs.length ? pairs[k + 1][0] : a.length
    if (hi - lo <= 2) continue
    // (the diagonal of the nearest kept block with another key, looked for a little way)
    let d = 0
    for (let q = 1; q <= 50; q++) {
      const back = pairs[k - q]
      const ahead = pairs[k + q]
      if (!back && !ahead) break
      const r = back && a[back[0]] !== a[x] ? back : ahead && a[ahead[0]] !== a[x] ? ahead : null
      if (r) {
        d = r[0] - r[1]
        break
      }
    }
    const want = y + d
    let best = x
    for (let c = lo + 1; c < hi; c++) if (a[c] === a[x] && Math.abs(c - want) < Math.abs(best - want)) best = c
    if (best !== x) {
      pairs[k] = [best, y]
      moved = true
    }
  }
  if (!moved) return hunks
  const out: Hunk[] = []
  let ai = 0
  let bi = 0
  for (const [x, y] of pairs) {
    if (x > ai || y > bi) out.push({ a0: ai, a1: x, b0: bi, b1: y })
    ai = x + 1
    bi = y + 1
  }
  if (ai < a.length || bi < b.length) out.push({ a0: ai, a1: a.length, b0: bi, b1: b.length })
  return out
}

/** What is known of `before`: its newer nodes (in order), where each block sits, every id. */
interface Before {
  root: JSONContent
  gen: number
  newer: JSONContent[]
  identities: Set<string>
  parent: Map<JSONContent, JSONContent>
  /** a block's index among its parent's blocks */
  index: Map<JSONContent, number>
  /** id → its block (null: more than one block has it) */
  ids: Map<string, JSONContent | null>
  /** how deep blocks nest (its own blocks: 1) */
  depth: number
  /** the blocks without an id and without blocks inside that have this value (built on first use) */
  byPrint: (bare: string) => JSONContent[]
  /** a block's value without any id, as a print (of any block, kept for the whole run) */
  bare: (n: JSONContent) => string
  /** a block's value without the ids `before` lacks (made up there), as a print */
  value: (n: JSONContent) => string
}

function readBefore(root: JSONContent, gen: number): Before {
  let prints: Map<string, JSONContent[]> | null = null
  const byPrint = (v: string) => {
    if (!prints) {
      prints = new Map()
      each(root, (n) => isBlock(n) && !idOf(n) && !blocksOf(n).length && n !== root && push(prints!, out.bare(n), n))
    }
    return prints.get(v) ?? []
  }
  const ids = new Map<string, JSONContent | null>()
  const bare = printer(() => false)
  const kept = printer((id) => ids.has(id))
  /** an id of `before` somewhere in it (else its value is its bare print) */
  const holdsKnown = bottomUp<boolean>((n, kid) => {
    const id = idOf(n)
    return (!!id && ids.has(id)) || (Array.isArray(n.content) && n.content.some((c) => kid(c) === true))
  })
  const value = (n: JSONContent) => (holdsKnown(n) ? kept(n) : bare(n))
  const out: Before = { root, gen, newer: [], identities: new Set(), parent: new Map(), index: new Map(), ids, depth: 0, byPrint, bare, value }
  const rootId = idOf(root)
  if (rootId) ids.set(rootId, root)
  const depth = new Map<JSONContent, number>([[root, 0]])
  descend(root, (n, parent, i) => {
    out.parent.set(n, parent)
    out.index.set(n, i)
    const d = depth.get(parent)! + 1
    depth.set(n, d)
    if (d > out.depth) out.depth = d
    if (newerThan(n.type, gen)) {
      out.newer.push(n)
      out.identities.add(identity(n))
    }
    const id = idOf(n)
    if (id) ids.set(id, ids.has(id) ? null : n)
  })
  return out
}

/**
 * The newer nodes of `before` that `doc` (without the nodes in `skip`) lacks — one for each copy it does not hold. Copies
 * with one identity (two tabs dragged one task at once: both kept) are told apart by their block id first.
 */
function lostIn(B: Before, doc: JSONContent | null, skip?: Set<JSONContent>): Set<JSONContent> {
  const have = new Map<string, number>()
  const exact = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by)
  const twice = (n: JSONContent) => `${identity(n)}\u0001${idOf(n) ?? ''}`
  if (doc)
    descend(doc, (n) => {
      if (skip?.has(n)) return false
      if (!newerThan(n.type, B.gen)) return
      bump(have, identity(n), 1)
      bump(exact, twice(n), 1)
    })
  const lost = new Set<JSONContent>()
  const open: JSONContent[] = []
  for (const n of B.newer) {
    const k = twice(n)
    if ((exact.get(k) ?? 0) > 0) {
      bump(exact, k, -1)
      bump(have, identity(n), -1)
    } else open.push(n)
  }
  for (const n of open) {
    const left = have.get(identity(n)) ?? 0
    if (left > 0) have.set(identity(n), left - 1)
    else lost.add(n)
  }
  return lost
}

/**
 * The deepest nesting the rewrap looks into block by block (its work goes as deep as the page); a page nested deeper
 * gets `rewrapById`. The drop path walks without recursion at any depth.
 */
const MAX_DEPTH = 120

/** Where each block of a copy sits: its parent, its index in the parent's content, its depth, ids, closed blocks. */
interface Layout {
  parent: Map<JSONContent, JSONContent>
  /** index in the parent's content (inline nodes counted too) */
  place: Map<JSONContent, number>
  depth: Map<JSONContent, number>
  /** id → its block (null: more than one has it) */
  ids: Map<string, JSONContent | null>
  /** inside a newer node or a table: nothing goes in there */
  closed: Set<JSONContent>
}

function layout(root: JSONContent, gen: number): Layout {
  const L: Layout = { parent: new Map(), place: new Map(), depth: new Map([[root, 0]]), ids: new Map(), closed: new Set() }
  const shut = (n: JSONContent) => L.closed.has(n) || newerThan(n.type, gen) || NO_WRAP.has(n.type ?? '')
  descend(root, (n, parent, _, place) => {
    L.parent.set(n, parent)
    L.place.set(n, place)
    L.depth.set(n, L.depth.get(parent)! + 1)
    const id = idOf(n)
    if (id) L.ids.set(id, L.ids.has(id) ? null : n)
    if (parent !== root && shut(parent)) L.closed.add(n)
  })
  return L
}

/**
 * `root` with the content of some of its containers rewritten (`edit`: container → its new content, from the content
 * as it is with the containers below it already rewritten), every container around them copied — deepest first,
 * without recursion.
 */
function rebuilt(root: JSONContent, at: Layout, edit: Map<JSONContent, (content: JSONContent[]) => JSONContent[]>): JSONContent {
  const onPath = new Set<JSONContent>()
  for (const n of edit.keys()) for (let x: JSONContent | undefined = n; x && !onPath.has(x); x = at.parent.get(x)) onPath.add(x)
  const copies = new Map<JSONContent, JSONContent>()
  for (const n of [...onPath].sort((x, y) => at.depth.get(y)! - at.depth.get(x)!)) {
    const src = (n.content ?? []).map((c) => copies.get(c) ?? c)
    const fn = edit.get(n)
    copies.set(n, { ...n, content: fn ? fn(src) : src })
  }
  return copies.get(root) ?? root
}

/* ------------------------------------------------------------------ 'drop': put back where the neighbours are */

/**
 * `after` with every newer node of `before` it lacks put back, as it is, where its neighbours are now: after the block
 * that was before it, else before the block that was after it, else into its container, else where that container
 * was (the older copy deleted it — the node never was its to delete). Never into a newer node or a table, never first
 * in a list item. `after` stays the truth for every other block, so nothing of it goes.
 *  - which block of `after` a block of `before` is: the same id; else, in the container it is now, the same value —
 *    without the lost nodes, and without the ids the older editor gave blocks that had none — else, inside a changed
 *    stretch, a block of the same type in the same order;
 *  - the older tab never saw inside a lost node: a block of it that `after` holds elsewhere too (by id) was restructured
 *    on both sides at once (a concurrent move: delete + insert there, the node built around it here) — both stay, as two
 *    concurrent moves do in the shared document (the twin gets a new id when written).
 */
function putBack(before: JSONContent, after: JSONContent, gen: number): JSONContent {
  const B = readBefore(before, gen)
  const lost = lostIn(B, after)
  if (!lost.size) return after
  const A = layout(after, gen)
  const parentA = A.parent
  const placeA = A.place
  const idsA = A.ids
  const closed = A.closed

  /** prints without the lost nodes and without the ids `before` does not know (the older editor made them up) */
  const print = printer((id) => B.ids.has(id), (n) => lost.has(n))
  const unique = (id: string | null) => !!id && !!B.ids.get(id) && !!idsA.get(id)
  const keyOf = (n: JSONContent) => (unique(idOf(n)) ? `#${idOf(n)}` : `=${print(n)}`)
  const text = (n: JSONContent): string => {
    let out = ''
    each(n, (c) => {
      if (out.length < 500 && c.type === 'text') out += c.text ?? ''
    })
    return out.slice(0, 500)
  }
  /** two blocks of one changed stretch: the same type, neither with an id of ours that is another block's */
  const score = (b: JSONContent, a: JSONContent): number => {
    if (b.type !== a.type) return 0
    const bid = idOf(b)
    const aid = idOf(a)
    if ((bid && B.ids.has(bid)) || (aid && B.ids.has(aid))) return 0
    if (blocky(b) || blocky(a) || PARTS.has(b.type ?? '')) return 0.5
    return 0.5 + textLikeness(text(b), text(a)) / 2
  }
  /** a container of `before` (found as `pa`) → its blocks found there */
  const aligned = new Map<JSONContent, Map<JSONContent, JSONContent>>()
  const align = (p: JSONContent, pa: JSONContent): Map<JSONContent, JSONContent> => {
    let out = aligned.get(p)
    if (out) return out
    out = new Map()
    aligned.set(p, out)
    const bs = blocksOf(p).filter((c) => !lost.has(c))
    const as = blocksOf(pa)
    let i = 0
    let j = 0
    const same = (to: number) => {
      for (; i < to; i++, j++) out!.set(bs[i], as[j])
    }
    for (const h of keptStretches(bs.map(keyOf), as.map(keyOf))) {
      same(h.a0)
      for (const [x, y] of pairUp(h.a1 - h.a0, h.b1 - h.b0, (x, y) => score(bs[h.a0 + x], as[h.b0 + y]))) out.set(bs[h.a0 + x], as[h.b0 + y])
      i = h.a1
      j = h.b1
    }
    same(bs.length)
    return out
  }
  /** the block of `after` a block of `before` is (null: none) — found top down, without recursion */
  const found = new Map<JSONContent, JSONContent | null>([[before, after]])
  const mapTo = (b: JSONContent): JSONContent | null => {
    if (found.has(b)) return found.get(b)!
    const chain: JSONContent[] = []
    for (let x: JSONContent | undefined = b; x && !found.has(x); x = B.parent.get(x)) chain.push(x)
    for (let k = chain.length - 1; k >= 0; k--) {
      const c = chain[k]
      const id = idOf(c)
      if (unique(id)) {
        found.set(c, idsA.get(id!)!)
        continue
      }
      const p = B.parent.get(c)
      const pa = p ? found.get(p) : null
      found.set(c, p && pa ? (align(p, pa).get(c) ?? null) : null)
    }
    return found.get(b)!
  }
  const open = (into: JSONContent, at: number) =>
    (into === after || (BLOCK_LISTS.has(into.type ?? '') && !closed.has(into))) && !(PARA_FIRST.has(into.type ?? '') && at === 0)
  interface Put {
    into: JSONContent
    at: number
    seq: number
    node: JSONContent
  }
  const puts: Put[] = []
  const putOf = new Map<JSONContent, Put>()
  /** just after (or before) where the block of `before` `s` is now — outside every container that takes none */
  const nextTo = (s: JSONContent, behind: boolean): { into: JSONContent; at: number } | null => {
    const put = putOf.get(s)
    if (put) return { into: put.into, at: put.at }
    let a = mapTo(s)
    while (a) {
      const into = parentA.get(a)
      if (!into) return null
      const at = placeA.get(a)! + (behind ? 1 : 0)
      if (open(into, at)) return { into, at }
      a = into
    }
    return null
  }
  const blocksIn = memo(blocksOf)
  const placeOf = (L: JSONContent): { into: JSONContent; at: number } => {
    for (let b = L; ; ) {
      const p = B.parent.get(b)
      if (!p) return { into: after, at: after.content?.length ?? 0 }
      const sibs = blocksIn(p)
      const i = B.index.get(b)!
      for (let k = i - 1; k >= 0; k--) {
        const r = nextTo(sibs[k], true)
        if (r) return r
      }
      for (let k = i + 1; k < sibs.length; k++) {
        const r = nextTo(sibs[k], false)
        if (r) return r
      }
      const pa = mapTo(p)
      if (pa) {
        const at = i === 0 ? (PARA_FIRST.has(pa.type ?? '') ? 1 : 0) : (pa.content?.length ?? 0)
        if (open(pa, at)) return { into: pa, at: Math.min(at, pa.content?.length ?? 0) }
      }
      b = p
    }
  }
  const inLost = (n: JSONContent) => {
    for (let p = B.parent.get(n); p; p = B.parent.get(p)) if (lost.has(p)) return true
    return false
  }
  for (const L of B.newer) {
    if (!lost.has(L) || inLost(L)) continue
    const { into, at } = placeOf(L)
    const put = { into, at, seq: puts.length, node: L }
    puts.push(put)
    putOf.set(L, put)
  }
  // the containers that take a node, and every one around them: copied, deepest first (no recursion)
  const byInto = new Map<JSONContent, Put[]>()
  for (const p of puts) push(byInto, p.into, p)
  const edit = new Map<JSONContent, (content: JSONContent[]) => JSONContent[]>()
  for (const [into, list] of byInto)
    edit.set(into, (src) => {
      const mine = list.sort((x, y) => x.at - y.at || x.seq - y.seq)
      const out: JSONContent[] = []
      let m = 0
      for (let i = 0; i <= src.length; i++) {
        while (m < mine.length && mine[m].at <= i) out.push(mine[m++].node)
        if (i < src.length) out.push(src[i])
      }
      return out
    })
  return rebuilt(after, A, edit)
}

/* ------------------------------------------------------------------ 'unwrap': rewrap (an older build that unwraps) */

export interface RewrapOptions {
  /** the older copy replaced the page as a whole (a version restored, a backup or an import there) */
  whole?: boolean
  /** did a build of this generation write this version of a block (an entry of `blockVersions`)? */
  wrote?: (entry: string) => boolean
}

export interface Rewrapped {
  doc: JSONContent | null
  /** Newer nodes of `before` that stay gone (none of their blocks left, or the page replaced): the caller keeps a version. */
  dropped: JSONContent[]
  /**
   * Lines of the newer nodes put back that the result lacks or holds emptied — deleted or cleared there, or lost by the
   * older build's own merge (a line we added it never saw): the caller keeps the version that had them.
   */
  missed: number
}

/** A block of `before` as the older build held it (lost nodes unwrapped), with the lost nodes it sat in (outermost first). */
interface Slot {
  node: JSONContent
  /** as it is in `before` */
  orig: JSONContent
  owners: JSONContent[]
}

/** A block of the older copy (or one of ours put back) and what it is. */
interface Item {
  a: JSONContent
  slot: Slot | null
  /** its slot's index in its level when it is at its place (else -1) */
  at: number
  /** at its place, found elsewhere (moved), added there, or one of ours put back */
  how: 'place' | 'moved' | 'new' | 'back'
  /** unchanged there */
  same: boolean
  /** a version we wrote before (the older merge's stale copy): ours goes in its place */
  stale: boolean
  /** surely that block: much alike, unchanged, or a version we wrote */
  sure: boolean
  /** what is inside it, block by block (null: taken as it is) */
  inner: Level | null
  owners: JSONContent[]
  /** may not go inside a newer node (it holds one, or sits in a table) */
  blocked: boolean
  /** where it is in the older copy (document order) */
  pos: number
}

/** A list of blocks of the older copy, against the list of `before` it is (if any). */
interface Level {
  items: Item[]
  slots: Slot[]
  /** none of its blocks is at its place: the list was replaced as a whole */
  whole: boolean
  /** no newer node goes back in here (a table) */
  noWrap: boolean
  /** the type of the node whose content it is */
  type: string
}

/**
 * Where the older copy holds blocks of ours twice (by id): its own merge appended our changed stretch whole (a task,
 * or a container holding one) next to its own copy of the same blocks — the stale copy is the one in a branch that
 * holds a newer node (the older editor never shows one). Each such block goes from there; a newer node that loses a
 * block goes as a whole (its blocks come back from its copy, `seeds`); a container left empty goes too.
 */
function withoutTwins(B: Before, after: JSONContent, opts: RewrapOptions): { doc: JSONContent; seeds: Set<JSONContent>; loose: Set<string>; beside: Set<JSONContent> } {
  const seeds = new Set<JSONContent>()
  /** lines of ours (no id, in no newer node) the stale copy held in another version than any the older editor holds */
  const beside = new Set<JSONContent>()
  /** the newer nodes that go (their blocks without an id are then found by value, wherever they are) */
  const loose = new Set<string>()
  const count = new Map<string, number>()
  each(after, (n) => {
    const id = isBlock(n) ? idOf(n) : null
    if (id && B.ids.get(id)) count.set(id, (count.get(id) ?? 0) + 1)
  })
  const occ = new Map<string, Array<{ n: JSONContent; path: JSONContent[] }>>()
  const stack: JSONContent[] = []
  const walk = (n: JSONContent) => {
    const id = idOf(n)
    if (id && (count.get(id) ?? 0) > 1) push(occ, id, { n, path: stack.slice() })
    if (!n.content) return
    stack.push(n)
    for (const c of n.content) if (isBlock(c)) walk(c)
    stack.pop()
  }
  walk(after)
  const mine = (n: JSONContent) => newerThan(n.type, B.gen) && B.identities.has(identity(n))
  const holdsMine: (n: JSONContent) => boolean = memo((n) => mine(n) || !!n.content?.some((c) => isBlock(c) && holdsMine(c)))
  const nameless = (n: JSONContent) => !idOf(n) && blocky(n) && !UNNAMED.has(n.type ?? '') && n.type !== 'doc'
  const madeUp: (n: JSONContent) => boolean = memo((n) => {
    const id = idOf(n)
    return (!!id && !B.ids.has(id)) || blocksOf(n).some(madeUp)
  })
  const gone = new Set<JSONContent>()
  /** the copy kept that is a version of ours we wrote before (not ours now): ours goes in its place */
  const ours = new Map<JSONContent, JSONContent>()
  /** where both copies meet → the stale branches there */
  const branches = new Map<JSONContent, Set<JSONContent>>()
  for (const [id, list] of occ) {
    let d = 0
    while (list.every((o) => d < o.path.length && o.path[d] === list[0].path[d])) d++
    // the stale copy: inside a newer node (the older editor never shows one), else in the branch that holds one, else
    // in a container the older editor would have given an id (the older merge's copy of ours: it has none)
    const score = list.map((o) => (o.path.slice(d).some(mine) ? 2 : holdsMine(o.path[d] ?? o.n) ? 1 : o.path.slice(d).some(nameless) ? 0.5 : 0))
    const top = Math.max(...score)
    // (nothing else tells them apart: the one whose branch holds blocks the older editor made is its own — never a
    // copy that goes, which would take them along)
    if (score.every((x) => x === top)) {
      const own = list.map((o) => madeUp(o.path[d] ?? o.n))
      if (own.filter(Boolean).length !== 1) continue
      own.forEach((x, i) => (score[i] = x ? 0 : 1))
    }
    const stale = list.filter((_, i) => score[i] === Math.max(...score))
    const kept = list.filter((_, i) => score[i] !== Math.max(...score))
    for (const o of stale) {
      gone.add(o.n)
      for (const p of o.path.slice(d)) if (mine(p)) gone.add(p)
      if (d > 0) (branches.get(o.path[d - 1]) ?? branches.set(o.path[d - 1], new Set()).get(o.path[d - 1])!).add(o.path[d] ?? o.n)
    }
    // the copy kept says what the block is now: the older tab's edit (whichever copy holds it), else ours — never a
    // version of ours we wrote before
    const k = kept[0].n
    if (kept.length !== 1 || blocksOf(k).length) continue
    const b = B.ids.get(id)!
    const now = B.bare(b)
    const was = (n: JSONContent) => !!opts.wrote && !blank(n) && B.bare(n) !== now && opts.wrote(`#${id}|${compact(B.bare(n))}`)
    const edit = stale.map((o) => o.n).find((n) => !blocksOf(n).length && B.bare(n) !== now && !was(n) && B.bare(n) !== B.bare(k))
    if (B.bare(k) === now && edit) ours.set(k, { ...edit })
    else if (was(k)) ours.set(k, { ...b })
  }
  if (!gone.size) return { doc: after, seeds, loose, beside }
  // a stale branch's lines without an id of ours that the older editor holds exactly, where both copies meet: they go
  const bare = B.bare
  const free = (n: JSONContent) => !blocksOf(n).length && !blank(n) && !UNNAMED.has(n.type ?? '') && !(idOf(n) && B.ids.has(idOf(n)!))
  for (const [at, stale] of branches) {
    const theirs = new Map<string, number>()
    const scan = (n: JSONContent) => {
      if (stale.has(n)) return
      if (free(n) && n !== at) theirs.set(bare(n), (theirs.get(bare(n)) ?? 0) + 1)
      blocksOf(n).forEach(scan)
    }
    scan(at)
    const inNewer = new Set<JSONContent>()
    for (const r of stale)
      each(r, (n) => {
        if (newerThan(n.type, B.gen)) each(n, (c) => inNewer.add(c))
        if (!isBlock(n) || !free(n)) return
        const left = theirs.get(bare(n)) ?? 0
        if (!left) {
          // no copy there as it is here: the older editor's is another version (no id tells which is the newer one) —
          // ours goes right beside it (finish), not in what is left of the stale copy
          const ours = !inNewer.has(n) && !idOf(n) ? B.byPrint(bare(n)) : []
          if (ours.length) {
            ours.forEach((b) => beside.add(b))
            gone.add(n)
          }
          return
        }
        theirs.set(bare(n), left - 1)
        gone.add(n)
      })
  }
  const strip = (n: JSONContent): JSONContent | null => {
    if (ours.has(n)) return ours.get(n)!
    if (gone.has(n)) {
      each(n, (w) => mine(w) && loose.add(identity(w)))
      // what it held of ours comes back where the copy lacks it (finish)
      const ours = mine(n) ? B.newer.find((x) => identity(x) === identity(n)) : B.ids.get(idOf(n)!)
      if (ours) heldIn(ours, n, seeds, B.bare)
      return null
    }
    if (!n.content) return n
    let changed = false
    let left = 0
    const kids: JSONContent[] = []
    for (const c of n.content) {
      const k = isBlock(c) ? strip(c) : c
      if (k !== c) changed = true
      if (k) {
        kids.push(k)
        left++
      } else if (FIXED_PARTS.has(c.type ?? '') && !spare(n, left + n.content.slice(n.content.indexOf(c) + 1).length)) kids.push(emptyPart(c))
    }
    if (!changed) return n
    if (!left && n.type !== 'doc') return null
    if (leadFirst(n.type) && kids[0]?.type !== 'paragraph') kids.unshift({ type: 'paragraph' })
    return { ...n, content: kids }
  }
  return { doc: strip(after) ?? { type: 'doc', content: [] }, seeds, loose, beside }
}

/**
 * A part of `n` can go when emptied: columns keep two, tabs one (`others`: the parts before it that stay and every one
 * after it — those may go too, so this errs on keeping one).
 */
function spare(n: JSONContent, others: number): boolean {
  return (n.type === 'columns' && others >= 2) || (n.type === 'tabs' && others >= 1)
}

/** An emptied part its container cannot do without (a column, a tab …): one empty line — never the id of the one gone. */
function emptyPart(c: JSONContent): JSONContent {
  const out: JSONContent = { ...c, content: [{ type: 'paragraph' }] }
  if (c.attrs && 'id' in c.attrs) {
    const { id: _, ...attrs } = c.attrs
    out.attrs = attrs
  }
  return out
}

/** The blocks of ours (`ours`, a block of `before`) that a copy of it in the older copy (`copy`) holds: by id, else by value. */
function heldIn(ours: JSONContent, copy: JSONContent, out: Set<JSONContent>, bare: (n: JSONContent) => string): void {
  const ids = new Set<string>()
  const prints = new Set<string>()
  each(copy, (n) => {
    if (!isBlock(n)) return
    const id = idOf(n)
    if (id) ids.add(id)
    prints.add(bare(n))
  })
  each(ours, (n) => {
    if (!isBlock(n)) return
    const id = idOf(n)
    if ((id && ids.has(id)) || prints.has(bare(n))) out.add(n)
  })
}

/**
 * Copies of ours the older merge may have appended where no id tells (blocks without one): for each newer node of ours
 * held whole while the older editor's own blocks are there too (an id it made up), with a line without an id of ours —
 * the outermost block around it that is exactly a block of ours (the merge appends our changed stretch whole) → that
 * block of ours (null: none, the node alone).
 */
function suspects(B: Before, doc: JSONContent): Map<JSONContent, JSONContent | null> {
  const out = new Map<JSONContent, JSONContent | null>()
  let madeUp = false
  const found: Array<{ n: JSONContent; path: JSONContent[] }> = []
  const stack: JSONContent[] = []
  const walk = (n: JSONContent, inNewer: boolean) => {
    const id = idOf(n)
    if (!inNewer && id && !B.ids.has(id)) madeUp = true
    const newer = newerThan(n.type, B.gen)
    // (a node of ours holding a block the older editor made — an id it made up — is one put back here around its
    // blocks, never the older merge's copy, which holds ours as we wrote them)
    if (newer && !inNewer && B.identities.has(identity(n)) && !madeUpIn(n) && blocksOf(n).some((c) => !blank(c) && !idOf(c))) found.push({ n, path: stack.slice(1) })
    // (a container with no id anywhere in it, or one it would give an id without one and holding none it made up:
    // never the older editor's own, which gives every such block one)
    else if (!inNewer && !newer && !id && blocky(n) && stack.length && (idless(n) || (!UNNAMED.has(n.type ?? '') && !madeUpIn(n)))) found.push({ n, path: stack.slice(1) })
    else if (!inNewer && !newer && id && !B.ids.has(id) && TEXTBLOCKS.has(n.type ?? '')) theirs.push(text(n))
    if (!n.content) return
    stack.push(n)
    for (const c of n.content) if (isBlock(c)) walk(c, inNewer || newer)
    stack.pop()
  }
  const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
  const idless: (n: JSONContent) => boolean = memo((n) => !idOf(n) && blocksOf(n).every(idless))
  const madeUpIn: (n: JSONContent) => boolean = memo((n) => {
    const id = idOf(n)
    return (!!id && !B.ids.has(id)) || blocksOf(n).some(madeUpIn)
  })
  /** the older editor's own lines (an id it made up): their starts and ends — a line of ours it holds, edited or not, shares one */
  const theirs: string[] = []
  walk(doc, false)
  if (!madeUp || !found.length) return out
  const ends = new Set<string>()
  const cut = (t: string) => [t.slice(0, 8), t.slice(-8)]
  for (const t of theirs) if (t) cut(t).forEach((e) => ends.add(e))
  const near = (w: JSONContent) => {
    let hit = false
    each(w, (c) => {
      if (!hit && c !== w && TEXTBLOCKS.has(c.type ?? '') && !(idOf(c) && B.ids.has(idOf(c)!))) hit = cut(text(c)).some((e) => e && ends.has(e))
    })
    return hit
  }
  const bare = B.bare
  const holds: (n: JSONContent) => boolean = memo((n) => newerThan(n.type, B.gen) || !!n.content?.some((c) => isBlock(c) && holds(c)))
  const ours = new Map<string, JSONContent>()
  each(B.root, (n) => {
    if (n !== B.root && isBlock(n) && (holds(n) || (!idOf(n) && blocky(n))) && !ours.has(bare(n))) ours.set(bare(n), n)
  })
  const units = new Map<JSONContent, { twin: JSONContent | null; path: JSONContent[] }>()
  for (const { n, path } of found) {
    if (!near(n)) continue
    let unit = n
    let twin = ours.get(bare(n)) ?? null
    let at = path.length
    for (let k = path.length - 1; k >= 0; k--) {
      const t = ours.get(bare(path[k]))
      if (t) [unit, twin, at] = [path[k], t, k]
    }
    // a container without a newer node is a copy only when it is exactly one of ours
    if (!twin && !newerThan(n.type, B.gen)) continue
    if (!units.has(unit)) units.set(unit, { twin, path: path.slice(0, at) })
  }
  // the outermost ones
  for (const [unit, { twin, path }] of units) if (!path.some((p) => units.has(p))) out.set(unit, twin)
  return out
}

/**
 * `after` — a copy an older build (generation `gen`, whose editor UNWRAPS node types it does not know) stored
 * of `before`, plus whatever the person did there — with every newer node of `before` that `after` lacks wrapped
 * again around what is left of its blocks. `after` itself is the truth for every block: nothing of `before` is
 * added but the wrappers (and a node's leading block when none is left), and what the older build's own merge
 * dropped of ours beside a stale copy of it — so nothing is ever doubled, and nothing either side wrote is lost.
 *  - which block of `after` is which block of `before`: the same id (wherever it is now); for a block without one
 *    (the older editor gives such blocks a fresh id at every load) the same value — of identical lines, the one in the
 *    same place relative to its neighbours — else, within a changed stretch, the same type and similar text (an edit;
 *    an empty line and one with text only in the same place of the stretch), else it is new; parts (columns, tabs)
 *    holding most of the same lines are the same part in any order, and a line moved inside its container with text
 *    typed into it is still that line (also when it is all that is left of its node);
 *  - a container without an id that the older tab wrapped into one of its own (or out of one it unwrapped) is found
 *    where it is now, and so are the lines of a node none of whose blocks is found where they were (by value);
 *  - text typed into a task's title or notes (plain blocks there) stays in the task; a block added between two of
 *    its blocks, or in the place of blocks that were all its own (never only emptied lines), joins it, as does the
 *    second half of one of its lines split there (Enter); one added at its edge stays outside; one moved there stays
 *    its own task's (dropped between two blocks of another task: that one's — the diff cannot tell a line moved
 *    between two blocks of a task from the task's block moved past it: the title dragged above a line outside the task
 *    wraps that line into the task, nothing lost);
 *  - a node with nothing left there (its blocks deleted, or only emptied lines) stays gone, as does every lost node
 *    when the page was replaced as a whole (`whole`; a stretch that replaced a whole level is that too): `dropped`
 *    lists them, so the caller keeps the version that had them; lines of a node put back that are gone or emptied
 *    there count in `missed` (the caller keeps that version too);
 *  - the older build's own merge keeps a stale copy of ours: a stretch of ours appended whole beside its own copy of
 *    the same blocks (`withoutTwins`, by id; by value — a node or container of ours without ids, never one holding a
 *    block the older editor made, which is one put back here — when its blocks are found surely in the older
 *    editor's own blocks before it, or all of them where the other tab moved it) goes, and what only it held comes
 *    back next to its neighbours (a line in another version there: ours right after it); a block without blocks
 *    inside that comes back exactly as this build wrote it earlier (`wrote`, bound to the block: `bindings`) is this
 *    build's version — never an empty one, never a container (its blocks are compared one by one);
 *  - a newer node never goes inside one, nor into a table; a node that came apart (its blocks moved away from each
 *    other) is put back around the larger part;
 *  - a page nested deeper than MAX_DEPTH gets `rewrapById` (no recursion at any depth).
 * Idempotent: what it returns lacks nothing, so a second pass returns it as it is.
 */
export function rewrapNewer(before: JSONContent | null, after: JSONContent | null, gen: number, opts: RewrapOptions = {}): Rewrapped {
  if (!before) return { doc: after, dropped: [], missed: 0 }
  const B = readBefore(before, gen)
  if (!B.newer.length) return { doc: after, dropped: [], missed: 0 }
  if (!after) return { doc: before, dropped: [], missed: 0 }
  if (opts.whole) return { doc: after, dropped: [...lostIn(B, after)], missed: 0 }
  if (B.depth > MAX_DEPTH || depthOf(after) > MAX_DEPTH) return rewrapById(B, after)
  // the work below tells blocks apart by object: a doc holding one object in two places (or one of `before`) is copied first
  const own = unshared(after, before)
  const ownBefore = unshared(before)
  if (own !== after || ownBefore !== before) {
    const r = rewrapNewer(ownBefore, own, gen, opts)
    return r.doc === own ? { ...r, doc: after } : r
  }
  // nothing to do (the usual case): every node there, no block of ours twice, no copy of ours beside the older editor's
  let twins = false
  const seen = new Set<string>()
  each(after, (n) => {
    const id = !twins && isBlock(n) ? idOf(n) : null
    if (!id || !B.ids.get(id)) return
    if (seen.has(id)) twins = true
    else seen.add(id)
  })
  const lost = lostIn(B, after)
  const maybeStale = suspects(B, after)
  if (!lost.size && !twins && !maybeStale.size) return { doc: after, dropped: [], missed: 0 }
  const { doc, seeds, loose, beside } = twins ? withoutTwins(B, after, opts) : { doc: after, seeds: new Set<JSONContent>(), loose: new Set<string>(), beside: new Set<JSONContent>() }
  const units = doc === after ? maybeStale : suspects(B, doc)
  if (!units.size) return rewrapLost(B, doc, new Set(), opts, loose).finish(seeds, beside)
  // a trial without the copies of ours that may be stale: a copy whose nodes' blocks are found surely, at their place
  // before it, in the older editor's own blocks is the older merge's stale copy — what of it the older editor holds goes
  const trial = rewrapLost(B, doc, new Set(units.keys()), opts, loose, new Set([...units.values()].filter((t): t is JSONContent => !!t)))
  const stale = [...units].filter(([u, twin]) => trial.staleCopy(u, twin))
  if (!stale.length) return rewrapLost(B, doc, new Set(), opts, loose).finish(seeds, beside)
  // (the nodes of a stale copy: their blocks are found by value wherever they are, as in the trial)
  for (const [u] of stale) each(u, (w) => newerThan(w.type, gen) && loose.add(identity(w)))
  return rewrapLost(B, withoutStale(B, doc, stale, trial, seeds, beside), new Set(), opts, loose).finish(seeds, beside)
}

/**
 * The rewrap of a page nested deeper than MAX_DEPTH (the block-by-block work goes as deep as the page): a lost node goes
 * back around its blocks only where all of them are still there by id, side by side and in its order, in a container
 * that takes it; every other one stays gone (`dropped`: the caller keeps the version that had it). No recursion.
 */
function rewrapById(B: Before, after: JSONContent): Rewrapped {
  const own = unshared(after, B.root)
  const lost = lostIn(B, own)
  if (!lost.size) return { doc: after, dropped: [], missed: 0 }
  const A = layout(own, B.gen)
  const inLost = (n: JSONContent) => {
    for (let p = B.parent.get(n); p; p = B.parent.get(p)) if (lost.has(p)) return true
    return false
  }
  const dropped: JSONContent[] = []
  const wraps = new Map<JSONContent, Array<{ from: number; to: number; node: JSONContent }>>()
  for (const L of lost) {
    if (inLost(L)) continue
    const found = blocksOf(L).map((k) => {
      const id = idOf(k)
      return id && B.ids.get(id) ? (A.ids.get(id) ?? null) : null
    })
    const p = found[0] ? A.parent.get(found[0]) : undefined
    const from = found[0] ? A.place.get(found[0])! : -1
    const fits =
      !!p &&
      found.every((a, i) => !!a && A.parent.get(a) === p && A.place.get(a) === from + i) &&
      (p === own || (BLOCK_LISTS.has(p.type ?? '') && !A.closed.has(p))) &&
      !(PARA_FIRST.has(p.type ?? '') && from === 0) &&
      !(wraps.get(p) ?? []).some((w) => w.from < from + found.length && from < w.to)
    if (!fits) {
      dropped.push(L)
      continue
    }
    push(wraps, p, { from, to: from + found.length, node: L })
  }
  if (!wraps.size) return { doc: after, dropped, missed: 0 }
  const edit = new Map<JSONContent, (content: JSONContent[]) => JSONContent[]>()
  for (const [p, list] of wraps)
    edit.set(p, (src) => {
      const out: JSONContent[] = []
      const sorted = list.sort((x, y) => x.from - y.from)
      let i = 0
      for (const w of sorted) {
        out.push(...src.slice(i, w.from))
        const attrs = idOf(w.node) ? w.node.attrs : { ...w.node.attrs, id: `${w.node.type}-${hash53(identity(w.node)).toString(36)}` }
        out.push({ ...w.node, attrs, content: src.slice(w.from, w.to) })
        i = w.to
      }
      out.push(...src.slice(i))
      return out
    })
  return { doc: rebuilt(own, A, edit), dropped, missed: 0 }
}

/**
 * `doc` without what the stale copies of ours (`stale`: copy → the block of ours it is exactly, or null) hold that the
 * older editor holds too (found in the trial): such a block goes; a newer node that loses one goes too, and a container
 * of ours the older editor holds; what they held of ours otherwise comes back next to its blocks there (`seeds`), the
 * rest stays where it is. A container left empty goes.
 */
function withoutStale(
  B: Before,
  doc: JSONContent,
  stale: Array<[JSONContent, JSONContent | null]>,
  trial: { foundAs: (b: JSONContent) => JSONContent | undefined; inLost: (b: JSONContent) => boolean; lostOf: (w: JSONContent) => JSONContent | undefined },
  seeds: Set<JSONContent>,
  beside: Set<JSONContent>,
): JSONContent {
  const gen = B.gen
  const bare = B.bare
  /** a block of the copy → the block of ours it is */
  const ours = new Map<JSONContent, JSONContent>()
  /** blocks of the copy → blocks of ours: by id or value, then a container left over by its type, in order */
  const pairAll = (bs: JSONContent[], as: JSONContent[]) => {
    const free = [...bs]
    const rest: JSONContent[] = []
    for (const c of as) {
      const i = free.findIndex((x) => (idOf(x) && idOf(x) === idOf(c)) || bare(x) === bare(c))
      if (i >= 0) pair(free.splice(i, 1)[0], c)
      else rest.push(c)
    }
    for (const c of rest) {
      const i = blocky(c) ? free.findIndex((x) => x.type === c.type && blocky(x) && !idOf(x) && !idOf(c)) : -1
      if (i >= 0) pair(free.splice(i, 1)[0], c)
    }
  }
  const pair = (b: JSONContent, a: JSONContent) => {
    ours.set(a, b)
    pairAll(blocksOf(b), blocksOf(a))
  }
  for (const [u, twin] of stale) {
    if (twin) pair(twin, u)
    else
      each(u, (w) => {
        const L = newerThan(w.type, gen) ? trial.lostOf(w) : undefined
        if (L) pairAll(blocksOf(L), blocksOf(w))
      })
  }
  const units = new Set(stale.map(([u]) => u))
  const filler = new Set<JSONContent>()
  /** the blocks a container keeps: an emptied part its container cannot do without keeps an empty line */
  const keep = (n: JSONContent, f: (c: JSONContent) => JSONContent[]): { kids: JSONContent[]; changed: boolean; left: number } => {
    let changed = false
    let left = 0
    const kids: JSONContent[] = []
    for (const c of n.content ?? []) {
      const k = isBlock(c) ? f(c) : [c]
      if (k.length !== 1 || k[0] !== c) changed = true
      if (k.length) left++
      else if (FIXED_PARTS.has(c.type ?? '') && !spare(n, left + (n.content ?? []).slice((n.content ?? []).indexOf(c) + 1).length)) {
        const empty = emptyPart(c)
        filler.add(empty)
        kids.push(empty)
      }
      kids.push(...k)
    }
    if (changed && leadFirst(n.type) && kids.length && kids[0].type !== 'paragraph') {
      const lead = { type: 'paragraph' }
      filler.add(lead)
      kids.unshift(lead)
    }
    return { kids, changed, left }
  }
  /**
   * What stays of a block inside a stale copy. A block of ours the older editor holds too (found there) goes: a line
   * found there in another version — outside the lost nodes (where the rewrap tells our version from its edit) —
   * comes back beside it (no id tells whose version is the newer one); a container found there takes along what is
   * left of it, which comes back next to its blocks there (seeds), as does what is left of a newer node that loses a
   * block. A block found nowhere there stays where it is.
   */
  const strip = (n: JSONContent): JSONContent[] => {
    const b = ours.get(n)
    // (found in a block without an id it would have: another copy of ours, never the older editor's own)
    const at = b && trial.foundAs(b)
    const a = at && (idOf(at) || UNNAMED.has(at.type ?? '')) ? at : undefined
    if (!blocky(n)) {
      // (a toggle's summary goes only with its toggle)
      if (!a || n.type === 'detailsSummary') return [n]
      if (!trial.inLost(b!) && bare(a) !== bare(n)) beside.add(b!)
      return []
    }
    const { kids, changed, left } = keep(n, strip)
    if (a || (newerThan(n.type, gen) && changed)) {
      const rest: JSONContent[] = []
      for (const k of kids) {
        if (filler.has(k)) continue
        const kb = ours.get(k)
        if (kb) seeds.add(kb)
        else rest.push(k)
      }
      return rest
    }
    if (!changed) return [n]
    if (!left) return []
    const out = { ...n, content: kids }
    if (b) ours.set(out, b)
    return [out]
  }
  const walk = (n: JSONContent): JSONContent[] => {
    if (units.has(n)) return strip(n)
    if (!n.content) return [n]
    const { kids, changed, left } = keep(n, walk)
    if (!changed) return [n]
    return left || n.type === 'doc' ? [{ ...n, content: kids }] : []
  }
  return walk(doc)[0] ?? { type: 'doc', content: [] }
}

/**
 * The work of rewrapNewer on a copy without the stale copies it found by id (`doc`), leaving out the nodes in `skip`
 * (copies of ours maybe stale: their nodes count as lost, their lines are matched — by value too, wherever they are;
 * `twins`: the blocks of ours they are exactly, found where they are most alike).
 */
function rewrapLost(B: Before, doc: JSONContent, skip: Set<JSONContent>, opts: RewrapOptions, loose?: Set<string>, twins: Set<JSONContent> = new Set()) {
  const gen = B.gen
  const lost = lostIn(B, doc, skip)
  const known = (id: string) => B.ids.has(id)
  const pos = new Map<JSONContent, number>()
  /** the older editor's copy (it holds an id it made up — it gives every block one) */
  let editorCopy = false
  each(doc, (n) => {
    pos.set(n, pos.size)
    const id = !editorCopy && isBlock(n) ? idOf(n) : null
    if (id && !known(id)) editorCopy = true
  })
  /** ids the copy holds (a block whose id is there is that block, never another one like it) */
  const held = new Set<string>()
  const hold = (n: JSONContent) => {
    if (skip.has(n)) return
    const id = idOf(n)
    if (id) held.add(id)
    for (const c of n.content ?? []) if (isBlock(c)) hold(c)
  }
  hold(doc)

  const blocky = memo((n) => !!n.content?.length && n.content.every(isBlock))
  /** the value without made-up ids and empty attrs */
  const value = B.value
  /** the value without any id */
  const bare = B.bare
  const print = bare
  const text: (n: JSONContent) => string = memo((n) => {
    let out = n.text ?? ''
    for (const c of n.content ?? []) out += c.type === 'text' ? (c.text ?? '') : c.content ? text(c) : ''
    return out
  })
  /** the text of the first 200 lines with text in a container (none of a copy left out), document order */
  const lines = memo((n: JSONContent) => {
    const out: string[] = []
    // (as deep as the page: within MAX_DEPTH)
    const walk = (c: JSONContent) => {
      if (out.length >= 200 || skip.has(c)) return
      if (c !== n && TEXTBLOCKS.has(c.type ?? '')) {
        const t = text(c)
        if (t) out.push(t)
        return
      }
      for (const k of c.content ?? []) if (isBlock(k)) walk(k)
    }
    walk(n)
    return out
  })
  const holdsLost: (n: JSONContent) => boolean = memo((n) => lost.has(n) || !!n.content?.some((c) => isBlock(c) && holdsLost(c)))
  const holdsNewer: (n: JSONContent) => boolean = memo((n) => newerThan(n.type, gen) || !!n.content?.some((c) => isBlock(c) && holdsNewer(c)))
  /** a block of `before` inside a lost node */
  const inLost: (n: JSONContent) => boolean = memo((n) => {
    const p = B.parent.get(n)
    return !!p && (lost.has(p) || inLost(p))
  })
  const keyOf = (n: JSONContent): string => {
    const id = idOf(n)
    return id && known(id) ? `#${n.type}:${id}` : `=${value(n)}`
  }
  /** a block as the older build held it */
  const project: (n: JSONContent) => JSONContent[] = memo((n) => {
    if (lost.has(n)) return blocksOf(n).flatMap(project)
    if (!n.content || !holdsLost(n)) return [n]
    return [{ ...n, content: n.content.flatMap((c) => (isBlock(c) ? project(c) : [c])) }]
  })
  const ownersOf: (n: JSONContent) => JSONContent[] = memo((n) => {
    const p = B.parent.get(n)
    return p && lost.has(p) ? [...ownersOf(p), p] : []
  })
  const slotOf = memo((n): Slot => ({ node: project(n)[0] ?? n, orig: n, owners: ownersOf(n) }))
  const slotsOf = (list: JSONContent[]): Slot[] => list.flatMap((n) => (!isBlock(n) ? [] : lost.has(n) ? slotsOf(n.content ?? []) : [slotOf(n)]))

  let budget = LINE_BUDGET
  /** a container's lines with text (the first 200), and as a set */
  const linesOf = memo((n) => {
    const list = lines(n)
    return { list, set: new Set(list) }
  })
  /** How alike two containers are, 0 – 1: the share of the shorter one's lines (non-empty) with a like line in the other; 0 under half. */
  const linesAlike = (p: JSONContent, q: JSONContent): number => {
    const a = linesOf(p)
    const b = linesOf(q)
    if (!a.list.length || !b.list.length) return !a.list.length && !b.list.length ? 0.5 : 0
    const [short, long] = a.list.length <= b.list.length ? [a, b] : [b, a]
    const need = short.list.length / 2
    let hits = 0
    for (let i = 0; i < short.list.length && hits + short.list.length - i >= need; i++) {
      const line = short.list[i]
      if (long.set.has(line)) hits++
      else if (budget > 0) {
        budget -= long.list.length
        if (long.list.some((l) => textLikeness(line, l) > 0.05)) hits++
      }
    }
    return hits >= need ? hits / long.list.length : 0
  }
  /** `a` + `b` (two lines of the older copy, one after the other) are the line `orig` of ours split in two there */
  const splitOff = (orig: JSONContent, a: JSONContent, b: JSONContent): boolean => {
    if (!TEXTBLOCKS.has(orig.type ?? '') || a.type !== orig.type || b.type !== 'paragraph') return false
    const p = text(a)
    const q = text(b)
    const t = text(orig)
    return !!p && !!q && p.length + q.length === t.length && t.startsWith(p) && t.endsWith(q)
  }
  /** How much `a` (a block of the older copy) looks like the block `s` changed there, 0 – 1 (0: another block). */
  const likeness = (s: Slot, a: JSONContent): number => {
    if (s.node.type !== a.type) return 0
    const aid = idOf(a)
    if (aid && known(aid)) return aid === idOf(s.node) ? 1 : 0
    // the slot's id lives on elsewhere in the copy: that is the block
    const sid = idOf(s.node)
    if (sid && held.has(sid)) return 0
    if (bare(s.node) === bare(a)) return 1
    // a part (a column, a tab …) is the one with the same lines — else the part at its place
    if (PARTS.has(a.type ?? '')) {
      const l = blocky(s.node) && blocky(a) ? linesAlike(s.node, a) : 0
      return l ? 0.5 + l / 2 : 0.1
    }
    if (blocky(s.node) && blocky(a)) return linesAlike(s.node, a)
    // a line without an id in the older editor's copy (it gives every line one) is a copy of one of ours as it is:
    // never an edit of another one
    if (!aid && editorCopy && TEXTBLOCKS.has(a.type ?? '')) return 0
    const p = text(s.node)
    const q = text(a)
    if (!p && !q) return TEXTBLOCKS.has(a.type ?? '') ? 1 : 0
    return textLikeness(p, q)
  }
  /** the prints of the blocks inside each lost node (built on first use) */
  const printsIn = new Map<JSONContent, Set<string>>()
  const heldNow = (L: JSONContent, p: string) => {
    let set = printsIn.get(L)
    if (!set) {
      set = new Set()
      descend(L, (n) => void set!.add(compact(print(n))))
      printsIn.set(L, set)
    }
    return set.has(p)
  }
  /**
   * `a` is a version of the block `s` (inside a lost node) we wrote before, not ours now: the older merge's stale copy.
   * Only a block without blocks inside (a container's blocks are each compared on their own: one moved out of it or
   * deleted there stays so), bound to the block (`bindings`): its id; else a version written inside its node — at its
   * place (from the start or the end), or one no other block of the node holds now (a line typed there to read like
   * another part of it is an edit, never a stale copy).
   */
  const staleVersion = (s: Slot, a: JSONContent): boolean => {
    if (!opts.wrote || !inLost(s.orig) || holdsLost(s.orig) || blank(a) || blocksOf(a).length || blocksOf(s.orig).length) return false
    if (print(a) === print(s.orig)) return false
    const p = compact(print(a))
    const key = bindings(s.orig, gen, (n) => B.parent.get(n), (n) => B.index.get(n) ?? -1, (n) => blocksOf(n).length)
    if (!key) return false
    if ('id' in key) return opts.wrote(`${key.id}|${p}`)
    if (!opts.wrote(`${key.owner}|${p}`)) return false
    if (opts.wrote(`${key.start}|${p}`) || opts.wrote(`${key.end}|${p}`)) return true
    let L = B.parent.get(s.orig)
    while (L && !lost.has(L)) L = B.parent.get(L)
    return !!L && !heldNow(L, p)
  }

  /** where each block of `before` is: its item (and the level it is in) */
  const mapped = new Map<JSONContent, { level: Level; item: Item }>()
  /** ids of the blocks inside lost nodes (a block with one is found wherever it is) */
  const lostIds = new Set<string>()
  for (const L of lost) each(L, (n) => n !== L && idOf(n) && B.ids.get(idOf(n)!) && lostIds.add(idOf(n)!))
  // the blocks (without an id) of a maybe-stale copy's node: found wherever they are, by value — a container also
  // when much alike (it is the older editor's copy of them, maybe edited there)
  const skipped = new Set<string>(loose)
  for (const u of skip) each(u, (w) => newerThan(w.type, gen) && skipped.add(identity(w)))
  const byValue = new Map<string, Slot[]>()
  const looseTypes = new Map<string, Slot[]>()
  for (const L of lost) {
    if (!skipped.has(identity(L))) continue
    for (const s of slotsOf(L.content ?? [])) {
      if (blank(s.orig) || idOf(s.orig)) continue
      push(byValue, keyOf(s.node), s)
      if (blocky(s.orig)) push(looseTypes, s.orig.type ?? '', s)
    }
  }
  /** a block of the copy that holds something to do: a block of a lost node (by id, or one of a maybe-stale copy's) */
  const relevant: (a: JSONContent) => boolean = memo((a) => {
    const id = idOf(a)
    if (id && lostIds.has(id)) return true
    if (byValue.size && (byValue.has(keyOf(a)) || (looseTypes.has(a.type ?? '') && blocky(a)))) return true
    return !!a.content?.some((c) => isBlock(c) && (skip.has(c) || relevant(c)))
  })

  /**
   * The pairs of a changed stretch: `slots` `x0`–`x1` against blocks `y0`–`y1` of the copy (`aList`). Parts (columns, tabs …) are
   * moved as a whole — the ones holding most of the same lines pair first, in any order; the rest (and every other block)
   * in their order.
   */
  const pairParts = (slots: Slot[], aList: JSONContent[], x0: number, x1: number, y0: number, y1: number, score: (x: number, y: number) => number): Array<[number, number]> => {
    const xs: number[] = []
    const ys: number[] = []
    for (let x = x0; x < x1; x++) xs.push(x)
    for (let y = y0; y < y1; y++) ys.push(y)
    const out: Array<[number, number]> = []
    if (xs.length > 1 && ys.length > 1 && xs.length * ys.length <= 400) {
      const cand: Array<[number, number, number]> = []
      for (const x of xs) for (const y of ys) {
        if (!PARTS.has(slots[x].node.type ?? '') || slots[x].node.type !== aList[y].type) continue
        // (by the lines both hold as they are: a part moved keeps most of them; one edited there is no sign of a move)
        const p = linesOf(slots[x].node)
        const q = linesOf(aList[y])
        let both = 0
        for (const l of p.set) if (q.set.has(l)) both++
        if (both && both * 2 >= Math.min(p.set.size, q.set.size)) cand.push([both / Math.max(p.set.size, q.set.size), x, y])
      }
      cand.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2])
      const px = new Set<number>()
      const py = new Set<number>()
      for (const [, x, y] of cand) {
        if (px.has(x) || py.has(y)) continue
        px.add(x)
        py.add(y)
        out.push([x, y])
      }
      if (out.length) {
        xs.splice(0, xs.length, ...xs.filter((x) => !px.has(x)))
        ys.splice(0, ys.length, ...ys.filter((y) => !py.has(y)))
      }
    }
    for (const [i, j] of pairUp(xs.length, ys.length, (i, j) => score(xs[i], ys[j]))) out.push([xs[i], ys[j]])
    return out
  }
  /** One level: `bList` (from `before`; null: a container the copy holds new or moved) against `aAll` (the older copy). */
  const level = (bList: JSONContent[] | null, type: string, aAll: JSONContent[], noWrap: boolean, force = false): Level | null => {
    const aList = aAll.filter((a) => isBlock(a) && !skip.has(a))
    const slots = bList ? slotsOf(bList) : []
    if (!force && aList.length === aAll.length && !slots.some((s) => s.owners.length || holdsLost(s.orig) || inLost(s.orig)) && !aList.some(relevant)) return null
    const lv: Level = { items: [], slots, whole: false, noWrap, type }
    // which slot each block of the older copy is at its place: the same key (id, or value), else the same block changed there
    const match: Array<number | null> = aList.map(() => null)
    if (slots.length) {
      let i = 0
      let j = 0
      const same = (to: number) => {
        for (; i < to; i++, j++) match[j] = i
      }
      for (const h of keptStretches(slots.map((s) => keyOf(s.node)), aList.map(keyOf))) {
        same(h.a0)
        // (an exact copy of a block of a maybe-stale copy's node is that block, never an edit of another one)
        const exact = (a: JSONContent) => byValue.size > 0 && !(idOf(a) && known(idOf(a)!)) && byValue.has(keyOf(a))
        const score = (x: number, y: number) => {
          if (exact(aList[y])) return 0
          const s = slots[x]
          const a = aList[y]
          // (an empty line and one with text are one typed into the other only in the same place of the stretch — from
          // its start or its end)
          if (TEXTBLOCKS.has(a.type ?? '') && !text(s.node) !== !text(a) && x - h.a0 !== y - h.b0 && h.a1 - x !== h.b1 - y) return 0
          return likeness(s, a)
        }
        for (const [x, y] of pairParts(slots, aList, h.a0, h.a1, h.b0, h.b1, score)) match[y] = x
        i = h.a1
        j = h.b1
      }
      same(slots.length)
      lv.whole = aList.length > 0 && match.every((m) => m === null)
    }
    for (const m of match) if (m !== null) mapped.set(slots[m].orig, { level: lv, item: null as unknown as Item })
    // slots no block of the older copy is at their place: a block elsewhere that is one of them was moved there
    const free = new Map<string, number[]>()
    if (!lv.whole) slots.forEach((s, x) => !mapped.has(s.orig) && push(free, keyOf(s.node), x))
    /** the containers of `before` here that hold no lost node, by the lines they hold (built on first use) */
    let byLine: Map<string, Slot[]> | null = null
    const holding = (a: JSONContent): Set<Slot> => {
      if (!byLine) {
        byLine = new Map()
        for (const s of slots) if (blocky(s.orig) && !holdsLost(s.orig) && !twins.has(s.orig)) for (const l of linesOf(s.node).set) push(byLine, l, s)
      }
      const out = new Set<Slot>()
      for (const l of linesOf(a).list) for (const s of byLine.get(l) ?? []) out.add(s)
      return out
    }
    const movedSlot = (a: JSONContent): Slot | null => {
      if (!lv.whole) {
        const x = free.get(keyOf(a))?.find((y) => !mapped.has(slots[y].orig))
        if (x !== undefined) return slots[x]
        if (blocky(a)) {
          // a container changed and moved: the most alike one that holds lost nodes, or that a copy left out is exactly
          // (a part: by its lines) — any other one only when much alike
          let top = 0
          let hit: Slot | null = null
          const near = holding(a)
          for (const s of slots) {
            if (mapped.has(s.orig) || !blocky(s.orig) || s.node.type !== a.type) continue
            // (any other: only one holding a line of it as it is)
            const any = holdsLost(s.orig) || twins.has(s.orig)
            if (!any && !near.has(s)) continue
            const l = PARTS.has(a.type ?? '') ? linesAlike(s.node, a) : likeness(s, a)
            if (l > top && (any || l >= 0.5)) [top, hit] = [l, s]
          }
          if (hit) return hit
        }
      }
      // a block with an id of ours is that block, wherever it is now
      const id = idOf(a)
      const b = id ? B.ids.get(id) : null
      return b && !mapped.has(b) && !lost.has(b) ? slotOf(b) : null
    }
    aList.forEach((a, k) => {
      const m = match[k]
      const s = m !== null ? slots[m] : movedSlot(a)
      const it: Item = { a, slot: s, at: m ?? -1, how: m !== null ? 'place' : s ? 'moved' : 'new', same: false, stale: false, sure: false, inner: null, owners: [], blocked: false, pos: pos.get(a) ?? 0 }
      if (s) {
        mapped.set(s.orig, { level: lv, item: it })
        it.same = value(a) === value(s.node)
        it.stale = !it.same && staleVersion(s, a)
        it.sure = it.same || it.stale || likeness(s, a) >= 0.5
      }
      // what is inside: against the block of `before` it is (a level of its own when it is new there)
      if (!it.stale && blocky(a) && !newerThan(a.type, gen)) it.inner = level(s && blocky(s.orig) ? s.orig.content! : null, a.type ?? '', a.content!, noWrap || NO_WRAP.has(a.type ?? ''))
      lv.items.push(it)
    })
    // a line moved inside its container and edited there: the free line of ours most like it, of a node with a block here
    if (!lv.whole && lv.items.some((it) => it.how === 'new')) {
      const here = new Set<JSONContent>()
      for (const it of lv.items) if (it.slot?.owners.length) here.add(it.slot.owners[it.slot.owners.length - 1])
      // (or of a node none of whose blocks is found: its line moved and typed into is all that is left of it)
      const none = memo((L) => !slotsOf(L.content ?? []).some((x) => mapped.has(x.orig)))
      for (const it of lv.items) {
        const id = idOf(it.a)
        if (it.how !== 'new' || !TEXTBLOCKS.has(it.a.type ?? '') || blank(it.a) || (id && known(id))) continue
        let best: Slot | null = null
        let top = 0.5
        for (const s of slots) {
          const owner = s.owners[s.owners.length - 1]
          if (mapped.has(s.orig) || s.orig.type !== it.a.type || blank(s.orig) || !owner || !(here.has(owner) || none(owner))) continue
          // (only text typed into it or taken out of it: the one line holds the whole other one)
          if (!typedInto(text(s.node), text(it.a))) continue
          const l = likeness(s, it.a)
          if (l >= top) [top, best] = [l, s]
        }
        if (!best) continue
        const same = value(it.a) === value(best.node)
        Object.assign(it, { slot: best, how: 'moved', same, stale: !same && staleVersion(best, it.a), sure: true })
        mapped.set(best.orig, { level: lv, item: it })
      }
    }
    return lv
  }
  const root = level(B.root.content ?? [], 'doc', doc.content ?? [], false, true)!
  /** a level dropped: the blocks of `before` it found are found no more */
  const unmap = (lv: Level) =>
    lv.items.forEach((it) => {
      if (it.slot && mapped.get(it.slot.orig)?.item === it) mapped.delete(it.slot.orig)
      if (it.inner) unmap(it.inner)
    })
  // a container of ours without an id that the older tab moved into a container of its own: found nowhere at its
  // level, so a container it holds new is the one of `before` around a lost node none of whose blocks is found — the most
  // alike of its type (half its lines at least), wherever that one was
  {
    const around = new Map<string, JSONContent[]>()
    const seenAround = new Set<JSONContent>()
    for (const L of lost) {
      if (slotsOf(L.content ?? []).some((x) => mapped.has(x.orig))) continue
      for (let p = B.parent.get(L); p && p !== B.root; p = B.parent.get(p))
        if (!idOf(p) && !lost.has(p) && blocky(p) && !seenAround.has(p)) {
          seenAround.add(p)
          push(around, p.type ?? '', p)
        }
    }
    /** the candidates by the lines they hold */
    const byLineC = new Map<string, JSONContent[]>()
    for (const b of seenAround) for (const l of linesOf(slotOf(b).node).set) push(byLineC, l, b)
    // (document order, depth first; a container it made is looked into when it holds one of a candidate's type)
    const todo: Array<{ level: Level; item: Item }> = []
    const later = (lv: Level) => {
      for (let k = lv.items.length - 1; k >= 0; k--) todo.push({ level: lv, item: lv.items[k] })
    }
    if (around.size) later(root)
    while (todo.length) {
      const { level: lv, item } = todo.pop()!
      const id = idOf(item.a)
      const stray = item.how === 'new' && blocky(item.a) && !(id && known(id)) && !newerThan(item.a.type, gen) && !lv.noWrap
      const kind = around.get(item.a.type ?? '')
      if (stray && kind) {
        const cands = new Set<JSONContent>(kind.length <= 8 ? kind : [])
        if (kind.length > 8) for (const l of linesOf(item.a).list) for (const c of byLineC.get(l) ?? []) if (c.type === item.a.type) cands.add(c)
        let best: JSONContent | null = null
        let top = 0.5
        for (const c of cands) {
          if (mapped.has(c)) continue
          const l = linesAlike(slotOf(c).node, item.a)
          if (l >= top) [top, best] = [l, c]
        }
        if (best) {
          const sl = slotOf(best)
          Object.assign(item, { slot: sl, how: 'moved', same: value(item.a) === value(sl.node), stale: false, sure: true })
          mapped.set(best, { level: lv, item })
          if (item.inner) unmap(item.inner)
          item.inner = level(best.content!, item.a.type ?? '', item.a.content!, NO_WRAP.has(item.a.type ?? ''), true)
          if (item.inner) later(item.inner)
          continue
        }
      }
      if (stray && !item.inner) {
        let holds = false
        each(item.a, (c) => {
          if (!holds && c !== item.a && blocky(c) && around.has(c.type ?? '')) holds = true
        })
        if (holds) item.inner = level(null, item.a.type ?? '', item.a.content!, NO_WRAP.has(item.a.type ?? ''), true)
      }
      if (item.inner) later(item.inner)
    }
  }
  // the lines of a lost node without an id of ours not found where they were, as they are, wherever the older tab moved
  // them — into a container it made, out of one it unwrapped (document order; a container holding one is looked into)
  {
    const want = new Map<string, Slot[]>()
    for (const L of lost)
      for (const x of slotsOf(L.content ?? [])) if (!mapped.has(x.orig) && !blank(x.orig) && !idOf(x.orig) && TEXTBLOCKS.has(x.orig.type ?? '')) push(want, keyOf(x.node), x)
    const holdsWanted: (n: JSONContent) => boolean = memo((n) => (TEXTBLOCKS.has(n.type ?? '') ? want.has(keyOf(n)) : blocksOf(n).some(holdsWanted)))
    const todo: Array<{ level: Level; item: Item }> = []
    const later = (lv: Level) => {
      for (let k = lv.items.length - 1; k >= 0; k--) todo.push({ level: lv, item: lv.items[k] })
    }
    if (want.size) later(root)
    while (todo.length) {
      const { level: lv, item } = todo.pop()!
      const id = idOf(item.a)
      if (item.how === 'new' && !(id && known(id)) && TEXTBLOCKS.has(item.a.type ?? '')) {
        const x = want.get(keyOf(item.a))?.find((y) => !mapped.has(y.orig))
        if (x) {
          Object.assign(item, { slot: x, how: 'moved', same: true, stale: false, sure: true })
          mapped.set(x.orig, { level: lv, item })
        }
        continue
      }
      if (!item.inner && !item.stale && blocky(item.a) && !newerThan(item.a.type, gen) && !lv.noWrap && holdsWanted(item.a))
        item.inner = level(item.slot && blocky(item.slot.orig) ? item.slot.orig.content! : null, item.a.type ?? '', item.a.content!, NO_WRAP.has(item.a.type ?? ''), true)
      if (item.inner) later(item.inner)
    }
  }
  // a block of a maybe-stale copy that the older editor holds elsewhere (no id of ours): moved there
  if (byValue.size) {
    const loose: Array<{ level: Level; item: Item }> = []
    const scan = (lv: Level) =>
      lv.items.forEach((it) => {
        if (it.how === 'new' && !(idOf(it.a) && known(idOf(it.a)!))) loose.push({ level: lv, item: it })
        if (it.inner) scan(it.inner)
      })
    scan(root)
    loose.sort((x, y) => x.item.pos - y.item.pos)
    for (const at of loose) {
      const a = at.item.a
      let s = byValue.get(keyOf(a))?.find((x) => !mapped.has(x.orig))
      let alike = 1
      if (!s && blocky(a)) {
        alike = 0.5
        for (const x of looseTypes.get(a.type ?? '') ?? []) {
          if (mapped.has(x.orig)) continue
          const l = likeness(x, a)
          if (l >= alike) [alike, s] = [l, x]
        }
      }
      if (!s) continue
      const same = value(a) === value(s.node)
      Object.assign(at.item, { slot: s, how: 'moved', same, stale: !same && staleVersion(s, a), sure: true })
      mapped.set(s.orig, at)
      // what is inside: against that block now (it was a new one)
      if (at.item.inner) unmap(at.item.inner)
      at.item.inner = null
      if (!at.item.stale && blocky(a) && !newerThan(a.type, gen)) at.item.inner = level(blocky(s.orig) ? s.orig.content! : null, a.type ?? '', a.content!, at.level.noWrap || NO_WRAP.has(a.type ?? ''))
    }
    // a line edited there, right beside blocks of such a node found there: that node's line most like it
    for (const at of loose) {
      const it = at.item
      if (it.how !== 'new' || !TEXTBLOCKS.has(it.a.type ?? '') || blank(it.a)) continue
      const items = at.level.items
      const k = items.indexOf(it)
      const nodes = new Set<JSONContent>()
      for (const x of [items[k - 1], items[k + 1]]) {
        const L = x?.how === 'moved' ? x.slot?.owners[x.slot.owners.length - 1] : undefined
        if (L && skipped.has(identity(L))) nodes.add(L)
      }
      let s: Slot | undefined
      let alike = 0.5
      for (const L of nodes)
        for (const x of slotsOf(L.content ?? [])) {
          if (mapped.has(x.orig) || x.orig.type !== it.a.type || blank(x.orig)) continue
          const l = likeness(x, it.a)
          if (l >= alike) [alike, s] = [l, x]
        }
      if (!s) continue
      Object.assign(it, { slot: s, how: 'moved', same: false, stale: staleVersion(s, it.a), sure: true })
      mapped.set(s.orig, at)
    }
  }

  /** the containers around a block of ours that are found but were taken as they are: looked into, top down */
  const reach = (n: JSONContent) => {
    const chain: JSONContent[] = []
    for (let p = B.parent.get(n); p; p = B.parent.get(p)) chain.unshift(p)
    for (const p of chain) {
      const m = mapped.get(p)
      if (!m) continue
      if (m.item.stale) return
      if (m.item.inner || !blocky(m.item.a) || newerThan(m.item.a.type, gen)) continue
      m.item.inner = level(blocky(p) ? p.content! : null, m.item.a.type ?? '', m.item.a.content!, m.level.noWrap || NO_WRAP.has(m.item.a.type ?? ''), true)
    }
  }
  /** this lost node's blocks, as found */
  const found = (L: JSONContent) =>
    slotsOf(L.content ?? []).flatMap((s) => {
      reach(s.orig)
      return mapped.get(s.orig)?.item ?? []
    })
  const lostOf = (w: JSONContent) => [...lost].find((L) => identity(L) === identity(w))

  return {
    /**
     * A copy of ours `u` (left out here) is the older merge's stale copy: the blocks of its nodes are found in the older
     * editor's own blocks (no id of ours) — of one node at least, a line with text surely — before it, or half its lines
     * with text surely; no node of it found otherwise (a container without a newer node: itself, surely, before it).
     */
    staleCopy(u: JSONContent, twin: JSONContent | null): boolean {
      const at = pos.get(u) ?? 0
      if (!holdsNewer(u)) {
        // a container without a newer node: ours, found surely — in the older editor's own block before it
        const m = twin && mapped.get(twin)?.item
        const id = m && idOf(m.a)
        return !!m && m.sure && (!id || !known(id)) && m.pos < at
      }
      let stale = false
      let fresh = false
      each(u, (w) => {
        if (fresh || !newerThan(w.type, gen)) return
        const L = lostOf(w)
        const hits = L ? found(L) : []
        // (a node whose lines are found nowhere surely — gone or emptied there — tells nothing either way)
        if (!hits.some((it) => it.sure && !blank(it.slot!.orig))) return
        // (the older merge puts what it did not know after its own stretch — or, when the other tab moved the node,
        // where it went: then at least half its lines are there, surely; the rest comes back beside them)
        const lines = slotsOf(L!.content ?? []).filter((s) => !blank(s.orig))
        const sure = lines.filter((s) => mapped.get(s.orig)?.item.sure).length
        const ok =
          (hits.some((it) => it.pos < at) || sure * 2 >= lines.length) &&
          hits.every((it) => {
            const id = idOf(it.a)
            return !id || !known(id)
          })
        if (ok) stale = true
        else fresh = true
      })
      return stale && !fresh
    },
    /** the lost node of `before` a copy `w` of a newer node is */
    lostOf(w: JSONContent): JSONContent | undefined {
      return lostOf(w)
    },
    /** the block of the copy this block of `before` is found as (at its place, moved, or by value) */
    foundAs(b: JSONContent): JSONContent | undefined {
      reach(b)
      return mapped.get(b)?.item.a
    },
    /** is this block of `before` inside a lost node? */
    inLost(b: JSONContent): boolean {
      return inLost(b)
    },
    finish(seeds: Set<JSONContent>, beside: Set<JSONContent> = new Set()): Rewrapped {
      // ours that only a stale copy held: back next to its neighbours (after the block before it, else …)
      const order = new Map<JSONContent, number>()
      each(B.root, (n) => order.set(n, order.size))
      const back = new Set<JSONContent>()
      const inBack = (n: JSONContent) => {
        for (let p = B.parent.get(n); p; p = B.parent.get(p)) if (back.has(p)) return true
        return false
      }
      const anyMapped = (n: JSONContent) => {
        let hit = false
        each(n, (c) => {
          if (c !== n && mapped.has(c)) hit = true
        })
        return hit
      }
      /** where a block of `before` is now (a lost node: its last — or first — block found) */
      const whereIs = (n: JSONContent, last: boolean) => {
        if (!lost.has(n)) return mapped.get(n)
        const slots = slotsOf(n.content ?? [])
        for (const s of last ? slots.reverse() : slots) {
          const m = mapped.get(s.orig)
          if (m) return m
        }
        return undefined
      }
      const placeOf = (r: JSONContent): { lv: Level; at: number; pos: number } => {
        for (let b = r; ; ) {
          const p = B.parent.get(b)
          if (!p) return { lv: root, at: root.items.length, pos: Infinity }
          const sibs = blocksOf(p)
          const i = sibs.indexOf(b)
          for (let k = i - 1; k >= 0; k--) {
            const m = whereIs(sibs[k], true)
            if (m) return { lv: m.level, at: m.level.items.indexOf(m.item) + 1, pos: m.item.pos }
          }
          for (let k = i + 1; k < sibs.length; k++) {
            const m = whereIs(sibs[k], false)
            if (m) return { lv: m.level, at: m.level.items.indexOf(m.item), pos: m.item.pos }
          }
          if (p === B.root) return { lv: root, at: i === 0 ? 0 : root.items.length, pos: i === 0 ? -1 : Infinity }
          const m = lost.has(p) ? undefined : mapped.get(p)
          if (m && !m.item.stale && blocky(m.item.a) && !newerThan(m.item.a.type, gen)) {
            const inner = (m.item.inner ??= level(blocky(p) ? p.content! : null, m.item.a.type ?? '', m.item.a.content!, m.level.noWrap || NO_WRAP.has(m.item.a.type ?? ''), true)!)
            return { lv: inner, at: i === 0 ? 0 : inner.items.length, pos: m.item.pos }
          }
          b = p
        }
      }
      /** inside a block found and taken as it is (or as ours): there */
      const asIs = (n: JSONContent) => {
        for (let p = B.parent.get(n); p; p = B.parent.get(p)) {
          const m = mapped.get(p)
          if (m) return !m.item.inner || m.item.stale
        }
        return false
      }
      // (a block holding a newer node or one found elsewhere is not put back as a whole: its blocks are, one by one)
      const put = (r: JSONContent) => {
        reach(r)
        // (a block whose id the copy holds is there, wherever that is)
        if (mapped.has(r) || back.has(r) || inBack(r) || asIs(r) || (idOf(r) && held.has(idOf(r)!))) return
        if (holdsNewer(r) || anyMapped(r)) return blocksOf(r).forEach(put)
        const { lv, at, pos: p } = placeOf(r)
        const it: Item = { a: r, slot: slotOf(r), at: -1, how: 'back', same: true, stale: false, sure: true, inner: null, owners: [], blocked: false, pos: p }
        lv.items.splice(at, 0, it)
        mapped.set(r, { level: lv, item: it })
        back.add(r)
      }
      ;[...seeds].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0)).forEach(put)
      // a version of ours the stale copy held beside another one the older editor holds of the same line: both stay —
      // ours right after it (no id tells which one is the newer)
      for (const r of beside) {
        reach(r)
        const m = mapped.get(r)
        if (!m) put(r)
        else if (!m.item.stale && !back.has(r) && bare(m.item.a) !== bare(r)) {
          const it: Item = { a: r, slot: null, at: -1, how: 'new', same: false, stale: false, sure: false, inner: null, owners: [], blocked: false, pos: m.item.pos }
          m.level.items.splice(m.level.items.indexOf(m.item) + 1, 0, it)
          back.add(r)
        }
      }

      // who each block goes back inside (a level holding blocks that go inside a node never goes inside one itself)
      const sweep = (lv: Level): boolean => {
        let holds = false
        for (const it of lv.items) {
          const inner = it.inner ? sweep(it.inner) : false
          const n = it.stale ? it.slot!.orig : it.a
          it.blocked = lv.noWrap || inner || holdsNewer(n)
          holds = holds || inner || holdsNewer(n)
        }
        const items = lv.items
        const near = (k: number, step: number, ok: (x: Item) => boolean) => {
          for (let x = k + step; x >= 0 && x < items.length; x += step) if (ok(items[x])) return items[x]
          return undefined
        }
        for (const it of items) if (!it.blocked && it.how === 'place') it.owners = it.slot!.owners
        items.forEach((it, k) => {
          if (it.blocked || (it.how !== 'moved' && it.how !== 'back')) return
          // moved between two blocks of another node: dropped into it; else — or moved along with a block of its own node
          // (a container unwrapped, a stretch moved) — it stays its own node's
          const own = it.slot!.owners
          const along = !!own.length && [items[k - 1], items[k + 1]].some((x) => x?.how === 'moved' && x.slot?.owners[0] === own[0])
          const prev = it.how === 'moved' && !along ? near(k, -1, (x) => x.how === 'place') : undefined
          const next = it.how === 'moved' && !along ? near(k, 1, (x) => x.how === 'place') : undefined
          const into = prev?.owners.length && next && prev.owners[0] === next.owners[0] ? common(prev.owners, next.owners) : null
          it.owners = into ?? own
        })
        for (let k = 0; k < items.length; ) {
          if (items[k].how !== 'new') {
            k++
            continue
          }
          let e = k
          while (e < items.length && items[e].how === 'new') e++
          // in the place of blocks that were all its own, or between two of its blocks: inside the node (never at its edge)
          let owners: JSONContent[] = []
          if (!lv.whole) {
            const pp = near(k, -1, (x) => x.how === 'place')
            const np = near(e - 1, 1, (x) => x.how === 'place')
            // (an emptied line gone there tells nothing: a node is never put back around new blocks for it alone)
            const gone = lv.slots.slice(pp ? pp.at + 1 : 0, np ? np.at : lv.slots.length).filter((s) => !mapped.has(s.orig) && !blank(s.orig))
            if (gone.length) owners = gone.slice(1).reduce((o, s) => common(o, s.owners), gone[0].owners)
            else if (k > 0 && e < items.length) owners = common(items[k - 1].owners, items[e].owners)
          }
          // (the second half of a line of a node split there — Enter inside it — stays with that line, at the edge too)
          const prev = items[k - 1]
          if (prev?.owners.length && prev.slot && !items[k].blocked && splitOff(prev.slot.orig, prev.a, items[k].a)) items[k++].owners = prev.owners
          for (; k < e; k++) items[k].owners = items[k].blocked ? [] : owners
        }
        return holds || items.some((it) => it.owners.length > 0)
      }
      sweep(root)

      // each node back once, around its largest part — never around only new blocks or emptied lines (deleted there)
      const best = new Map<JSONContent, { first: Item; depth: number; weight: number; pos: number }>()
      const runs = (items: Item[], depth: number) => {
        for (let k = 0; k < items.length; ) {
          const owner = items[k].owners[depth]
          let e = k + 1
          if (owner) while (e < items.length && items[e].owners[depth] === owner) e++
          if (owner) {
            const run = items.slice(k, e)
            const weight = run.filter((it) => it.how !== 'new').length
            const emptied = run.every((it) => !it.same && !it.stale && it.a.type === 'paragraph' && blank(it.a))
            const cur = best.get(owner)
            if (weight && !emptied && (!cur || weight > cur.weight || (weight === cur.weight && items[k].pos < cur.pos))) best.set(owner, { first: items[k], depth, weight, pos: items[k].pos })
            runs(run, depth + 1)
          }
          k = e
        }
      }
      const choose = (lv: Level) => {
        runs(lv.items, 0)
        for (const it of lv.items) if (it.inner) choose(it.inner)
      }
      choose(root)

      const wrapped = new Set<JSONContent>()
      const nodeOf = (it: Item): JSONContent => {
        if (it.stale) {
          // ours — with the id the older editor gave a block that had none (its next merge then knows the block)
          const s = it.slot!.orig
          const id = idOf(it.a)
          return id && !idOf(s) ? { ...s, attrs: { ...s.attrs, id } } : s
        }
        if (!it.inner) return it.a
        const kids = build(it.inner)
        const src = it.a.content!
        return kids.length === src.length && kids.every((k, i) => k === src[i]) ? it.a : { ...it.a, content: kids }
      }
      const group = (items: Item[], depth: number): JSONContent[] => {
        const out: JSONContent[] = []
        for (let k = 0; k < items.length; ) {
          const owner = items[k].owners[depth]
          let e = k + 1
          if (owner) while (e < items.length && items[e].owners[depth] === owner) e++
          if (!owner) out.push(nodeOf(items[k]))
          else {
            const kids = group(items.slice(k, e), depth + 1)
            const b = best.get(owner)
            if (b?.first !== items[k] || b.depth !== depth) out.push(...kids)
            else {
              wrapped.add(owner)
              const lead = LEAD[owner.type ?? '']
              // a node put back without a block id gets a stable one: the older build's next merge then knows it (an
              // unknown node there is a block it appends beside its own copy)
              const attrs = idOf(owner) ? owner.attrs : { ...owner.attrs, id: `${owner.type}-${hash53(identity(owner)).toString(36)}` }
              out.push({ ...owner, attrs, content: lead && kids[0]?.type !== lead ? [{ type: lead }, ...kids] : kids })
            }
          }
          k = e
        }
        return out
      }
      const build = (lv: Level): JSONContent[] => {
        const out = group(lv.items, 0)
        if (PARA_FIRST.has(lv.type) && out[0] && out[0].type !== 'paragraph') out.unshift({ type: 'paragraph' })
        return out
      }
      const content = build(root)
      const src = doc.content ?? []
      const out = content.length === src.length && content.every((k, i) => k === src[i]) ? doc : { ...doc, content: content.length ? content : [{ type: 'paragraph' }] }

      // lines of a node put back that are gone there, or emptied (a block taken as it is or as ours holds its lines)
      let missed = 0
      for (const L of lost) {
        if (!wrapped.has(L)) continue
        each(L, (n) => {
          if (n === L || !isBlock(n) || blocky(n) || blank(n)) return
          const m = mapped.get(n)?.item
          if (m ? !m.stale && blank(m.a) : !asIs(n)) missed++
        })
      }
      return { doc: out, dropped: [...lost].filter((L) => !wrapped.has(L)), missed }
    },
  }
}
