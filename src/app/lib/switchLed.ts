/**
 * The LED colour of every switch (Settings → Appearance and Workspace → Overview → Display write the same value).
 * A display preference of this device, kept in localStorage `one.switchLed` ('signal' — the default, stored as no
 * value — or a ColorName from SWITCH_LEDS), never synced, exported or backed up. Applied before the first paint
 * (main.tsx) as `--switch-led-pick: var(--switch-led-<name>)` + `data-switch-led` on <html>; tokens.css turns it
 * into `--switch-led` (the signal colour without a pick, so the workspace look's signal by default) and mixes every
 * lit tone of the glass rocker from it (ui.css .switch).
 */
import { useSyncExternalStore } from 'react'
import type { ColorName } from '../store/types'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

export const SWITCH_LED_KEY = 'one.switchLed'

/** 'signal' = the primary colour (the default); the others are LED versions of these content colours (tokens.css). */
export const SWITCH_LEDS = ['signal', 'green', 'blue', 'yellow', 'red', 'purple'] as const satisfies ReadonlyArray<'signal' | ColorName>
export type SwitchLed = (typeof SWITCH_LEDS)[number]

const listeners = new Set<() => void>()

export function cleanSwitchLed(v: unknown): SwitchLed {
  return typeof v === 'string' && (SWITCH_LEDS as readonly string[]).includes(v) ? (v as SwitchLed) : 'signal'
}

export function readSwitchLed(): SwitchLed {
  return cleanSwitchLed(safeLocalGet(SWITCH_LED_KEY))
}

/** The CSS colour of a choice (for swatches): a token reference, never a raw value. */
export function switchLedColor(led: SwitchLed): string {
  return led === 'signal' ? 'var(--signal)' : `var(--switch-led-${led})`
}

/** Put a choice on <html>; 'signal' leaves the token default (the signal colour). */
export function applySwitchLed(led: SwitchLed = readSwitchLed()): void {
  const html = document.documentElement
  if (led === 'signal') {
    html.style.removeProperty('--switch-led-pick')
    delete html.dataset.switchLed
  } else {
    html.style.setProperty('--switch-led-pick', `var(--switch-led-${led})`)
    html.dataset.switchLed = led
  }
}

/** Store + apply + tell every control (this tab; other tabs follow through the storage event). */
export function setSwitchLed(led: SwitchLed): void {
  const v = cleanSwitchLed(led)
  safeLocalSet(SWITCH_LED_KEY, v === 'signal' ? null : v)
  applySwitchLed(v)
  for (const l of listeners) l()
}

let watching = false

/** Apply this device's choice now and follow changes made in other tabs (main.tsx, once at boot). */
export function startSwitchLed(): void {
  applySwitchLed()
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('storage', (e) => {
    if (e.key !== SWITCH_LED_KEY && e.key !== null) return
    applySwitchLed()
    for (const l of listeners) l()
  })
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The current choice, live (both settings places and other tabs stay in step). */
export function useSwitchLed(): SwitchLed {
  return useSyncExternalStore(subscribe, readSwitchLed, () => 'signal' as SwitchLed)
}
