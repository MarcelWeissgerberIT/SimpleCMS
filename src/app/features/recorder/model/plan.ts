/**
 * The eject's planner core (design §6.2; eject/plan.ts loads, this decides) — pure and synchronous, so the commit can
 * run it again inside its sync section. Principle: a part goes back only when what is there now is what the writer
 * left AND the journal shows nobody else touching it since the writer first did; the journal only ever ADDS holds.
 *
 * Order: the held check (model/hold.ts verdicts) per place → schemas and views per database, part by part (locked →
 * held; kit-owned parts never; a property / option the writer added taken out only when nothing uses it after the row
 * plan) → pages (meta parts by the part rule, content hunk by hunk, newest segment first, located uniquely) → rows
 * (held whole; values as the planned database takes them; relation values only with their partners; record types;
 * pipeline rows keep their agent's stamp) → new rows and pages to the trash only when nothing else holds them →
 * parents → task blocks → a dependency pass until nothing flips. The plan holds DECISIONS (parts, working content,
 * values) — targetsFor() builds the overlays on the objects as they are when the eject writes.
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, ID, Page, PropertyDef, PropertyValue, View } from '../../../store/types'
import type { RestorePlan, SnapshotProps } from '../../history/propsCore'
import type { WindowData } from '../window/load'
import { verdicts, type VerdictInput } from './hold'
import { blockHunks, locateUnique } from './blocks'
import { overlay, overlayDb, type SchemaDecision } from './overlay'
import { F, type Foreign, type JSegment, type LaneKey, type NowDigest, type Outcome, type PinMeta, type PlaceKey, type PlaceKind, type PlanCounts, type PlaceWindow, type Reason } from './types'

/* ------------------------------------------------------------------ */
/* inputs                                                              */
/* ------------------------------------------------------------------ */

/** A content's top-level blocks: the journal's block strings and the JSON blocks they stand for, aligned. */
export interface BlockList {
  strings: string[]
  json: JSONContent[]
}

/** The pins the plan reads: metas, page bodies and (pages whose content W touched) their block lists. */
export interface PinSet {
  metas: ReadonlyMap<string, PinMeta>
  /** `${pageId}|${body}` → content */
  bodies: ReadonlyMap<string, JSONContent | null>
  /** pin id → its content's blocks */
  blocks: ReadonlyMap<string, BlockList>
}

/** The workspace's tasks (Task block), as the plan asks about them. */
export interface ItemLookup {
  /** pages holding a LIVE original of the itemId now (trash and templates left out) */
  livePagesOf(itemId: string): readonly ID[]
  /** pages holding a LIVE task that links the itemId now (Blocked by or Related) */
  linkersOf(itemId: string): readonly ID[]
  /** would "from waits for to" close a loop among live tasks */
  wouldLoop(from: string, to: string): boolean
}

/** What the sources know (agent runs, the terminal …) that decides a place. */
export interface SourceFacts {
  /** a staged change's review status now (undefined: no run holds it — journal-only, ignored) */
  changeStatus?(changeId: string): string | undefined
  /** changes a source marked final: their places are held (defence in depth) */
  final?: ReadonlySet<string>
}

/** Pure helpers of other areas, handed in (the model imports nothing but itself). */
export interface PlanFns {
  planRestoreProps(row: Page, props: SnapshotProps, db: Pick<Database, 'id' | 'properties'> | undefined): RestorePlan
  relationRestoreOk(planned: { pages: Record<ID, Page>; databases: Record<ID, Database> }, dbId: ID, prop: PropertyDef, rowId: ID, value: PropertyValue, back: ReadonlySet<ID>, valueBack?: (rowId: ID, propId: ID) => boolean): boolean
  withoutProperty(db: Database, propId: ID): Database
  propertyRefs(db: Database, databases: Record<ID, Database>, propId: ID): string[]
  optionRefs(db: Database, optId: ID): string[]
  /** the tasks of a content (itemId + blockedBy + related; synced copies left out) */
  itemsOf(content: JSONContent | null | undefined): ReadonlyArray<{ itemId: string; blockedBy: readonly string[]; related?: readonly string[] }>
  /** tasks inside a task / a table moved out (the same object when nothing moves) */
  liftMisplacedItems(doc: JSONContent): JSONContent
}

export interface CoreInput {
  data: WindowData
  now: Map<PlaceKey, NowDigest>
  pins: PinSet
  /** the pages' top-level blocks now (pages whose content W touched) */
  nowBlocks: ReadonlyMap<PlaceKey, BlockList>
  /** ONE read of the store */
  state: { pages: Record<ID, Page>; databases: Record<ID, Database> }
  empty: VerdictInput['empty']
  kitComputed: VerdictInput['kitComputed']
  readOnly: VerdictInput['readOnly']
  db: VerdictInput['db']
  items: ItemLookup
  sources: SourceFacts
  fns: PlanFns
}

/* ------------------------------------------------------------------ */
/* outputs                                                             */
/* ------------------------------------------------------------------ */

/** A part that is never ejected (it belongs to the kit, the pipeline, the commands …) — eject.notEjectable.<why>. */
export type NotEjectable = 'viewOrder' | 'commands' | 'templates' | 'automations' | 'pipeline' | 'recordTypes' | 'kitProperty' | 'listOption'

/** What the eject does with one changed value of a row ('#title', '#icon' or a property id). */
export type Fate = 'back' | 'held' | 'deleted' | 'type' | 'option' | 'relation'

/** How a target is built at the commit (on the objects as they are then). */
export type Build =
  | { kind: 'page'; pin: string; parts: string[]; content?: JSONContent; values?: Record<ID, PropertyValue | undefined>; stamp: string | null; restored?: string[][] }
  | { kind: 'trash' }
  | { kind: 'db'; groups: Array<{ pin: string; decided: SchemaDecision[] }> }

export interface PlacePlan {
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  outcome: Outcome
  reason?: Reason
  why?: NotEjectable
  by: Array<{ lane: LaneKey | null; at: number }>
  firstForeignAt?: number
  ops: number
  span: [number, number]
  changes: string[]
  /** parts that go back, parts held (and why) */
  parts: { back: string[]; held: Array<{ part: string; reason: Reason; why?: NotEjectable }> }
  /** rows: values that stay (by name) */
  notRestored: Array<{ name: string; reason: Exclude<Fate, 'back' | 'held'> }>
  /** rows: the fate of each value W changed */
  fates?: Record<string, Fate>
  /** pages: content hunks going back / held */
  hunks?: { back: number; held: number }
  /** a restored page whose parent is gone or in the trash goes to the root */
  toRoot?: true
  /** a page going into the trash: the live pages below it the plan took along (the commit re-checks nothing joined) */
  keeps?: ID[]
  build?: Build
}

