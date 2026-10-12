/**
 * The held check: per place W touched in a window, whether it could go back now — or why not. The place-level and
 * part rules the reading (R2: the plate's held note and diamonds, the read dialog) and the planner core (R3) share.
 * Order per place: unavailable → open → cut → already ejected → partial (no before, no left, batch, stale) → by kind:
 * rows are held whole (sent, memory, pipeline, moved, interleaved, changed), pages / schemas / views part by part (R2
 * holds them only when every part W touched is held). Pure: the async caller hands in the digests now, the empty
 * value's digests, and what it knows about the databases.
 */
import type { Database, ID, PropertyType } from '../../../store/types'
import type { WindowData } from '../window/load'
import { partsDiffer, propKeysAt } from './rowkeys'
import { isStoredType } from './canon'
import { F, K, type Foreign, type LaneKey, type LeftHash, type NowDigest, type Outcome, type PlaceKey, type PlaceVerdict, type PlaceWindow, type Reason } from './types'

export interface VerdictInput {
  data: WindowData
  now: Map<PlaceKey, NowDigest>
  /** the digest of a part's empty value */
  empty: (part: string) => string
  /** a kit-computed value property (its value follows the row; never decided, never compared) */
  kitComputed: (db: ID, prop: ID) => boolean
  readOnly: { pageLocked(id: ID): boolean; dbLocked(id: ID): boolean }
  db: {
    system(db: ID): Database['system'] | undefined
    /** a pipeline database's role of a property (null: no role); undefined: not a pipeline database */
    pipelineRole(db: ID, prop: ID): string | null | undefined
    /** the database's properties now (id + type) */
    props(db: ID): ReadonlyArray<{ id: ID; type: PropertyType }>
  }
}

/** Roles of a pipeline row that may go back (title, priority) — the others decide where / whether the worker runs. */
const FREE_ROLES = new Set(['priority', 'title'])

/** The parts W's own segments touched ('*': any). */
function ownTouched(w: PlaceWindow): Set<string> | '*' {
  const out = new Set<string>()
  for (const g of w.own) {
    if (g.touched === '*') return '*'
    for (const k of g.touched) out.add(k)
  }
  return out
}

/** Lanes of foreign segments, those after W's last segment first (then the ones within), one per lane. */
function byOf(foreign: Foreign[], lastTo: number): Array<{ lane: LaneKey | null; at: number }> {
  const after = foreign.filter((f) => f.from > lastTo)
  const within = foreign.filter((f) => f.from <= lastTo)
  const out: Array<{ lane: LaneKey | null; at: number }> = []
  const seen = new Set<string>()
  for (const f of [...after, ...within]) {
    const k = f.lane ?? '\u0000'
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ lane: f.lane, at: f.from })
  }
  return out
}

const blockMap = (blocks: string[] | undefined): Map<string, string> => {
  const m = new Map<string, string>()
  for (const b of blocks ?? []) {
    const i = b.indexOf('=')
    const id = b.slice(0, i)
    if (id !== '#') m.set(id, b.slice(i + 1))
  }
  return m
}
const looseOf = (blocks: string[] | undefined): string =>
  (blocks ?? [])
    .filter((b) => b.startsWith('#='))
    .sort()
    .join(',')
const seqOf = (blocks: string[] | undefined): string => (blocks ?? []).map((b) => b.slice(0, b.indexOf('='))).join(',')

/** A page's or schema's touched part `k` is no longer what W left (or someone else touched it). */
function partHeld(k: string, left: LeftHash, now: NowDigest, foreign: Foreign[]): boolean {
  if (foreign.some((f) => f.touched === '*' || f.touched.includes(k))) return true
  if (k.startsWith('b:')) return blockMap(left.blocks).get(k.slice(2)) !== blockMap(now.blocks).get(k.slice(2))
  if (k === 'b#') return looseOf(left.blocks) !== looseOf(now.blocks)
  if (k === 'bo') return seqOf(left.blocks) !== seqOf(now.blocks)
  return (left.parts[k] ?? '') !== (now.parts[k] ?? '')
}

/** W's own events of the window in [a, b): Vorgänge, span, staged change ids. */
function eventFacts(w: PlaceWindow, a: number, b: number): { ops: number; span: [number, number]; changes: string[] } {
  const vs = new Set<string>()
  const changes = new Set<string>()
  let lo = Infinity
  let hi = -Infinity
  for (const e of w.ownEvents) {
    if (e.at < a || e.at >= b) continue
    if (!((e.f ?? 0) & F.COPY)) vs.add(e.v)
    if (e.c) changes.add(e.c)
    lo = Math.min(lo, e.at)
    hi = Math.max(hi, e.t2 ?? e.at)
  }
  if (!Number.isFinite(lo)) {
    lo = Math.min(...w.own.map((g) => g.from))
    hi = Math.max(...w.own.map((g) => g.to))
  }
  return { ops: vs.size, span: [lo, hi], changes: [...changes].sort() }
}

