/**
 * The rack's layout (plan §3.3, §1.19, §3.7, §3.8, §6 U13 / U15, B5) — pure, never stored but for the row order.
 *
 * The rack is ONE grid whose rows all three columns share (§ 01 sources · § 02 processing · § 03 targets). This module
 * says which row each module, net flag, fold and bus chip takes; the page (B6) puts each slot at `grid-row: row + 1`
 * (row 1 holds the column heads) and spans 2U modules over two rows; the cable layer (render.ts, B7) draws the wires
 * between the anchors the slots carry (`data-j`: jack keys, flag ids, bus ids).
 *
 * How rows are chosen:
 *  - the order of § 02 comes from 3 barycentric sweeps (each column sorted by the mean height of what it is cabled to),
 *    then adjacent swaps that lower the crossing count, then every fuse path's processors pulled together (§ 02 rows
 *    stay packed, top to bottom);
 *  - § 01 and § 03 items take the row of what they are cabled to in § 02 (the first one), pushed down when it is taken —
 *    a § 03 net flag sits at its writer's row, a § 01 flag at its listener's row; at a tie the item on the higher jack
 *    goes first (no crossing), then flags, then the model's order;
 *  - **stable** (§6 U15): seeded with the previous order (localStorage `one.patchbay.order:<scope>`, module keys only,
 *    ≤ 200), the known modules keep their order AND their rows. A new § 02 module takes the place with the fewest
 *    crossings among those that move at most 2 others (the bottom always qualifies); a new § 01 / § 03 item takes the
 *    free row nearest its own. Only when that crosses notably more cables (muchBetter) do the known modules keep just
 *    their order while the rows below the new one shift; and only when the model's own fresh layout is notably better
 *    still is the rack laid out anew (`reflowed`) — its order is then the one kept.
 *
 * Folds (one row per column and reason, each module named): idle (no cable — "3 IDLE kanal · bildwerk · wiki"), off
 * (switched-off processors not on a fuse path or near miss, and what only they reach), filter (outside the 2-hop
 * filter or the preset — "9 modules hidden by the filter"), setup (the drop visit: what the profile does not touch, §3.7)
 * and bus (targets only reached by cables bundled into a "+n" chip, §1.19). Every module is placed exactly once or named
 * in exactly one closed fold, so a column head's count = placed + folded (`cols`).
 *
 * Also here: the filter presets ("Fuse paths only" opens by itself past 30 modules with an open fuse), the profile tags
 * the filter offers, the phone's fixed strand order with "Not processed" (§3.8), and the setup band's partition.
 */
import { lsGet, lsOrder, lsSet } from './cache'
import { moduleKey } from './ref'
import type { BusChip, Chain, Column, Edge, FilterPreset, Fuse, Model, Module, ModuleKey, NearMiss, Place } from './types'

/* ------------------------------------------------------------------ the result */

/** Why modules sit in a fold instead of a row. */
export type FoldWhy = 'idle' | 'off' | 'filter' | 'setup' | 'bus'

export interface ModuleSlot {
  kind: 'module'
  /** = the module key */
  id: ModuleKey
  col: Column
  /** content row (1-based; the page puts it at grid-row row + 1) */
  row: number
  span: 1 | 2
}

/** A net flag: § 03 `out` at the writer's row (the writers' cables end there), § 01 `in` at the listener's row. */
export interface FlagSlot {
  kind: 'flag'
  /** flagId(net, side) — also the cables' anchor */
  id: string
  net: string
  side: 'in' | 'out'
  col: 1 | 3
  row: number
  span: 1
}

export interface FoldSlot {
  kind: 'fold'
  /** foldId(why, col) */
  id: string
  why: Exclude<FoldWhy, 'bus'>
  col: Column
  row: number
  span: 1
  /** every module it names, in rack order */
  modules: ModuleKey[]
  /** keys of the fuses whose path runs through one of them (the fold keeps the "F1" tag) */
  fuses: string[]
  /** opened by the person (↵): its modules are placed, the slot stays as the way to close it again */
  open?: true
}

/** "+n": cables from one jack into one column past the 6th (§1.19) — the popover lists `edges`. */
export interface BusSlot {
  kind: 'bus'
  /** = the bus chip id (also the anchor its wire ends at) */
  id: string
  jack: string
  col: Column
  row: number
  span: 1
  edges: string[]
  /** targets reached only through this chip (folded into it, named by it) */
  modules: ModuleKey[]
}

export type Slot = ModuleSlot | FlagSlot | FoldSlot | BusSlot

/** One cable to draw: between two anchors (jack keys, flag ids, bus ids); a bus wire stands for its bundled edges. */
export interface Wire {
  id: string
  from: string
  to: string
  edges: string[]
  bus?: string
}

export interface ColumnCount {
  /** modules in a row */
  placed: number
  idle: number
  off: number
  filter: number
  setup: number
  bus: number
  /** every module of the column: placed + all folded */
  total: number
}

/** The drop visit's partition (§3.7): the profile's modules in the band, the rest folded below it. */
export interface BandPartition {
  profile: string
  /** in the band: the profile's modules, ghosts and what a planned cable reaches */
  touched: ModuleKey[]
  /** drawn modules the profile does not touch (folded, named) */
  untouched: ModuleKey[]
  /** cables between them, folded with them */
  cables: number
}

