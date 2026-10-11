/**
 * The eject's Undo — ONE step (design §6.5, C24, Δ29, Δ30). In the tab that ejected (memory): every place the eject
 * wrote that is still exactly as the eject left it (its parts key) gets the decided parts of the object before back,
 * on the object as it is NOW (comments, locks, stamps made since stay); a place changed since stays and is counted.
 * After a reload: the planner on the eject's own window ("eject the eject": its pins, its compare-and-hold). Either
 * way ONE store update under `you~undo:<ejectId>` (a ref settled.ts knows: no automation, agent trigger, autofill,
 * trust watch or attribution keeper reacts to it), no new record, no new version; then the sources come back for the
 * places that came back (marks last) and the record reads `undone`. Refused in another workspace than the eject's.
 */
import { useWorkspace } from '../../../store/store'
import { withWriter, type Writer } from '../../../store/writer'
import type { Database, ID, Page } from '../../../store/types'
import { flushOpenEditors } from '../../../editor'
import { withRestoring } from '../../history/snapshots'
import { partsKey } from '../model/canon'
import { targetsFor } from '../model/plan'
import { overlay, overlayDb, type SchemaDecision } from '../model/overlay'
import type { EjectRecord, Outcome, PlaceKey } from '../model/types'
import { deps } from '../journal/deps'
import { scopeNow } from '../journal/scope'
import { noteEject } from '../settled'
import { flips, removalsInUse, undoMemory, withEjectLock, withSourceLock, type CommitRefusal, type UndoMemo } from './commit'
import { canEject, planEject, PLAN_FNS } from './plan'
import { getEject, putEject } from './records'
import { unsettle } from './sources'
import { objectIn } from './targets'

const BACK: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore'])

export type UndoResult = { ok: true; back: number; kept: number; slips: number } | { refused: CommitRefusal }

type State = { pages: Record<ID, Page>; databases: Record<ID, Database> }

/** Undo an eject (the toast's key, Ctrl+Z while it shows, the after-plate's key). */
export async function undoEject(ejectId: string): Promise<UndoResult> {
  const rec = await getEject(ejectId)
  if (!rec || rec.state !== 'done') return { refused: { key: 'gone' } }
  if (rec.undone) return { refused: { key: 'undone' } }
  if (!canEject(rec.s)) return { refused: { key: 'teamLater' } }
  const mem = undoMemory.get(ejectId)
  // the workspace the eject was made in, as it was (a switch or a reload of another workspace in between: refused)
  if (scopeNow() !== rec.s || (mem && (mem.scope0 !== scopeNow() || mem.epoch0 !== useWorkspace.getState().epoch))) return { refused: { key: 'workspaceChanged' } }
  noteEject(ejectId)
  const r = await withEjectLock(rec.s, () => withSourceLock({ lane: rec.lane, run: rec.writer }, async (): Promise<UndoResult> => {
    // read again inside the locks: another tab may have undone it meanwhile
    const cur = await getEject(ejectId)
    if (!cur || cur.state !== 'done') return { refused: { key: 'gone' } }
    if (cur.undone) return { refused: { key: 'undone' } }
    return mem ? instant(cur, mem) : planned(cur)
  }))
  return r === 'busy' ? { refused: { key: 'lockBusy' } } : r
}

const undoWriter = (id: string): Writer => ({ kind: 'you', via: 'undo', ref: id })
const keyOf = (s: State, p: PlaceKey): string => partsKey(objectIn(s, p), deps)

/** A database's decided parts the other way round: what the object before had comes back, what it lacked goes. */
function inverse(decided: readonly SchemaDecision[], pre: Database): SchemaDecision[] {
  return decided.map((d): SchemaDecision => {
    let has = true
    if (d.part.startsWith('p:')) has = pre.properties.some((p) => p.id === d.part.slice(2))
    else if (d.part.startsWith('o:')) {
      const [propId, optId] = d.part.slice(2).split('/')
      has = !!pre.properties.find((p) => p.id === propId)?.options?.some((o) => o.id === optId)
    } else if (d.part.startsWith('v:')) has = pre.views.some((v) => v.id === d.part.slice(2))
    return { part: d.part, op: has ? 'back' : 'remove' }
  })
}

