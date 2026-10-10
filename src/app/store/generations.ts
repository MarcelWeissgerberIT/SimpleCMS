/**
 * Document schema generations — which node types a build of One reads, what a copy written by an OLDER build
 * is missing, and how to take its other changes over without losing what it could not read. Pure (TipTap
 * JSON). The editor's schema (editor/schema/base.ts) re-exports the two constants; the team cloud's page
 * documents (cloud/content.ts) and the local workspace's records (persistence.ts) guard against older copies.
 *
 * An older build that meets a node type it does not know:
 *  - 'drop'   — y-prosemirror (team cloud) deletes the node from its copy of the shared document; the person
 *               there never saw it, so nothing they did can mean it — `restoreNewer` puts it back (a three-way
 *               merge that keeps the older copy's own edits);
 *  - 'unwrap' — the editor's sanitize (local workspace) keeps its blocks, the node itself goes; the person there
 *               saw its title and notes as plain blocks and may have edited them — `rewrapNewer` wraps the node
 *               again around what is left of its blocks (their edits kept), and lets a node go only when none of
 *               its blocks is left (deleted there, or the whole page replaced: a restore, an import).
 * Its stored copy then lacks those nodes. Taken as it is, that loss would reach this build's copy, the
 * server or the other tabs.
 */
import type { JSONContent } from '@tiptap/core'
import { diff, mergeContent } from './merge'

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
  const walk = (n: JSONContent | undefined) => {
    if (!n || typeof n !== 'object') return
    if (newerThan(n.type, gen)) out.set(n.type!, (out.get(n.type!) ?? 0) + 1)
    n.content?.forEach(walk)
  }
  walk(doc ?? undefined)
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
  const walk = (n: JSONContent): JSONContent[] => {
    if (newerThan(n.type, gen)) return mode === 'drop' ? [] : (n.content ?? []).flatMap(walk)
    if (!n.content) return [n]
    const kids = n.content.flatMap(walk)
    return [kids.length === n.content.length && kids.every((k, i) => k === n.content![i]) ? n : { ...n, content: kids }]
  }
  return walk(doc)[0] ?? { type: 'doc', content: [] }
}

/**
 * `after` — what a client of generation `gen` made of `before` (losing its newer nodes, `mode`) plus its own
 * edits — with every newer node of `before` back. 'drop': a three-way merge (base: `before` as that client saw
 * it; where both changed the same blocks, `before` wins). 'unwrap': `rewrapNewer` (what is left of a node's
 * blocks, edits and all, wrapped again). `after` itself when it lost nothing.
 */
