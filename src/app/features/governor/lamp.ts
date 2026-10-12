/**
 * The Preflight lamp VERBRAUCH (Regler § 10.3) — its reading, pure (Node specs load it). O(1) over the totals the tab
 * keeps plus the day's holds, paused rows and open halt cards; no ledger read, no Claude call, no page-map walk.
 *  - ≥ 75 % of the line nearest its limit: amber, count 1, id `use:<day>:amber`, `master: false` — the dark cockpit: amber
 *    never lights MASTER CAUTION;
 *  - at or over a line — or work waiting at it (an agent held today, autofill rows paused, a terminal task at its halt
 *    card): red, `master: true`, ids `use:<day>:red` (at the line) + `held:<agentId>:<day>` + `paused:<db>:<prop>` (one
 *    per property, not per row) + `halt:<task>` — each acknowledged on its own;
 *  - the ids carry the day, so an acknowledgement holds per band and per day.
 * The registration (registerLampSource: fitted = a limit exists, tick, open → #/regler) follows when the store holds the
 * governor (B9) — from install.ts, so this module stays pure.
 */
import type { LampReading } from '../preflight/registry'
import type { Binding, Limits, TotalsLike } from './limits'

/** amber from this share of a line */
export const AMBER_SHARE = 0.75

export interface UsageLine {
  binding: Exclude<Binding, 'run'>
  spent: number
  limit: number
  /** spent ÷ limit */
  share: number
}

/** The line nearest its limit (highest share; null: no line set). */
export function usageLine(l: Limits, t: Pick<TotalsLike, 'scope' | 'device'>): UsageLine | null {
  const lines: UsageLine[] = []
  const add = (binding: UsageLine['binding'], spent: number, limit: number | null) => {
    if (limit === null || !(limit > 0)) return
    lines.push({ binding, spent: Math.max(0, spent), limit, share: Math.max(0, spent) / limit })
  }
  add('day', t.scope.spentToday, l.ws.day)
  add('device-day', t.device.spentToday, l.device.day)
  add('month', t.scope.spentMonth, l.ws.month)
  add('device-month', t.device.spentMonth, l.device.month)
  let best: UsageLine | null = null
  for (const x of lines) if (!best || x.share > best.share) best = x
  return best
}

export interface UsageLampInput {
  /** the local day ('yyyy-MM-dd') */
  day: string
  limits: Limits
  totals: Pick<TotalsLike, 'scope' | 'device'>
  /** agents with a run held today (their ids) */
  held?: readonly string[]
  /** autofill rows paused at the line (features/governor paused.ts) */
  paused?: ReadonlyArray<{ db: string; prop: string }>
  /** terminal tasks waiting at their halt card (task ids) */
  halts?: readonly string[]
  /** the second line ("4,12/6 $", format.ts fmtOf in the UI's language) */
  second?: (spent: number, limit: number) => string
}

/** The lamp's reading now. */
export function readUsageLamp(i: UsageLampInput): LampReading {
  const line = usageLine(i.limits, i.totals)
  const waiting: string[] = []
  for (const a of new Set(i.held ?? [])) waiting.push(`held:${a}:${i.day}`)
  const props = new Set<string>()
  for (const p of i.paused ?? []) props.add(`paused:${p.db}:${p.prop}`)
  waiting.push(...props)
  for (const h of new Set(i.halts ?? [])) waiting.push(`halt:${h}`)
  const second = line && i.second ? { second: i.second(line.spent, line.limit) } : {}
  const parts = { held: new Set(i.held ?? []).size, paused: props.size, halt: new Set(i.halts ?? []).size }
  const atLine = !!line && line.share >= 1
  if (atLine || waiting.length) {
    const ids = [...(atLine ? [`use:${i.day}:red`] : []), ...waiting]
    return { state: 'ok', count: ids.length, ids, level: 'red', master: true, parts, ...second }
  }
  if (line && line.share >= AMBER_SHARE) return { state: 'ok', count: 1, ids: [`use:${i.day}:amber`], level: 'amber', master: false, ...second }
  return { state: 'ok', count: 0, ids: [], ...second }
}
