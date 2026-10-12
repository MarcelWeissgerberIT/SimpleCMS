/**
 * Limits and rests (Regler § 5.1) — pure. Two lines, each with a day and a month:
 *  - the workspace's (Workspace.governor), against this workspace's spend on this device;
 *  - the person's own (one.governor.device), against every workspace of this browser (owner decision 1).
 * A request must fit both; a run also its own budget (an agent's maxRunUsd). Open reservations count as spent — here and in
 * the other tabs — except the caller's own (what this request or run may spend is not spent, and never counted twice).
 * An allowance (E) lifts the day and month rests for the request or task it was given to. Infinity = no limit.
 */
import { isReadableDeviceGovernor, isReadableGovernor, type DeviceGovernor, type WorkspaceGovernor } from '@/shared/ai/governor'
import type { Unreadable } from '@/shared/ai/route'
import type { Band } from './estimate'
import type { TotalsNow } from './totals'

export interface Limits {
  /** this workspace, measured on this device */
  ws: { day: number | null; month: number | null }
  /** the person's line for this browser */
  device: { day: number | null; month: number | null }
}

export const NO_LIMITS: Limits = { ws: { day: null, month: null }, device: { day: null, month: null } }

/** The limits in force (a value this build cannot read limits nothing here — its generation stamp refuses AI instead). */
export function limitsOf(ws?: WorkspaceGovernor | Unreadable | null, dev?: DeviceGovernor | Unreadable | null): Limits {
  const w = isReadableGovernor(ws) ? ws : undefined
  const d = isReadableDeviceGovernor(dev) ? dev : undefined
  return { ws: { day: w?.day ?? null, month: w?.month ?? null }, device: { day: d?.day ?? null, month: d?.month ?? null } }
}

/** Is any line set? (none: the brake is the identity — slice 1's behaviour, bodies unchanged) */
export const hasLimit = (l: Limits): boolean => [l.ws.day, l.ws.month, l.device.day, l.device.month].some((x) => x !== null)
export const hasMonthLimit = (l: Limits): boolean => l.ws.month !== null || l.device.month !== null

export type Binding = 'day' | 'month' | 'device-day' | 'device-month' | 'run'

export interface Rest {
  day: number
  month: number
  run: number
  /** the line with the lowest rest (null: no limit at all) */
  binding: Binding | null
}

/** What the rests are computed from (totals.ts TotalsNow, or a spec's own). */
export type TotalsLike = Pick<TotalsNow, 'scopeId' | 'scope' | 'device' | 'reserved'>

export interface OwnPart {
  /** the caller's own open reservation: never counted in any reserved sum */
  reservation?: string | null
  /** a run's own budget and what it spent so far */
  run?: { budget: number; spent: number } | null
}

/** The rests now (§ 5.1). */
export function restOf(l: Limits, t: TotalsLike, own: OwnPart = {}, allowance = 0): Rest {
  const except = own.reservation ?? undefined
  const a = Number.isFinite(allowance) && allowance > 0 ? allowance : 0
  const here = t.scopeId ? t.reserved(t.scopeId, except) : 0
  const all = t.reserved(undefined, except)
  const lines: Array<[Binding, number]> = []
  if (l.ws.day !== null) lines.push(['day', l.ws.day - t.scope.spentToday - here + a])
  if (l.device.day !== null) lines.push(['device-day', l.device.day - t.device.spentToday - all + a])
  if (l.ws.month !== null) lines.push(['month', l.ws.month - t.scope.spentMonth - here + a])
  if (l.device.month !== null) lines.push(['device-month', l.device.month - t.device.spentMonth - all + a])
  if (own.run && Number.isFinite(own.run.budget)) lines.push(['run', own.run.budget - own.run.spent])
  const min = (kinds: Binding[]) => Math.min(Infinity, ...lines.filter(([k]) => kinds.includes(k)).map(([, v]) => v))
  let binding: Binding | null = null
  let low = Infinity
  for (const [k, v] of lines)
    if (v < low) {
      low = v
      binding = k
    }
  return { day: min(['day', 'device-day']), month: min(['month', 'device-month']), run: min(['run']), binding }
}

/** The lowest rest (Infinity: none). */
export const restMin = (r: Rest): number => Math.min(r.day, r.month, r.run)

/** Does a band fit the rests? 'noprice': no band while a limit exists (no price + any limit = refused). */
export function fits(band: Band | null, rest: Rest): 'yes' | 'no' | 'noprice' {
  const low = restMin(rest)
  if (low === Infinity) return 'yes'
  if (!band) return 'noprice'
  return band.high <= low ? 'yes' : 'no'
}

/** The binding line's spend and limit (the halt card's "Heute 5,71 $ von 6,00 $"). */
export function lineOf(l: Limits, t: TotalsLike, binding: Binding, run?: { budget: number; spent: number } | null): { spent: number; limit: number } {
  switch (binding) {
    case 'day':
      return { spent: t.scope.spentToday, limit: l.ws.day ?? Infinity }
    case 'month':
      return { spent: t.scope.spentMonth, limit: l.ws.month ?? Infinity }
    case 'device-day':
      return { spent: t.device.spentToday, limit: l.device.day ?? Infinity }
    case 'device-month':
      return { spent: t.device.spentMonth, limit: l.device.month ?? Infinity }
    case 'run':
      return { spent: run?.spent ?? 0, limit: run?.budget ?? Infinity }
  }
}
