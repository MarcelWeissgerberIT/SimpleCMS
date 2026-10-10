/**
 * Three-way merge of pages (used by cross-tab sync).
 *
 * Two tabs that edit the same page within the same save window each write their whole copy of
 * it. The second writer would wipe the first one's words, so persistence merges instead: it
 * knows the copy its own edits started from (`base`), finds what the other tab stored
 * (`theirs`) and combines both changes with its own (`ours`).
 *
 * - Page fields: the side that changed a field wins; `properties` and `settings` merge key by key.
 * - Content (TipTap JSON): blocks are matched by their `id` attribute (or by value), inline
 *   content character by character (marks and atoms included). Changes in different places are
 *   all kept; insertions at the same spot are both kept (theirs first). Only when both sides
 *   changed the very same characters does ours win there.
 */
import type { JSONContent } from '@tiptap/core'
import { plainText } from './plain'
import type { Page } from './types'

type Json = unknown
type Rec = Record<string, Json>

const isRec = (v: Json): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a as Rec).filter((k) => (a as Rec)[k] !== undefined)
  const kb = Object.keys(b as Rec).filter((k) => (b as Rec)[k] !== undefined)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!deepEqual((a as Rec)[k], (b as Rec)[k])) return false
  return true
}

/** Key by key: a key only one side changed takes that side's value; both changed → ours. */
function mergeRecord(base: Rec, theirs: Rec, ours: Rec): Rec {
  const out: Rec = { ...ours }
  for (const k of new Set([...Object.keys(base), ...Object.keys(theirs), ...Object.keys(ours)])) {
    if (deepEqual(ours[k], base[k]) && !deepEqual(theirs[k], base[k])) {
      if (theirs[k] === undefined) delete out[k]
      else out[k] = theirs[k]
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Sequence diff (Myers) + diff3                                       */
/* ------------------------------------------------------------------ */

/** base[a0, a1) became side[b0, b1). */
interface Hunk {
  a0: number
  a1: number
  b0: number
  b1: number
}

/** Upper bound for the Myers trace (number of stored cells); beyond it the middle is one hunk. */
const TRACE_CELLS = 4_000_000

function myers(a: string[], b: string[]): Hunk[] {
  const n = a.length
  const m = b.length
  if (!n && !m) return []
  if (!n || !m) return [{ a0: 0, a1: n, b0: 0, b1: m }]
  const max = n + m
  const off = max + 1
  const limit = Math.min(max, Math.floor(TRACE_CELLS / (2 * max + 3)))
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let end = -1
  for (let d = 0; d <= limit && end < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        end = d
        break
      }
    }
  }
  if (end < 0) return [{ a0: 0, a1: n, b0: 0, b1: m }]
  // walk back to collect the matched pairs
  const matches: Array<[number, number]> = []
  let x = n
  let y = m
  for (let d = end; d > 0; d--) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1
    const prevX = vd[off + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      matches.push([x, y])
    }
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    x--
    y--
    matches.push([x, y])
  }
  matches.reverse()
  const hunks: Hunk[] = []
  let ai = 0
  let bi = 0
  for (const [mx, my] of matches) {
    if (mx > ai || my > bi) hunks.push({ a0: ai, a1: mx, b0: bi, b1: my })
    ai = mx + 1
    bi = my + 1
  }
  if (ai < n || bi < m) hunks.push({ a0: ai, a1: n, b0: bi, b1: m })
  return hunks
}

function diff(a: string[], b: string[]): Hunk[] {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  return myers(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)).map((h) => ({ a0: h.a0 + pre, a1: h.a1 + pre, b0: h.b0 + pre, b1: h.b1 + pre }))
}

interface Side extends Hunk {
  side: 0 | 1 // 0 = theirs, 1 = ours
}

/** Do two changes (from different sides) touch the same part of base? */
function clash(x: Hunk, y: Hunk): boolean {
  const xe = x.a0 === x.a1
  const ye = y.a0 === y.a1
  if (xe && ye) return x.a0 === y.a0 // two insertions at the same spot
  if (xe) return y.a0 < x.a0 && x.a0 < y.a1 // insertion inside the other's range
  if (ye) return x.a0 < y.a0 && y.a0 < x.a1
  return x.a0 < y.a1 && y.a0 < x.a1
}

interface SeqMerge<T> {
  key: (item: T) => string
  /** An item both sides kept (same key): merge its three versions. */
  same: (base: T, theirs: T, ours: T) => T
  /** Both sides changed the same stretch of base. */
  conflict: (base: T[], theirs: T[], ours: T[]) => T[]
}

