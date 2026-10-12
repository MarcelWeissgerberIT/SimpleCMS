/**
 * Reading a window (R2): the loaded window, its places as they are now, the held check (model/hold.ts) — the plate's
 * meters, held note and diamonds, the read dialog's groups ("what changed": schema, views, pages, rows, new rows, to
 * the trash, moved, partial) and, lazily per picked place, its diff: the state before W (the first segment's pin), the
 * state after W (the next writer's pin, or the place now) and what others changed in between. Read-only: nothing here
 * writes the workspace, settles a writer or flushes an editor.
 */
import type { ID, Page } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { kindOfDb, codingRoleOf } from '../../coding'
import { isKitComputed } from '../../kit'
import { propertyValueToText } from '../../../database'
import { bodyOf, type SnapshotBody } from '../../history/snapshots'
import { pinToBody } from '../../history/pins'
import { windowMeters, type Meters } from '../model/counts'
import { verdicts } from '../model/hold'
import { propKeysAt } from '../model/rowkeys'
import { F, K, type JEvent, type JSegment, type LaneKey, type NowDigest, type PlaceKey, type PlaceKind, type PlaceVerdict, type PlaceWindow, type SchemaDelta, type WindowSel } from '../model/types'
import { openJournal } from '../journal/db'
import { journalRev } from '../journal/bus'
import { eventsOf } from '../journal/query'
import { readPinBodies, readPinMetas } from '../journal/pins'
import { emptyLookup, nowDigests } from './digest'
import { loadWindow, type WindowData } from './load'

export type GroupKind = 'schema' | 'views' | 'pages' | 'rows' | 'newRows' | 'trashed' | 'moved' | 'partial'
export const GROUP_ORDER: GroupKind[] = ['schema', 'views', 'pages', 'rows', 'newRows', 'trashed', 'moved', 'partial']
export type Act = 'changed' | 'new' | 'trashed' | 'moved' | 'restored'

export interface ReadItem {
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  act: Act
  verdict: PlaceVerdict
  /** W's first write on it in the window */
  at: number
  /** words W added / removed on it in the window */
  words: [number, number]
  /** property values W changed (the Vorgänge's count) */
  values: number
  text: boolean
}

export interface ReadModel {
  sel: WindowSel
  data: WindowData
  now: Map<PlaceKey, NowDigest>
  meters: Meters
  verdicts: Map<PlaceKey, PlaceVerdict>
  groups: Array<{ kind: GroupKind; items: ReadItem[] }>
  held: PlaceVerdict[]
  partial: PlaceVerdict[]
  /** a lost tail overlaps the window's reach: "possibly incomplete" (Δ13) */
  incomplete: boolean
  /** a window that cuts a writer's stretch: the bracket that holds it whole */
  extendTo?: { a: number; b: number }
  tooMany?: number
  unavailable: number
}

/** W's events, oldest first (derived writers' too). */
const eventsOfWindow = (d: WindowData): JEvent[] => [...d.places.values()].flatMap((w) => w.ownEvents)

/** What W did to a place in the window, as the read dialog groups it. */
function groupOf(w: PlaceWindow, v: PlaceVerdict, a: number, b: number): { kind: GroupKind; act: Act } {
  if (v.outcome === 'partial') return { kind: 'partial', act: 'changed' }
  const evs = w.ownEvents.filter((e) => e.at >= a && e.at < b)
  const trash = evs.filter((e) => e.kinds & (K.TRASH | K.RESTORE))
  const last = trash[trash.length - 1]
  if (last && last.kinds & K.TRASH) return { kind: 'trashed', act: 'trashed' }
  const isNew = !!(w.own[0].f & F.NEW)
  if (!isNew && evs.some((e) => e.kinds & K.MOVE && e.mv && e.mv[0] !== e.mv[1])) return { kind: 'moved', act: 'moved' }
  const act: Act = isNew ? 'new' : last && last.kinds & K.RESTORE ? 'restored' : 'changed'
  if (w.pk === 'schema') return { kind: 'schema', act }
  if (w.pk === 'view') return { kind: 'views', act }
  if (w.pk === 'row') return { kind: isNew ? 'newRows' : 'rows', act }
  return { kind: 'pages', act }
}