export interface Layout {
  slots: Slot[]
  /** content rows used (grid rows = rows + 1 with the heads) */
  rows: number
  wires: Wire[]
  cols: Record<Column, ColumnCount>
  /**
   * the row order to keep (module keys only, ≤ ORDER_MAX): the placed modules, § 01, § 02, § 03 top to bottom. Keep it
   * (saveOrder) from the whole rack only — a filtered or setup layout places a part of it, and the next whole layout
   * seeded from that part would put the rest at the bottom
   */
  order: ModuleKey[]
  /** cables crossing between neighbouring columns (the measure the layout keeps low) */
  crossings: number
  /** laid out from a previous order (known modules kept) */
  seeded: boolean
  /** seeded, but a fresh layout crossed notably fewer cables and was taken */
  reflowed: boolean
  /** the filter in force (null: everything) */
  filter: FilterPreset | null
  /** profile ids on the rack (the filter's "Profile <id>" presets) */
  profiles: string[]
  band?: BandPartition
}

/** A fuse as the layout reads it (B4's Fuse / FuseState fit). */
export type FuseLike = Pick<Fuse, 'key' | 'chain'> & { label?: string; allowed?: { state: 'allowed' | 'lapsed' } | null }

export interface LayoutOptions {
  /** the previous row order (loadOrder): known modules keep their rows */
  prev?: readonly string[] | null
  /** a preset or a database filter (null: everything) — ignored while `setup` is on */
  filter?: FilterPreset | null
  /** modules running now (the "Running now" preset) */
  running?: Iterable<ModuleKey>
  /** fuses (default model.fuses): their paths stay adjacent, a switched-off agent on one stays in a row */
  fuses?: readonly FuseLike[]
  /** near misses (default model.nearMisses): a switched-off agent on one stays in a row */
  nearMisses?: readonly Pick<NearMiss, 'chain'>[]
  /** the drop visit: the band shows the profile's modules, the rest folds (§3.7) */
  setup?: { profile: string } | null
  /** fold ids the person opened (↵) — never a bus chip (its popover lists the cables) */
  unfolded?: Iterable<string>
}

/* ------------------------------------------------------------------ ids */

export const flagId = (net: string, side: 'in' | 'out'): string => `flag:${side}:${net}`
export const foldId = (why: FoldWhy, col: Column): string => `fold:${why}:${col}`

/** A filter preset opens by itself past this many drawn modules with an open fuse (§3.3). */
export const AUTO_FUSES_FROM = 31
/** The filter keeps modules this many cables away from what it picks (§3.3). */
export const FILTER_HOPS = 2
/** How many other modules' rows a new module may move in a seeded layout. */
export const MAX_MOVED = 2
/** The previous order kept per device (localStorage, module keys only). */
export const ORDER_MAX = 200
/** Adjacent swaps a fresh layout tries at most (each lays the rows out again — deterministic, never timed). */
const SWAP_TRIES = 60
/**
 * A seeded layout keeps its rows unless another one crosses notably fewer cables: fewer than half of them, less this
 * many — a few more crossings are a fair price for an unchanged rack, a mess is not.
 */
const REFLOW_GAIN = 2
const muchBetter = (a: { crossings: number }, than: { crossings: number }) => a.crossings * 2 + REFLOW_GAIN < than.crossings

/* ------------------------------------------------------------------ the stored order */

const KEY_SHAPE = /^[a-z][a-zA-Z]{1,15}:[A-Za-z0-9_.:%~-]{1,400}$/

/** Read this device's previous row order for a scope (module keys only; anything else dropped). */
export function loadOrder(scope: string | null): ModuleKey[] {
  if (!scope) return []
  try {
    const raw = JSON.parse(lsGet(lsOrder(scope)) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && KEY_SHAPE.test(k)).slice(0, ORDER_MAX) : []
  } catch {
    return []
  }
}

/** Keep a layout's order for the next visit (module keys only, ≤ ORDER_MAX); unchanged orders are not rewritten. */
export function saveOrder(scope: string | null, order: readonly ModuleKey[]): void {
  if (!scope) return
  const next = JSON.stringify(order.filter((k) => KEY_SHAPE.test(k)).slice(0, ORDER_MAX))
  if (lsGet(lsOrder(scope)) !== next) lsSet(lsOrder(scope), next)
}

/* ------------------------------------------------------------------ chains, presets, tags */

/** The module of a place, when the rack has one (a database, a page, Whole workspace, the inbox). */
function placeModule(p: Place): ModuleKey | null {
  if ('db' in p) return moduleKey({ kind: 'database', id: p.db })
  if ('page' in p) return moduleKey({ kind: 'page', id: p.page })
  if ('everything' in p) return moduleKey({ kind: 'everything' })
  if ('inbox' in p) return moduleKey({ kind: 'inbox' })
  return null
}

/** Every module a chain runs through: its source, the decider, each step's ends (a place: its module, when drawn). */
export function chainModules(chain: Chain, model?: Pick<Model, 'modules'>): ModuleKey[] {
  const have = model ? new Set(model.modules.map((m) => m.key)) : null
  const out: ModuleKey[] = []
  const add = (k: ModuleKey | null) => {
    if (k && !out.includes(k) && (!have || have.has(k))) out.push(k)
  }
  add(chain.source)
  add(chain.decider)
  for (const s of chain.steps) {
    add(s.from)
    if (s.via) add(placeModule(s.via))
    add(typeof s.to === 'string' ? s.to : placeModule(s.to))
  }
  return out
}

const isOpen = (f: FuseLike) => !f.allowed || f.allowed.state !== 'allowed'

/** The preset the page opens on: "Fuse paths only" past 30 drawn modules with ≥ 1 open fuse, else none. */
export function defaultPreset(model: Pick<Model, 'counts'>, openFuses: number): FilterPreset | null {
  return model.counts.modules >= AUTO_FUSES_FROM && openFuses > 0 ? { kind: 'fuses' } : null
}

/** Profile ids that touch a module on the rack, sorted — the filter's "Profile <id>" presets. */
export function profileTags(model: Pick<Model, 'modules'>): string[] {
  return [...new Set(model.modules.map((m) => m.profile).filter((p): p is string => !!p))].sort()
}

