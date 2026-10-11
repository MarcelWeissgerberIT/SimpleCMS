/** Helpers for the built-in lamps: plural strings, store watches that compare by reference (no selector middleware). */
import { t } from '../../../i18n'

/** `key.one` / `key.other` with {n}. */
export const tn = (key: string, n: number, vars: Record<string, string | number> = {}): string => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars })

interface Watchable<S> {
  getState(): S
  subscribe(fn: (s: S, prev: S) => void): () => void
}

/** Call `fn` when one of the picked values changed (by reference) — the lamps' subscribe pattern. */
export function watch<S>(store: Watchable<S>, pick: (s: S) => readonly unknown[], fn: () => void): () => void {
  return store.subscribe((s, prev) => {
    const a = pick(s)
    const b = pick(prev)
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        fn()
        return
      }
    }
  })
}

/** Several unsubscribe functions as one. */
export const all =
  (...offs: Array<() => void>) =>
  (): void => {
    for (const off of offs) off()
  }
