/**
 * `prefers-reduced-motion: reduce`, read live (the setting can change while the page is open): the run's dot is left out
 * and its cables carry the static ink emphasis instead (plan §1.7, §6 U28). The LED blink needs no hook — its CSS
 * animates only under `prefers-reduced-motion: no-preference`.
 */
import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

const mql = (): MediaQueryList | null => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null)

function subscribe(fn: () => void): () => void {
  const q = mql()
  if (!q) return () => undefined
  q.addEventListener('change', fn)
  return () => q.removeEventListener('change', fn)
}

const read = (): boolean => !!mql()?.matches

export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, read, () => false)

/** How the page scrolls a thing into view (fix ui-words): a jump with reduced motion, else smooth. */
export const scrollBehavior = (): ScrollBehavior => (read() ? 'auto' : 'smooth')
