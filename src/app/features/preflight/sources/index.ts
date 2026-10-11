/**
 * The built-in lamps (§6 of the design): registered once from startPreflight. Other areas register their own lamps
 * from their boot modules (the Outbox: features/outbox/lamp.ts).
 *  - registerBuiltIns(): idempotent
 *  - startSourceServices(): the lamps' background reads while Preflight is on (the own server agents' open runs,
 *    polled only while the tab is visible) and what Preflight tells the agents area (a card the person opened is never
 *    superseded — unknown until the opened set loaded, then no pass runs; an agent's "has N proposals" toast stays away
 *    while the proposals queue is on screen) — returns the stop
 */
import { catchUpSupersede, setProposalsShown, setSupersedeGuard, startOpenServerPoll } from '../../agents'
import { ensureRunsLoaded } from '../../ai/runs'
import { onOpened, openedLoads, openedReady, wasOpened } from '../log'
import { proposalsOnScreen } from '../queue/state'
import { registerLampSource } from '../registry'
import { proposalsLamp } from './proposals'
import { failedLamp, gateLamp, questionLamp } from './coding'
import { inboxLamp } from './inbox'
import { tokenLamp } from './token'
import { workerLamp } from './worker'
import { mirrorLamp, missedLamp } from './agentsHealth'
import { syncLamp } from './sync'
import { mailLamp } from './mail'
import { cloudLamp } from './cloud'

export const BUILT_IN_LAMPS = [proposalsLamp, gateLamp, tokenLamp, questionLamp, failedLamp, inboxLamp, workerLamp, mirrorLamp, missedLamp, syncLamp, mailLamp, cloudLamp]

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
  return () => {
    offOpened()
    stopPoll()
    setSupersedeGuard(null)
    setProposalsShown(null)
  }
}
