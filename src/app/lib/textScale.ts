/**
 * Text size of the whole app (Settings → Appearance and Workspace → Overview → Display write the same
 * value). A display preference of this device — screens differ — kept in localStorage `one.textScale`
 * (the step 1–4), never synced, exported or backed up. Applied as `--text-scale` on <html> before the
 * first paint (main.tsx): every type token in src/shared/tokens.css and every font size in the app's CSS
 * multiplies it. The landing page never reads it.
 */
import { useSyncExternalStore } from 'react'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

export const TEXT_SCALE_KEY = 'one.textScale'

/** 1 = today's sizes (the default and the smallest); the UI base text is 14 · 15 · 16 · 17 px. */
export const TEXT_STEPS = [1, 15 / 14, 16 / 14, 17 / 14] as const
export type TextStep = 1 | 2 | 3 | 4

const listeners = new Set<() => void>()

function clampStep(v: unknown): TextStep {
  const n = Math.round(Number(v))
  return n >= 1 && n <= TEXT_STEPS.length ? (n as TextStep) : 1
}

export function readTextStep(): TextStep {
  return clampStep(safeLocalGet(TEXT_SCALE_KEY) ?? 1)
}

/** The factor of a step (1 · 1.071 · 1.143 · 1.214). */
export function textScaleOf(step: TextStep): number {
  return TEXT_STEPS[step - 1]
}

/** Put a step on <html> (`--text-scale`, `data-text-size`); step 1 leaves the token default. */
export function applyTextStep(step: TextStep = readTextStep()): void {
  const html = document.documentElement
  if (step === 1) {
    html.style.removeProperty('--text-scale')
    delete html.dataset.textSize
  } else {
    html.style.setProperty('--text-scale', String(textScaleOf(step)))
    html.dataset.textSize = String(step)
  }
}

/** Store + apply + tell every control (this tab; other tabs follow through the storage event). */
export function setTextStep(step: TextStep): void {
  const s = clampStep(step)
  safeLocalSet(TEXT_SCALE_KEY, s === 1 ? null : String(s))
  applyTextStep(s)
  for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== TEXT_SCALE_KEY && e.key !== null) return
    applyTextStep()
    fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

/** The current step, live (both settings places and other tabs stay in step). */
export function useTextStep(): TextStep {
  return useSyncExternalStore(subscribe, readTextStep, () => 1 as TextStep)
}
