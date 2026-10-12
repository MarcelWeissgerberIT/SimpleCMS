/**
 * Committing an eject (design §6.4, Δ26, Δ27, C34, C41): under the scope's eject lock (and, for an agent's window,
 * the agent's run lock — one review at a time), with the sources' guards checked again:
 *  1. a "Vor dem Auswurf" version of every page / row that goes back (forced: even one equal to its newest version; one
 *     that cannot be written refuses the eject — `versionFailed`, nothing written);
 *  2. the record written ahead as 'committing' (the decided parts of every target, signed — a boot finishes a crashed
 *     commit from them);
 *  3. one synchronous section: same workspace, the open editors' typing in the store, every place that goes back still
 *     what the plan read, and what it read besides still so (nothing joined a page going into the trash, every parent
 *     going back still fits — `staleFacts`) — else NOTHING is written: the dialog plans again and shows the new counts
 *     (the person confirmed a plan, never a silently different one); the targets built on the objects as they are
 *     now, ONE store update (`applyRewind`) under the eject's own writer;
 *  4. the sources settled (settled marks first), the record 'done'.
 * What the eject's Undo needs in this tab (the objects before, the parts keys after) stays in memory.
 * `applyRewind` is called only here and in eject/undo.ts.
 */
import { useWorkspace } from '../../../store/store'
import { endRun, noteRun, withWriter, type Writer } from '../../../store/writer'
import type { Database, ID, Page, PropertyValue } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { flushOpenEditors } from '../../../editor'
import { snapshotNow, withRestoring } from '../../history/snapshots'
import { partsKey } from '../model/canon'
import { livePagesBelow, refOf, staleFacts, targetsFor, type CoreInput, type Plan } from '../model/plan'
import type { EjectRecord, Outcome, PlaceKey, Scope, WindowSel } from '../model/types'
import { deps } from '../journal/deps'
import { recorder } from '../journal/recorder'
import { scopeNow } from '../journal/scope'
import { noteEject } from '../settled'
import { busyRefusal } from './guards'
import { ejectHook, holdAt } from './hook'
import { canEject, PLAN_FNS, type EjectRefusal } from './plan'
import { putEject } from './records'
import { agentOf, changeMap, outcomesOf, settle } from './sources'
import { decidedKey, objectIn, targetDigests } from './targets'

const BACK: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore'])

/** Why a commit (or an Undo) did not write. */
export type CommitRefusal = EjectRefusal | { key: 'lockBusy' } | { key: 'workspaceChanged' } | { key: 'writeRefused' } | { key: 'versionFailed' } | { key: 'nothingBack' } | { key: 'gone' } | { key: 'undone' }

export type CommitResult = { ok: true; record: EjectRecord } | { refused: CommitRefusal } | { replan: true }

type State = { pages: Record<ID, Page>; databases: Record<ID, Database> }

/**
 * What the eject's Undo needs in this tab: the objects before, the decided parts' keys after, the live pages below the
 * pages it took out of the trash (right after its write), the plan, the agent states.
 */
export interface UndoMemo {
  record: EjectRecord
  plan: Plan
  pre: State
  post: Map<PlaceKey, string>
  below: Map<ID, ID[]>
  scope0: Scope
  epoch0: string | undefined
  states: Map<string, unknown>
}

/** Undo data of this tab's ejects (memory only: a reload takes the planner's way back). */
export const undoMemory = new Map<string, UndoMemo>()

/* ------------------------------------------------------------------ */
/* locks                                                               */
/* ------------------------------------------------------------------ */

let busyHere = false