/** The held check of every place of a loaded window. */
export function verdicts(input: VerdictInput): Map<PlaceKey, PlaceVerdict> {
  const out = new Map<PlaceKey, PlaceVerdict>()
  const { data } = input
  const { sel } = data
  const wKey = sel.run ?? sel.lane
  const live = data.ejects.filter((e) => e.state === 'done' && !e.undone && (e.writer === wKey || e.lane === sel.lane))
  for (const [p, w] of data.places) out.set(p, verdictOf(input, p, w, live))
  return out
}

function verdictOf(input: VerdictInput, p: PlaceKey, w: PlaceWindow, live: WindowData['ejects']): PlaceVerdict {
  const { data } = input
  const { a, b } = data.sel
  const facts = eventFacts(w, a, b)
  const first = w.own[0]
  const last = w.own[w.own.length - 1]
  const lastTo = Math.max(...w.own.map((g) => g.to))
  const base = { p, pk: w.pk, ...(w.db ? { db: w.db } : {}), ...facts }
  const verdict = (outcome: Outcome, reason?: Reason, foreign: Foreign[] = w.foreign): PlaceVerdict => {
    const after = foreign.filter((f) => f.from > first.from)
    return { ...base, outcome, ...(reason ? { reason } : {}), by: byOf(foreign, lastTo), ...(after.length ? { firstForeignAt: after[0].from, firstForeignLane: after[0].lane } : {}) }
  }

  if (w.unavailable) return verdict('skip', 'unavailable')
  if (w.own.some((g) => g.o === 1)) return verdict('partial', 'open')
  if (w.cut) return verdict('partial', 'cut')
  if (live.some((e) => w.own.every((g) => e.segs.includes(g.id)))) return verdict('already', 'alreadyEjected')
  if (w.own.some((g) => !g.before && !(g.f & (F.NEW | F.PURGED)))) return verdict('partial', 'noBefore')
  if (w.own.some((g) => !g.left)) return verdict('partial', 'noLeft')
  if (w.own.some((g) => g.f & F.BATCH)) return verdict('partial', 'batch')
  if (w.own.some((g) => g.f & F.STALE)) return verdict('partial', 'stale')

  const now = input.now.get(p)
  const left = last.left!
  const isNew = !!(first.f & F.NEW)
  const gone = w.own.some((g) => g.f & F.GONE)
  if (!now || !now.exists) {
    // a view W deleted goes back from its pin (the planner checks the lock and later writers); a page or row is recreated
    if (gone && w.pk === 'view') return verdict('back')
    return gone ? verdict('recreate') : verdict('held', 'changed')
  }
  // the net trash state W left: its last trash / restore
  const trashEvents = w.ownEvents.filter((e) => e.kinds & (K.TRASH | K.RESTORE))
  const trashed = !!trashEvents.length && !!(trashEvents[trashEvents.length - 1].kinds & K.TRASH)
  const touched = ownTouched(w)

  if (w.pk === 'row') return rowVerdict(input, w, left, now, { isNew, trashed, touched, lastTo, verdict })
  if (w.pk === 'page' || w.pk === 'db') {
    const id = p.slice(2)
    if (input.readOnly.pageLocked(id)) return verdict('held', 'pageLocked')
    if (isNew) return newPageVerdict(left, now, w.foreign, lastTo, verdict)
    return partsVerdict(left, now, touched, w.foreign, lastTo, trashed, verdict)
  }
  // schema and views
  const db = w.db ?? p.slice(2)
  if (input.readOnly.dbLocked(db)) return verdict('held', 'locked')
  if (w.pk === 'view') {
    if (isNew) return now.h === left.h && !w.foreign.length ? verdict('trash') : verdict('held', 'changed')
  }
  if (w.pk === 'schema' && isNew) return now.h === left.h && !w.foreign.length ? verdict('trash') : verdict('held', 'changed')
  return partsVerdict(left, now, touched, w.foreign, lastTo, false, verdict)
}

/**
 * A page (or a database's page) W made goes to the trash when nobody changed it since — part by part like a row (Δ28):
 * the order is no one's change (a sidebar reorder), so neither its part nor a foreign segment that touched only it
 * counts. A record from before parts were kept compares its whole digest.
 */
function newPageVerdict(left: LeftHash, now: NowDigest, foreign: Foreign[], lastTo: number, verdict: (o: Outcome, r?: Reason, f?: Foreign[]) => PlaceVerdict): PlaceVerdict {
  const orderOnly = (f: Foreign) => f.lane !== null && f.touched !== '*' && f.touched.length > 0 && f.touched.every((k) => k === 'o')
  const others = foreign.filter((f) => !orderOnly(f))
  let same = now.h === left.h
  if (Object.keys(left.parts).length) {
    const keys = new Set([...Object.keys(left.parts), ...Object.keys(now.parts)])
    keys.delete('o')
    same = [...keys].every((k) => (left.parts[k] ?? '') === (now.parts[k] ?? '')) && (left.blocks ?? []).join('\u0001') === (now.blocks ?? []).join('\u0001')
  }
  if (same && !others.length) return verdict('trash', undefined, [])
  return verdict('held', others.some((f) => f.from <= lastTo) ? 'interleaved' : 'changed', others.length ? others : foreign)
}