/** Module adjacency over the cables (a net flag pair counts as one hop: each writer ↔ each listener). */
function adjacency(model: Model, jackMod: Map<string, Module>): Map<ModuleKey, Set<ModuleKey>> {
  const adj = new Map<ModuleKey, Set<ModuleKey>>()
  const link = (a: ModuleKey, b: ModuleKey) => {
    if (a === b) return
    ;(adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b)
    ;(adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a)
  }
  const ends = new Map<string, { w: ModuleKey[]; l: ModuleKey[] }>()
  for (const e of model.edges) {
    const f = jackMod.get(e.from)?.key
    const t = jackMod.get(e.to)?.key
    if (f && t) link(f, t)
    else if (f && e.to.startsWith('net:')) (ends.get(e.to) ?? ends.set(e.to, { w: [], l: [] }).get(e.to)!).w.push(f)
    else if (t && e.from.startsWith('net:')) (ends.get(e.from) ?? ends.set(e.from, { w: [], l: [] }).get(e.from)!).l.push(t)
  }
  for (const { w, l } of ends.values()) for (const a of w) for (const b of l) link(a, b)
  return adj
}

function within(seeds: Iterable<ModuleKey>, adj: Map<ModuleKey, Set<ModuleKey>>, hops: number): Set<ModuleKey> {
  const keep = new Set(seeds)
  let edge = [...keep]
  for (let h = 0; h < hops; h++) {
    const next: ModuleKey[] = []
    for (const k of edge) for (const n of adj.get(k) ?? []) if (!keep.has(n)) (keep.add(n), next.push(n))
    edge = next
  }
  return keep
}

/** What a filter keeps (null: everything). */
function filterKeep(model: Model, f: FilterPreset, adj: Map<ModuleKey, Set<ModuleKey>>, fuses: readonly FuseLike[], running: Set<ModuleKey>): Set<ModuleKey> {
  switch (f.kind) {
    case 'fuses': {
      // the open ones (an allowed path is no alarm) — all of them when every one is allowed
      const open = fuses.filter(isOpen)
      const keep = new Set<ModuleKey>()
      for (const fu of open.length ? open : fuses) for (const k of chainModules(fu.chain, model)) keep.add(k)
      return keep
    }
    case 'running':
      return within(running, adj, FILTER_HOPS)
    case 'profile':
      return within(
        model.modules.filter((m) => m.profile === f.id).map((m) => m.key),
        adj,
        FILTER_HOPS,
      )
    case 'databases': {
      const ids = new Set(f.ids)
      const seeds = model.modules.filter((m) => {
        const r = m.ref as { id?: string; db?: string | null }
        return (m.kind === 'database' && ids.has(r.id ?? '')) || (!!r.db && ids.has(r.db))
      })
      return within(
        seeds.map((m) => m.key),
        adj,
        FILTER_HOPS,
      )
    }
  }
}

/** The drop visit's partition: the profile's modules, ghosts and what a planned cable reaches are in the band. */
export function bandPartition(model: Model, profile: string): BandPartition {
  const jackMod = jackModules(model)
  const touched = new Set(model.modules.filter((m) => m.profile === profile || m.tags.includes('ghost')).map((m) => m.key))
  for (const e of model.edges) {
    if (!e.planned) continue
    for (const end of [e.from, e.to]) {
      const m = jackMod.get(end)
      if (m) touched.add(m.key)
    }
  }
  const order = model.modules.map((m) => m.key)
  const untouched = model.modules.filter((m) => !m.idle && !touched.has(m.key)).map((m) => m.key)
  const out = new Set(untouched)
  // a cable is folded with the untouched part when one of its modules is folded (net flags: both sides)
  const cables = model.edges.filter((e) => [e.from, e.to].some((end) => out.has(jackMod.get(end)?.key ?? ''))).length
  return { profile, touched: order.filter((k) => touched.has(k)), untouched, cables }
}

/* ------------------------------------------------------------------ phone strands (§3.8) */

export interface StrandOrder {
  /** fuse keys in F order (the fuse cards come first) */
  fuses: string[]
  /** one strand per drawn processor, by name */
  strands: ModuleKey[]
  /** "§ 03 Not processed · n": every other module no strand names (idle servers, a clock writing a database …) */
  rest: ModuleKey[]
}

const labelNo = (l?: string) => Number(/\d+/.exec(l ?? '')?.[0] ?? Number.MAX_SAFE_INTEGER)

/** The phone's order, fixed when the page opens: fuse cards, strands by name, then what no strand processes. */
export function strandOrder(model: Model, opts: { name: (key: ModuleKey) => string; lang: 'en' | 'de'; fuses?: readonly FuseLike[] }): StrandOrder {
  const coll = new Intl.Collator(opts.lang, { sensitivity: 'base', numeric: true })
  const byName = (a: ModuleKey, b: ModuleKey) => coll.compare(opts.name(a), opts.name(b)) || (a < b ? -1 : a > b ? 1 : 0)
  const fuses = [...(opts.fuses ?? model.fuses)].sort((a, b) => labelNo(a.label) - labelNo(b.label) || (a.key < b.key ? -1 : 1)).map((f) => f.key)
  const strands = model.modules.filter((m) => m.col === 2 && !m.idle).map((m) => m.key)
  const named = new Set(strands)
  const adj = adjacency(model, jackModules(model))
  for (const s of strands) for (const n of adj.get(s) ?? []) named.add(n)
  const colOf = new Map(model.modules.map((m) => [m.key, m.col]))
  const rest = model.modules
    .filter((m) => !named.has(m.key))
    .map((m) => m.key)
    .sort((a, b) => colOf.get(a)! - colOf.get(b)! || byName(a, b))
  return { fuses, strands: strands.sort(byName), rest }
}

/* ------------------------------------------------------------------ the graph the rows are chosen over */