function merge3Seq<T>(base: T[], theirs: T[], ours: T[], fns: SeqMerge<T>): T[] {
  const bk = base.map(fns.key)
  const tk = theirs.map(fns.key)
  const ok = ours.map(fns.key)
  const all: Side[] = [...diff(bk, tk).map((h) => ({ ...h, side: 0 as const })), ...diff(bk, ok).map((h) => ({ ...h, side: 1 as const }))]
  all.sort((p, q) => p.a0 - q.a0 || p.a1 - p.a0 - (q.a1 - q.a0))
  const groups: Side[][] = []
  for (const h of all) {
    const cur = groups[groups.length - 1]
    if (cur && cur.some((g) => g.side !== h.side && clash(g, h))) cur.push(h)
    else groups.push([h])
  }

  const out: T[] = []
  let bPos = 0
  let tPos = 0
  let oPos = 0
  const stable = (to: number) => {
    for (; bPos < to; bPos++, tPos++, oPos++) out.push(fns.same(base[bPos], theirs[tPos], ours[oPos]))
  }
  for (const g of groups) {
    const g0 = Math.min(...g.map((h) => h.a0))
    const g1 = Math.max(...g.map((h) => h.a1))
    stable(g0)
    const span = g1 - g0
    const len = (side: 0 | 1) => span + g.filter((h) => h.side === side).reduce((n, h) => n + (h.b1 - h.b0) - (h.a1 - h.a0), 0)
    const bR = base.slice(g0, g1)
    const tR = theirs.slice(tPos, tPos + len(0))
    const oR = ours.slice(oPos, oPos + len(1))
    const sides = new Set(g.map((h) => h.side))
    if (sides.size === 2) out.push(...fns.conflict(bR, tR, oR))
    // one side changed this stretch; if the other one edited inside it too (same keys,
    // other content) that is a conflict as well
    else if (sides.has(0)) out.push(...(deepEqual(oR, bR) ? tR : fns.conflict(bR, tR, oR)))
    else out.push(...(deepEqual(tR, bR) ? oR : fns.conflict(bR, tR, oR)))
    bPos = g1
    tPos += tR.length
    oPos += oR.length
  }
  stable(base.length)
  return out
}

/* ------------------------------------------------------------------ */
/* TipTap JSON                                                         */
/* ------------------------------------------------------------------ */

const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath'])
const isInline = (nodes: JSONContent[]) => nodes.every((n) => !!n.type && INLINE.has(n.type))

interface Token {
  key: string
  ch?: string
  marks?: JSONContent['marks']
  node?: JSONContent
}

function tokenize(nodes: JSONContent[]): Token[] {
  const out: Token[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      const mk = n.marks?.length ? JSON.stringify(n.marks) : ''
      for (const ch of Array.from(n.text ?? '')) out.push({ key: `c${mk}\u0001${ch}`, ch, marks: n.marks })
    } else out.push({ key: `n${JSON.stringify(n)}`, node: n })
  }
  return out
}

function untokenize(tokens: Token[]): JSONContent[] {
  const out: JSONContent[] = []
  let run: { text: string; marks?: JSONContent['marks']; mk: string } | null = null
  const close = () => {
    if (run) out.push(run.marks?.length ? { type: 'text', text: run.text, marks: run.marks } : { type: 'text', text: run.text })
    run = null
  }
  for (const t of tokens) {
    if (t.ch === undefined) {
      close()
      if (t.node) out.push(t.node)
      continue
    }
    const mk = t.key.slice(0, t.key.indexOf('\u0001'))
    if (run && run.mk === mk) run.text += t.ch
    else {
      close()
      run = { text: t.ch, marks: t.marks, mk }
    }
  }
  close()
  return out
}

function mergeInline(base: JSONContent[], theirs: JSONContent[], ours: JSONContent[]): JSONContent[] {
  const merged = merge3Seq(tokenize(base), tokenize(theirs), tokenize(ours), {
    key: (t) => t.key,
    same: (_b, _t, o) => o,
    // typed at the same spot: keep both; changed the same characters: ours
    conflict: (b, t, o) => (b.length ? o : [...t, ...o]),
  })
  return untokenize(merged)
}

const blockKey = (n: JSONContent) => {
  const id = n.attrs?.id
  return typeof id === 'string' && id ? `#${n.type}:${id}` : `=${JSON.stringify(n)}`
}

function mergeBlocks(base: JSONContent[], theirs: JSONContent[], ours: JSONContent[]): JSONContent[] {
  return merge3Seq(base, theirs, ours, {
    key: blockKey,
    same: mergeNode,
    conflict: (b, t, o) => {
      // the same blocks edited on both sides (blocks without ids): merge them one by one
      if (b.length === t.length && b.length === o.length && b.every((n, i) => n.type === t[i].type && n.type === o[i].type)) {
        return b.map((n, i) => mergeNode(n, t[i], o[i]))
      }
      if (!b.length) return [...t, ...o]
      // ours wins the stretch, but blocks the other tab added there are kept
      const known = new Set([...b, ...o].map(blockKey))
      return [...o, ...t.filter((n) => !known.has(blockKey(n)))]
    },
  })
}

