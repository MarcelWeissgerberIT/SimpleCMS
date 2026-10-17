/**
 * The built-in lamps (§6 of the design): registered once from startPreflight. Other areas register their own lamps
 * from their boot modules (the Outbox: features/outbox/lamp.ts).
 *  - registerBuiltIns(): idempotent
 *  - startSourceServices(): the lamps' background reads while Preflight is on (the own server agents' open runs,
 *    polled only while the tab is visible) and what Preflight tells the agents area (a card the person opened is never
 *    superseded — unknown until the opened set loaded, then no pass runs; an agent's "has N proposals" toast stays away
 *    while the proposals queue is on screen) — returns the stop
 */
import { catchUpSupersede, onRunsChanged, setProposalsShown, setSupersedeGuard, startOpenServerPoll, useAgentRuns } from '../../agents'
import { appendLog, useLog } from '../log'
import { agentRunsHere, openChangesOf } from './proposals/common'
import { ensureRunsLoaded } from '../../ai/runs'
import { onOpened, openedLoads, openedReady, wasOpened } from '../log'
import { proposalsOnScreen } from '../queue/state'
import { registerLampSource } from '../registry'
import { proposalsLamp } from './proposals'
import { failedLamp, gateLamp, questionLamp } from './coding'
import { ordersLamp } from './orders'
import { permissionLamp } from './permission'
import { inboxLamp } from './inbox'
import { tokenLamp } from './token'
import { workerLamp } from './worker'
import { mirrorLamp, missedLamp } from './agentsHealth'
import { syncLamp } from './sync'
import { mailLamp } from './mail'
import { cloudLamp } from './cloud'

export const BUILT_IN_LAMPS = [proposalsLamp, gateLamp, ordersLamp, tokenLamp, questionLamp, permissionLamp, failedLamp, inboxLamp, workerLamp, mirrorLamp, missedLamp, syncLamp, mailLamp, cloudLamp]

let registered = false

export function registerBuiltIns(): void {
  if (registered) return
  registered = true
  for (const l of BUILT_IN_LAMPS) registerLampSource(l)
}

export function startSourceServices(): () => void {
  // AI-menu results of this device (the sidebar's LED loads them too; once per tab)
  void ensureRunsLoaded().catch(() => {})
  setSupersedeGuard((runId, changeId) => wasOpened(`run:${runId}#${changeId}`))
  setProposalsShown(proposalsOnScreen)
  // the leader's pass was skipped while the opened set was unknown: once it is known, it looks again
  let caught = 0
  const catchUp = () => {
    if (!openedReady() || caught === openedLoads()) return
    caught = openedLoads()
    void catchUpSupersede().catch((e) => console.warn('[one] preflight: superseding could not catch up', e))
  }
  const offOpened = onOpened(catchUp)
  catchUp()
  const stopPoll = startOpenServerPoll()
  const offRuns = noteAgentRuns()
  return () => {
    offOpened()
    offRuns()
    stopPoll()
    setSupersedeGuard(null)
    setProposalsShown(null)
  }
}

/**
 * The Bordbuch notes each agent run of today that brought proposals ("Mirror ran · 4 proposals, replaces 2 older") —
 * once per run (the day's events say which were noted; another tab's notes arrive through the log's channel).
 */
function noteAgentRuns(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const check = () => {
    timer = null
    const { day, events, scope } = useLog.getState()
    if (!scope || !day) return
    const start = new Date(`${day}T00:00:00`).getTime()
    const noted = new Set(events.filter((e) => e.k === 'source').map((e) => (e as { ref: string }).ref))
    for (const { agent, runs } of agentRunsHere()) {
      for (const run of runs) {
        // a run the Regler held keeps its proposals for review too
        if ((run.status !== 'staged' && run.status !== 'held') || run.startedAt < start) continue
        const ref = `${agent.id}/${run.id}`
        if (noted.has(ref)) continue
        const open = openChangesOf(run)
        if (!open.length) continue
        const sup = open.reduce((n, c) => n + (c.supersedes?.length ?? 0), 0)
        appendLog({ at: run.endedAt ?? run.startedAt, k: 'source', lamp: 'proposals', ref, n: open.length, ...(sup ? { sup } : {}) })
        noted.add(ref)
      }
    }
  }
  const soon = () => {
    if (!timer) timer = setTimeout(check, 1500)
  }
  const a = useAgentRuns.subscribe((s, p) => {
    if (s.byAgent !== p.byAgent) soon()
  })
  const b = onRunsChanged(() => soon())
  const c = useLog.subscribe((s, p) => {
    if (s.day !== p.day || s.scope !== p.scope) soon()
  })
  soon()
  return () => {
    a()
    b()
    c()
    if (timer) clearTimeout(timer)
  }
}
