/**
 * The eject's bookkeeping per source (design §6.6, Δ29): which of W's changes went back with their places, what the
 * dialog says about the sources (open proposals, cards opened in Preflight, coding tasks, the folder / GitHub sync,
 * Outbox slips, reviews this device no longer holds), and the settle / unsettle that keep every review in step with
 * the store — agent runs (review.ts; the caller holds the agent's run lock), the terminal's batches, MCP activity,
 * script runs. Every in-memory Undo of a settled change is told first (settled.ts) and last on the way back.
 *
 * A unit is one staged change of an agent run or a terminal batch (`<runKey>#<change>` — change ids are per run; the
 * changes ONE write carried are a unit each on the same places, so they go or stay together) or a whole MCP call /
 * script run (its run key). A unit is ejected when every place it touched in the window went back (or
 * had gone back already) and at least one went back now; it comes back only when every place it took back came back.
 * Ids, counts and states only — never text.
 */
import type { ID } from '../../../store/types'
import type { CoreInput, Plan } from '../model/plan'
import { changeIds, runKindOf } from '../model/writerKeys'
import type { EjectRecord, LaneKey, Outcome, PlaceKey, WindowSel } from '../model/types'
import type { WindowData } from '../window/load'
import { markSettled, unmarkSettled } from '../settled'

const BACK: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore'])
/** places that leave a unit ejected: back now, back before (an earlier eject), or nothing to take back */
const DONE: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore', 'already', 'skip'])

/** The agent of a window (its lane or run is an agent's), else null. */
export function agentOf(sel: Pick<WindowSel, 'lane' | 'run'>): ID | null {
  const key = sel.run ?? sel.lane
  if (!key.startsWith('agent:')) return null
  return key.split(':')[1] || null
}

/** A unit as its run key and change (no change: the whole run). */
export function splitUnit(u: string): { runKey: string; change?: string } {
  const i = u.indexOf('#')
  return i < 0 ? { runKey: u } : { runKey: u.slice(0, i), change: u.slice(i + 1) }
}

/** Per place: the units of W's events on it in the window (record field `changes`, Δ29). */
export function changeMap(data: Pick<WindowData, 'sel' | 'places'>, plan: Pick<Plan, 'places'>): Record<PlaceKey, string[]> {
  const { a, b } = data.sel
  const out: Record<PlaceKey, string[]> = {}
  for (const x of plan.places) {
    const w = data.places.get(x.p)
    if (!w) continue
    const set = new Set<string>()
    for (const e of w.ownEvents) {
      if (e.at < a || e.at >= b || !e.r) continue
      const kind = runKindOf(e.r)
      if (kind === 'agent' || kind === 'terminal') {
        // '*': a write of more changes than its key could name — the plan holds its place (never a unit)
        for (const c of changeIds(e.c)) if (c !== '*') set.add(`${e.r}#${c}`)
      } else if (kind === 'mcp' || kind === 'script') set.add(e.r)
    }
    if (set.size) out[x.p] = [...set].sort()
  }
  return out
}

export interface UnitFates {
  ejected: string[]
  /** units a held place keeps applied: who changed that place since, and when */
  held: Array<{ unit: string; by: string; at: number }>
}

/** Which units went back and which a held place keeps. */
export function unitFates(changes: Record<PlaceKey, string[]>, outcomes: Record<PlaceKey, Outcome>, byOf: (p: PlaceKey) => { lane: LaneKey | null; at: number } | undefined): UnitFates {
  const places = new Map<string, PlaceKey[]>()
  for (const [p, units] of Object.entries(changes) as Array<[PlaceKey, string[]]>) for (const u of units) (places.get(u) ?? places.set(u, []).get(u)!).push(p)
  const out: UnitFates = { ejected: [], held: [] }
  for (const [u, ps] of places) {
    const outs = ps.map((p) => outcomes[p])
    if (outs.every((o) => DONE.has(o)) && outs.some((o) => BACK.has(o))) out.ejected.push(u)
    else {
      const p = ps.find((x) => outcomes[x] === 'held')
      if (!p) continue
      const by = byOf(p)
      out.held.push({ unit: u, by: by?.lane ?? '-', at: by?.at ?? 0 })
    }
  }
  out.ejected.sort()
  return out
}

/** Units grouped by run key (change ids; a whole-run unit has none). */
function byRun(units: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const u of units) {
    const { runKey, change } = splitUnit(u)
    const list = m.get(runKey) ?? m.set(runKey, []).get(runKey)!
    if (change) list.push(change)
  }
  return m
}