export function restoreNewer(before: JSONContent | null, after: JSONContent | null, gen: number, mode: LossMode): JSONContent | null {
  if (mode === 'unwrap') return rewrapNewer(before, after, gen).doc
  if (!before || !lostNewer(before, after, gen)) return after
  if (!after) return before
  return mergeContent(asGeneration(before, gen, mode), after, before)
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

/* ------------------------------------------------------------------ rewrap (an older build that unwraps) */

/** The block a newer node's content has to start with (its schema) — put back when none of it is left there. */
const LEAD: Readonly<Record<string, string>> = { workItem: 'paragraph' }
/** Parts of a container: no text of their own tells two apart — the same part when they sit in the same place. */
const PARTS = new Set(['column', 'tab', 'detailsSummary', 'detailsContent', 'tableRow', 'tableCell', 'tableHeader'])
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
/** Blocks of a changed stretch compared pair by pair at most (beyond that it was replaced as a whole). */
const PAIR_CELLS = 40_000

const idOf = (n: JSONContent): string | null => (typeof n.attrs?.id === 'string' && n.attrs.id ? n.attrs.id : null)

/** A newer node's identity across copies: its item id, else its block id, else its value. */
function identity(n: JSONContent): string {
  const a = n.attrs
  if (typeof a?.itemId === 'string' && a.itemId) return `i:${a.itemId}`
  const id = idOf(n)
  return id ? `b:${id}` : `v:${JSON.stringify(n)}`
}

function each(n: JSONContent | null | undefined, fn: (n: JSONContent) => void): void {
  if (!n || typeof n !== 'object') return
  fn(n)
  n.content?.forEach((c) => each(c, fn))
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

/** A node's value without the ids `keep` refuses and without empty attrs, in a stable order (key order aside). */
function canonical(n: JSONContent, keep: (id: string) => boolean): unknown {
  return [
    n.type,
    cleanAttrs(n.attrs, (k, v) => k === 'id' && typeof v === 'string' && !keep(v)) ?? null,
    n.text ?? null,
    n.marks?.map((m) => [m.type, cleanAttrs(m.attrs, () => false) ?? null]) ?? null,
    n.content ? n.content.map((c) => canonical(c, keep)) : null,
  ]
}

/** A block's print: its value without any id (what an editor's defaults and key order change aside). */
const blockPrint = (n: JSONContent): number => hash53(JSON.stringify(canonical(n, () => false)))

/**
 * The prints of the blocks inside newer nodes — what a build of this generation wrote of them. An older build's own
 * cross-tab merge brings such a version back as its own when it saved with typing of its own anywhere on the page
 * (to it, every unwrapped node is a change): persistence.ts keeps the recent ones per page, so `rewrapNewer`
 * (`wrote`) tells that stale copy from an edit made there.
 */
export function newerBlockPrints(doc: JSONContent | null | undefined, gen = 0): number[] {
  const out: number[] = []
  const walk = (n: JSONContent | undefined, inside: boolean) => {
    if (!n || typeof n !== 'object' || INLINE.has(n.type ?? '')) return
    if (inside) out.push(blockPrint(n))
    n.content?.forEach((c) => walk(c, inside || newerThan(n.type, gen)))
  }
  walk(doc ?? undefined, false)
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

/** How alike two containers are, 0 – 1: the share of the shorter one's lines (non-empty) with a like line in the other; 0 under half. */
function linesLikeness(p: string[], q: string[]): number {
  const a = p.filter(Boolean).slice(0, 200)
  const b = q.filter(Boolean).slice(0, 200)
  if (!a.length || !b.length) return !a.length && !b.length ? 0.5 : 0
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let hits = 0
  for (const line of short) if (long.some((l) => textLikeness(line, l) > 0.05)) hits++
  return 2 * hits >= short.length ? hits / long.length : 0
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

export interface RewrapOptions {
  /** the older copy replaced the page as a whole (a version restored, a backup or an import there) */
  whole?: boolean
  /** did a build of this generation write this version (its print, `newerBlockPrints`) of a block inside a newer node? */
  wrote?: (print: number) => boolean
}

export interface Rewrapped {
  doc: JSONContent | null
  /** Newer nodes of `before` that stay gone (none of their blocks left, or the page replaced): the caller keeps a version. */
  dropped: JSONContent[]
}

/** A block of `before` as the older build held it (lost nodes unwrapped), with the lost nodes it sat in (outermost first). */
interface Slot {
  node: JSONContent
  /** as it is in `before` */
  orig: JSONContent
  owners: JSONContent[]
}

/** A block of the older copy and where it goes: 'kept' unchanged, 'edited' changed there, 'new' added there. */
interface Placed {
  node: JSONContent
  owners: JSONContent[]
  kind: 'kept' | 'edited' | 'new'
}

/**
 * Where the older build's own cross-tab merge may have kept a stale copy of our version: every newer node of `before`
 * that `after` still holds, with the block around it that is exactly our version (where both tabs changed the same
 * stretch, that merge keeps its own blocks and appends our changed ones whole) — unit → the newer nodes in it.
 */
function staleUnits(before: JSONContent, after: JSONContent, gen: number): Map<JSONContent, string[]> {
  const units = new Map<JSONContent, string[]>()
  const mine = new Set<string>()
  const ours = new Set<string>()
  const bare = (n: JSONContent) => JSON.stringify(canonical(n, () => false))
  const holds = (n: JSONContent): boolean => newerThan(n.type, gen) || !!n.content?.some(holds)
  each(before, (n) => {
    if (newerThan(n.type, gen)) mine.add(identity(n))
    if (n !== before && holds(n)) ours.add(bare(n))
  })
  if (!mine.size) return units
  const walk = (n: JSONContent, chain: JSONContent[]) => {
    if (!n || typeof n !== 'object') return
    if (newerThan(n.type, gen) && mine.has(identity(n))) {
      const unit = chain.find((a) => ours.has(bare(a))) ?? n
      units.set(unit, [...(units.get(unit) ?? []), identity(n)])
      return
    }
    n.content?.forEach((c) => walk(c, [...chain, n]))
  }
  after.content?.forEach((c) => walk(c, []))
  return units
}

/**
 * `after` without the stale copies (staleUnits) whose blocks are also elsewhere in it, by id: such a copy goes —
 * of a newer node itself, its blocks that are nowhere else stay in its place.
 */
function withoutStaleCopies(before: JSONContent, after: JSONContent, gen: number): JSONContent {
  const units = staleUnits(before, after, gen)
  if (!units.size) return after
  const inside = new Map<JSONContent, string[]>()
  const outside = new Set<string>()
  const walk = (n: JSONContent, unit: JSONContent | null) => {
    if (!n || typeof n !== 'object') return
    let u = unit
    if (!u && units.has(n)) inside.set((u = n), [])
    const id = idOf(n)
    if (id && u && n !== u) inside.get(u)!.push(id)
    else if (id && !u) outside.add(id)
    n.content?.forEach((c) => walk(c, u))
  }
  walk(after, null)
  const stale = new Set<JSONContent>()
  for (const [n, ids] of inside) if (ids.some((id) => outside.has(id))) stale.add(n)
  if (!stale.size) return after
  const fresh = (n: JSONContent): boolean => {
    const id = idOf(n)
    return !!id && !outside.has(id)
  }
  const strip = (n: JSONContent): JSONContent[] => {
    if (stale.has(n)) return newerThan(n.type, gen) ? (n.content ?? []).filter(fresh) : []
    if (!n.content) return [n]
    return [{ ...n, content: n.content.flatMap(strip) }]
  }
  return strip(after)[0]
}

/**
 * `after` — a copy an older build (generation `gen`, whose editor UNWRAPS node types it does not know) stored
 * of `before`, plus whatever the person did there — with every newer node of `before` that `after` lacks wrapped
 * again around what is left of its blocks. `after` itself is the truth for every block: nothing of `before` is
 * added but the wrappers (and a node's leading block when none is left), so nothing is ever doubled.
 *  - which block of `after` is which block of `before`: the same id; for a block without one (the older editor
 *    gives such blocks a fresh id at every load) the same value, else — within a changed stretch — the same type
 *    and similar text (an edit), else it is new;
 *  - text typed into a task's title or notes (plain blocks there) stays in the task; a block added between two of
 *    its blocks, or in the place of blocks that were all its own, joins it; one added at its edge stays outside;
 *  - a node with nothing left there (its blocks deleted, or only emptied lines) stays gone, as does every lost node
 *    when the page was replaced as a whole (`whole`; a stretch that replaced a whole level is that too): `dropped`
 *    lists them, so the caller keeps the version that had them;
 *  - a block of a lost node that comes back exactly as this build wrote it earlier (`wrote`: the older build's merge
 *    kept a stale copy over an edit made here meanwhile) is this build's version;
 *  - a newer node never goes inside one; a node that came apart (its blocks moved away from each other) is put
 *    back around the larger part.
 * Idempotent: what it returns lacks nothing, so a second pass returns it as it is.
 */
export function rewrapNewer(before: JSONContent | null, after: JSONContent | null, gen: number, opts: RewrapOptions = {}): Rewrapped {
  if (!before) return { doc: after, dropped: [] }
  let clean = after && withoutStaleCopies(before, after, gen)
  // a newer node the older copy still holds next to an unwrapped copy of all its blocks (its merge kept both sides;
  // blocks without ids, so withoutStaleCopies cannot tell) — with the block around it that is exactly our version
  // (the merge appends our changed blocks whole): taken away, every newer node in it is found again, whole. An older
  // tab whose editor showed the page holds every task unwrapped — a second, whole copy is its merge's.
  if (clean && !opts.whole) {
    const units = staleUnits(before, clean, gen)
    if (units.size) {
      // where each block is in the copy (that merge appends our blocks AFTER its own: the copy found must come first)
      const order = new Map<JSONContent, number>()
      each(clean, (n) => order.set(n, order.size))
      const origin = new WeakMap<JSONContent, JSONContent>()
      const trial = rewrapLost(before, without(clean, new Set(units.keys()), origin), gen, opts, (n) => order.get(origin.get(n) ?? n) ?? -1, clean)
      const stale = new Set(
        [...units]
          .filter(([unit, ids]) =>
            ids.every((id) => {
              const at = trial.found.get(id)
              return at !== undefined && at < order.get(unit)!
            }),
          )
          .map(([n]) => n),
      )
      if (stale.size === units.size) return { doc: trial.doc, dropped: trial.dropped }
      if (stale.size) clean = without(clean, stale)
    }
  }
  const { doc, dropped } = rewrapLost(before, clean, gen, opts)
  return { doc, dropped }
}

/** `doc` without these nodes (whole); `origin` learns the node each rebuilt one stands for. */
function without(doc: JSONContent, nodes: Set<JSONContent>, origin?: WeakMap<JSONContent, JSONContent>): JSONContent {
  const strip = (n: JSONContent): JSONContent[] => {
    if (nodes.has(n)) return []
    if (!n.content) return [n]
    const out = { ...n, content: n.content.flatMap(strip) }
    origin?.set(out, n)
    return [out]
  }
  return strip(doc)[0]
}

/**
 * rewrapNewer's work on a copy without stale copies. `found`: the lost nodes put back whole — every block found,
 * surely — with where the last of those blocks is (`at`, the place of a block of `clean` in the caller's copy
 * `full`, which `clean` is part of).
 */
function rewrapLost(
  before: JSONContent,
  clean: JSONContent | null,
  gen: number,
  opts: RewrapOptions,
  at: (n: JSONContent) => number = () => 0,
  full: JSONContent | null = clean,
): Rewrapped & { found: Map<string, number> } {
  const found = new Map<string, number>()
  if (!lostNewer(before, clean, gen)) return { doc: clean, dropped: [], found }
  if (!clean) return { doc: before, dropped: [], found }

  // the newer nodes of `before` that `after` lacks (one each for every copy `after` still holds)
  const have = new Map<string, number>()
  each(clean, (n) => {
    if (newerThan(n.type, gen)) have.set(identity(n), (have.get(identity(n)) ?? 0) + 1)
  })
  const lost = new Set<JSONContent>()
  each(before, (n) => {
    if (!newerThan(n.type, gen)) return
    const k = identity(n)
    const left = have.get(k) ?? 0
    if (left > 0) have.set(k, left - 1)
    else lost.add(n)
  })
  if (opts.whole) return { doc: clean, dropped: [...lost], found }

  // block ids: every id `before` knows (any other was made up by the older editor), every id `after` holds
  const known = new Set<string>()
  each(before, (n) => {
    const id = idOf(n)
    if (id) known.add(id)
  })
  // (in a trial without a stale copy: the ids of the whole copy — a block whose id is in the copy taken away is
  // that block, never another one like it)
  const held = new Set<string>()
  each(full, (n) => {
    const id = idOf(n)
    if (id) held.add(id)
  })

  const memo = <T>(fn: (n: JSONContent) => T) => {
    const cache = new WeakMap<JSONContent, T>()
    return (n: JSONContent): T => {
      if (cache.has(n)) return cache.get(n)!
      const v = fn(n)
      cache.set(n, v)
      return v
    }
  }
  /** the value without made-up ids and empty attrs */
  const value = memo((n) => JSON.stringify(canonical(n, (id) => known.has(id))))
  /** the value without any id */
  const bare = memo((n) => JSON.stringify(canonical(n, () => false)))
  const text: (n: JSONContent) => string = memo((n) => (n.text ?? '') + (n.content ?? []).map(text).join(''))
  /** the text of every line in a container */
  const lines = memo((n: JSONContent) => {
    const out: string[] = []
    each(n, (c) => {
      if (c !== n && TEXTBLOCKS.has(c.type ?? '')) out.push(text(c))
    })
    return out
  })
  const holdsLost: (n: JSONContent) => boolean = memo((n) => lost.has(n) || !!n.content?.some(holdsLost))
  const holdsNewer: (n: JSONContent) => boolean = memo((n) => newerThan(n.type, gen) || !!n.content?.some(holdsNewer))
  const blocky = (n: JSONContent) => !!n.content?.length && n.content.every((c) => !INLINE.has(c.type ?? ''))
  const keyOf = (n: JSONContent): string => {
    const id = idOf(n)
    return id && known.has(id) ? `#${n.type}:${id}` : `=${value(n)}`
  }
  /** a block as the older build held it */
  const project: (n: JSONContent) => JSONContent[] = memo((n) => {
    if (lost.has(n)) return (n.content ?? []).flatMap(project)
    if (!n.content || !holdsLost(n)) return [n]
    return [{ ...n, content: n.content.flatMap(project) }]
  })
  const slotsOf = (list: JSONContent[], owners: JSONContent[]): Slot[] =>
    list.flatMap((n) => (lost.has(n) ? slotsOf(n.content ?? [], [...owners, n]) : [{ node: project(n)[0], orig: n, owners }]))
  const common = (a: JSONContent[] | undefined, b: JSONContent[] | undefined): JSONContent[] => {
    if (!a || !b) return []
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return a.slice(0, i)
  }

  /** How much `a` (a block of the older copy) looks like the block `s` changed there, 0 – 1 (0: another block). */
  const likeness = (s: Slot, a: JSONContent): number => {
    if (s.node.type !== a.type) return 0
    const aid = idOf(a)
    if (aid && known.has(aid)) return aid === idOf(s.node) ? 1 : 0
    // the slot's id lives on elsewhere in `after`: that is the block
    const sid = idOf(s.node)
    if (sid && held.has(sid)) return 0
    if (bare(s.node) === bare(a)) return 1
    if (PARTS.has(a.type ?? '')) return 0.5
    if (blocky(s.node) && blocky(a)) return linesLikeness(lines(s.node), lines(a))
    const p = text(s.node)
    const q = text(a)
    if (!p && !q) return TEXTBLOCKS.has(a.type ?? '') ? 1 : 0
    return textLikeness(p, q)
  }
  /**
   * `a` is surely the block `s`: much alike, or a version we wrote of it — not merely like it (a line like another
   * is no proof: taking a task we hold for a stale copy would lose it, a stale copy left is only seen twice)
   */
  const surely = (s: Slot, a: JSONContent): boolean => likeness(s, a) >= 0.5 || !!opts.wrote?.(blockPrint(a))
  /** every block of `before` with an id: a block the older copy moved is still that block (its lost nodes inside too) */
  const byId = new Map<string, JSONContent>()
  each(before, (n) => {
    const id = idOf(n)
    if (id && !lost.has(n) && !byId.has(id)) byId.set(id, n)
  })
  /** `a` with the lost nodes of `orig` (the block of `before` it is) put back inside it, level by level */
  const inside = (orig: JSONContent | undefined, a: JSONContent): JSONContent =>
    orig && holdsLost(orig) && blocky(orig) && blocky(a) ? { ...a, content: level(orig.content!, a.content!) } : a

  const used = new Set<JSONContent>()
  /** per lost node: its blocks, and how many of them the older copy holds (in place, changed or moved) */
  const blocks = new Map<JSONContent, number>()
  const hits = new Map<JSONContent, number>()
  const last = new Map<JSONContent, number>()
  const count = (map: Map<JSONContent, number>, s: Slot) => s.owners.forEach((o) => map.set(o, (map.get(o) ?? 0) + 1))
  const hit = (s: Slot, a: JSONContent) => {
    count(hits, s)
    s.owners.forEach((o) => last.set(o, Math.max(last.get(o) ?? -1, at(a))))
  }
  const emptied = (run: Placed[]) => run.every((p) => p.kind !== 'kept' && p.node.type === 'paragraph' && !p.node.content?.length)

  /** Consecutive blocks with the same owner at `depth` go back inside it. */
  const group = (placed: Placed[], depth: number): JSONContent[] => {
    const runs: Array<{ owner: JSONContent | undefined; from: number; to: number }> = []
    for (let k = 0; k < placed.length; ) {
      const owner = placed[k].owners[depth]
      let e = k + 1
      if (owner) while (e < placed.length && placed[e].owners[depth] === owner) e++
      runs.push({ owner, from: k, to: e })
      k = e
    }
    const best = new Map<JSONContent, { from: number; weight: number }>()
    for (const r of runs) {
      if (!r.owner) continue
      const weight = placed.slice(r.from, r.to).filter((p) => p.kind !== 'new').length
      const cur = best.get(r.owner)
      if (!cur || weight > cur.weight) best.set(r.owner, { from: r.from, weight })
    }
    const out: JSONContent[] = []
    for (const r of runs) {
      if (!r.owner) {
        out.push(placed[r.from].node)
        continue
      }
      const run = placed.slice(r.from, r.to)
      const kids = group(run, depth + 1)
      // put back once, around its largest part — never around only new blocks or emptied lines (deleted there)
      const b = best.get(r.owner)
      if (b?.from !== r.from || !b.weight || used.has(r.owner) || emptied(run)) {
        out.push(...kids)
        continue
      }
      used.add(r.owner)
      const lead = LEAD[r.owner.type ?? '']
      // a node put back without a block id gets a stable one: the older build's next merge then knows it (an unknown
      // node there is a block it appends beside its own copy)
      const attrs = idOf(r.owner) ? r.owner.attrs : { ...r.owner.attrs, id: `${r.owner.type}-${hash53(identity(r.owner)).toString(36)}` }
      out.push({ ...r.owner, attrs, content: lead && kids[0]?.type !== lead ? [{ type: lead }, ...kids] : kids })
    }
    return out
  }

  /** One level: `bList` (from `before`) against `aList` (the older copy). */
  const level = (bList: JSONContent[], aList: JSONContent[]): JSONContent[] => {
    const slots = slotsOf(bList, [])
    if (!slots.some((s) => s.owners.length || holdsLost(s.orig))) return aList
    slots.forEach((s) => count(blocks, s))
    // which slot each block of the older copy is: the same key (id, or value), else the same block changed there
    const match: Array<number | null> = aList.map(() => null)
    let i = 0
    let j = 0
    const same = (to: number) => {
      for (; i < to; i++, j++) match[j] = i
    }
    for (const h of diff(slots.map((s) => keyOf(s.node)), aList.map(keyOf))) {
      same(h.a0)
      for (const [x, y] of pairUp(h.a1 - h.a0, h.b1 - h.b0, (x, y) => likeness(slots[h.a0 + x], aList[h.b0 + y]))) match[h.b0 + y] = h.a0 + x
      i = h.a1
      j = h.b1
    }
    same(slots.length)

    const whole = match.every((m) => m === null)
    // slots no block of the older copy is at their place: a block elsewhere that is one of them was moved there
    const free = new Set(slots.keys())
    for (const m of match) if (m !== null) free.delete(m)
    const freeByKey = new Map<string, number[]>()
    for (const x of free) {
      const k = keyOf(slots[x].node)
      freeByKey.set(k, [...(freeByKey.get(k) ?? []), x])
    }
    const movedSlot = (a: JSONContent): Slot | undefined => {
      let x = freeByKey.get(keyOf(a))?.find((y) => free.has(y))
      if (x === undefined && blocky(a)) {
        // a container changed and moved: the most alike one that holds lost nodes
        let top = 0
        for (const y of free) {
          if (!holdsLost(slots[y].orig) || !blocky(slots[y].orig)) continue
          const l = likeness(slots[y], a)
          if (l > top) [x, top] = [y, l]
        }
      }
      if (x === undefined) return undefined
      free.delete(x)
      return slots[x]
    }
    const placed: Placed[] = []
    for (let k = 0; k < aList.length; ) {
      const m = match[k]
      if (m !== null) {
        const s = slots[m]
        const a = aList[k]
        const kept = value(a) === value(s.node)
        if (kept || surely(s, a)) hit(s, a)
        // a block of a lost node as this build wrote it before (the older merge's stale copy): this build's version —
        // with the id the older editor gave a block that had none (its next merge then knows the block)
        if (!kept && s.owners.length && !holdsLost(s.orig) && opts.wrote?.(blockPrint(a))) {
          const id = idOf(a)
          placed.push({ node: id && !idOf(s.orig) ? { ...s.orig, attrs: { ...s.orig.attrs, id } } : s.orig, owners: s.owners, kind: 'kept' })
          k++
          continue
        }
        const node = inside(s.orig, a)
        placed.push({ node, owners: holdsNewer(node) ? [] : s.owners, kind: kept ? 'kept' : 'edited' })
        k++
        continue
      }
      // blocks no slot is: added there — or what replaced the slots between their neighbours
      let e = k
      while (e < aList.length && match[e] === null) e++
      const prev = k > 0 ? match[k - 1] : null
      const next = e < aList.length ? match[e] : null
      const gone = slots.slice(prev === null ? 0 : prev + 1, next === null ? slots.length : next)
      // inside a node only when every block it replaced was in that node, or when it was added between two of
      // its blocks (at a node's edge it stays outside); a level replaced as a whole holds none
      const owners = whole ? [] : gone.length ? gone.slice(1).reduce((o, s) => common(o, s.owners), gone[0].owners) : prev === null || next === null ? [] : common(slots[prev].owners, slots[next].owners)
      for (; k < e; k++) {
        const a = aList[k]
        const s = whole ? undefined : movedSlot(a)
        if (s && surely(s, a)) hit(s, a)
        const id = idOf(a)
        // what a moved container held comes back inside it
        const node = inside(s?.orig ?? (id && known.has(id) ? byId.get(id) : undefined), a)
        // a moved block joins the node it was dropped into (between two of its blocks), else its own comes along
        const own = holdsNewer(node) ? [] : owners.length ? owners : (s?.owners ?? [])
        placed.push({ node, owners: own, kind: !s ? 'new' : value(a) === value(s.node) ? 'kept' : 'edited' })
      }
    }
    return group(placed, 0)
  }

  const content = level(before.content ?? [], clean.content ?? [])
  const dropped: JSONContent[] = []
  for (const n of lost) {
    if (!used.has(n)) dropped.push(n)
    else if (blocks.get(n) === hits.get(n)) found.set(identity(n), last.get(n) ?? -1)
  }
  return { doc: { ...clean, content }, dropped, found }
}