export interface Plan {
  sel: WindowData['sel']
  places: PlacePlan[]
  counts: PlanCounts
  /** who changed held places since (lanes; null = not recorded) */
  heldBy: Array<LaneKey | null>
  extendTo?: { a: number; b: number }
  /** a lost tail overlaps: possibly incomplete */
  incomplete: boolean
  /** the objects the plan was computed against (the commit's re-check: same object, or the same parts key) */
  refs: Map<PlaceKey, Page | Database | View | null>
  keys: Map<PlaceKey, string>
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const isEmpty = (v: PropertyValue | undefined) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)
const META = ['t', 'i', 'cv', 'tr', 'pa', 'o'] as const
const ROW_PARTS = ['t', 'i', 'c', 'tr', 'pa', 'r', 'o']
const NOT_EJECTABLE: Record<string, NotEjectable> = { cmd: 'commands', tpl: 'templates', auto: 'automations', pipe: 'pipeline', rt: 'recordTypes', sub: 'recordTypes', dep: 'recordTypes' }
const BACK: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore'])

/** The pin's page with its content (null: not a page pin, or its body is missing). */
export function pinPage(pins: PinSet, pinId: string | null | undefined): Page | null {
  if (!pinId) return null
  const meta = pins.metas.get(pinId)
  if (!meta || meta.kind !== 'page') return null
  const key = `${meta.page.id}|${meta.body}`
  if (meta.body && !pins.bodies.has(key)) return null
  return { ...meta.page, content: meta.body ? (pins.bodies.get(key) ?? null) : null } as Page
}

const pinDbOf = (pins: PinSet, pinId: string | null | undefined): Database | null => {
  const meta = pinId ? pins.metas.get(pinId) : undefined
  return meta?.kind === 'schema' ? meta.db : null
}

/** A row pin's values as a snapshot (empty values left out). */
function pinProps(meta: PinMeta | undefined): SnapshotProps | null {
  if (!meta || meta.kind !== 'page' || !meta.page.databaseId || !meta.defs) return null
  const values: Record<ID, PropertyValue> = {}
  for (const d of meta.defs) {
    const v = meta.page.properties?.[d.id]
    if (!isEmpty(v)) values[d.id] = v
  }
  return { databaseId: meta.page.databaseId, values, defs: meta.defs }
}

/** The parts W's own segments touched ('*': any). */
function touchedOf(w: PlaceWindow): Set<string> | '*' {
  const out = new Set<string>()
  for (const g of w.own) {
    if (g.touched === '*') return '*'
    for (const k of g.touched) out.add(k)
  }
  return out
}

/** The first own segment that touched part `k`. */
const firstTouch = (w: PlaceWindow, k: string): JSegment => w.own.find((g) => g.touched === '*' || g.touched.includes(k)) ?? w.own[0]

/** The part rule's journal half: a foreign segment touched `k` after W first did (held why). */
function foreignOn(w: PlaceWindow, k: string, lastTo: number): Reason | null {
  const from = firstTouch(w, k).from
  const f = w.foreign.find((x) => x.from > from && (x.touched === '*' || x.touched.includes(k)))
  return f ? (f.from <= lastTo ? 'interleaved' : 'changed') : null
}

const idOfBlock = (b: string) => {
  const id = b.slice(0, b.indexOf('='))
  return id === '#' ? null : id
}

/* ------------------------------------------------------------------ */
/* the core                                                            */
/* ------------------------------------------------------------------ */

interface Ctx {
  input: CoreInput
  plans: Map<PlaceKey, PlacePlan>
  windows: Map<PlaceKey, PlaceWindow>
  plannedDbs: Record<ID, Database>
  /** rows (and pages) going back / to the trash: the pass before's outcomes (the first pass: the held check's) */
  backRows: Set<ID>
  trashIds: Set<ID>
  /** places held from outside (a flip at the commit, a final change, an undone review): no pass looks at them again */
  fixed: Set<PlaceKey>
  /** `${rowId}|${propId}`: row values that go back (the pass before's fates; the first pass: every value W touched) */
  valueBack: Set<string>
  /** what the task check held (hunks, row contents, trash, restores, whole places) and why — only grows, across passes */
  itemHolds: Map<string, Reason>
  /** this pass: the hunks each page puts back, with the tasks they add and drop */
  applied: Map<ID, AppliedHunk[]>
  /** tasks that lived before W touched the window's pages (lazy) */
  preItems: Set<string> | null
  /** the pages below each page now (lazy) */
  kids: Map<ID, ID[]> | null
}

interface AppliedHunk {
  key: string
  adds: string[]
  drops: string[]
}

/** Plan an eject of a loaded window: every place's outcome, why, and how its target is built. */
export function core(input: CoreInput, forcedHeld: ReadonlySet<PlaceKey> = new Set()): Plan {
  const { data } = input
  const start = new Map<PlaceKey, PlacePlan>()
  const fixed = new Set<PlaceKey>()
  for (const [p, v] of verdicts(input)) {
    const plan: PlacePlan = { ...v, parts: { back: [], held: [] }, notRestored: [] }
    // a recreate is planned for later releases only (R3 never creates): counted as partial, never written
    if (v.outcome === 'recreate') plan.reason = 'noBefore'
    else if (BACK.has(v.outcome) || v.outcome === 'held') {
      const status = input.sources.changeStatus
      const known = status ? v.changes.filter((c) => status(c) !== undefined) : []
      const set = (outcome: Outcome, reason: Reason) => {
        Object.assign(plan, { outcome, reason })
        fixed.add(p)
      }
      if (known.length && known.every((c) => status!(c) !== 'applied')) set('skip', 'reviewUndone')
      else if (v.changes.some((c) => input.sources.final?.has(c))) set('held', 'notEjectable')
      // a write of more staged changes than its key could name: no review could be settled for it — it stays
      else if (v.changes.includes('*')) set('held', 'batch')
      else if (forcedHeld.has(p)) set('held', 'changed')
    }
    start.set(p, plan)
  }
  const ctx: Ctx = { input, plans: new Map(), windows: data.places, plannedDbs: { ...input.state.databases }, backRows: new Set(), trashIds: new Set(), fixed, valueBack: new Set(), itemHolds: new Map(), applied: new Map(), preItems: null, kids: null }
  const carry = (plans: Iterable<PlacePlan>, first = false) => {
    ctx.backRows = new Set()
    ctx.trashIds = new Set()
    ctx.valueBack = new Set()
    for (const x of plans) {
      if (!x.p.startsWith('p:')) continue
      const id = x.p.slice(2)
      if (x.outcome === 'back' || x.outcome === 'restore') ctx.backRows.add(id)
      if (x.outcome === 'trash') ctx.trashIds.add(id)
      if (x.outcome !== 'back' && x.outcome !== 'restore') continue
      if (first) {
        // the first pass assumes every value W touched goes back; later passes take the fates
        const w = data.places.get(x.p)
        const t = w ? touchedOf(w) : new Set<string>()
        const keys = t === '*' ? Object.keys(input.now.get(x.p)?.parts ?? {}) : [...t]
        for (const k of keys) if (k.startsWith('p:')) ctx.valueBack.add(`${id}|${k.slice(2)}`)
      } else for (const [pid, f] of Object.entries(x.fates ?? {})) if (f === 'back') ctx.valueBack.add(`${id}|${pid}`)
    }
  }
  carry(start.values(), true)
  // the passes depend on each other (a property goes when no row keeps it; a row's values read the planned schema;
  // relation values go back with their partners' values; tasks never doubled or lost): run them until nothing flips —
  // what the task check holds only grows, so it ends; the plan returned always passed it
  let sig = ''
  for (let round = 0; ; round++) {
    ctx.plans = new Map([...start].map(([p, x]) => [p, { ...x, parts: { back: [], held: [] }, notRestored: [] }]))
    ctx.applied = new Map()
    for (const [h, why] of ctx.itemHolds) {
      const x = h.startsWith('x:') ? ctx.plans.get(`p:${h.slice(2)}` as PlaceKey) : undefined
      if (x && !ctx.fixed.has(x.p)) hold(x, why)
    }
    schemaPass(ctx)
    rowPass(ctx)
    pagePass(ctx)
    newPass(ctx)
    const grew = itemPass(ctx)
    const now = [...ctx.plans.values()].map((x) => `${x.p}:${x.outcome}:${x.reason ?? ''}:${x.parts.back.join(',')}:${Object.entries(x.fates ?? {}).join(';')}:${x.hunks?.back ?? ''}`).join('|')
    if (!grew && (now === sig || round >= 7)) break
    sig = now
    carry(ctx.plans.values())
  }
  return finish(ctx)
}

