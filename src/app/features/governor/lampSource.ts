/**
 * VERBRAUCH on Start (Regler § 10.3), registered from install.ts through Preflight's dependency-free registry: fitted
 * while a budget exists (the workspace's or this browser's own line), read O(1) from the totals the tab keeps, the
 * paused rows and what waits at the line (marks.ts) — no ledger read, no Claude call. Its level comes from the reading
 * (amber at 75 % never lights MASTER CAUTION; red at the line does — `master` per reading). Ticks every minute; Open →
 * the Regler (#/regler).
 */
import { registerLampSource } from '../preflight/registry'
import { useWorkspace } from '../../store/store'
import { currentLang, t } from '../../i18n'
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import { readUsageLamp, usageLine } from './lamp'
import { hasLimit, limitsOf, lineOf, restOf, type Binding, type Limits } from './limits'
import { deviceLimitOf } from './device'
import { totalsNow, useGovernorTotals } from './totals'
import { heldToday, useGovernorMarks } from './marks'
import { onLineChange, pausedRows } from './background'
import { fmtOf } from './format'
import { dayOf } from './clock'

const limitsNow = (): Limits => limitsOf(useWorkspace.getState().governor, deviceLimitOf())

/** A budget exists here (the workspace's or this browser's own line) — what the coding worker's cost line says about. */
export const budgetSet = (): boolean => hasLimit(limitsNow())

/** The line nearest its limit now (a run's end stores it: the run row's "Governor today … · rest …"); null: no line. */
export function reglerLine(): { binding: 'day' | 'month' | 'device-day' | 'device-month'; spent: number; limit: number } | null {
  const line = usageLine(limitsNow(), totalsNow())
  return line ? { binding: line.binding, spent: Math.round(line.spent * 10_000) / 10_000, limit: line.limit } : null
}

/**
 * The rest before a person starts a job of several requests (the autofill panel's band against it, § 5.7): the lowest
 * rest of every line set now, the line that binds and its spend / limit (the mini bar). null: no line set.
 */
export function reglerRest(): { rest: number; binding: Binding; spent: number; limit: number } | null {
  const l = limitsNow()
  if (!hasLimit(l)) return null
  const t = totalsNow()
  const r = restOf(l, t)
  const binding = r.binding ?? 'day'
  const line = lineOf(l, t, binding)
  return { rest: Math.max(0, Math.min(r.day, r.month)), binding, spent: line.spent, limit: line.limit }
}

/** The Regler's screen (#/regler); a dialog, the palette and the phone drawer close first. */
export function openRegler(): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'regler' })
}

/** The budgets: Workspace › AI § 06 (the person's own line for this browser sits in Settings › AI). */
export function openBudgets(): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace', section: 'ai' })
}

export function registerUsageLamp(): void {
  registerLampSource({
    id: 'governor',
    order: 88,
    legend: () => t('features.governor.lamp.legend'),
    short: () => t('features.governor.lamp.short'),
    rule: () => t('features.governor.lamp.rule'),
    thresholds: { amber: null, red: null },
    master: false,
    fitted: () => hasLimit(limitsNow()),
    subscribe: (changed) => {
      const a = onLineChange(changed)
      const b = useGovernorTotals.subscribe(changed)
      const c = useGovernorMarks.subscribe(changed)
      return () => {
        a()
        b()
        c()
      }
    },
    read: () => {
      const now = Date.now()
      const lang = currentLang()
      return readUsageLamp({
        day: dayOf(now),
        limits: limitsNow(),
        totals: totalsNow(now),
        held: heldToday(now),
        paused: pausedRows().rows,
        halts: useGovernorMarks.getState().halts,
        second: (spent, limit) => fmtOf(spent, limit, lang),
      })
    },
    tick: true,
    open: openRegler,
  })
}
