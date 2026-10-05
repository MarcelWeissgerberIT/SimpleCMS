/**
 * Word-level diff of two TipTap docs — pure (no store, no DOM), shared by History ("Changes") and the
 * AI terminal's review of an edit (features/ai/agent).
 *
 *  1. Top-level blocks: LCS on the normalized JSON (block ids ignored, diff.ts).
 *  2. In each run of removed + added blocks, blocks of the same type that read alike are PAIRED.
 *  3. A paired block is merged: inline content → a word LCS (marks and inline atoms kept, a mark
 *     change counts as a change); containers (lists, quotes, callouts, tables …) → the same diff over
 *     their children, recursively. Blocks that can't be merged (atoms: images, databases …) stay a
 *     whole removed + added pair — the text-only fallback.
 *
 * The result is a DiffNode tree: the "after" document with the removed parts put back in and marked
 * (`diff: 'del'`, struck) and the new parts marked (`diff: 'add'`).
 */
import type { JSONContent } from '@tiptap/core'
import { blockKey } from './diff'

export type WordOp = 'same' | 'del' | 'add'

export interface WordRun {
  op: WordOp
  text: string
}

/** A node of the merged view: TipTap JSON plus where it differs. */
export interface DiffNode {
  type: string
  attrs?: Record<string, unknown>
  marks?: JSONContent['marks']
  text?: string
  content?: DiffNode[]
  /** a removed / added part (the node and everything inside it) */
  diff?: 'del' | 'add'
  /** the node's attrs before, when they changed (a task ticked, a callout recoloured …) */
  was?: Record<string, unknown>
}

export type DocItem =
  | { kind: 'same'; block: JSONContent }
  | { kind: 'removed'; block: JSONContent }
  | { kind: 'added'; block: JSONContent }
  | { kind: 'changed'; before: JSONContent; after: JSONContent; merged: DiffNode }

/* ------------------------------------------------------------------ */
/* LCS                                                                 */
/* ------------------------------------------------------------------ */

/** Above this many cells a run is shown as "all removed, all added" instead (keeps it fast). */
const MAX_CELLS = 1_500_000

type Op<T> = { op: WordOp; a?: T; b?: T }

/** LCS over keys: same / del / add in order (ties: removals first — reads "old, then new"). */
function lcs<T>(a: T[], b: T[], key: (x: T) => string): Op<T>[] {
  const ka = a.map(key)
  const kb = b.map(key)
  // common prefix / suffix first: most edits touch a small middle
  let start = 0
  while (start < a.length && start < b.length && ka[start] === kb[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--
    endB--
  }
  const out: Op<T>[] = []
  for (let i = 0; i < start; i++) out.push({ op: 'same', a: a[i], b: b[i] })
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) out.push({ op: 'del', a: a[i] })
    for (let j = start; j < endB; j++) out.push({ op: 'add', b: b[j] })
  } else if (n || m) {
    const w = m + 1
    const L = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i * w + j] = ka[start + i] === kb[start + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && ka[start + i] === kb[start + j]) {
        out.push({ op: 'same', a: a[start + i], b: b[start + j] })
        i++
        j++
      } else if (j >= m || (i < n && L[(i + 1) * w + j] >= L[i * w + j + 1])) out.push({ op: 'del', a: a[start + i++] })
      else out.push({ op: 'add', b: b[start + j++] })
    }
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ op: 'same', a: a[i], b: b[j] })
  return out
}

/* ------------------------------------------------------------------ */
/* Plain text                                                          */
/* ------------------------------------------------------------------ */

const tokenize = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? []

/** Word-level diff of two strings (whitespace rides with the words). */
export function wordRuns(before: string, after: string): WordRun[] {
  const out: WordRun[] = []
  for (const o of lcs(tokenize(before), tokenize(after), (x) => x)) {
    const text = (o.op === 'add' ? o.b : o.a) ?? ''
    const last = out[out.length - 1]
    if (last && last.op === o.op) last.text += text
    else out.push({ op: o.op, text })
  }
  return out
}