function jackModules(model: Pick<Model, 'modules'>): Map<string, Module> {
  const out = new Map<string, Module>()
  for (const m of model.modules) for (const j of [...m.inJacks, ...m.outJacks]) out.set(j.key, m)
  return out
}

interface Item {
  id: string
  col: Column
  span: 1 | 2
  /** at an equal wanted row and jack: flags first (they belong to their writer's / listener's row), then modules, then buses */
  prio: number
  /** model order (ties; the seed of a fresh layout) */
  seq: number
  /** in the previous order (or, for a flag / bus, every module it is cabled to is) */
  known: boolean
  isModule: boolean
}

interface Port {
  item: string
  /** height within the item, 0 (top) … 1 (bottom) */
  frac: number
}

interface Link {
  a: Port
  z: Port
}

type Rows = Map<string, number>

interface Graph {
  items: Map<string, Item>
  links: Link[]
  /** links per item — with the net flag twins (§ 01 ↔ § 03 of one net), which pull together but never cross */
  by: Map<string, Link[]>
}

const portY = (p: Port, items: Map<string, Item>, rows: Rows) => rows.get(p.item)! - 1 + items.get(p.item)!.span * p.frac

/** Cable crossings between neighbouring columns: a § 01 → § 03 cable passes § 02 halfway between its ends. */
function countCrossings(g: Graph, rows: Rows): number {
  const gapA: Array<[number, number]> = []
  const gapB: Array<[number, number]> = []
  for (const l of g.links) {
    const ca = g.items.get(l.a.item)!.col
    const cz = g.items.get(l.z.item)!.col
    const ya = portY(l.a, g.items, rows)
    const yz = portY(l.z, g.items, rows)
    if (ca === 1 && cz === 2) gapA.push([ya, yz])
    else if (ca === 2 && cz === 3) gapB.push([ya, yz])
    else if (ca === 1 && cz === 3) {
      const mid = (ya + yz) / 2
      gapA.push([ya, mid])
      gapB.push([mid, yz])
    }
  }
  return inversions(gapA) + inversions(gapB)
}

/** Pairs of segments that cross strictly (a shared end is no crossing): sort by start, count inversions of the ends. */
function inversions(segs: Array<[number, number]>): number {
  segs.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const ends = segs.map((s) => s[1])
  const tmp = new Array<number>(ends.length)
  const sort = (lo: number, hi: number): number => {
    if (hi - lo < 2) return 0
    const mid = (lo + hi) >> 1
    let n = sort(lo, mid) + sort(mid, hi)
    let i = lo
    let j = mid
    let k = lo
    while (i < mid && j < hi) {
      if (ends[i] <= ends[j]) tmp[k++] = ends[i++]
      else {
        // every ends[i..mid) is strictly greater than ends[j]: each is a crossing
        n += mid - i
        tmp[k++] = ends[j++]
      }
    }
    while (i < mid) tmp[k++] = ends[i++]
    while (j < hi) tmp[k++] = ends[j++]
    for (let x = lo; x < hi; x++) ends[x] = tmp[x]
    return n
  }
  return sort(0, ends.length)
}

/* ------------------------------------------------------------------ rows */

class Column_ {
  private used: boolean[] = []
  take(row: number, span: number): void {
    for (let r = row; r < row + span; r++) this.used[r] = true
  }
  free(row: number, span: number): boolean {
    for (let r = row; r < row + span; r++) if (this.used[r]) return false
    return true
  }
  /** the first free run of `span` rows at or below `want` */
  first(want: number, span: number): number {
    let r = Math.max(1, want)
    while (!this.free(r, span)) r++
    return r
  }
  /** the free run nearest `want` (below first at a tie) */
  nearest(want: number, span: number): number {
    for (let d = 0; ; d++) {
      if (this.free(want + d, span)) return want + d
      if (want - d >= 1 && this.free(want - d, span)) return want - d
    }
  }
  last(): number {
    return this.used.length - 1
  }
}

/** Rows for an order of § 02 (packed) and the outer items (each at the row of what it is cabled to in § 02). */
function assignRows(g: Graph, mid: string[], outer: Record<1 | 3, string[]>, seeded: boolean): Rows {
  const rows: Rows = new Map()
  let r = 1
  for (const id of mid) {
    rows.set(id, r)
    r += g.items.get(id)!.span
  }
  const cols = { 1: new Column_(), 3: new Column_() } as Record<1 | 3, Column_>
  // the wanted row: the row of the first § 02 jack it is cabled to (at a tie the higher jack goes first — no crossing)
  const want = new Map<string, number>()
  const at = new Map<string, number>()
  for (const c of [1, 3] as const)
    for (const id of outer[c]) {
      let y = Infinity
      for (const l of g.by.get(id) ?? []) {
        const other = l.a.item === id ? l.z : l.a
        if (g.items.get(other.item)!.col !== 2 || !rows.has(other.item)) continue
        y = Math.min(y, portY(other, g.items, rows))
      }
      if (y === Infinity) continue
      want.set(id, Math.floor(y) + 1)
      at.set(id, y)
    }
  // the rest of a tie goes by model order — never by a sweep's order, so a seeded layout finds the same rows again
  const cmp = (x: string, y: string) =>
    want.get(x)! - want.get(y)! ||
    at.get(x)! - at.get(y)! ||
    g.items.get(x)!.prio - g.items.get(y)!.prio ||
    g.items.get(x)!.seq - g.items.get(y)!.seq ||
    (x < y ? -1 : x > y ? 1 : 0)
  for (const c of [1, 3] as const) {
    const a = outer[c].filter((id) => want.has(id))
    const known = seeded ? a.filter((id) => g.items.get(id)!.known) : a
    const fresh = seeded ? a.filter((id) => !g.items.get(id)!.known) : []
    for (const id of known.sort(cmp)) {
      const it = g.items.get(id)!
      const row = cols[c].first(want.get(id)!, it.span)
      cols[c].take(row, it.span)
      rows.set(id, row)
    }
    for (const id of fresh.sort(cmp)) {
      const it = g.items.get(id)!
      const row = cols[c].nearest(want.get(id)!, it.span)
      cols[c].take(row, it.span)
      rows.set(id, row)
    }
  }
  // the rest is cabled only across § 02 (or not at all): next to what it is cabled to, as that gets its row
  let rest = [...outer[1], ...outer[3]].filter((id) => !want.has(id)).sort((x, y) => g.items.get(x)!.seq - g.items.get(y)!.seq || (x < y ? -1 : 1))
  while (rest.length) {
    let best: { id: string; w: number } | null = null
    for (const id of rest) {
      let w = Infinity
      for (const l of g.by.get(id) ?? []) {
        const other = l.a.item === id ? l.z : l.a
        if (rows.has(other.item)) w = Math.min(w, Math.floor(portY(other, g.items, rows)) + 1)
      }
      if (w !== Infinity && (!best || w < best.w)) best = { id, w }
    }
    const id = best?.id ?? rest[0]
    const it = g.items.get(id)!
    const c = it.col as 1 | 3
    const row = best ? cols[c].first(best.w, it.span) : cols[c].first(cols[c].last() + 1, it.span)
    cols[c].take(row, it.span)
    rows.set(id, row)
    rest = rest.filter((x) => x !== id)
  }
  return rows
}