/** The outcomes of a plan, by place. */
export const outcomesOf = (plan: Pick<Plan, 'places'>): Record<PlaceKey, Outcome> => Object.fromEntries(plan.places.map((x) => [x.p, x.outcome])) as Record<PlaceKey, Outcome>

const fatesOfPlan = (data: WindowData, plan: Plan): UnitFates => {
  const by = new Map(plan.places.map((x) => [x.p, x.by[0]]))
  return unitFates(changeMap(data, plan), outcomesOf(plan), (p) => by.get(p))
}

/* ------------------------------------------------------------------ */
/* what the dialog says                                                */
/* ------------------------------------------------------------------ */

export interface EjectFacts {
  /** W's agent and its runs in the window (found: the run's review is on this device) */
  agent: { agentId: ID; runs: Array<{ id: string; found: boolean }> } | null
  /** open proposals the switch "discard the run's open proposals" discards */
  pending: number
  /** open proposals that stay whatever the switch says: opened in Preflight (or Preflight cannot tell yet) */
  opened: number
  /** Outbox slips withdrawn with the proposals discarded: always (they build on an ejected change) · with the switch */
  slips: { always: number; pending: number }
  /** other open slips on rows that go back (their CHANGED marker shows by itself) */
  slipsChanged: number
  /** a run's review is not on this device (gone, another tab's terminal batch, before a reload): only the places go back */
  reviewGone: boolean
  /** pipeline tasks whose text goes back with an agent's stamp: they wait for Confirm */
  codingConfirm: number
  /** the folder / GitHub sync is on and pages go back: their files are written again */
  syncWriteBack: boolean
}

type Opened = (runId: string, changeId: string) => boolean | null

/** Preflight's word on a card: opened (true), not (false), cannot tell yet or no Preflight (null). */
async function openedFn(): Promise<Opened> {
  const { supersedeGuard } = await import('../../agents')
  const g = supersedeGuard()
  return (runId, changeId) => (g ? g(runId, changeId) : null)
}