const hold = (x: PlacePlan, reason: Reason, why?: NotEjectable) => {
  x.outcome = 'held'
  x.reason = reason
  if (why) x.why = why
  delete x.build
}

/* ---------------- 6.2.1 schemas and views ---------------- */

function schemaPass(ctx: Ctx) {
  const { input, plans, windows } = ctx
  const byDb = new Map<ID, PlaceKey[]>()
  for (const [p, w] of windows) {
    if (w.pk !== 'schema' && w.pk !== 'view') continue
    const dbId = w.db ?? p.slice(2).split('/')[0]
    ;(byDb.get(dbId) ?? byDb.set(dbId, []).get(dbId)!).push(p)
  }
  ctx.plannedDbs = { ...input.state.databases }
  for (const [dbId, places] of byDb) {
    const cur = input.state.databases[dbId]
    if (!cur) continue
    const all: Array<{ pin: string; d: SchemaDecision }> = []
    for (const p of places) {
      const x = plans.get(p)!
      const w = windows.get(p)!
      if (ctx.fixed.has(p)) continue
      if (x.outcome !== 'back' && x.outcome !== 'trash' && !(x.outcome === 'held' && (x.reason === 'changed' || x.reason === 'interleaved'))) continue
      if (cur.locked) {
        hold(x, 'locked')
        continue
      }
      const mine: Array<{ pin: string; d: SchemaDecision }> = []
      const add: AddDecision = (pin, d) => mine.push({ pin, d })
      if (w.pk === 'schema') schemaPlace(ctx, x, w, cur, add)
      else viewPlace(ctx, x, w, cur, add)
      if (BACK.has(x.outcome) && mine.length) {
        x.build = { kind: 'db', groups: byPin(mine) }
        all.push(...mine)
      }
    }
    if (all.length) ctx.plannedDbs[dbId] = applyGroups(cur, byPin(all), input.pins, input.fns)
  }
}

/** Decisions grouped by the pin they read from (in order of first appearance). */
function byPin(list: Array<{ pin: string; d: SchemaDecision }>): Array<{ pin: string; decided: SchemaDecision[] }> {
  const m = new Map<string, SchemaDecision[]>()
  for (const { pin, d } of list) (m.get(pin) ?? m.set(pin, []).get(pin)!).push(d)
  return [...m].map(([pin, decided]) => ({ pin, decided }))
}

/** A database with decided parts applied, pin by pin (taking a thing out needs no pin). */
function applyGroups(cur: Database, groups: Array<{ pin: string; decided: SchemaDecision[] }>, pins: PinSet, fns: Pick<PlanFns, 'withoutProperty'>): Database {
  let db = cur
  for (const g of groups) {
    const pinDb = pinDbOf(pins, g.pin) ?? (g.decided.every((d) => d.op === 'remove') ? cur : null)
    if (pinDb) db = overlayDb(db, pinDb, g.decided, fns)
  }
  return db
}

type AddDecision = (pin: string, d: SchemaDecision) => void

function schemaPlace(ctx: Ctx, x: PlacePlan, w: PlaceWindow, cur: Database, add: AddDecision) {
  const { input } = ctx
  const now = input.now.get(x.p)
  const last = w.own[w.own.length - 1]
  const left = last.left
  const first = w.own[0]
  // a database W made: its schema goes with its page (6.2.5) — newPass decides
  if (first.f & F.NEW) return
  if (!now || !left) return hold(x, 'changed')
  const lastTo = Math.max(...w.own.map((g) => g.to))
  const t = touchedOf(w)
  const keys = t === '*' ? new Set([...Object.keys(left.parts), ...Object.keys(now.parts)]) : t
  // a pure reorder of the views (a DBMETA change with no part): never ejected (Δ7)
  if (![...keys].length) {
    if (w.ownEvents.some((e) => e.x?.some((d) => d.part === 'dbmeta'))) return hold(x, 'notEjectable', 'viewOrder')
    return hold(x, 'changed')
  }
  const decide = (k: string, op: SchemaDecision['op']) => {
    x.parts.back.push(k)
    add(firstTouch(w, k).before ?? '', { part: k, op })
  }
  const held = (k: string, reason: Reason, why?: NotEjectable) => x.parts.held.push({ part: k, reason, ...(why ? { why } : {}) })
  for (const k of [...keys].sort()) {
    const pin = pinDbOf(input.pins, firstTouch(w, k).before)
    if (!pin) {
      held(k, 'noBefore')
      continue
    }
    if (NOT_EJECTABLE[k]) {
      held(k, 'notEjectable', NOT_EJECTABLE[k])
      continue
    }
    const f = foreignOn(w, k, lastTo)
    if (f) {
      held(k, f)
      continue
    }
    if ((left.parts[k] ?? '') !== (now.parts[k] ?? '')) {
      held(k, 'changed')
      continue
    }
    if (k.startsWith('p:')) {
      const id = k.slice(2)
      const then = pin.properties.find((p) => p.id === id)
      const live = cur.properties.find((p) => p.id === id)
      if (then?.fromType || live?.fromType) {
        held(k, 'notEjectable', 'kitProperty')
        continue
      }
      if (!then) {
        // W added it: out only when nothing uses it once the rows are planned
        const use = propertyInUse(ctx, cur, id)
        if (use) held(k, 'inUse')
        else decide(k, 'remove')
        continue
      }
      // a type change goes back only with every row W touched in this database
      if (live && live.type !== then.type && !allRowsBack(ctx, cur.id)) {
        held(k, 'dependsOnHeld')
        continue
      }
      decide(k, 'back')
    } else if (k.startsWith('o:') || k.startsWith('oo:')) {
      const propId = (k.startsWith('o:') ? k.slice(2) : k.slice(3)).split('/')[0]
      const live = cur.properties.find((p) => p.id === propId)
      const then = pin.properties.find((p) => p.id === propId)
      if (live?.listId || then?.listId) {
        held(k, 'notEjectable', 'listOption')
        continue
      }
      if (live?.fromType || then?.fromType) {
        held(k, 'notEjectable', 'kitProperty')
        continue
      }
      if (k.startsWith('o:')) {
        const optId = k.slice(2).split('/')[1]
        if (!then?.options?.some((o) => o.id === optId)) {
          // W added the option: out only when no row (that stays) holds it and nothing else names it
          if (optionInUse(ctx, cur, propId, optId)) held(k, 'inUse')
          else decide(k, 'remove')
          continue
        }
      }
      decide(k, 'back')
    } else if (k === 'po' || k === 'l') decide(k, 'back')
    else held(k, 'notEjectable')
  }
  if (x.parts.back.length) {
    x.outcome = 'back'
    delete x.reason
  } else {
    const h = x.parts.held[0]
    hold(x, h?.reason ?? 'changed', h?.why)
  }
}