/** Positions of a column order packed top to bottom (the sweeps' measure). */
function packed(g: Graph, order: string[], into: Map<string, number>): void {
  let y = 0
  for (const id of order) {
    into.set(id, y)
    y += g.items.get(id)!.span
  }
}

/** Sort a column by the mean height of the ports it is cabled to in `toward` (items cabled to none keep their place). */
function sweep(g: Graph, order: string[], pos: Map<string, number>, toward: Set<Column>): string[] {
  const key = new Map<string, number>()
  for (const id of order) {
    let sum = 0
    let n = 0
    for (const l of g.by.get(id) ?? []) {
      const other = l.a.item === id ? l.z : l.a
      if (!toward.has(g.items.get(other.item)!.col)) continue
      sum += pos.get(other.item)! + g.items.get(other.item)!.span * other.frac
      n++
    }
    key.set(id, n ? sum / n : pos.get(id)! + g.items.get(id)!.span / 2)
  }
  return [...order].sort((a, b) => key.get(a)! - key.get(b)!)
}

interface Placement {
  mid: string[]
  outer: Record<1 | 3, string[]>
  rows: Rows
  crossings: number
}

function place(g: Graph, mid: string[], outer: Record<1 | 3, string[]>, seeded: boolean): Placement {
  const rows = assignRows(g, mid, outer, seeded)
  return { mid, outer, rows, crossings: countCrossings(g, rows) }
}

/** A fresh layout: 3 barycentric sweeps from the seed order, adjacent swaps, fuse paths pulled together. */
function fresh(g: Graph, seed: Record<Column, string[]>, paths: string[][]): Placement {
  let o: Record<Column, string[]> = { 1: [...seed[1]], 2: [...seed[2]], 3: [...seed[3]] }
  const pos = new Map<string, number>()
  let best: Placement | null = null
  for (let i = 0; i < 3; i++) {
    for (const c of [1, 2, 3] as const) packed(g, o[c], pos)
    o = { ...o, 2: sweep(g, o[2], pos, new Set<Column>([1, 3])) }
    packed(g, o[2], pos)
    o = { ...o, 1: sweep(g, o[1], pos, new Set<Column>([2, 3])), 3: sweep(g, o[3], pos, new Set<Column>([1, 2])) }
    // the outer columns take the rows of what they are cabled to: sort § 02 once more over those real rows
    const p = place(g, o[2], { 1: o[1], 3: o[3] }, false)
    if (!best || p.crossings < best.crossings) best = p
    for (const id of o[2]) pos.set(id, p.rows.get(id)! - 1)
    for (const c of [1, 3] as const) for (const id of o[c]) pos.set(id, p.rows.get(id)! - 1)
    o = { ...o, 2: sweep(g, o[2], pos, new Set<Column>([1, 3])) }
    const q = place(g, o[2], { 1: o[1], 3: o[3] }, false)
    if (q.crossings < best.crossings) best = q
  }
  best = best!
  // adjacent swaps in § 02 while they lower the crossings — each try lays the rows out again, so at most SWAP_TRIES
  let tries = 0
  for (let pass = 0; pass < 2 && tries < SWAP_TRIES; pass++) {
    let better = false
    for (let i = 0; i + 1 < best.mid.length && tries < SWAP_TRIES; i++, tries++) {
      if (!best.crossings) break
      const mid = [...best.mid]
      ;[mid[i], mid[i + 1]] = [mid[i + 1], mid[i]]
      const p = place(g, mid, best.outer, false)
      if (p.crossings < best.crossings) {
        best = p
        better = true
      }
    }
    if (!better) break
  }
  const together = adjacent(best.mid, paths)
  return together === best.mid ? best : place(g, together, best.outer, false)
}

/** Each fuse path's § 02 modules in consecutive rows, in path order, at the first one's place. */
function adjacent(mid: string[], paths: string[][]): string[] {
  let out = mid
  for (const path of paths) {
    const on = path.filter((k) => out.includes(k))
    if (on.length < 2) continue
    const at = Math.min(...on.map((k) => out.indexOf(k)))
    const rest = out.filter((k) => !on.includes(k))
    const before = out.slice(0, at).filter((k) => !on.includes(k)).length
    const next = [...rest.slice(0, before), ...on, ...rest.slice(before)]
    if (next.some((k, i) => k !== out[i])) out = next
  }
  return out
}

