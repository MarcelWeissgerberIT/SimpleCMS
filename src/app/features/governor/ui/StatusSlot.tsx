/**
 * The REGLER cell wired (Regler § 10.2; a lazy chunk — statusGate.tsx renders it while a budget exists): the limits (the workspace's budget, this browser's own line), the totals the tab
 * keeps (useGovernorTotals — "—" until the day was read after the first paint) and what waits at the line (a terminal
 * task at its halt card → ROTLINIE · PAUSE). Shown only while a budget exists: without one nothing reads the ledger at
 * boot and the cell would only say "—" (the usage without a budget lives on #/regler, B10). Click → the Regler.
 */
import { useSyncExternalStore } from 'react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { fmtLimit } from '../format'
import { useWorkspace } from '../../../store/store'
import { deviceLimitOf } from '../device'
import { deviceSnapshot, subscribeDevice } from '../statusGate'
import { hasLimit, limitsOf } from '../limits'
import { usageLine } from '../lamp'
import { useGovernorTotals } from '../totals'
import { useGovernorMarks } from '../marks'
import { openRegler } from '../lampSource'
import { StatusCell } from './StatusCell'

export function GovernorStatusCell() {
  const governor = useWorkspace((s) => s.governor)
  // the device stamp moves settings.ai when this tab writes its own line
  useWorkspace((s) => s.settings.ai)
  const device = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => '')
  const totals = useGovernorTotals()
  const halted = useGovernorMarks((s) => s.halts.length > 0)
  const limits = limitsOf(governor, device ? deviceLimitOf() : undefined)
  if (!hasLimit(limits)) return null
  const line = usageLine(limits, {
    scope: { spentToday: totals.spentToday, spentMonth: totals.spentMonth, unpricedToday: totals.unpricedToday },
    device: { spentToday: totals.deviceToday, spentMonth: totals.deviceMonth, scopes: [] },
  })
  return <StatusCell spent={totals.known && line ? line.spent : null} limit={line?.limit ?? null} state={halted ? 'pause' : 'ok'} onOpen={openRegler} />
}

/** The terminal's /cost: the line that binds today, with the rest ("Governor: today $5.71 of $6.00 · rest $0.29"). */
export function ReglerRestLine() {
  const t = useT()
  const lang = useLang()
  const governor = useWorkspace((s) => s.governor)
  const device = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => '')
  const totals = useGovernorTotals()
  const limits = limitsOf(governor, device ? deviceLimitOf() : undefined)
  if (!hasLimit(limits)) return null
  const line = usageLine(limits, {
    scope: { spentToday: totals.spentToday, spentMonth: totals.spentMonth, unpricedToday: totals.unpricedToday },
    device: { spentToday: totals.deviceToday, spentMonth: totals.deviceMonth, scopes: [] },
  })
  if (!line) return null
  return (
    <p className="term-echo__note" data-testid="term-cost-regler">
      {t('features.governor.cost.rest', { spent: fmtUsd(line.spent, lang), limit: fmtLimit(line.limit, lang), rest: fmtUsd(Math.max(0, line.limit - line.spent), lang) })}
    </p>
  )
}
