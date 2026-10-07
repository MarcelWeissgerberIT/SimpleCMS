/**
 * Sizes people gave resizable popovers (Popover `resizable="<kind>"`): per device, per kind of popover,
 * in localStorage `one.popover.size:<kind>` = {"w":720,"h":480} (CSS px). Never synced or exported.
 */
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

export interface PopoverSize {
  w: number
  h: number
}

export const POPOVER_SIZE_PREFIX = 'one.popover.size:'

/** Resizing is for a fine pointer on a screen wider than a phone (no grip on touch screens). */
export function canResize(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: fine) and (min-width: 641px)').matches
}

export function loadPopoverSize(kind: string): PopoverSize | null {
  try {
    const v = JSON.parse(safeLocalGet(POPOVER_SIZE_PREFIX + kind) ?? 'null') as Partial<PopoverSize> | null
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 10000
    return v && ok(v.w) && ok(v.h) ? { w: Math.round(v.w), h: Math.round(v.h) } : null
  } catch {
    return null
  }
}

export function savePopoverSize(kind: string, s: PopoverSize): void {
  safeLocalSet(POPOVER_SIZE_PREFIX + kind, JSON.stringify({ w: Math.round(s.w), h: Math.round(s.h) }))
}

export function clearPopoverSize(kind: string): void {
  safeLocalSet(POPOVER_SIZE_PREFIX + kind, null)
}