/** Does putting something between mid[p - 1] and mid[p] split a fuse path's run of processors? */
function splits(mid: string[], p: number, paths: string[][]): boolean {
  if (p <= 0 || p >= mid.length) return false
  return paths.some((path) => {
    const i = path.indexOf(mid[p - 1])
    return i >= 0 && path[i + 1] === mid[p]
  })
}

/**
 * A seeded layout. The known modules keep their previous order; each new § 02 module goes where it crosses fewest
 * cables, in two tiers:
 *  - `keep`: known modules keep their ROWS — the new one goes to the bottom or as high as moves at most MAX_MOVED of
 *    them; a new § 01 / § 03 item takes the free row nearest its own;
 *  - `shift`: known modules keep their ORDER — anywhere, the rows below it shift down; outer items in order as well.
 * `shift` is taken only when it crosses notably fewer cables than `keep` (muchBetter).
 */
function seededPlacement(g: Graph, prevIndex: Map<string, number>, seed: Record<Column, string[]>, paths: string[][]): Placement {
  const outer = { 1: seed[1], 3: seed[3] } as Record<1 | 3, string[]>
  const knownMid = seed[2].filter((id) => g.items.get(id)!.known).sort((a, b) => prevIndex.get(a)! - prevIndex.get(b)!)
  const newMid = seed[2].filter((id) => !g.items.get(id)!.known)
  const insert = (keep: boolean): Placement => {
    let mid = knownMid
    let best = place(g, mid, outer, keep)
    const base = assignRows(g, mid, outer, true)
    for (const id of newMid) {
      let pick: Placement | null = null
      for (let p = mid.length; p >= 0; p--) {
        if (splits(mid, p, paths)) continue
        const order = [...mid.slice(0, p), id, ...mid.slice(p)]
        const rows = assignRows(g, order, outer, keep)
        if (keep) {
          const moved = [...base.keys()].filter((k) => g.items.get(k)!.isModule && rows.get(k) !== base.get(k)).length
          // the bottom always qualifies; above it only while at most MAX_MOVED others move
          if (pick && moved > MAX_MOVED) break
        }
        const crossings = countCrossings(g, rows)
        if (!pick || crossings < pick.crossings) pick = { mid: order, outer, rows, crossings }
      }
      best = pick!
      mid = best.mid
    }
    return best
  }
  const keep = insert(true)
  if (!keep.crossings) return keep
  const shift = insert(false)
  return muchBetter(shift, keep) ? shift : keep
}

/* ------------------------------------------------------------------ the layout */

