/**
 * VERBRAUCH on Start (Regler § 10.3), registered from install.ts through Preflight's dependency-free registry: fitted
 * while a budget exists (the workspace's or this browser's own line), read O(1) from the totals the tab keeps, the
 * paused rows and what waits at the line (marks.ts) — no ledger read, no Claude call. Its level comes from the reading
 * (amber at 75 % never lights MASTER CAUTION; red at the line does — `master` per reading). Ticks every minute; Open →
 * the Regler (#/regler from B10; until then the workspace page).
 */
import { registerLampSource } from '../preflight/registry'
import { useWorkspace } from '../../store/store'
import { currentLang, t } from '../../i18n'
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import { readUsageLamp } from './lamp'
import { hasLimit, limitsOf, type Limits } from './limits'
import { deviceLimitOf } from './device'
import { totalsNow, useGovernorTotals } from './totals'
import { heldToday, useGovernorMarks } from './marks'
import { onLineChange, pausedRows } from './background'
import { fmtOf } from './format'
import { dayOf } from './clock'

const limitsNow = (): Limits => limitsOf(useWorkspace.getState().governor, deviceLimitOf())

/** A budget exists here (the workspace's or this browser's own line) — what the coding worker's cost line says about. */
export const budgetSet = (): boolean => hasLimit(limitsNow())

/** The Regler's screen (B10: #/regler); a dialog, the palette and the phone drawer close first. */
export function openRegler(): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace' })
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