function viewPlace(ctx: Ctx, x: PlacePlan, w: PlaceWindow, cur: Database, add: AddDecision) {
  const { input } = ctx
  const viewId = x.p.slice(2).split('/')[1]
  const first = w.own[0]
  const last = w.own[w.own.length - 1]
  const now = input.now.get(x.p)
  const pinId = first.before ?? ''
  const gone = w.own.some((g) => g.f & F.GONE)
  if (first.f & F.NEW) {
    // W made the view: it goes when it is still what W left, nobody touched it, and it is not the last one
    const others = cur.views.filter((v) => v.id !== viewId).length
    if (!now?.exists || now.h !== last.left?.h || w.foreign.length || !others) return hold(x, 'changed')
    x.outcome = 'trash'
    x.parts.back.push('v')
    // the view is taken out of the database's current views (no pin needed)
    add(pinId || `new:${viewId}`, { part: `v:${viewId}`, op: 'remove' })
    return
  }
  if (!pinDbOf(input.pins, pinId)) return hold(x, 'noBefore')
  if (gone && !now?.exists) {
    // W deleted it: back at its pin index
    if (w.foreign.some((f) => f.from > first.from)) return hold(x, 'changed')
    x.outcome = 'back'
    x.parts.back.push('v')
    add(pinId, { part: `v:${viewId}`, op: 'back' })
    return
  }
  const lastTo = Math.max(...w.own.map((g) => g.to))
  const f = foreignOn(w, 'v', lastTo)
  if (f) return hold(x, f)
  if (!now?.exists || !last.left || now.parts.v !== last.left.parts.v) return hold(x, 'changed')
  x.outcome = 'back'
  delete x.reason
  x.parts.back.push('v')
  add(pinId, { part: `v:${viewId}`, op: 'back' })
}

/** Every row W touched in this database goes back (a type change may then go back too). */
function allRowsBack(ctx: Ctx, dbId: ID): boolean {
  for (const [p, w] of ctx.windows) if (w.pk === 'row' && w.db === dbId && !ctx.backRows.has(p.slice(2)) && !ctx.trashIds.has(p.slice(2))) return false
  return true
}

/** A property W added is still used after the plan: a row that stays holds a value, or anything names it. */
function propertyInUse(ctx: Ctx, db: Database, propId: ID): boolean {
  if (usedBesidesW(ctx, db, propId)) return true
  // a two-way relation goes only as one unit with its partner: both W's, both unused, neither database locked
  const prop = db.properties.find((p) => p.id === propId)
  if (prop?.type !== 'relation' || !prop.relationDatabaseId) return false
  const partnerId = propId.endsWith('.2way') ? propId.slice(0, -'.2way'.length) : `${propId}.2way`
  const target = ctx.input.state.databases[prop.relationDatabaseId]
  if (!target?.properties.some((p) => p.id === partnerId)) return false
  return !!target.locked || !addedByW(ctx, target.id, partnerId) || usedBesidesW(ctx, target, partnerId)
}

/** A row that stays holds a value of the property, or a view / formula / rollup / automation / command names it. */
function usedBesidesW(ctx: Ctx, db: Database, propId: ID): boolean {
  for (const r of Object.values(ctx.input.state.pages)) {
    if (r.databaseId !== db.id || r.trashed || isEmpty(r.properties?.[propId])) continue
    if (!ctx.backRows.has(r.id) && !ctx.trashIds.has(r.id)) return true
  }
  return ctx.input.fns.propertyRefs(db, ctx.input.state.databases, propId).length > 0
}

/** W added the property in this window (its schema place touched it and the pin before did not have it). */
function addedByW(ctx: Ctx, dbId: ID, propId: ID): boolean {
  const w = ctx.windows.get(`s:${dbId}` as PlaceKey)
  if (!w) return false
  const t = touchedOf(w)
  if (t !== '*' && !t.has(`p:${propId}`)) return false
  const pin = pinDbOf(ctx.input.pins, firstTouch(w, `p:${propId}`).before)
  return !!pin && !pin.properties.some((p) => p.id === propId)
}

function optionInUse(ctx: Ctx, db: Database, propId: ID, optId: ID): boolean {
  for (const r of Object.values(ctx.input.state.pages)) {
    if (r.databaseId !== db.id || r.trashed || ctx.backRows.has(r.id) || ctx.trashIds.has(r.id)) continue
    const v = r.properties?.[propId]
    if (v === optId || (Array.isArray(v) && v.includes(optId))) return true
  }
  return ctx.input.fns.optionRefs(db, optId).length > 0
}

/* ---------------- 6.2.3 rows ---------------- */

