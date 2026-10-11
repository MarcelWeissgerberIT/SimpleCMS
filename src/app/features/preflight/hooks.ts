/**
 * Preflight's hooks for the shell (through index.ts): is it on, the plate's mode, the numbered Preflight sections
 * above Home's own, and `openPreflight()` (⌘K, MASTER CAUTION with nothing new).
 */
import { useLayoutEffect, useRef } from 'react'
import { navigate, parseHash } from '../../lib/router'
import { planMode } from './lamps'
import { applyModeEffect } from './engine'
import { usePreflight } from './state'
import { useQueue } from './queue/state'
import type { PlateMode } from './types'

/** Preflight is on (this device's preference). */
export const usePreflightOn = (): boolean => usePreflight((s) => s.on)
/** The same, outside React (the command list). */
export const preflightIsOn = (): boolean => usePreflight.getState().on

/** The plate's mode without its effects (any reader). */
export function usePlateModeOnly(): PlateMode {
  const on = usePreflight((s) => s.on)
  const ready = usePreflight((s) => s.ready)
  const lit = usePreflight((s) => s.lit)
  const newIds = usePreflight((s) => s.newIds)
  const today = usePreflight((s) => s.today)
  const last = usePreflight((s) => s.last)
  const queueOpen = useQueue((s) => s.lamp !== null)
  const unfolded = useQueue((s) => s.unfolded)
  return planMode({ on, ready, lit, newIds, queueOpen, unfolded, today, last }).mode
}

/**
 * The plate's mode: 'off' · 'full' · 'strip' (§5.6). Its effects (the day's first full render, a lamp turning new
 * unfolds) run in a layout effect once per change — only in the component that owns the plate (`withEffects`).
 */
export function usePlateMode(withEffects = false): PlateMode {
  const on = usePreflight((s) => s.on)
  const ready = usePreflight((s) => s.ready)
  const lit = usePreflight((s) => s.lit)
  const newIds = usePreflight((s) => s.newIds)
  const today = usePreflight((s) => s.today)
  const last = usePreflight((s) => s.last)
  const queueOpen = useQueue((s) => s.lamp !== null)
  const unfolded = useQueue((s) => s.unfolded)
  const plan = planMode({ on, ready, lit, newIds, queueOpen, unfolded, today, last })
  const done = useRef('')
  const key = plan.effect ? JSON.stringify(plan.effect) + today.day : ''
  useLayoutEffect(() => {
    if (!withEffects || !plan.effect || done.current === key) return
    done.current = key
    applyModeEffect(plan.effect)
  })
  return plan.mode
}

/** Numbered Preflight sections above Home's own §01–§04 (0 in P1 / P2): Home offsets its numbers by it. */
export const usePreflightSections = (): number => 0

/** ⌘K "Preflight", MASTER CAUTION with nothing new: Start, the plate unfolded, focus on its first tab stop. */
export function openPreflight(): void {
  useQueue.setState({ unfolded: true, pendingFocus: 'plate' })
  if (parseHash(window.location.hash).name !== 'home') navigate({ name: 'home' })
}
