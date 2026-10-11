/**
 * What the UI reads of Preflight (zustand, tab memory). The engine (engine.ts) is the only writer: it sets a view only
 * when it differs, so a cap re-renders only when its own lamp changed and the topbar key only when `mc` / `lit` did.
 */
import { create } from 'zustand'
import type { LampId } from './registry'
import { readPrefs } from './prefs'
import type { LastCache, LampView, TodayRecord } from './types'

export interface PreflightState {
  /** this device's preference "Preflight on Start" */
  on: boolean
  /** the member scope ('local:local' | 'cloud:<ws>:u:<account>'); null = not known yet */
  scope: string | null
  /** every fitted lamp was read once in this scope */
  ready: boolean
  /** the lamps on the panel, in order (≤ 16) */
  views: LampView[]
  /** fitted lamps past 16 (listed in the rule card) */
  overflow: LampId[]
  /** lamps hidden on this device (the head says "n hidden") */
  hidden: number
  /** lamps lit (amber / red) */
  lit: number
  /** MASTER CAUTION: lamps new and counting for it */
  mc: number
  /** the sum of the lit lamps' counts (read-out "Open") */
  open: number
  /** lamps new now */
  newIds: LampId[]
  /** the lamp test's phase (§5.6) */
  testing: 'off' | 'phase1' | 'phase2'
  /** when the plate last changed (the head's time): the lamp test, a lamp lighting or going dark */
  lastChange: number
  /** the Preflight day of this member on this device */
  today: TodayRecord
  /** the lit lamps when last counted (drawn before `ready`) */
  last: LastCache | null
  /** the newest acknowledgement on this device (read-out "Acknowledged") */
  ackedAt: number | null
}

export const usePreflight = create<PreflightState>()(() => ({
  // this device's preference from the first render on (no flash of Home's own line when it is off)
  on: readPrefs().on,
  scope: null,
  ready: false,
  views: [],
  overflow: [],
  hidden: 0,
  lit: 0,
  mc: 0,
  open: 0,
  newIds: [],
  testing: 'off',
  lastChange: 0,
  today: { day: '', base: [] },
  last: null,
  ackedAt: null,
}))