function rowPass(ctx: Ctx) {
  const { input, plans, windows } = ctx
  const planned = { pages: input.state.pages, databases: ctx.plannedDbs }
  for (const [p, w] of windows) {
    if (w.pk !== 'row') continue
    const x = plans.get(p)!
    if (ctx.fixed.has(p) || (x.outcome !== 'back' && x.outcome !== 'restore')) continue
    const id = p.slice(2)
    const cur = input.state.pages[id]
    const first = w.own[0]
    const meta = first.before ? input.pins.metas.get(first.before) : undefined
    const before = pinPage(input.pins, first.before)
    const db = ctx.plannedDbs[w.db ?? '']
    if (!cur || !before || !meta || meta.kind !== 'page') {
      hold(x, 'noBefore')
      x.outcome = 'partial'
      continue
    }
    const t = touchedOf(w)
    const kit = (k: string) => k.startsWith('p:') && input.kitComputed(w.db ?? '', k.slice(2))
    const keys = (t === '*' ? [...ROW_PARTS, ...Object.keys(input.now.get(p)?.parts ?? {}).filter((k) => k.startsWith('p:'))] : [...t]).filter((k) => !kit(k))
    const now = input.now.get(p)
    const left = w.own[w.own.length - 1].left
    const parts: string[] = []
    const fates: Record<string, Fate> = {}
    const values: Record<ID, PropertyValue | undefined> = {}
    // a record type comes back only when the planned database still holds it
    const rt = before.recordType ?? null
    if (keys.includes('r') && rt && !(db?.recordTypes ?? []).includes(rt)) {
      hold(x, 'recordType')
      continue
    }
    for (const k of keys) {
      // the order goes back only when nobody moved the row since
      if (k === 'o') {
        if (now && left && now.parts.o === left.parts.o) parts.push('o')
      } else if (!k.startsWith('p:')) parts.push(k)
    }
    // the values W changed, as the planned database takes them
    const props = pinProps(meta)
    const propKeys = keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2))
    if (props && db) {
      const wanted = new Set(propKeys)
      const plan = input.fns.planRestoreProps(cur, { ...props, defs: props.defs.filter((d) => wanted.has(d.id)) }, db)
      plan.skipped.forEach((pid, i) => {
        fates[pid] = plan.notRestored[i].reason
        x.notRestored.push({ name: plan.notRestored[i].name, reason: plan.notRestored[i].reason })
      })
      for (const [pid, v] of Object.entries(plan.values)) {
        const def = db.properties.find((d) => d.id === pid)
        // a two-way value goes back only with its partners' paired values (decided per pair, not per row)
        if (def?.type === 'relation' && !input.fns.relationRestoreOk(planned, db.id, def, id, v, ctx.backRows, (row, prop) => ctx.valueBack.has(`${row}|${prop}`))) {
          fates[pid] = 'relation'
          x.notRestored.push({ name: def.name, reason: 'relation' })
          continue
        }
        values[pid] = v
        fates[pid] ??= 'back'
      }
      for (const pid of propKeys) {
        if (fates[pid]) continue
        const then = props.defs.find((d) => d.id === pid)
        // equal now already (nothing to write), or never restored (a unique ID)
        if (then) fates[pid] = then.type === 'unique_id' ? 'held' : 'back'
        else if (!db.properties.some((d) => d.id === pid)) {
          // a property W added that the plan takes out: its value goes with it
          values[pid] = undefined
          fates[pid] = 'back'
        } else fates[pid] = 'held'
      }
    } else for (const pid of propKeys) fates[pid] = 'deleted'
    for (const pid of propKeys) parts.push(`p:${pid}`)
    if (parts.includes('t')) fates['#title'] = 'back'
    if (parts.includes('i')) fates['#icon'] = 'back'
    // nothing of the row goes back (every value it changed stays): held — its change is not ejected
    if (propKeys.length && !parts.some((k) => !k.startsWith('p:')) && !propKeys.some((pid) => fates[pid] === 'back')) {
      hold(x, Object.values(fates).includes('relation') ? 'dependsOnHeld' : 'valuesStay')
      x.fates = fates
      continue
    }
    // task blocks in the content that comes back (whether one lives elsewhere: the task check after the passes)
    if (parts.includes('c')) {
      const itemWhy = ctx.itemHolds.get(`r:${id}`)
      if (itemWhy) {
        hold(x, itemWhy)
        continue
      }
      if (loops(ctx, before.content)) {
        hold(x, 'taskLoop')
        continue
      }
    }
    // a pipeline task: the agent's stamp goes back with its text (a Confirm before the worker takes it, Δ25)
    const stamp = input.db.pipelineRole(w.db ?? '', '') !== undefined && typeof before.updatedBy === 'string' && before.updatedBy.startsWith('agent:') && (parts.includes('t') || parts.includes('c')) ? before.updatedBy : null
    x.fates = fates
    x.parts.back = parts
    x.build = { kind: 'page', pin: first.before!, parts, values, stamp }
  }
}

/** A task that would come back waits on something that waits on it. */
const loops = (ctx: Ctx, restored: JSONContent | null | undefined): boolean => ctx.input.fns.itemsOf(restored).some((it) => it.blockedBy.some((to) => ctx.input.items.wouldLoop(it.itemId, to)))

const itemIdsOf = (ctx: Ctx, content: JSONContent | null | undefined): string[] => ctx.input.fns.itemsOf(content).map((it) => it.itemId)

/** Tasks that lived before W touched the window's pages (the first pin of each, where it was not in the trash). */
function preItemsOf(ctx: Ctx): Set<string> {
  if (ctx.preItems) return ctx.preItems
  const out = new Set<string>()
  for (const w of ctx.windows.values()) {
    if (w.pk !== 'page' && w.pk !== 'db' && w.pk !== 'row') continue
    const before = pinPage(ctx.input.pins, w.own[0].before)
    if (before && !before.trashed) for (const id of itemIdsOf(ctx, before.content)) out.add(id)
  }
  return (ctx.preItems = out)
}

const count = (list: readonly string[], id: string) => list.reduce((n, x) => (x === id ? n + 1 : n), 0)

/**
 * The task check over the whole plan (§5.2): a task the plan puts back must not live twice once the plan is done —
 * an occurrence the same plan removes (a move inside the page, a cut and paste across pages) does not count — a task
 * that lived before W must not be lost (its removal stays held when nothing puts it back), and a task W made must not
 * go while a live task the plan leaves links it (Blocked by / Related: never a link to a task that is gone — 'taskLinked').
 * Holds the hunk, row content, trash or restore that breaks it (else the page's content, else the place) for the next
 * pass. Resolves whether it held anything new.
 */
function itemPass(ctx: Ctx): boolean {
  const { input, plans } = ctx
  const nowOf = new Map<ID, string[]>()
  const afterOf = new Map<ID, string[]>()
  const afterDoc = new Map<ID, JSONContent | null>()
  const liveChange = new Set<ID>()
  for (const x of plans.values()) {
    if (!x.p.startsWith('p:') || !BACK.has(x.outcome) || !x.build || x.build.kind === 'db') continue
    const id = x.p.slice(2)
    const cur = input.state.pages[id]
    if (!cur) continue
    const b = x.build
    let content = cur.content
    let trashed = !!cur.trashed
    if (b.kind === 'trash') trashed = true
    else {
      const before = pinPage(input.pins, b.pin)
      if (b.content) content = b.content
      else if (b.parts.includes('c')) content = before?.content ?? null
      if (b.parts.includes('tr') && before) trashed = !!before.trashed
    }
    if (content === cur.content && trashed === !!cur.trashed) continue
    if (trashed !== !!cur.trashed) liveChange.add(id)
    nowOf.set(id, cur.trashed ? [] : itemIdsOf(ctx, cur.content))
    afterOf.set(id, trashed ? [] : itemIdsOf(ctx, content))
    afterDoc.set(id, trashed ? null : (content ?? null))
  }
  if (!nowOf.size) return false
  const ids = new Set([...nowOf.values(), ...afterOf.values()].flat())
  // the links the pages the plan changes keep (lazy): a linker elsewhere keeps its link anyway
  let linksAfter: Set<string> | null = null
  const linkedAfter = (item: string): boolean => {
    if (input.items.linkersOf(item).some((pid) => !nowOf.has(pid))) return true
    if (!linksAfter) {
      linksAfter = new Set()
      for (const doc of afterDoc.values()) for (const it of input.fns.itemsOf(doc)) for (const to of [...it.blockedBy, ...(it.related ?? [])]) linksAfter.add(to)
    }
    return linksAfter.has(item)
  }
  let grew = false
  for (const item of ids) {
    const others = input.items.livePagesOf(item).filter((pid) => !nowOf.has(pid)).length
    let now = others
    let after = others
    for (const [id, list] of nowOf) {
      now += count(list, item)
      after += count(afterOf.get(id)!, item)
    }
    let side: 'adds' | 'drops' | null = null
    let why: Reason = 'taskElsewhere'
    if (after > Math.max(1, now)) side = 'adds'
    else if (after === 0 && now > 0 && preItemsOf(ctx).has(item)) side = 'drops'
    else if (after === 0 && now > 0 && linkedAfter(item)) {
      side = 'drops'
      why = 'taskLinked'
    }
    if (!side) continue
    const id = [...nowOf.keys()].find((pid) => (side === 'adds' ? count(afterOf.get(pid)!, item) > count(nowOf.get(pid)!, item) : count(afterOf.get(pid)!, item) < count(nowOf.get(pid)!, item)))
    if (!id) continue
    const x = plans.get(`p:${id}` as PlaceKey)!
    const ladder: string[] = []
    if (x.build?.kind === 'trash') ladder.push(`t:${id}`)
    else if (x.pk === 'row') ladder.push(`r:${id}`)
    else {
      const h = ctx.applied.get(id)?.find((a) => a[side!].includes(item))
      if (h) ladder.push(h.key)
      if (liveChange.has(id)) ladder.push(`tr:${id}`)
      ladder.push(`c:${id}`)
    }
    ladder.push(`x:${id}`)
    const next = ladder.find((k) => !ctx.itemHolds.has(k))
    if (next) {
      ctx.itemHolds.set(next, why)
      grew = true
    }
  }
  return grew
}