function mergeNode(base: JSONContent, theirs: JSONContent, ours: JSONContent): JSONContent {
  if (deepEqual(theirs, base)) return ours
  if (deepEqual(ours, base) || deepEqual(theirs, ours)) return theirs
  // a node turned into another kind (or plain text nodes): no structure to merge
  if (theirs.type !== ours.type || base.type !== ours.type || ours.type === 'text') return ours
  const out: JSONContent = { ...ours }
  if (base.attrs || theirs.attrs || ours.attrs) out.attrs = mergeRecord(base.attrs ?? {}, theirs.attrs ?? {}, ours.attrs ?? {})
  if (deepEqual(ours.marks, base.marks) && theirs.marks !== undefined) out.marks = theirs.marks
  const bc = base.content ?? []
  const tc = theirs.content ?? []
  const oc = ours.content ?? []
  if (base.content || theirs.content || ours.content) {
    out.content = isInline(bc) && isInline(tc) && isInline(oc) ? mergeInline(bc, tc, oc) : mergeBlocks(bc, tc, oc)
  }
  return out
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

export function mergeContent(base: JSONContent | null, theirs: JSONContent | null, ours: JSONContent | null): JSONContent | null {
  if (deepEqual(theirs, base) || deepEqual(theirs, ours)) return ours
  if (deepEqual(ours, base)) return theirs
  // one side emptied the page (or never had content): nothing to combine with
  if (!theirs || !ours) return ours
  return mergeNode(base ?? EMPTY_DOC, theirs, ours)
}

/* ------------------------------------------------------------------ */
/* Records with ids (comment threads and their replies)                */
/* ------------------------------------------------------------------ */

type Keyed = Rec & { id: string }
const keyedList = (v: Json): Keyed[] => (Array.isArray(v) ? v.filter((x): x is Keyed => isRec(x) && typeof x.id === 'string') : [])

/**
 * Lists of records with an `id` (comment threads, their replies): added on either side → kept;
 * deleted on one side and untouched on the other → gone; changed on both → merged field by field
 * (`nested` names a child list merged the same way). Ordered by createdAt.
 */
function mergeById(base: Json, theirs: Json, ours: Json, nested?: string): Keyed[] {
  const b = new Map(keyedList(base).map((x) => [x.id, x]))
  const t = new Map(keyedList(theirs).map((x) => [x.id, x]))
  const out: Keyed[] = []
  const seen = new Set<string>()
  const strip = (r: Keyed | undefined): Rec => {
    if (!r || !nested) return r ?? {}
    const { [nested]: _skip, ...rest } = r
    return rest
  }
  for (const o of keyedList(ours)) {
    seen.add(o.id)
    const th = t.get(o.id)
    const bs = b.get(o.id)
    if (th) {
      const rec = mergeRecord(strip(bs), strip(th), strip(o)) as Keyed
      if (nested) rec[nested] = mergeById(bs?.[nested], th[nested], o[nested])
      out.push(rec)
    } else if (!bs || !deepEqual(o, bs)) out.push(o) // they deleted it: keep ours only when we changed (or added) it
  }
  for (const [id, th] of t) {
    if (seen.has(id)) continue
    const bs = b.get(id)
    if (!bs || !deepEqual(th, bs)) out.push(th) // new on their side (or changed there while we deleted it)
  }
  const at = (r: Keyed) => (typeof r.createdAt === 'number' ? r.createdAt : 0)
  return out.map((r, i) => ({ r, i })).sort((x, y) => at(x.r) - at(y.r) || x.i - y.i).map((x) => x.r)
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

/** Bookkeeping fields: never compared, never merged. */
const META = new Set(['contentRev', 'contentOrigin', 'updatedAt', 'plain'])

/** Same page as far as the user can tell (content, title, properties …), bookkeeping aside. */
export function samePage(a: Page, b: Page): boolean {
  if (a === b) return true
  if (a.updatedAt === b.updatedAt && a.contentRev === b.contentRev && a.contentOrigin === b.contentOrigin) return true
  const ra = a as unknown as Rec
  const rb = b as unknown as Rec
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (!META.has(k) && !deepEqual(ra[k], rb[k])) return false
  }
  return true
}

/**
 * Combine the other tab's version of a page (`theirs`) with ours; both descend from `base`.
 * Returns `ours` itself when theirs adds nothing.
 */
export function mergePage(base: Page, theirs: Page, ours: Page): Page {
  const rb = base as unknown as Rec
  const rt = theirs as unknown as Rec
  const ro = ours as unknown as Rec
  const out: Rec = { ...ro }
  let changed = false
  for (const k of new Set([...Object.keys(rb), ...Object.keys(rt), ...Object.keys(ro)])) {
    if (META.has(k) || k === 'content' || deepEqual(rt[k], rb[k]) || deepEqual(rt[k], ro[k])) continue
    if (deepEqual(ro[k], rb[k])) out[k] = rt[k]
    else if ((k === 'properties' || k === 'settings') && isRec(rb[k]) && isRec(rt[k]) && isRec(ro[k])) out[k] = mergeRecord(rb[k], rt[k], ro[k])
    else if (k === 'comments') out[k] = mergeById(rb[k], rt[k], ro[k], 'replies')
    else continue
    changed = true
  }
  const content = mergeContent(base.content, theirs.content, ours.content)
  if (content !== ours.content) {
    out.content = content
    out.plain = plainText(content)
    changed = true
  }
  if (!changed) return ours
  out.updatedAt = Math.max(theirs.updatedAt, ours.updatedAt)
  return out as unknown as Page
}