/** The plain text of a node: text blocks on their own lines, atoms as nothing. */
export function textOf(node: JSONContent | DiffNode | null | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const kids = node.content ?? []
  if (!kids.length) return ''
  const inline = kids.some((k) => k.type === 'text')
  return kids.map(textOf).join(inline ? '' : '\n')
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** How alike two blocks read (Dice coefficient over their words, 0…1). */
export function similarity(a: JSONContent, b: JSONContent): number {
  const wa = words(textOf(a))
  const wb = words(textOf(b))
  if (!wa.length && !wb.length) return a.type === b.type ? 1 : 0
  if (!wa.length || !wb.length) return 0
  const bag = new Map<string, number>()
  for (const w of wa) bag.set(w, (bag.get(w) ?? 0) + 1)
  let common = 0
  for (const w of wb) {
    const c = bag.get(w) ?? 0
    if (c > 0) {
      common++
      bag.set(w, c - 1)
    }
  }
  return (2 * common) / (wa.length + wb.length)
}

/* ------------------------------------------------------------------ */
/* Merging                                                             */
/* ------------------------------------------------------------------ */

/** Blocks with inline content (also when empty). */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
/** Paired when at least this alike (same type). */
const PAIR_AT = 0.25

const VOLATILE = new Set(['id', 'blockId', 'uid', 'data-id'])

function attrsOf(node: JSONContent): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node.attrs ?? {})) if (!VOLATILE.has(k) && v !== null && v !== undefined) out[k] = v
  return out
}

const sameAttrs = (a: JSONContent, b: JSONContent) => JSON.stringify(attrsOf(a)) === JSON.stringify(attrsOf(b))

const isTextblock = (n: JSONContent) => TEXTBLOCKS.has(n.type ?? '') || !!n.content?.some((k) => k.type === 'text')

/** A node (and what is inside it) as a DiffNode, optionally marked as removed / added. */
export function toDiffNode(node: JSONContent, diff?: 'del' | 'add'): DiffNode {
  const out: DiffNode = { type: node.type ?? 'paragraph' }
  if (node.attrs) out.attrs = node.attrs
  if (node.marks?.length) out.marks = node.marks
  if (node.text !== undefined) out.text = node.text
  if (node.content) out.content = node.content.map((c) => toDiffNode(c))
  if (diff) out.diff = diff
  return out
}

interface Token {
  key: string
  node: JSONContent
}

const markKey = (marks: JSONContent['marks']) => (marks?.length ? JSON.stringify(marks.map((m) => [m.type, m.attrs ?? null])) : '')

/** Inline content as word tokens (marks kept on each) and atom tokens. */
function inlineTokens(content: JSONContent[] | undefined): Token[] {
  const out: Token[] = []
  for (const n of content ?? []) {
    if (n.type === 'text' && typeof n.text === 'string') {
      const mk = markKey(n.marks)
      for (const part of tokenize(n.text)) {
        // whitespace compares as whitespace: a mark that happens to span a space is no change
        const key = /^\s+$/.test(part) ? ' ' : `t${mk}\u0000${part}`
        out.push({ key, node: { type: 'text', text: part, ...(n.marks?.length ? { marks: n.marks } : {}) } })
      }
    } else out.push({ key: `a${blockKey(n)}`, node: n })
  }
  return out
}

/** Word-level merge of two inline contents. */
function mergeInline(a: JSONContent[] | undefined, b: JSONContent[] | undefined): DiffNode[] {
  const out: DiffNode[] = []
  for (const o of lcs(inlineTokens(a), inlineTokens(b), (x) => x.key)) {
    const tok = (o.op === 'add' ? o.b : o.a)!
    const diff = o.op === 'same' ? undefined : o.op
    const node = tok.node
    const last = out[out.length - 1]
    // adjacent text with the same marks and the same state becomes one run
    if (node.type === 'text' && last?.type === 'text' && last.diff === diff && markKey(last.marks) === markKey(node.marks)) {
      last.text = (last.text ?? '') + (node.text ?? '')
      continue
    }
    out.push(toDiffNode(node, diff))
  }
  return out
}

type ChildOp = { kind: 'same'; a: JSONContent; b: JSONContent } | { kind: 'removed'; a: JSONContent } | { kind: 'added'; b: JSONContent } | { kind: 'changed'; a: JSONContent; b: JSONContent; merged: DiffNode }

/** Pair removed and added blocks of one run (in order, same type, alike enough) and merge the pairs. */
function pairRun(removed: JSONContent[], added: JSONContent[], out: ChildOp[]) {
  let j = 0
  for (const a of removed) {
    let hit = -1
    for (let k = j; k < added.length; k++) {
      if (added[k].type === a.type && similarity(a, added[k]) >= PAIR_AT) {
        hit = k
        break
      }
    }
    const merged = hit >= 0 ? mergeBlock(a, added[hit]) : null
    if (hit < 0 || !merged) {
      out.push({ kind: 'removed', a })
      continue
    }
    for (; j < hit; j++) out.push({ kind: 'added', b: added[j] })
    out.push({ kind: 'changed', a, b: added[hit], merged })
    j = hit + 1
  }
  for (; j < added.length; j++) out.push({ kind: 'added', b: added[j] })
}