/* ---------------- 6.2.2 pages, 6.2.4 parents ---------------- */

function pagePass(ctx: Ctx) {
  const { input, plans, windows } = ctx
  for (const [p, w] of windows) {
    if (w.pk !== 'page' && w.pk !== 'db') continue
    const x = plans.get(p)!
    if (ctx.fixed.has(p) || x.outcome === 'trash' || !(x.outcome === 'back' || x.outcome === 'restore' || (x.outcome === 'held' && (x.reason === 'changed' || x.reason === 'interleaved')))) continue
    if (w.own[0].f & F.NEW) continue
    const id = p.slice(2)
    const cur = input.state.pages[id]
    const now = input.now.get(p)
    const last = w.own[w.own.length - 1]
    const left = last.left
    const first = w.own[0]
    const before = pinPage(input.pins, first.before)
    if (!cur || !now || !left || !before) {
      hold(x, 'noBefore')
      x.outcome = 'partial'
      continue
    }
    const lastTo = Math.max(...w.own.map((g) => g.to))
    const t = touchedOf(w)
    const meta = t === '*' ? [...META] : META.filter((k) => t.has(k))
    for (const k of meta) {
      const f = foreignOn(w, k, lastTo)
      if (f) x.parts.held.push({ part: k, reason: f })
      else if ((left.parts[k] ?? '') !== (now.parts[k] ?? '')) x.parts.held.push({ part: k, reason: 'changed' })
      else if (k === 'tr' && ctx.itemHolds.has(`tr:${id}`)) x.parts.held.push({ part: k, reason: ctx.itemHolds.get(`tr:${id}`)! })
      else x.parts.back.push(k)
    }
    // back into the trash (W restored it): never with pages below it that are newer than W's restore (6.2.4)
    if (x.parts.back.includes('tr') && before.trashed && !cur.trashed) {
      const since = firstTouch(w, 'tr').from
      const below = liveBelow(ctx, id)
      const pages = input.state.pages
      const newer = below.some((d) => !ctx.trashIds.has(d) && !ctx.backRows.has(d) && Math.max(pages[d].createdAt ?? 0, pages[d].updatedAt ?? 0) > since)
      if (newer) {
        x.parts.back = x.parts.back.filter((k) => k !== 'tr')
        x.parts.held.push({ part: 'tr', reason: 'children' })
      } else x.keeps = below
    }
    // the parent goes back only where movePage would let it (6.2.4)
    if (x.parts.back.includes('pa') && !parentOk(ctx, id, before.parentId)) {
      x.parts.back = x.parts.back.filter((k) => k !== 'pa')
      x.parts.held.push({ part: 'pa', reason: 'parent' })
    }
    // a restored page whose parent is gone or in the trash goes to the root (applyRewind does it, the plan says it)
    if (x.parts.back.includes('tr') && !before.trashed && cur.trashed) {
      const parentId = x.parts.back.includes('pa') ? before.parentId : cur.parentId
      if (parentId && !parentLive(ctx, parentId)) x.toRoot = true
    }
    let content: JSONContent | undefined
    let restored: string[][] | undefined
    const touchesContent = t === '*' || [...t].some((k) => k.startsWith('b:') || k === 'b#' || k === 'bo')
    if (touchesContent) {
      const r = contentPlan(ctx, w, id, lastTo)
      x.hunks = { back: r.back, held: r.held }
      if (r.reason) x.parts.held.push({ part: 'c', reason: r.reason })
      if (r.back && r.content) {
        content = r.content
        restored = r.restored
        x.parts.back.push('c')
      }
    }
    if (!x.parts.back.length) {
      const h = x.parts.held[0]
      hold(x, h?.reason ?? 'changed')
      continue
    }
    x.outcome = x.parts.back.includes('tr') && !before.trashed && cur.trashed ? 'restore' : 'back'
    delete x.reason
    x.build = { kind: 'page', pin: first.before!, parts: x.parts.back.filter((k) => k !== 'c'), ...(content ? { content, restored } : {}), stamp: null }
  }
}