/** Lay a model out on the rack (pure, deterministic). */
export function layoutRack(model: Model, opts: LayoutOptions = {}): Layout {
  const fuses = opts.fuses ?? model.fuses
  const misses = opts.nearMisses ?? model.nearMisses
  const jackMod = jackModules(model)
  const modIndex = new Map(model.modules.map((m, i) => [m.key, i]))
  const colMap = new Map(model.modules.map((m) => [m.key, m.col]))
  const adj = adjacency(model, jackMod)
  const unfolded = new Set(opts.unfolded ?? [])

  // ---- what folds, and why
  const why = new Map<ModuleKey, FoldWhy>()
  const onChain = new Set<ModuleKey>()
  for (const f of fuses) for (const k of chainModules(f.chain, model)) onChain.add(k)
  for (const n of misses) for (const k of chainModules(n.chain, model)) onChain.add(k)
  const band = opts.setup ? bandPartition(model, opts.setup.profile) : undefined
  const filter = band ? null : (opts.filter ?? null)
  const keep = filter ? filterKeep(model, filter, adj, fuses, new Set(opts.running ?? [])) : null
  const untouched = new Set(band?.untouched ?? [])
  for (const m of model.modules) {
    if (m.tags.includes('disabled') && m.col === 2 && !onChain.has(m.key)) why.set(m.key, 'off')
    else if (m.idle) why.set(m.key, 'idle')
    else if (untouched.has(m.key)) why.set(m.key, 'setup')
    else if (keep && !keep.has(m.key)) why.set(m.key, 'filter')
  }
  // targets reached only through bundled cables fold into their bus chip
  const busOf = new Map<ModuleKey, string>()
  const touches = new Map<ModuleKey, Edge[]>()
  for (const e of model.edges)
    for (const end of [e.from, e.to]) {
      const m = jackMod.get(end)
      if (m) (touches.get(m.key) ?? touches.set(m.key, []).get(m.key)!).push(e)
    }
  for (const b of model.buses)
    for (const id of b.edges) {
      const e = model.edges.find((x) => x.id === id)
      const t = e && jackMod.get(e.to)
      if (!t || why.has(t.key) || !(touches.get(t.key) ?? []).every((x) => x.bundle)) continue
      why.set(t.key, 'bus')
      busOf.set(t.key, b.id)
    }
  const isFolded = (k: ModuleKey) => {
    const w = why.get(k)
    return !!w && (w === 'bus' || !unfolded.has(foldId(w, colMap.get(k)!)))
  }

  // ---- what is drawn: visible wires (a module end shown, a flag shown when one of its cables is)
  const visibleModule = (end: string) => {
    const m = jackMod.get(end)
    return !!m && !isFolded(m.key)
  }
  const wires: Wire[] = []
  const flagSides = new Map<string, { net: string; side: 'in' | 'out' }>()
  const busWires = new Map<string, Wire>()
  const busById = new Map<string, BusChip>(model.buses.map((b) => [b.id, b]))
  for (const e of model.edges) {
    if (e.bundle) {
      if (!visibleModule(e.from)) continue
      const b = busById.get(e.bundle)
      if (!b) continue
      const w = busWires.get(b.id) ?? { id: b.id, from: b.jack, to: b.id, edges: [], bus: b.id }
      w.edges.push(e.id)
      busWires.set(b.id, w)
      continue
    }
    const fromNet = e.from.startsWith('net:')
    const toNet = e.to.startsWith('net:')
    if (fromNet ? !visibleModule(e.to) : toNet ? !visibleModule(e.from) : !(visibleModule(e.from) && visibleModule(e.to))) continue
    const from = fromNet ? flagId(e.from, 'in') : e.from
    const to = toNet ? flagId(e.to, 'out') : e.to
    if (fromNet) flagSides.set(from, { net: e.from, side: 'in' })
    if (toNet) flagSides.set(to, { net: e.to, side: 'out' })
    wires.push({ id: e.id, from, to, edges: [e.id] })
  }
  wires.push(...busWires.values())
  // a bus whose writer is folded is not drawn: its targets fold with the writer now — before rows are chosen, so an
  // opened fold places them like any other module (fix rest)
  for (const [k, b] of busOf)
    if (!busWires.has(b)) {
      why.set(k, keep ? 'filter' : 'off')
      busOf.delete(k)
    }

  // a module whose every cable leads into a fold folds with it (it would stand in a row without a cable)
  const shown = new Set<ModuleKey>()
  for (const w of wires)
    for (const end of [w.from, w.to]) {
      const m = jackMod.get(end)
      if (m) shown.add(m.key)
    }
  for (const m of model.modules) {
    if (isFolded(m.key) || shown.has(m.key) || m.idle) continue
    let reason: FoldWhy = keep ? 'filter' : 'off'
    for (const n of adj.get(m.key) ?? []) {
      const w = why.get(n)
      if (w && w !== 'idle' && w !== 'bus') {
        reason = w
        break
      }
    }
    why.set(m.key, reason)
  }
  const placedModules = model.modules.filter((m) => !isFolded(m.key))

  // ---- the graph rows are chosen over
  const prevIndex = new Map<string, number>()
  ;(opts.prev ?? []).forEach((k, i) => {
    if (!prevIndex.has(k)) prevIndex.set(k, i)
  })
  const knownCount = placedModules.filter((m) => prevIndex.has(m.key)).length
  const seeded = knownCount > 0 && knownCount * 2 >= placedModules.length
  const items = new Map<string, Item>()
  for (const m of placedModules)
    items.set(m.key, { id: m.key, col: m.col, span: m.u, prio: 1, seq: modIndex.get(m.key)!, known: prevIndex.has(m.key), isModule: true })
  const links: Link[] = []
  const by = new Map<string, Link[]>()
  const portOf = (anchor: string): Port | null => {
    const m = jackMod.get(anchor)
    if (m) {
      if (!items.has(m.key)) return null
      const side = m.inJacks.some((j) => j.key === anchor) ? m.inJacks : m.outJacks
      const i = side.findIndex((j) => j.key === anchor)
      return { item: m.key, frac: (i + 0.5) / side.length }
    }
    return items.has(anchor) ? { item: anchor, frac: 0.5 } : null
  }
  // flags and buses: their place in the seed next to the module they are cabled to
  for (const [id, f] of flagSides) {
    const ends = wires.filter((w) => w.from === id || w.to === id).map((w) => jackMod.get(w.from === id ? w.to : w.from)!)
    items.set(id, {
      id,
      col: f.side === 'out' ? 3 : 1,
      span: 1,
      prio: 0,
      seq: Math.min(...ends.map((m) => modIndex.get(m.key)!)) + 0.5,
      known: seeded && ends.every((m) => prevIndex.has(m.key)),
      isModule: false,
    })
  }
  for (const w of busWires.values()) {
    const b = busById.get(w.bus!)!
    const src = jackMod.get(b.jack)!
    items.set(b.id, { id: b.id, col: b.col, span: 1, prio: 2, seq: modIndex.get(src.key)! + 0.6, known: seeded && prevIndex.has(src.key), isModule: false })
  }
  for (const w of wires) {
    const a = portOf(w.from)
    const z = portOf(w.to)
    if (!a || !z) continue
    const l = { a, z }
    links.push(l)
    for (const id of [a.item, z.item]) (by.get(id) ?? by.set(id, []).get(id)!).push(l)
  }
  // twins: a net's two flags pull each other (and so the writer toward the listener) in the sweeps
  for (const [id, f] of flagSides) {
    const twin = flagId(f.net, f.side === 'in' ? 'out' : 'in')
    if (f.side !== 'in' || !items.has(twin)) continue
    const l = { a: { item: id, frac: 0.5 }, z: { item: twin, frac: 0.5 } }
    for (const k of [id, twin]) (by.get(k) ?? by.set(k, []).get(k)!).push(l)
  }
  const g: Graph = { items, links, by }

  // ---- the order: seed (previous order, else model order), then sweeps or the seeded placement
  const rank = (id: string) => {
    const it = items.get(id)!
    if (!seeded) return it.seq
    if (it.isModule) return prevIndex.get(id) ?? 1e6 + it.seq
    // a flag / bus: right after its module's previous place
    const anchor = links.filter((l) => l.a.item === id || l.z.item === id).map((l) => (l.a.item === id ? l.z.item : l.a.item))
    const p = anchor.map((k) => prevIndex.get(k)).filter((x): x is number => x !== undefined)
    return p.length ? Math.min(...p) + 0.5 : 1e6 + it.seq
  }
  const seed: Record<Column, string[]> = { 1: [], 2: [], 3: [] }
  for (const it of items.values()) seed[it.col].push(it.id)
  // the model's own order: a fresh layout always starts from it, so the fresh layout of a model is one layout
  const canon: Record<Column, string[]> = { 1: [], 2: [], 3: [] }
  for (const c of [1, 2, 3] as const) {
    canon[c] = [...seed[c]].sort((a, b) => items.get(a)!.seq - items.get(b)!.seq)
    seed[c].sort((a, b) => rank(a) - rank(b) || items.get(a)!.seq - items.get(b)!.seq)
  }
  const paths = [...fuses]
    .sort((a, b) => labelNo(a.label) - labelNo(b.label) || (a.key < b.key ? -1 : 1))
    .map((f) => chainModules(f.chain, model).filter((k) => items.get(k)?.col === 2))
  let best: Placement
  let reflowed = false
  if (seeded) {
    best = seededPlacement(g, prevIndex, seed, paths)
    const together = adjacent(best.mid, paths)
    if (together !== best.mid) best = place(g, together, best.outer, true)
    // the fresh layout of this model (from its own order — never from the previous one, or every visit could find
    // another): taken only when it crosses notably fewer cables, and then it is the order kept from now on
    const other = fresh(g, canon, paths)
    if (muchBetter(other, best)) {
      best = other
      reflowed = true
    }
  } else best = fresh(g, canon, paths)

  // ---- slots: modules, flags, buses, then the folds after each column's modules
  const slots: Slot[] = []
  const cols = { 1: new Column_(), 2: new Column_(), 3: new Column_() } as Record<Column, Column_>
  const lastModule: Record<Column, number> = { 1: 0, 2: 0, 3: 0 }
  for (const [id, row] of best.rows) {
    const it = items.get(id)!
    cols[it.col].take(row, it.span)
    if (it.isModule) {
      lastModule[it.col] = Math.max(lastModule[it.col], row + it.span - 1)
      slots.push({ kind: 'module', id, col: it.col, row, span: it.span })
    } else if (flagSides.has(id)) {
      const f = flagSides.get(id)!
      slots.push({ kind: 'flag', id, net: f.net, side: f.side, col: it.col as 1 | 3, row, span: 1 })
    } else {
      const b = busById.get(id)!
      slots.push({ kind: 'bus', id, jack: b.jack, col: b.col, row, span: 1, edges: busWires.get(id)!.edges, modules: [] })
    }
  }
  for (const [k, b] of busOf) slots.find((x): x is BusSlot => x.kind === 'bus' && x.id === b)?.modules.push(k)
  const pathOf = new Map<ModuleKey, string[]>()
  for (const f of fuses) for (const k of chainModules(f.chain, model)) pathOf.set(k, [...(pathOf.get(k) ?? []), f.key])
  for (const col of [1, 2, 3] as const)
    for (const w of ['idle', 'off', 'filter', 'setup'] as const) {
      const mods = model.modules.filter((m) => m.col === col && why.get(m.key) === w).map((m) => m.key)
      if (!mods.length) continue
      const id = foldId(w, col)
      // opened (↵): its modules took rows like any other; the slot stays as the key that folds them again
      const open = unfolded.has(id)
      const row = cols[col].first(lastModule[col] + 1, 1)
      cols[col].take(row, 1)
      slots.push({
        kind: 'fold',
        id,
        why: w,
        col,
        row,
        span: 1,
        modules: mods,
        fuses: [...new Set(mods.flatMap((k) => pathOf.get(k) ?? []))],
        ...(open ? { open: true as const } : {}),
      })
    }
  slots.sort((a, b) => a.col - b.col || a.row - b.row)

  // ---- counts: placed + folded = every module of the column
  const counts = {} as Record<Column, ColumnCount>
  for (const c of [1, 2, 3] as const) {
    const of = model.modules.filter((m) => m.col === c)
    const n = (w: FoldWhy) => of.filter((m) => why.get(m.key) === w && (w === 'bus' || !unfolded.has(foldId(w, c)))).length
    const folded = { idle: n('idle'), off: n('off'), filter: n('filter'), setup: n('setup'), bus: n('bus') }
    counts[c] = { placed: slots.filter((s) => s.kind === 'module' && s.col === c).length, ...folded, total: of.length }
  }

  // ---- the order to keep: the placed modules top to bottom, § 01 then § 02 then § 03
  const order = slots
    .filter((s): s is ModuleSlot => s.kind === 'module')
    .map((s) => s.id)
    .slice(0, ORDER_MAX)

  return {
    slots,
    rows: Math.max(0, ...slots.map((s) => s.row + s.span - 1)),
    wires,
    cols: counts,
    order,
    crossings: best.crossings,
    seeded,
    reflowed,
    filter,
    profiles: profileTags(model),
    ...(band ? { band } : {}),
  }
}

/** Crossings of any row placement (the mock's rows, a stored layout) — the same measure the layout keeps low. */
export function crossingsOf(model: Model, layout: Pick<Layout, 'slots' | 'wires'>): number {
  const jackMod = jackModules(model)
  const items = new Map<string, Item>()
  const rows: Rows = new Map()
  for (const s of layout.slots) {
    if (s.kind === 'fold') continue
    items.set(s.id, { id: s.id, col: s.col, span: s.span, prio: 0, seq: 0, known: false, isModule: s.kind === 'module' })
    rows.set(s.id, s.row)
  }
  const links: Link[] = []
  const portOf = (anchor: string): Port | null => {
    const m = jackMod.get(anchor)
    if (m && items.has(m.key)) {
      const side = m.inJacks.some((j) => j.key === anchor) ? m.inJacks : m.outJacks
      return { item: m.key, frac: (side.findIndex((j) => j.key === anchor) + 0.5) / side.length }
    }
    return items.has(anchor) ? { item: anchor, frac: 0.5 } : null
  }
  for (const w of layout.wires) {
    const a = portOf(w.from)
    const z = portOf(w.to)
    if (a && z) links.push({ a, z })
  }
  return countCrossings({ items, links, by: new Map() }, rows)
}
