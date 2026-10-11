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

/**
 * A short content revision of a value (FNV-1a over its JSON, plus the length; '' for nothing) — what ⇧A compares with
 * the revision a card was shown in full at (a change merged in place gets a new one).
 */
export function revHash(v: unknown): string {
  if (v === undefined || v === null) return ''
  const s = JSON.stringify(v) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`
}
