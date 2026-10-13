/**
 * Workspace page § 07 — AI: what the workspace allows its AI. In G1 only the Regler's § 06 "Budget & governor"
 * (features/governor BudgetSlot, lazy: the day / month budget, measured on each device); the AI slice S5 brings §§ 01–05
 * (providers, data rules, routes …) around it. This device's own AI settings stay in Settings › AI.
 */
import { Suspense } from 'react'
import { BudgetSlot } from '../../features'
import { useT } from '../../i18n'
import { SectionHead } from './parts'

export function AISection() {
  const t = useT()
  return (
    <>
      <SectionHead n="07" title={t('shell.ws.sec.ai')} lead={t('shell.ws.ai.lead')} help="ai-costs" />
      <Suspense fallback={null}>
        <BudgetSlot />
      </Suspense>
    </>
  )
}
