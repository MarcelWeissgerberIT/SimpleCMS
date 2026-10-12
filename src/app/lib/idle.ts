/**
 * Idle callbacks with a shim: `requestIdleCallback` where the browser has it, else a 1 ms timer with an 8 ms
 * synthetic deadline (Safari has none). Preflight's lamps are counted only here — never in a render; the Regler reads
 * the ledger here, never before first paint.
 */
export interface IdleDeadline {
  timeRemaining(): number
  didTimeout: boolean
}

/** Run `fn` when the browser is idle (at the latest after `timeout` ms). Returns the cancel function. */
export function whenIdle(fn: (deadline: IdleDeadline) => void, opts: { timeout?: number } = {}): () => void {
  const w = typeof window !== 'undefined' ? (window as Window & { requestIdleCallback?: unknown; cancelIdleCallback?: unknown }) : null
  if (w && typeof w.requestIdleCallback === 'function' && typeof w.cancelIdleCallback === 'function') {
    const id = (w.requestIdleCallback as (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number)(fn, opts.timeout ? { timeout: opts.timeout } : undefined)
    return () => (w.cancelIdleCallback as (id: number) => void)(id)
  }
  const t = setTimeout(() => {
    const t0 = performance.now()
    fn({ timeRemaining: () => Math.max(0, 8 - (performance.now() - t0)), didTimeout: false })
  }, 1)
  return () => clearTimeout(t)
}