/** Run `fn` under the scope's eject lock (another tab or this one busy: 'busy'). */
export async function withEjectLock<T>(scope: Scope, fn: () => Promise<T>): Promise<T | 'busy'> {
  if (busyHere) return 'busy'
  const go = async () => {
    busyHere = true
    try {
      return await fn()
    } finally {
      busyHere = false
    }
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return go()
  return locks.request(`one-recorder-eject:${scope}`, { ifAvailable: true }, (lock) => (lock ? go() : 'busy')) as Promise<T | 'busy'>
}

/** Inside the eject lock: an agent's window also takes the agent's run lock (never nested — the sources assume it). */
export async function withSourceLock<T>(sel: Pick<WindowSel, 'lane' | 'run'>, fn: () => Promise<T>): Promise<T> {
  const agentId = agentOf(sel)
  if (!agentId) return fn()
  const { withRunLock } = await import('../../agents')
  return withRunLock(agentId, fn)
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const keyOf = (s: State, p: PlaceKey): string => partsKey(objectIn(s, p), deps)

/** Places that go back but are no longer what the plan read (another object AND other parts). */
export function flips(plan: Plan, s: State): PlaceKey[] {
  const out: PlaceKey[] = []
  for (const x of plan.places) {
    if (!BACK.has(x.outcome)) continue
    if (refOf(s, x.p, x.pk) === plan.refs.get(x.p)) continue
    if (keyOf(s, x.p) !== plan.keys.get(x.p)) out.push(x.p)
  }
  return out
}

const isEmpty = (v: PropertyValue | undefined) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)

/** A property or option the plan takes out is used now (a row outside the plan holds it, or something names it). */
export function removalsInUse(plan: Plan, s: State): boolean {
  const back = new Set(plan.places.filter((x) => BACK.has(x.outcome) && x.p.startsWith('p:')).map((x) => x.p.slice(2)))
  for (const x of plan.places) {
    if (!BACK.has(x.outcome) || x.build?.kind !== 'db') continue
    const dbId = x.db ?? x.p.slice(2).split('/')[0]
    const db = s.databases[dbId]
    if (!db) continue
    for (const g of x.build.groups)
      for (const d of g.decided) {
        if (d.op !== 'remove') continue
        if (d.part.startsWith('p:')) {
          const id = d.part.slice(2)
          if (PLAN_FNS.propertyRefs(db, s.databases, id).length) return true
          for (const r of Object.values(s.pages)) if (r.databaseId === dbId && !r.trashed && !back.has(r.id) && !isEmpty(r.properties?.[id])) return true
        } else if (d.part.startsWith('o:')) {
          const [propId, optId] = d.part.slice(2).split('/')
          if (PLAN_FNS.optionRefs(db, optId).length) return true
          for (const r of Object.values(s.pages)) {
            if (r.databaseId !== dbId || r.trashed || back.has(r.id)) continue
            const v = r.properties?.[propId]
            if (v === optId || (Array.isArray(v) && v.includes(optId))) return true
          }
        }
      }
  }
  return false
}

/** The pages a plan writes (their versions come first). */
export const pagesWritten = (plan: Plan): ID[] => plan.places.filter((x) => BACK.has(x.outcome) && x.build && x.build.kind !== 'db' && x.p.startsWith('p:')).map((x) => x.p.slice(2))

/** The current objects of a patch's places (the Undo overlays their decided parts back). */
function preOf(s: State, patch: State): State {
  const pages: Record<ID, Page> = {}
  const databases: Record<ID, Database> = {}
  for (const id of Object.keys(patch.pages)) if (s.pages[id]) pages[id] = s.pages[id]
  for (const id of Object.keys(patch.databases)) if (s.databases[id]) databases[id] = s.databases[id]
  return { pages, databases }
}

/** The segments of the places that go back (what a later eject's `already` compares). */
const segsOf = (plan: Plan, input: CoreInput): string[] => plan.places.filter((x) => BACK.has(x.outcome)).flatMap((x) => input.data.places.get(x.p)?.own.map((g) => g.id) ?? [])

/* ------------------------------------------------------------------ */
/* the commit                                                          */
/* ------------------------------------------------------------------ */

/**
 * Eject a planned window. `label`: the writer's name for the versions ("Vor dem Auswurf · {name}"). Resolves with the
 * done record, a refusal, or `replan` (a place changed after planning: nothing was written).
 */
export async function ejectNow(sel: WindowSel, planned: { plan: Plan; input: CoreInput }, opts: { discardPending: boolean; label?: string }): Promise<CommitResult> {
  if (sel.run?.startsWith('eject:') || sel.lane === 'undo') return { refused: { key: 'ejectRun' } }
  if (!canEject(sel.scope)) return { refused: { key: 'teamLater' } }
  if (!planned.plan.counts.back) return { refused: { key: 'nothingBack' } }
  const r = await withEjectLock(sel.scope, () => withSourceLock(sel, () => commitLocked(sel, planned, opts)))
  return r === 'busy' ? { refused: { key: 'lockBusy' } } : r
}

async function commitLocked(sel: WindowSel, planned: { plan: Plan; input: CoreInput }, opts: { discardPending: boolean; label?: string }): Promise<CommitResult> {
  const { plan, input } = planned
  const data = input.data
  // the sources again, inside the locks (a run may have started since the dialog opened)
  const busy = await busyRefusal(data)
  if (busy) return { refused: busy }
  const scope0 = scopeNow()
  const epoch0 = useWorkspace.getState().epoch
  if (scope0 !== sel.scope) return { refused: { key: 'workspaceChanged' } }
  const ejectId = newId()
  noteEject(ejectId)
  const w: Writer = { kind: 'eject', id: ejectId, of: sel.run ?? sel.lane }
  noteRun(w, { action: 'eject' })
  let record: EjectRecord
  let pre: State
  const post = new Map<PlaceKey, string>()
  const below = new Map<ID, ID[]>()
  try {
    // 1. versions ("Vor dem Auswurf"), forced — one that cannot be written: nothing is (the version comes first)
    const versions = await Promise.all(pagesWritten(plan).map((id) => snapshotNow(id, 'eject', opts.label, { force: true, strict: true }).then(() => true, () => false)))
    if (versions.includes(false)) return { refused: { key: 'versionFailed' } }
    const versionAt = Date.now()
    // 2. write-ahead
    const s1 = useWorkspace.getState()
    const ahead = targetsFor(plan, s1, input.pins, PLAN_FNS)
    record = {
      id: ejectId,
      s: scope0,
      at: versionAt,
      tab: recorder()?.tab ?? '-',
      writer: sel.run ?? sel.lane,
      lane: sel.lane,
      a: sel.a,
      b: sel.b,
      state: 'committing',
      outcomes: outcomesOf(plan),
      segs: segsOf(plan, input),
      targets: await targetDigests(scope0, plan, ahead, s1),
      changes: changeMap(data, plan),
      runs: Object.keys(data.runs),
      pending: opts.discardPending,
      counts: plan.counts,
      versionAt,
    }
    await putEject(record)
    if (ejectHook.at === 'beforeCheck') await holdAt()
    // 3. the synchronous section — no await from here to the store update
    const abort = async (why: 'workspaceChanged' | 'writeRefused' | 'replan'): Promise<CommitResult> => {
      await putEject({ ...record, state: 'aborted' })
      return why === 'replan' ? { replan: true } : { refused: { key: why } }
    }
    if (scopeNow() !== scope0 || useWorkspace.getState().epoch !== epoch0) return await abort('workspaceChanged')
    flushOpenEditors()
    const s = useWorkspace.getState()
    if (flips(plan, s).length || removalsInUse(plan, s) || staleFacts(plan, s, input.pins)) return await abort('replan')
    const patch = targetsFor(plan, s, input.pins, PLAN_FNS)
    pre = preOf(s, patch)
    const t0 = performance.now()
    const ok = withWriter(w, () => withRestoring(() => s.applyRewind(patch, 'eject')))
    try {
      performance.measure('rec-eject', { start: t0, end: performance.now() })
    } catch {
      /* no marks */
    }
    if (!ok) return await abort('writeRefused')
    const after = useWorkspace.getState()
    for (const x of plan.places) {
      if (!BACK.has(x.outcome)) continue
      post.set(x.p, decidedKey(objectIn(after, x.p), x))
      // a page it took out of the trash: what lives below it now (the Undo puts it back only with nothing newer there)
      if (x.p.startsWith('p:') && s.pages[x.p.slice(2)]?.trashed && !after.pages[x.p.slice(2)]?.trashed) below.set(x.p.slice(2), livePagesBelow(after.pages, x.p.slice(2)))
    }
  } finally {
    endRun(w)
  }
  // the test hook: a commit that dies here (a boot finishes it) or waits here (a second tab boots meanwhile)
  if (ejectHook.at === 'afterWrite') return { ok: true, record }
  if (ejectHook.at === 'beforeSettle') await holdAt()
  // 4. the sources, then the record
  const by = new Map(plan.places.map((x) => [x.p, x.by[0]]))
  const settled = await settle(record, (p) => by.get(p))
  const done: EjectRecord = { ...record, state: 'done', ...(settled.agent ? { agent: settled.agent } : {}), ...(settled.slips ? { slips: settled.slips } : {}) }
  await putEject(done)
  undoMemory.set(ejectId, { record: done, plan, pre: pre!, post, below, scope0, epoch0, states: settled.states })
  return { ok: true, record: done }
}