/** What the eject dialog shows about the sources of a planned eject. */
export async function facts(planned: { plan: Plan; input: CoreInput }): Promise<EjectFacts> {
  const { plan, input } = planned
  const data = input.data
  const fates = fatesOfPlan(data, plan)
  const out: EjectFacts = { agent: null, pending: 0, opened: 0, slips: { always: 0, pending: 0 }, slipsChanged: 0, reviewGone: false, codingConfirm: 0, syncWriteBack: false }
  const ejected = byRun(fates.ejected)
  const agentId = agentOf(data.sel)
  const runs = Object.values(data.runs)
  const sendSlips: string[] = []
  const pendingSlips: string[] = []
  if (agentId) {
    const { loadAgentRuns } = await import('../../agents')
    const { depsOf } = await import('../../ai/agent/types')
    const stored = await loadAgentRuns(agentId)
    const opened = await openedFn()
    out.agent = { agentId, runs: [] }
    for (const r of runs) {
      if (r.kind !== 'agent') continue
      const cur = stored.find((x) => x.id === r.ref)
      out.agent.runs.push({ id: r.ref, found: !!cur })
      if (!cur) {
        out.reviewGone = true
        continue
      }
      const out1 = new Set(ejected.get(r.key) ?? [])
      const all = cur.staged ?? []
      const open = (s: string) => s === 'pending' || s === 'failed'
      // open proposals that build on an ejected one go with it (whatever the switch says)
      const deps = new Set<string>()
      for (let grew = true; grew; ) {
        grew = false
        for (const c of all) {
          if (deps.has(c.id) || !open(c.status) || !depsOf(c).some((d) => out1.has(d) || deps.has(d))) continue
          deps.add(c.id)
          grew = true
        }
      }
      for (const c of all) {
        if (!open(c.status)) continue
        const slip = c.send?.slipId
        if (deps.has(c.id)) {
          if (slip) sendSlips.push(slip)
          continue
        }
        if (opened(cur.id, c.id) === false) {
          out.pending++
          if (slip) pendingSlips.push(slip)
        } else out.opened++
      }
    }
  }
  // the terminal: a batch not in this tab has no review here to settle
  if (runs.some((r) => r.kind === 'terminal')) {
    const { batchFacts } = await import('../../ai/agent/session')
    if (runs.some((r) => r.kind === 'terminal' && !batchFacts(r.ref))) out.reviewGone = true
  }
  // slips: the ones the eject would withdraw, the others on rows that go back
  const back = plan.places.filter((x) => BACK.has(x.outcome) && x.p.startsWith('p:'))
  const backRows = back.filter((x) => x.pk === 'row')
  if (sendSlips.length || pendingSlips.length || backRows.length) {
    const { getSlips } = await import('../../outbox')
    const live = new Map(getSlips().map((s) => [s.id, s.state]))
    const withdrawable = (id: string) => {
      const st = live.get(id)
      return !!st && st !== 'withdrawn' && st !== 'sent' && st !== 'confirmed' && st !== 'unconfirmed'
    }
    out.slips = { always: sendSlips.filter(withdrawable).length, pending: pendingSlips.filter(withdrawable).length }
    const mine = new Set([...sendSlips, ...pendingSlips])
    for (const x of backRows) out.slipsChanged += getSlips({ rowId: x.p.slice(2) }).filter((s) => !mine.has(s.id) && withdrawable(s.id)).length
  }
  out.codingConfirm = backRows.filter((x) => x.build?.kind === 'page' && !!x.build.stamp).length
  if (back.some((x) => x.pk === 'page' || x.pk === 'db' || x.pk === 'row')) {
    const { useSync } = await import('../../sync')
    const s = useSync.getState()
    const on = (st: string) => st !== 'off' && st !== 'unsupported'
    out.syncWriteBack = on(s.folder.state) || on(s.github.state)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* settle / unsettle                                                   */
/* ------------------------------------------------------------------ */

/** What a settle did that the record keeps (ids and counts) — and, in memory, the agent states it put back. */
export interface Settled {
  agent?: NonNullable<EjectRecord['agent']>
  slips: number
  /** per agent run: the state stateBack wrote and the one it replaced (memory only — states hold text) */
  states: Map<string, unknown>
}

/** The kind and source ref of a run key (`agent:<agent>:<run>` → the AgentRun id …). */
const refOf = (runKey: string): string => {
  const [, a = '-', b = '-'] = runKey.split(':')
  return runKindOf(runKey) === 'terminal' ? a : b
}

/**
 * Settle the sources of a written eject — from its record alone (a boot finishes a crashed commit with it): every
 * settled change is marked first (the Undo closures in this tab and the others leave it alone), then the reviews
 * follow — agent runs (ejected → discarded + ejected, held stay applied + held, open proposals as the switch said,
 * their Outbox slips withdrawn), the terminal's batches, MCP calls, script runs. `byOf`: who changed a held place since
 * (the plan knows; a boot does not). The caller holds the agent's run lock (agent W).
 */
export async function settle(record: Pick<EjectRecord, 'id' | 'at' | 'lane' | 'writer' | 'changes' | 'outcomes' | 'runs' | 'pending'>, byOf: (p: PlaceKey) => { lane: LaneKey | null; at: number } | undefined = () => undefined): Promise<Settled> {
  const fates = unitFates(record.changes, record.outcomes, byOf)
  const ejected = byRun(fates.ejected)
  const held = new Map<string, Array<{ id: string; by: string; at: number }>>()
  for (const h of fates.held) {
    const { runKey, change } = splitUnit(h.unit)
    if (change) (held.get(runKey) ?? held.set(runKey, []).get(runKey)!).push({ id: change, by: h.by, at: h.at })
  }
  const out: Settled = { slips: 0, states: new Map() }
  // 1. the marks: every in-memory Undo of these changes leaves them alone from now on
  for (const [runKey, ids] of ejected) markSettled(runKey, ids, record.id)
  const runs = [...new Set([...(record.runs ?? []), ...ejected.keys()])]
  // 2. agent runs (the caller holds the run lock)
  const agentId = agentOf({ lane: record.lane, run: record.writer })
  const agentRuns = runs.filter((k) => runKindOf(k) === 'agent' && k.split(':')[1] === agentId)
  if (agentId && agentRuns.length) {
    const { loadAgentRuns, settleEjected } = await import('../../agents')
    const opened = await openedFn()
    const stored = await loadAgentRuns(agentId)
    const agent: NonNullable<EjectRecord['agent']> = { agentId, runIds: [], discarded: [] }
    const slips: string[] = []
    for (const key of agentRuns) {
      const cur = stored.find((x) => x.id === refOf(key))
      if (!cur) continue
      const res = await settleEjected(cur, { ejected: ejected.get(key) ?? [], held: held.get(key) ?? [], ejectId: record.id, at: record.at, discardPending: !!record.pending, opened })
      agent.runIds.push(cur.id)
      agent.discarded.push(...res.discarded.map((c) => `${key}#${c}`))
      slips.push(...res.slips)
      if (res.state) {
        out.states.set(cur.id, res.state)
        agent.stateBefore = { runId: res.state.replaced.runId, at: res.state.replaced.at }
        agent.stateAfter = res.state.wrote ? { runId: res.state.wrote.runId, at: res.state.wrote.at } : null
      }
    }
    out.agent = agent
    // the slips of `send` proposals it discarded: withdrawn through the Outbox (a sent one answers too-late and stays)
    if (slips.length) {
      const { withdrawSlip } = await import('../../outbox')
      for (const id of slips) if ((await withdrawSlip(id, 'origin').catch(() => 'gone')) === 'withdrawn') out.slips++
    }
  }
  // 3. the terminal's batches (this tab's; another tab's follow the mark)
  const terminal = runs.filter((k) => runKindOf(k) === 'terminal')
  if (terminal.length) {
    const { ejectBatch } = await import('../../ai/agent/session')
    for (const key of terminal) ejectBatch(refOf(key), ejected.get(key) ?? [], (held.get(key) ?? []).map((h) => h.id), { id: record.id, at: record.at })
  }
  // 4. MCP calls and script runs: the whole run
  for (const [runKey] of ejected) {
    const kind = runKindOf(runKey)
    const [, a, b] = runKey.split(':')
    if (kind === 'mcp') {
      const { settleMcpCall } = await import('../../mcp')
      settleMcpCall(a, b, record.id)
    } else if (kind === 'script' && a && a !== '-') {
      const { settleScriptRun } = await import('../../script')
      await settleScriptRun(a, b).catch(() => false)
    }
  }
  return out
}

/**
 * The eject's Undo gave places back (`back`): the units whose every ejected place came back are applied again — agent
 * runs (the proposals it discarded open again, the agent state forward while it is still the one the eject put back),
 * the terminal's batches, MCP calls, script runs — and their marks go last. The caller holds the agent's run lock.
 */
export async function unsettle(record: EjectRecord, back: ReadonlySet<PlaceKey>, states?: Map<string, unknown>): Promise<void> {
  const fates = unitFates(record.changes, record.outcomes, () => undefined)
  // a unit comes back only when every place it took back came back
  const placesOf = new Map<string, PlaceKey[]>()
  for (const [p, units] of Object.entries(record.changes) as Array<[PlaceKey, string[]]>) for (const u of units) if (BACK.has(record.outcomes[p])) (placesOf.get(u) ?? placesOf.set(u, []).get(u)!).push(p)
  const again = fates.ejected.filter((u) => (placesOf.get(u) ?? []).every((p) => back.has(p)))
  const returning = byRun(again)
  const discarded = byRun(record.agent?.discarded ?? [])
  // agent runs
  if (record.agent?.runIds.length) {
    const { loadAgentRuns, unsettleEjected } = await import('../../agents')
    const stored = await loadAgentRuns(record.agent.agentId)
    for (const runId of record.agent.runIds) {
      const cur = stored.find((x) => x.id === runId)
      if (!cur) continue
      const runKey = `agent:${record.agent.agentId}:${runId}`
      const state = states?.get(runId) as Parameters<typeof unsettleEjected>[4]
      await unsettleEjected(cur, record.id, returning.get(runKey) ?? [], discarded.get(runKey) ?? [], state ?? null)
    }
  }
  for (const [runKey, ids] of returning) {
    const kind = runKindOf(runKey)
    const [, a, b] = runKey.split(':')
    if (kind === 'terminal') {
      const { unejectBatch } = await import('../../ai/agent/session')
      unejectBatch(a, record.id, ids)
    } else if (kind === 'mcp') {
      const { unsettleMcpCall } = await import('../../mcp')
      unsettleMcpCall(a, b, record.id)
    } else if (kind === 'script' && a && a !== '-') {
      const { unsettleScriptRun } = await import('../../script')
      await unsettleScriptRun(a, b).catch(() => undefined)
    }
  }
  // the marks go last: nothing writes old values over the places until the reviews say "applied" again
  for (const [runKey, ids] of returning) unmarkSettled(runKey, ids, record.id)
}

/** The run keys and change ids an eject settled (the seam, the specs). */
export function settledUnits(record: Pick<EjectRecord, 'changes' | 'outcomes'>): string[] {
  return unitFates(record.changes, record.outcomes, () => undefined).ejected
}