/** Is the page there and not in the trash (nor anything above it) — in the plan's state? */
function parentLive(ctx: Ctx, id: ID): boolean {
  const pages = ctx.input.state.pages
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  while (cur && !seen.has(cur.id)) {
    const trashed = ctx.trashIds.has(cur.id) || (cur.trashed && !restoredByPlan(ctx, cur.id))
    if (trashed) return false
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return !!pages[id]
}

const restoredByPlan = (ctx: Ctx, id: ID) => ctx.plans.get(`p:${id}` as PlaceKey)?.outcome === 'restore'

/** May the page move back under `parentId`: there, live, and not one of its own descendants (no cycle). */
function parentOk(ctx: Ctx, id: ID, parentId: ID | null): boolean {
  const pages = ctx.input.state.pages
  return parentFits(pages, id, parentId, (c) => ctx.trashIds.has(c) || (!!pages[c]?.trashed && !restoredByPlan(ctx, c)))
}

/**
 * May page `id` sit under `parentId` (as movePage would let it): the parent is there, neither it nor anything above it
 * is (or goes) into the trash (`gone`), and the page is not above it (no cycle). Null: the root. Cycle-safe.
 */
export function parentFits(pages: Record<ID, Page>, id: ID, parentId: ID | null, gone: (id: ID) => boolean): boolean {
  if (!parentId) return true
  if (parentId === id || !pages[parentId]) return false
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[parentId]
  while (cur && !seen.has(cur.id)) {
    if (cur.id === id || gone(cur.id)) return false
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return true
}

/** The pages directly below each page now (one scan, lazy). */
function kidsOf(ctx: Ctx): Map<ID, ID[]> {
  if (ctx.kids) return ctx.kids
  const m = new Map<ID, ID[]>()
  for (const pg of Object.values(ctx.input.state.pages)) if (pg.parentId) (m.get(pg.parentId) ?? m.set(pg.parentId, []).get(pg.parentId)!).push(pg.id)
  return (ctx.kids = m)
}

/** The live pages below a page (sub-pages, rows, theirs …): what goes into the trash with it. */
function liveBelow(ctx: Ctx, id: ID): ID[] {
  return livePagesBelow(ctx.input.state.pages, id, kidsOf(ctx))
}

/** The live pages below `id` — a page in the trash and what is below it are not (cycle-safe). */
export function livePagesBelow(pages: Record<ID, Page>, id: ID, kids?: ReadonlyMap<ID, readonly ID[]>): ID[] {
  let index = kids
  if (!index) {
    const m = new Map<ID, ID[]>()
    for (const pg of Object.values(pages)) if (pg.parentId) (m.get(pg.parentId) ?? m.set(pg.parentId, []).get(pg.parentId)!).push(pg.id)
    index = m
  }
  const out: ID[] = []
  const seen = new Set<ID>([id])
  const stack = [...(index.get(id) ?? [])]
  while (stack.length) {
    const c = stack.pop()!
    if (seen.has(c) || !pages[c] || pages[c].trashed) continue
    seen.add(c)
    out.push(c)
    stack.push(...(index.get(c) ?? []))
  }
  return out
}

/** A page's content, hunk by hunk, W's segments newest first (design §6.2.2). */
function contentPlan(ctx: Ctx, w: PlaceWindow, pageId: ID, lastTo: number): { back: number; held: number; content?: JSONContent; restored?: string[][]; reason?: Reason } {
  const { input } = ctx
  const nowList = input.nowBlocks.get(w.p)
  if (!nowList) return { back: 0, held: 1, reason: 'noBefore' }
  const working = { strings: [...nowList.strings], json: [...nowList.json] }
  let back = 0
  let held = 0
  let reason: Reason | undefined
  const restored: string[][] = []
  const applied: AppliedHunk[] = []
  for (let i = w.own.length - 1; i >= 0; i--) {
    const g = w.own[i]
    const pinList = g.before ? input.pins.blocks.get(g.before) : g.f & F.NEW ? { strings: [], json: [] } : undefined
    const leftBlocks = g.left?.blocks
    if (!pinList || !leftBlocks) {
      held++
      reason ??= 'noBefore'
      continue
    }
    const later = w.foreign.filter((f) => f.from > g.from)
    for (const h of blockHunks(pinList.strings, leftBlocks)) {
      const key = `h:${pageId}|${i}:${h.b[0]}-${h.b[1]}:${h.l[0]}-${h.l[1]}`
      const ids = [...h.B, ...h.L].map(idOfBlock).filter((x): x is string => !!x)
      const loose = [...h.B, ...h.L].some((b) => !idOfBlock(b))
      const touchedBy = (f: Foreign) => f.touched === '*' || ids.some((bid) => (f.touched as string[]).includes(`b:${bid}`)) || (loose && ((f.touched as string[]).includes('b#') || (f.touched as string[]).includes('bo')))
      const f = later.find(touchedBy)
      if (f) {
        held++
        reason ??= f.from <= lastTo ? 'interleaved' : 'changed'
        continue
      }
      const loc = locateUnique(working.strings, h.L, h.anchors)
      if (!loc) {
        held++
        reason ??= 'ambiguous'
        continue
      }
      // the task check after the passes held this hunk (a task doubled, lost or still linked), or the page's whole content
      const itemWhy = ctx.itemHolds.get(key) ?? ctx.itemHolds.get(`c:${pageId}`)
      if (itemWhy) {
        held++
        reason ??= itemWhy
        continue
      }
      const json = pinList.json.slice(h.b[0], h.b[1])
      const restoredDoc: JSONContent = { type: 'doc', content: json }
      if (loops(ctx, restoredDoc)) {
        held++
        reason ??= 'taskLoop'
        continue
      }
      applied.push({ key, adds: itemIdsOf(ctx, restoredDoc), drops: itemIdsOf(ctx, { type: 'doc', content: working.json.slice(loc[0], loc[1]) }) })
      working.strings.splice(loc[0], loc[1] - loc[0], ...h.B)
      working.json.splice(loc[0], loc[1] - loc[0], ...json)
      restored.push(h.B)
      back++
    }
  }
  if (!back) return { back, held, ...(reason ? { reason } : {}) }
  const doc: JSONContent = { type: 'doc', content: working.json.length ? working.json : [{ type: 'paragraph' }] }
  // a task never lands inside a task or a table — the swap of whole top-level blocks keeps it so; asserted
  if (input.fns.liftMisplacedItems(doc) !== doc) return { back: 0, held: held + back, reason: 'ambiguous' }
  ctx.applied.set(pageId, applied)
  return { back, held, content: doc, restored, ...(reason ? { reason } : {}) }
}

/* ---------------- new rows, new pages, new databases ---------------- */

function newPass(ctx: Ctx) {
  const { input, plans, windows } = ctx
  const trash = new Set<ID>()
  for (const [p, x] of plans) if (x.outcome === 'trash' && p.startsWith('p:')) trash.add(p.slice(2))
  // a held relation index: who links to whom now (only when new rows are planned)
  let holders: Map<ID, ID[]> | null = null
  const holdersOf = (id: ID) => {
    if (!holders) {
      holders = new Map()
      for (const r of Object.values(input.state.pages)) {
        if (!r.databaseId || r.trashed) continue
        const db = input.state.databases[r.databaseId]
        for (const prop of db?.properties ?? []) {
          if (prop.type !== 'relation') continue
          const v = r.properties?.[prop.id]
          if (Array.isArray(v)) for (const t of v) (holders.get(t) ?? holders.set(t, []).get(t)!).push(r.id)
        }
      }
    }
    return holders.get(id) ?? []
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [p, w] of windows) {
      const x = plans.get(p)!
      if (ctx.fixed.has(p) || x.outcome !== 'trash' || !p.startsWith('p:')) continue
      const id = p.slice(2)
      let why: Reason | null = null
      // no live page below it that stays (a page's sub-pages, a row's, a database's rows) — every one a new one going too
      if ((kidsOf(ctx).get(id) ?? []).some((c) => !input.state.pages[c]?.trashed && !trash.has(c))) why = 'children'
      if (w.pk === 'row') {
        if (holdersOf(id).some((h) => !trash.has(h))) why = 'inUse'
      } else if (w.pk === 'db') {
        // a database: its schema too
        const schema = plans.get(`s:${id}` as PlaceKey)
        if (schema && schema.outcome !== 'trash') why = 'children'
      }
      if (!why && ctx.itemHolds.has(`t:${id}`)) why = ctx.itemHolds.get(`t:${id}`)!
      if (why) {
        hold(x, why)
        trash.delete(id)
        changed = true
        continue
      }
      x.build = { kind: 'trash' }
      x.parts.back = ['tr']
      x.keeps = liveBelow(ctx, id)
    }
  }
  // a new database's schema goes with its page; held with it
  for (const [p, x] of plans) {
    if (!p.startsWith('s:') || x.outcome !== 'trash') continue
    const page = plans.get(`p:${p.slice(2)}` as PlaceKey)
    if (!page || page.outcome !== 'trash') hold(x, 'children')
  }
  ctx.trashIds = trash
}

/* ---------------- counts ---------------- */

function finish(ctx: Ctx): Plan {
  const { input, plans } = ctx
  const counts: PlanCounts = { ops: 0, all: 0, back: 0, held: 0, partial: 0, already: 0, rows: 0, newRows: 0, pages: 0, schema: 0, views: 0 }
  const vs = new Set<string>()
  const heldBy: Array<LaneKey | null> = []
  let extendTo: { a: number; b: number } | undefined
  const { a, b } = input.data.sel
  const refs = new Map<PlaceKey, Page | Database | View | null>()
  const keys = new Map<PlaceKey, string>()
  for (const [p, w] of input.data.places) {
    const x = plans.get(p)!
    for (const e of w.ownEvents) if (e.at >= a && e.at < b && !((e.f ?? 0) & F.COPY)) vs.add(e.v)
    if (x.outcome === 'skip') continue
    if (x.outcome === 'already') {
      counts.already++
      continue
    }
    counts.all++
    if (BACK.has(x.outcome)) counts.back++
    else if (x.outcome === 'held') {
      counts.held++
      for (const by of x.by) if (!heldBy.includes(by.lane)) heldBy.push(by.lane)
    } else counts.partial++
    const isNew = !!(w.own[0].f & F.NEW)
    if (w.pk === 'row') counts[isNew ? 'newRows' : 'rows']++
    else if (w.pk === 'schema') counts.schema++
    else if (w.pk === 'view') counts.views++
    else counts.pages++
    if (x.reason === 'cut') {
      const lo = Math.min(...w.own.map((g) => g.from))
      const hi = Math.max(...w.own.map((g) => g.to + 1))
      extendTo = { a: Math.min(extendTo?.a ?? a, lo, a), b: Math.max(extendTo?.b ?? b, hi, b) }
    }
    refs.set(p, refOf(input.state, p, w.pk))
    keys.set(p, input.now.get(p)?.key ?? '-')
  }
  counts.ops = vs.size
  return { sel: input.data.sel, places: [...plans.values()], counts, heldBy, ...(extendTo ? { extendTo } : {}), incomplete: input.data.lostTails.length > 0, refs, keys }
}

/**
 * The commit's re-check of what the plan read besides its own places (Δ26): nothing joined a page that goes into the
 * trash (a page below it, a row linking a new row), and every parent that goes back still fits — on the state at the
 * commit. True: something changed — plan again, write nothing.
 */
export function staleFacts(plan: Plan, state: { pages: Record<ID, Page>; databases: Record<ID, Database> }, pins: PinSet): boolean {
  const trash = new Set<ID>()
  const restored = new Set<ID>()
  const pageBuild = (x: PlacePlan) => (x.build?.kind === 'page' ? x.build : null)
  for (const x of plan.places) {
    if (!x.p.startsWith('p:') || !BACK.has(x.outcome) || !x.build) continue
    const id = x.p.slice(2)
    if (x.outcome === 'trash') trash.add(id)
    if (x.outcome === 'restore') restored.add(id)
    const b = pageBuild(x)
    if (b?.parts.includes('tr') && pinPage(pins, b.pin)?.trashed) trash.add(id)
  }
  let kids: Map<ID, ID[]> | null = null
  const kidsNow = () => {
    if (kids) return kids
    kids = new Map()
    for (const pg of Object.values(state.pages)) if (pg.parentId) (kids.get(pg.parentId) ?? kids.set(pg.parentId, []).get(pg.parentId)!).push(pg.id)
    return kids
  }
  let holders: Set<ID> | null = null
  const linked = (id: ID) => {
    if (!holders) {
      holders = new Set()
      for (const r of Object.values(state.pages)) {
        if (!r.databaseId || r.trashed || trash.has(r.id)) continue
        for (const prop of state.databases[r.databaseId]?.properties ?? []) {
          const v = prop.type === 'relation' ? r.properties?.[prop.id] : undefined
          if (Array.isArray(v)) for (const t of v) if (typeof t === 'string') holders.add(t)
        }
      }
    }
    return holders.has(id)
  }
  for (const x of plan.places) {
    if (!x.p.startsWith('p:') || !BACK.has(x.outcome) || !x.build) continue
    const id = x.p.slice(2)
    if (trash.has(id)) {
      const keeps = new Set(x.keeps ?? [])
      if (livePagesBelow(state.pages, id, kidsNow()).some((d) => !keeps.has(d) && !trash.has(d))) return true
      if (x.outcome === 'trash' && x.pk === 'row' && linked(id)) return true
    }
    const b = pageBuild(x)
    if (b?.parts.includes('pa') && x.pk !== 'row') {
      const before = pinPage(pins, b.pin)
      if (before && !parentFits(state.pages, id, before.parentId ?? null, (c) => trash.has(c) || (!!state.pages[c]?.trashed && !restored.has(c)))) return true
    }
  }
  return false
}

/** The object a place is in the store (the commit's re-check compares it). */
export function refOf(state: { pages: Record<ID, Page>; databases: Record<ID, Database> }, p: PlaceKey, pk: PlaceKind): Page | Database | View | null {
  if (pk === 'schema') return state.databases[p.slice(2)] ?? null
  if (pk === 'view') {
    const [db, view] = p.slice(2).split('/')
    return state.databases[db]?.views.find((v) => v.id === view) ?? null
  }
  return state.pages[p.slice(2)] ?? null
}

/* ------------------------------------------------------------------ */
/* targets at the commit                                               */
/* ------------------------------------------------------------------ */

/**
 * The patch of an eject: every place that goes back (back · trash · restore), as an overlay on the object as it is
 * NOW (`state`: one read at the commit) — stamps and comments that arrived after planning survive. A recreate is
 * never written (R3 creates nothing).
 */
export function targetsFor(plan: Plan, state: { pages: Record<ID, Page>; databases: Record<ID, Database> }, pins: PinSet, fns: Pick<PlanFns, 'withoutProperty'>): { pages: Record<ID, Page>; databases: Record<ID, Database> } {
  const pages: Record<ID, Page> = {}
  const dbGroups = new Map<ID, Array<{ pin: string; decided: SchemaDecision[] }>>()
  for (const x of plan.places) {
    if (!BACK.has(x.outcome) || !x.build) continue
    const b = x.build
    if (b.kind === 'db') continue
    const id = x.p.slice(2)
    const cur = state.pages[id]
    if (!cur) continue
    if (b.kind === 'trash') {
      pages[id] = { ...cur, trashed: true, updatedBy: null }
      continue
    }
    const before = pinPage(pins, b.pin)
    if (!before) continue
    pages[id] = overlay(cur, before, b.parts, b.content, b.values as Record<ID, PropertyValue> | undefined, b.stamp)
  }
  // databases: the schema place's and the view places' decisions, by pin, on the database as it is now
  for (const x of plan.places) {
    if (!BACK.has(x.outcome) || !x.build || x.build.kind !== 'db') continue
    const dbId = x.db ?? x.p.slice(2).split('/')[0]
    const list = dbGroups.get(dbId) ?? dbGroups.set(dbId, []).get(dbId)!
    list.push(...x.build.groups)
  }
  const databases: Record<ID, Database> = {}
  for (const [dbId, groups] of dbGroups) {
    const cur = state.databases[dbId]
    if (!cur) continue
    const db = applyGroups(cur, groups, pins, fns)
    if (db !== cur) databases[dbId] = db
  }
  return { pages, databases }
}
