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

/** Words with the whitespace after them ("quick "); whitespace at the very start on its own. */
const tokenize = (s: string): string[] => s.match(/^\s+|\S+\s*/g) ?? []

/** Word-level diff of two strings (whitespace rides with the words). */
export function wordRuns(before: string, after: string): WordRun[] {
  const out: WordRun[] = []
  for (const n of mergeInline([{ type: 'text', text: before }], [{ type: 'text', text: after }])) {
    const op: WordOp = n.diff ?? 'same'
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += n.text ?? ''
    else out.push({ op, text: n.text ?? '' })
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

/** block ids, a task's itemId and doneAt (diff.ts) */
const VOLATILE = new Set(['id', 'blockId', 'uid', 'data-id', 'itemId', 'doneAt'])

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
        // a word compares without the whitespace after it ("fox" = "fox "); whitespace alone as whitespace
        const word = part.trimEnd()
        const key = word ? `t${mk}\u0000${word}` : ' '
        out.push({ key, node: { type: 'text', text: part, ...(n.marks?.length ? { marks: n.marks } : {}) } })
      }
    } else out.push({ key: `a${blockKey(n)}`, node: n })
  }
  return out
}

const tokText = (t: Token | undefined) => (t?.node.type === 'text' ? (t.node.text ?? '') : '')

/**
 * Readable runs: a replaced word group ends where the words end, not after their space — "~~quick~~
 * slow brown" instead of "~~quick ~~slow brown". The trailing whitespace of a group of changes moves
 * into the unchanged text after it.
 */
function tidy(ops: Op<Token>[]): Op<Token>[] {
  const out: Op<Token>[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].op === 'same') {
      out.push(ops[i++])
      continue
    }
    let j = i
    while (j < ops.length && ops[j].op !== 'same') j++
    const group = ops.slice(i, j)
    const lastDel = group.findLast((o) => o.op === 'del')
    const lastAdd = group.findLast((o) => o.op === 'add')
    const ws = (o: Op<Token> | undefined) => (o ? (/\s+$/.exec(tokText(o.op === 'add' ? o.b : o.a))?.[0] ?? null) : null)
    const wd = ws(lastDel)
    const wa = ws(lastAdd)
    const keep = lastDel && lastAdd ? (wd && wa ? wa : null) : (wd ?? wa)
    if (!keep) out.push(...group)
    else {
      const strip = (o: Op<Token>): Op<Token> | null => {
        if (o !== lastDel && o !== lastAdd) return o
        const tok = (o.op === 'add' ? o.b : o.a)!
        const text = tokText(tok).replace(/\s+$/, '')
        if (!text) return null
        const next: Token = { key: tok.key, node: { ...tok.node, text } }
        return o.op === 'add' ? { ...o, b: next } : { ...o, a: next }
      }
      for (const o of group) {
        const s = strip(o)
        if (s) out.push(s)
      }
      const src = (lastAdd?.b ?? lastDel?.a)!
      const space: Token = { key: ' ', node: { type: 'text', text: keep, ...(src.node.marks?.length ? { marks: src.node.marks } : {}) } }
      out.push({ op: 'same', a: space, b: space })
    }
    i = j
  }
  return out
}

