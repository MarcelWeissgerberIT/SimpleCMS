/**
 * The eager part of the REGLER cell and the terminal's /cost rest line: they render only while a budget exists (the
 * workspace's or this browser's own line); the cell itself (StatusCell, the mini bar, the totals' wiring) is a lazy
 * chunk — loaded the first time a budget is there, never for people without one.
 */
import { lazy, Suspense, useSyncExternalStore } from 'react'
import { useWorkspace } from '../../store/store'
import { deviceLimitOf, onDeviceLine } from './device'
import { hasLimit, limitsOf } from './limits'

const Cell = lazy(() => import('./ui/StatusSlot').then((m) => ({ default: m.GovernorStatusCell })))
const Rest = lazy(() => import('./ui/StatusSlot').then((m) => ({ default: m.ReglerRestLine })))

/** This browser's own line, re-read when this tab or another one writes it. */
export const subscribeDevice = (changed: () => void): (() => void) => onDeviceLine(changed)
export const deviceSnapshot = (): string => {
  const d = deviceLimitOf()
  return d ? JSON.stringify(d) : ''
}

/** A budget exists here (re-rendered when it changes). */
function useBudgetSet(): boolean {
  const governor = useWorkspace((s) => s.governor)
  // the device stamp moves settings.ai when this tab writes its own line
  useWorkspace((s) => s.settings.ai)
  const device = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => '')
  return hasLimit(limitsOf(governor, device ? deviceLimitOf() : undefined))
}

export function GovernorStatusCell() {
  if (!useBudgetSet()) return null
  return (
    <Suspense fallback={null}>
      <Cell />
    </Suspense>
  )
}

export function ReglerRestLine() {
  if (!useBudgetSet()) return null
  return (
    <Suspense fallback={null}>
      <Rest />
    </Suspense>
  )
}