/** The instant path: the parts the eject decided, from the objects before, wherever the eject's write still stands. */
async function instant(rec: EjectRecord, mem: UndoMemo): Promise<UndoResult> {
  if (scopeNow() !== mem.scope0 || useWorkspace.getState().epoch !== mem.epoch0) return { refused: { key: 'workspaceChanged' } }
  flushOpenEditors()
  const s = useWorkspace.getState()
  const back = new Set<PlaceKey>()
  for (const [p, key] of mem.post) if (keyOf(s, p) === key) back.add(p)
  // a database comes back whole or not at all (its schema and its views are one object)
  const dbPlaces = new Map<ID, PlaceKey[]>()
  for (const x of mem.plan.places) {
    if (!BACK.has(x.outcome) || x.build?.kind !== 'db') continue
    const dbId = x.db ?? x.p.slice(2).split('/')[0]
    ;(dbPlaces.get(dbId) ?? dbPlaces.set(dbId, []).get(dbId)!).push(x.p)
  }
  for (const places of dbPlaces.values()) if (!places.every((p) => back.has(p))) for (const p of places) back.delete(p)
  const patch: State = { pages: {}, databases: {} }
  const groups = new Map<ID, SchemaDecision[]>()
  for (const x of mem.plan.places) {
    if (!back.has(x.p) || !x.build) continue
    const b = x.build
    if (b.kind === 'db') {
      const dbId = x.db ?? x.p.slice(2).split('/')[0]
      ;(groups.get(dbId) ?? groups.set(dbId, []).get(dbId)!).push(...b.groups.flatMap((g) => g.decided))
      continue
    }
    const id = x.p.slice(2)
    const cur = s.pages[id]
    const before = mem.pre.pages[id]
    if (!cur || !before) {
      back.delete(x.p)
      continue
    }
    const parts = b.kind === 'trash' ? ['tr'] : [...b.parts, ...(b.content ? ['c'] : [])]
    patch.pages[id] = overlay(cur, before, parts, undefined, undefined, before.updatedBy ?? null)
  }
  for (const [dbId, decided] of groups) {
    const cur = s.databases[dbId]
    const before = mem.pre.databases[dbId]
    if (!cur || !before) continue
    const db = overlayDb(cur, before, inverse(decided, before), PLAN_FNS)
    if (db !== cur) patch.databases[dbId] = db
  }
  const kept = mem.post.size - back.size
  const ok = measured(() => withWriter(undoWriter(rec.id), () => withRestoring(() => s.applyRewind(patch, 'eject'))))
  if (!ok) return { refused: { key: 'writeRefused' } }
  await unsettle(rec, back, mem.states)
  await putEject({ ...rec, undone: Date.now() })
  undoMemory.delete(rec.id)
  return { ok: true, back: back.size, kept, slips: rec.slips ?? 0 }
}

/** After a reload: the planner on the eject's own window (its pins, compare-and-hold), committed as the Undo. */
async function planned(rec: EjectRecord): Promise<UndoResult> {
  const sel = { scope: rec.s, lane: 'undo' as const, run: `eject:${rec.id}`, a: rec.at, b: Date.now() + 1 }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await planEject(sel, { undoOf: rec.id })
    if ('refused' in r) return { refused: r.refused.key === 'empty' ? { key: 'gone' } : r.refused }
    const { plan, input } = r
    if (!plan.counts.back) return { refused: { key: 'nothingBack' } }
    // the synchronous section, as the eject's own
    if (scopeNow() !== rec.s) return { refused: { key: 'workspaceChanged' } }
    flushOpenEditors()
    const s = useWorkspace.getState()
    if (flips(plan, s).length || removalsInUse(plan, s)) continue
    const patch = targetsFor(plan, s, input.pins, PLAN_FNS)
    const ok = measured(() => withWriter(undoWriter(rec.id), () => withRestoring(() => s.applyRewind(patch, 'eject'))))
    if (!ok) return { refused: { key: 'writeRefused' } }
    const back = new Set(plan.places.filter((x) => BACK.has(x.outcome)).map((x) => x.p))
    await unsettle(rec, back)
    await putEject({ ...rec, undone: Date.now() })
    return { ok: true, back: back.size, kept: plan.counts.held + plan.counts.partial, slips: rec.slips ?? 0 }
  }
  return { refused: { key: 'workspaceChanged' } }
}

/** The Undo's one store update, as the performance mark `rec-eject-undo`. */
function measured(fn: () => boolean): boolean {
  const t0 = performance.now()
  const ok = fn()
  try {
    performance.measure('rec-eject-undo', { start: t0, end: performance.now() })
  } catch {
    /* no marks */
  }
  return ok
}