/** Pages, schemas, views: held only when every part W touched is held. */
function partsVerdict(left: LeftHash, now: NowDigest, touched: Set<string> | '*', foreign: Foreign[], lastTo: number, trashed: boolean, verdict: (o: Outcome, r?: Reason, f?: Foreign[]) => PlaceVerdict): PlaceVerdict {
  const keys = touched === '*' ? [...Object.keys(left.parts), ...(left.blocks ?? []).map((x) => `b:${x.slice(0, x.indexOf('='))}`)] : [...touched]
  const parts = keys.filter((k) => k !== 'o')
  const held = parts.filter((k) => partHeld(k, left, now, foreign))
  if (parts.length && held.length === parts.length) {
    const why = foreign.filter((f) => f.touched === '*' || held.some((k) => f.touched.includes(k)))
    return verdict('held', why.some((f) => f.from <= lastTo) ? 'interleaved' : 'changed', why.length ? why : foreign)
  }
  return verdict(trashed ? 'restore' : 'back')
}

interface RowCtx {
  isNew: boolean
  trashed: boolean
  touched: Set<string> | '*'
  lastTo: number
  verdict: (o: Outcome, r?: Reason, f?: Foreign[]) => PlaceVerdict
}

/** Rows: held whole. */
function rowVerdict(input: VerdictInput, w: PlaceWindow, left: LeftHash, now: NowDigest, c: RowCtx): PlaceVerdict {
  const { verdict, touched } = c
  const db = w.db ?? ''
  if (w.ownEvents.some((e) => e.w.startsWith('you~outbox'))) return verdict('held', 'sent')
  const system = input.db.system(db)
  if (system === 'memory' || system === 'memory-log') return verdict('held', 'memory')
  if (input.readOnly.pageLocked(w.p.slice(2))) return verdict('held', 'pageLocked')
  // a move between databases (or page ⇄ entry) is never planned back
  const kinds = new Set(w.ownEvents.map((e) => e.pk))
  if (kinds.size > 1 || w.ownEvents.some((e) => e.pk === 'row' && e.kinds & K.MOVE && e.mv && e.mv[0] !== e.mv[1])) return verdict('held', 'moved')
  // a pipeline task: whatever decides where / whether the worker runs stays (Δ25); new tasks may go to the trash
  // (pipelineRole answers undefined for any database that is no pipeline)
  if (!c.isNew && input.db.pipelineRole(db, '') !== undefined) {
    if (touched === '*' || touched.has('tr') || touched.has('pa')) return verdict('held', 'pipeline')
    for (const k of touched)
      if (k.startsWith('p:')) {
        const role = input.db.pipelineRole(db, k.slice(2))
        if (!role || !FREE_ROLES.has(role)) return verdict('held', 'pipeline')
      }
  }
  const nowProps = input.db.props(db)
  const nowKeys = new Set(nowProps.filter((x) => isStoredType(x.type)).map((x) => `p:${x.id}`))
  const keysAt = propKeysAt(nowProps, input.data.schemaEvents.get(db) ?? [], c.lastTo)
  if (!keysAt) return verdict('held', 'changed')
  const kit = (k: string) => k.startsWith('p:') && input.kitComputed(db, k.slice(2))
  // a foreign segment that changed nothing of the row's: its order, kit-computed values, a property added later and
  // back-filled or deleted since
  const ignorable = (f: Foreign) => f.lane !== null && f.touched !== '*' && f.touched.every((k) => k === 'o' || (k.startsWith('p:') && (kit(k) || !keysAt.has(k) || !nowKeys.has(k))))
  const foreign = w.foreign.filter((f) => !ignorable(f))
  if (foreign.length) return verdict('held', foreign.some((f) => f.from <= c.lastTo) ? 'interleaved' : 'changed', foreign)
  // the row now against what W left: over the keys present at W's end AND now
  if (c.isNew && !Object.keys(left.parts).length) {
    // a NEW row of a record from before parts were kept: the whole digest (the caller signed it over keysAt)
    if (now.h !== left.h) return verdict('held', 'changed', [])
  } else {
    const keep = (parts: Record<string, string>) => {
      const o: Record<string, string> = {}
      for (const [k, v] of Object.entries(parts)) if (!k.startsWith('p:') || (keysAt.has(k) && nowKeys.has(k))) o[k] = v
      return o
    }
    if (partsDiffer(keep(left.parts), keep(now.parts), input.empty, kit).length) return verdict('held', 'changed', [])
  }
  if (c.isNew) return verdict('trash', undefined, [])
  return verdict(c.trashed ? 'restore' : 'back', undefined, [])
}