/** Diff two lists of sibling blocks. */
function diffChildren(a: JSONContent[], b: JSONContent[]): ChildOp[] {
  const ops = lcs(a, b, blockKey)
  const out: ChildOp[] = []
  let removed: JSONContent[] = []
  let added: JSONContent[] = []
  const flush = () => {
    if (removed.length || added.length) pairRun(removed, added, out)
    removed = []
    added = []
  }
  for (const o of ops) {
    if (o.op === 'del') removed.push(o.a!)
    else if (o.op === 'add') added.push(o.b!)
    else {
      flush()
      out.push({ kind: 'same', a: o.a!, b: o.b! })
    }
  }
  flush()
  return out
}

/** Merge two blocks of the same type into one DiffNode; null when they can't be merged (atoms, other types). */
export function mergeBlock(a: JSONContent, b: JSONContent): DiffNode | null {
  if (a.type !== b.type) return null
  const base: DiffNode = { type: b.type ?? 'paragraph', ...(b.attrs ? { attrs: b.attrs } : {}), ...(sameAttrs(a, b) ? {} : { was: a.attrs ?? {} }) }
  if (isTextblock(a) || isTextblock(b)) return { ...base, content: mergeInline(a.content, b.content) }
  if (!a.content?.length && !b.content?.length) return blockKey(a) === blockKey(b) ? toDiffNode(b) : null
  const content: DiffNode[] = []
  for (const op of diffChildren(a.content ?? [], b.content ?? [])) {
    if (op.kind === 'same') content.push(toDiffNode(op.b))
    else if (op.kind === 'removed') content.push(toDiffNode(op.a, 'del'))
    else if (op.kind === 'added') content.push(toDiffNode(op.b, 'add'))
    else content.push(op.merged)
  }
  return { ...base, content }
}

/** Diff two docs: their top-level blocks, changed ones merged word by word. */
export function diffDocs(oldDoc: JSONContent | null | undefined, newDoc: JSONContent | null | undefined): DocItem[] {
  return diffChildren(oldDoc?.content ?? [], newDoc?.content ?? []).map((op): DocItem => {
    if (op.kind === 'same') return { kind: 'same', block: op.b }
    if (op.kind === 'removed') return { kind: 'removed', block: op.a }
    if (op.kind === 'added') return { kind: 'added', block: op.b }
    return { kind: 'changed', before: op.a, after: op.b, merged: op.merged }
  })
}

export function docDiffStats(items: DocItem[]): { added: number; removed: number; changed: number; same: number } {
  const s = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const it of items) s[it.kind] += 1
  return s
}

/** Words removed / added inside a merged node (the counter). */
export function wordCounts(node: DiffNode | DiffNode[]): { del: number; add: number } {
  const c = { del: 0, add: 0 }
  const walk = (n: DiffNode, inherited?: 'del' | 'add') => {
    const d = n.diff ?? inherited
    if (n.type === 'text' && d) c[d] += (n.text?.match(/\S+/g) ?? []).length
    for (const k of n.content ?? []) walk(k, d)
  }
  for (const n of Array.isArray(node) ? node : [node]) walk(n)
  return c
}

/* ------------------------------------------------------------------ */
/* Folding unchanged blocks                                            */
/* ------------------------------------------------------------------ */

export type DiffRow = { kind: 'item'; item: DocItem; index: number } | { kind: 'fold'; count: number; from: number; to: number }

/**
 * The rows to show: every change plus `context` unchanged blocks around it; longer unchanged runs
 * fold into one row ("12 unchanged blocks"). `open`: folds the reader opened (by their first index).
 */
export function foldRows(items: DocItem[], context: number, open: ReadonlySet<number> = new Set()): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0
  while (i < items.length) {
    if (items[i].kind !== 'same') {
      rows.push({ kind: 'item', item: items[i], index: i })
      i++
      continue
    }
    let j = i
    while (j < items.length && items[j].kind === 'same') j++
    const head = i === 0 ? 0 : context
    const tail = j === items.length ? 0 : context
    if (j - i > head + tail + 1 && !open.has(i + head)) {
      for (let k = i; k < i + head; k++) rows.push({ kind: 'item', item: items[k], index: k })
      rows.push({ kind: 'fold', count: j - i - head - tail, from: i + head, to: j - tail })
      for (let k = j - tail; k < j; k++) rows.push({ kind: 'item', item: items[k], index: k })
    } else for (let k = i; k < j; k++) rows.push({ kind: 'item', item: items[k], index: k })
    i = j
  }
  return rows
}
