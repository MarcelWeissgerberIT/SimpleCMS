/**
 * The built-in lamps (§6 of the design): registered once from startPreflight. Other areas register their own lamps
 * from their boot modules (the Outbox: features/outbox/lamp.ts).
 *  - registerBuiltIns(): idempotent
 *  - startSourceServices(): the lamps' background reads while Preflight is on (the own server agents' open runs,
 *    polled only while the tab is visible) — returns the stop
 */
import { startOpenServerPoll } from '../../agents'
import { ensureRunsLoaded } from '../../ai/runs'
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
  return startOpenServerPoll()
}