/** The facts the held check reads about the databases now (one store read). */
function dbFacts() {
  const s = useWorkspace.getState()
  const propOf = (db: ID, prop: ID) => s.databases[db]?.properties.find((p) => p.id === prop)
  return {
    kitComputed: (db: ID, prop: ID) => {
      const def = propOf(db, prop)
      return !!def && isKitComputed(def)
    },
    readOnly: { pageLocked: (id: ID) => !!s.pages[id]?.settings?.locked, dbLocked: (id: ID) => !!s.databases[id]?.locked },
    db: {
      system: (db: ID) => s.databases[db]?.system,
      pipelineRole: (db: ID, prop: ID) => (kindOfDb(db) ? codingRoleOf(db, prop) : undefined),
      props: (db: ID) => s.databases[db]?.properties ?? [],
    },
  }
}

/** Old NEW records (before parts were kept) compare their whole digest over the keys the database had then. */
function oldNewKeys(d: WindowData): Map<PlaceKey, Set<string>> {
  const out = new Map<PlaceKey, Set<string>>()
  const s = useWorkspace.getState()
  for (const [p, w] of d.places) {
    const last = w.own[w.own.length - 1]
    if (w.pk !== 'row' || !(w.own[0].f & F.NEW) || !last.left || Object.keys(last.left.parts).length) continue
    const keys = propKeysAt(s.databases[w.db ?? '']?.properties ?? [], d.schemaEvents.get(w.db ?? '') ?? [], last.to)
    if (keys) out.set(p, keys)
  }
  return out
}

