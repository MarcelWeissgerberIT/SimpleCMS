import { useSyncExternalStore } from 'react'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

/**
 * The margin rail's on/off switch: a per-device preference (localStorage, never workspace data).
 * Shared by every page view and the Mod+. shortcut; default on.
 */
const KEY = 'one.marginRail'
export const RAIL_SHORTCUT = 'Mod+.'

let open = safeLocalGet(KEY) !== '0'
const listeners = new Set<() => void>()

export function isMarginRailOpen(): boolean {
  return open
}

export function setMarginRailOpen(next: boolean): void {
  if (next === open) return
  open = next
  safeLocalSet(KEY, next ? '1' : '0')
  listeners.forEach((l) => l())
}

export const toggleMarginRail = () => setMarginRailOpen(!open)

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useMarginRailOpen(): boolean {
  return useSyncExternalStore(subscribe, isMarginRailOpen, isMarginRailOpen)
}