/** Word-level merge of two inline contents. */
function mergeInline(a: JSONContent[] | undefined, b: JSONContent[] | undefined): DiffNode[] {
  const out: DiffNode[] = []
  for (const o of tidy(lcs(inlineTokens(a), inlineTokens(b), (x) => x.key))) {
    // unchanged words are shown as they read now (their spacing, their marks)
    const tok = (o.op === 'del' ? o.a : o.b)!
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

/** Top-level blocks without the empty lines at the end (the editor keeps one there). */
function trimmed(doc: JSONContent | null | undefined): JSONContent[] {
  const blocks = [...(doc?.content ?? [])]
  while (blocks.length && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) blocks.pop()
  return blocks
}

/** Diff two docs: their top-level blocks, changed ones merged word by word. */
export function diffDocs(oldDoc: JSONContent | null | undefined, newDoc: JSONContent | null | undefined): DocItem[] {
  return diffChildren(trimmed(oldDoc), trimmed(newDoc)).map((op): DocItem => {
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
/* What is new (History → Version)                                     */
/* ------------------------------------------------------------------ */

/** A part of a merged node that is new: added words / children, or changed attrs (a task ticked). */
function hasNew(n: DiffNode): boolean {
  return n.diff === 'add' || !!n.was || !!n.content?.some(hasNew)
}

/**
 * A merged node with its removed parts left out (null: the node itself was removed). A removed word
 * hands the space after it to the text that follows (tidy): that text starts without it again, so
 * the result reads exactly like the newer text.
 */
function pruneRemoved(n: DiffNode): DiffNode | null {
  if (n.diff === 'del') return null
  if (!n.content) return n
  const content: DiffNode[] = []
  let cut = false
  for (const k of n.content) {
    const p = pruneRemoved(k)
    if (!p) {
      cut = true
      continue
    }
    if (cut && p.type === 'text' && !p.diff && /^\s/.test(p.text ?? '')) {
      const last = content[content.length - 1]
      if (!last || (last.type === 'text' && /\s$/.test(last.text ?? ''))) {
        const text = (p.text ?? '').replace(/^\s+/, '')
        cut = false
        if (text) content.push({ ...p, text })
        continue
      }
    }
    cut = false
    content.push(p)
  }
  return { ...n, content }
}

/** What is new in a string against an older one (a title): unchanged and added runs, removed words left out. */
export function newWordRuns(before: string, after: string): WordRun[] {
  const merged = pruneRemoved({ type: 'paragraph', content: mergeInline([{ type: 'text', text: before }], [{ type: 'text', text: after }]) })
  const out: WordRun[] = []
  for (const n of merged?.content ?? []) {
    const op: WordOp = n.diff ?? 'same'
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += n.text ?? ''
    else out.push({ op, text: n.text ?? '' })
  }
  return out
}

/**
 * The newer document with only what is NEW marked (History → Version): removed blocks left out,
 * removed words and children pruned from changed blocks. A changed block that only lost something
 * reads as unchanged; one whose attrs changed (a task ticked, a heading level) stays changed. Pure.
 */
export function withoutRemovals(items: DocItem[]): DocItem[] {
  const out: DocItem[] = []
  for (const it of items) {
    if (it.kind === 'removed') continue
    if (it.kind !== 'changed') {
      out.push(it)
      continue
    }
    const merged = pruneRemoved(it.merged)
    out.push(merged && hasNew(merged) ? { ...it, merged } : { kind: 'same', block: it.after })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Folding unchanged blocks                                            */
/* ------------------------------------------------------------------ */

export type DiffRow = { kind: 'item'; item: DocItem; index: number } | { kind: 'fold'; count: number; from: number; to: number }

/**
 * The rows to show: every change plus `context` unchanged blocks around it; longer unchanged runs
 * fold into one row ("12 unchanged blocks"). `open`: folds the reader opened (by their first index).
 * `context = Infinity` folds nothing (the whole document).
 */
export function foldRows(items: DocItem[], context: number, open: ReadonlySet<number> = new Set()): DiffRow[] {
  if (context === Infinity) return items.map((item, index) => ({ kind: 'item', item, index }))
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

/** Words removed / added over a whole diff (whole blocks count all their words). */
export function itemsWordCounts(items: DocItem[]): { del: number; add: number } {
  const c = { del: 0, add: 0 }
  const n = (s: string) => (s.match(/\S+/g) ?? []).length
  for (const it of items) {
    if (it.kind === 'removed') c.del += n(textOf(it.block))
    else if (it.kind === 'added') c.add += n(textOf(it.block))
    else if (it.kind === 'changed') {
      const w = wordCounts(it.merged)
      c.del += w.del
      c.add += w.add
    }
  }
  return c
}