/** Read a window: load → digests now → the held check → meters, groups, held, partial. */
async function build(sel: WindowSel): Promise<ReadModel> {
  const data = await loadWindow(sel)
  const t0 = performance.now()
  const now = await nowDigests(sel.scope, data.places.keys(), { keys: oldNewKeys(data) })
  const keys = new Set<string>()
  for (const w of data.places.values()) for (const g of w.own) for (const k of Object.keys(g.left?.parts ?? {})) keys.add(k)
  for (const n of now.values()) for (const k of Object.keys(n.parts)) keys.add(k)
  const empty = await emptyLookup(sel.scope, keys)
  const v = verdicts({ data, now, empty, ...dbFacts() })
  try {
    performance.measure('rec-held', { start: t0, end: performance.now() })
  } catch {
    /* no marks */
  }
  const who = sel.run ? { run: sel.run } : { lane: sel.lane }
  // too many places: only the first are loaded — the meters count every event of the window, as the plate does
  const meters = windowMeters(data.tooMany ? await eventsOf(sel.scope, who, sel.a, sel.b) : eventsOfWindow(data), who, sel.a, sel.b)
  const byKind = new Map<GroupKind, ReadItem[]>()
  let extend: { a: number; b: number } | undefined
  for (const [p, w] of data.places) {
    const verdict = v.get(p)!
    const { kind, act } = groupOf(w, verdict, sel.a, sel.b)
    const evs = w.ownEvents.filter((e) => e.at >= sel.a && e.at < sel.b)
    const words: [number, number] = [0, 0]
    let values = 0
    let text = false
    for (const e of evs) {
      words[0] += e.wa ?? 0
      words[1] += e.wd ?? 0
      values += e.pc ?? 0
      if (e.kinds & K.CONTENT) text = true
    }
    const at = evs.length ? evs[0].at : w.own[0].from
    ;(byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push({ p, pk: w.pk, ...(w.db ? { db: w.db } : {}), act, verdict, at, words, values, text })
    if (verdict.reason === 'cut') {
      const lo = Math.min(...w.own.map((g) => g.from))
      const hi = Math.max(...w.own.map((g) => (g.to ?? g.from) + 1))
      extend = { a: Math.min(extend?.a ?? sel.a, lo, sel.a), b: Math.max(extend?.b ?? sel.b, hi, sel.b) }
    }
  }
  const groups = GROUP_ORDER.filter((k) => byKind.get(k)?.length).map((kind) => ({ kind, items: byKind.get(kind)!.sort((x, y) => x.at - y.at) }))
  const all = [...v.values()]
  return {
    sel,
    data,
    now,
    meters,
    verdicts: v,
    groups,
    held: all.filter((x) => x.outcome === 'held'),
    partial: all.filter((x) => x.outcome === 'partial'),
    incomplete: data.lostTails.length > 0,
    ...(extend ? { extendTo: extend } : {}),
    ...(data.tooMany ? { tooMany: data.tooMany } : {}),
    unavailable: all.filter((x) => x.reason === 'unavailable').length,
  }
}

/* one read per window and state of the journal and the workspace (the plate, the dialog and the report share it) */
let memo: { key: string; pages: unknown; dbs: unknown; p: Promise<ReadModel> } | null = null

/**
 * Read a window (memoised per window, journal revision — every flush, closing segments too, every other tab's ping —
 * and workspace state). `rev`: an extra key (a caller that wants a fresh read passes something new).
 */
export function readWindow(sel: WindowSel, rev = 0): Promise<ReadModel> {
  const key = `${sel.scope}|${sel.lane}|${sel.run ?? ''}|${sel.a}|${sel.b}|${rev}|${journalRev()}`
  const s = useWorkspace.getState()
  if (memo && memo.key === key && memo.pages === s.pages && memo.dbs === s.databases) return memo.p
  const p = build(sel)
  memo = { key, pages: s.pages, dbs: s.databases, p }
  p.catch(() => {
    if (memo?.p === p) memo = null
  })
  return p
}

/** Forget the memo (tests, a wipe). */
export function forgetRead(): void {
  memo = null
}

/* ------------------------------------------------------------------ */
/* held marks on the tape                                              */
/* ------------------------------------------------------------------ */

export interface HeldMark {
  p: PlaceKey
  at: number
  label: string
  /** who changed it first since (its diamond sits on that track when it is shown; null: not recorded) */
  lane: LaneKey | null
}

const CUT = 14

/** A row's label on the tape: its unique-id display (rendered now, never stored), else its title cut at 14. */
export function rowLabel(page: Page | undefined): string {
  if (!page) return '—'
  const db = page.databaseId ? useWorkspace.getState().databases[page.databaseId] : undefined
  const uid = db?.properties.find((p) => p.type === 'unique_id')
  if (db && uid) {
    const v = propertyValueToText(db, uid, page)
    if (v) return v
  }
  const title = page.title || '—'
  return title.length > CUT ? `${title.slice(0, CUT - 1)}…` : title
}

/** The held rows as diamonds: at the first foreign change after W's first touch, on its writer's track (else now). */
export function heldMarks(model: ReadModel): HeldMark[] {
  const pages = useWorkspace.getState().pages
  return model.held
    .filter((v) => v.pk === 'row')
    .map((v) => ({ p: v.p, at: v.firstForeignAt ?? Date.now(), label: rowLabel(pages[v.p.slice(2)]), lane: v.firstForeignAt === undefined ? (v.by[0]?.lane ?? null) : (v.firstForeignLane ?? null) }))
    .sort((x, y) => x.at - y.at)
}

/** Who changed the held places since (lanes, a null lane = not recorded), in order of first appearance. */
export function heldWho(model: ReadModel): Array<LaneKey | null> {
  const out: Array<LaneKey | null> = []
  for (const v of model.held) for (const b of v.by) if (!out.includes(b.lane)) out.push(b.lane)
  return out
}

/* ------------------------------------------------------------------ */
/* one place's diff (lazy, on pick)                                    */
/* ------------------------------------------------------------------ */

export interface ForeignNote {
  lane: LaneKey | null
  at: number
  /** block ids and property ids it touched; '*' = anything */
  blocks: string[] | '*'
  props: string[] | '*'
}

export interface SchemaLine {
  delta: SchemaDelta
  at: number
  /** the named thing is there now (true), gone (false), or unknown (null) */
  there: boolean | null
}

export interface PlaceDiff {
  p: PlaceKey
  pk: PlaceKind
  unavailable?: true
  isNew: boolean
  gone: boolean
  /** pages and rows: the state before W (null: W created it, or no pin) */
  before: SnapshotBody | null
  after: SnapshotBody | null
  afterExact: boolean
  /** what others changed between W's first and last write on it */
  interleaved: ForeignNote[]
  /** schema / view places: what W did, by name */
  schema?: SchemaLine[]
  /** W's first and last write on it */
  span: [number, number]
  ops: number
}

async function pinBody(scope: WindowSel['scope'], pinId: string | null, memory: boolean): Promise<SnapshotBody | null> {
  if (!pinId) return null
  const meta = (await readPinMetas(scope, [pinId], memory)).get(pinId)
  if (!meta || meta.kind !== 'page') return null
  let content = null
  if (meta.body) {
    const bodies = await readPinBodies(scope, [[meta.page.id, meta.body]], memory)
    content = bodies.get(`${meta.page.id}|${meta.body}`) ?? null
  }
  return pinToBody(meta, content)
}

const noteOf = (f: { lane: LaneKey | null; from: number; touched: string[] | '*' }): ForeignNote => ({
  lane: f.lane,
  at: f.from,
  blocks: f.touched === '*' ? '*' : f.touched.filter((k) => k.startsWith('b:')).map((k) => k.slice(2)),
  props: f.touched === '*' ? '*' : f.touched.filter((k) => k.startsWith('p:')).map((k) => k.slice(2)),
})

/** One place's diff: before → after, and the changes inside W's span that are not W's. */
export async function placeDiff(model: ReadModel, p: PlaceKey): Promise<PlaceDiff> {
  const w = model.data.places.get(p)!
  const v = model.verdicts.get(p)!
  const first = w.own[0]
  const last = w.own[w.own.length - 1]
  const lastTo = Math.max(...w.own.map((g) => g.to))
  const isNew = !!(first.f & F.NEW)
  const base = { p, pk: w.pk, isNew, gone: !model.now.get(p)?.exists, span: v.span, ops: v.ops }
  const interleaved = w.foreign.filter((f) => f.from >= first.from && f.from <= lastTo).map(noteOf)
  if (w.unavailable) return { ...base, unavailable: true, before: null, after: null, afterExact: false, interleaved: [] }
  if (w.pk === 'schema' || w.pk === 'view') return { ...base, before: null, after: null, afterExact: true, interleaved, schema: schemaLines(w) }
  const j = await openJournal()
  const memory = j.mode === 'memory'
  const scope = model.sel.scope
  const before = isNew ? null : await pinBody(scope, first.before, memory)
  // after: the next writer's pin when it starts exactly from what W left; else the place now when nothing changed it
  // since; else the nearer of the two, marked approximate
  const left = last.left?.h ?? last.lastLh
  const nextF = w.foreign.find((f) => f.from >= lastTo && f.seg && f.lane !== null)
  const nextSeg = nextF?.seg ? await j.get<JSegment>('segs', nextF.seg) : undefined
  const page = useWorkspace.getState().pages[p.slice(2)]
  const current = page ? bodyOf(page) : null
  const settled = v.outcome === 'back' || v.outcome === 'trash' || v.outcome === 'restore'
  let after: SnapshotBody | null = null
  let afterExact = false
  if (nextSeg?.before && (nextSeg.bh === left || nextSeg.bhr === left)) {
    after = await pinBody(scope, nextSeg.before, memory)
    afterExact = !!after
  }
  if (!after && current && settled && !w.foreign.some((f) => f.from > lastTo)) {
    after = current
    afterExact = true
  }
  if (!after) after = (nextSeg?.before ? await pinBody(scope, nextSeg.before, memory) : null) ?? current
  return { ...base, before, after, afterExact, interleaved }
}

/** What W did to a schema or view, line by line, by name — and whether the named thing is there now. */
function schemaLines(w: PlaceWindow): SchemaLine[] {
  const db = useWorkspace.getState().databases[w.db ?? '']
  const out: SchemaLine[] = []
  for (const e of w.ownEvents)
    for (const d of e.x ?? []) {
      let there: boolean | null = null
      if (db) {
        const prop = d.prop ? db.properties.find((x) => x.id === d.prop!.id) : undefined
        if (d.part === 'opt+' || d.part === 'opt-' || d.part === 'opt~') there = !!prop?.options?.some((o) => o.id === d.opt?.id)
        else if (d.part.startsWith('prop')) there = !!prop
        else if (d.part.startsWith('view')) there = db.views.some((x) => x.id === d.view?.id)
      }
      out.push({ delta: d, at: e.at, there })
    }
  return out
}
