/**
 * When the core sends a request again (D-S2-19), for providers that do not retry by themselves (OpenRouter; Claude's
 * SDK retries inside): a rate limit up to 3 times (0.5 · 1.5 · 4 s with jitter, or the provider's Retry-After when it
 * says one — never longer than 30 s), "busy" (the in-flight budget) up to 2 times with half the answer budget — and only
 * while nothing of the answer arrived (after the first content nothing is sent twice). A Jev Router 404 is never sent
 * again (call.ts refreshes the endpoint pins of a model once on "no endpoints"; never for the router); everything else
 * surfaces with "Nochmal". Pure — no store, no timers.
 */
import type { AIErrorCode } from '@/shared/ai/errors'

export const RETRY_WAITS_MS = [500, 1500, 4000] as const
export const MAX_RATE_RETRIES = 3
export const MAX_BUSY_RETRIES = 2
/** a Retry-After longer than this is not waited for in a request the person watches */
export const MAX_RETRY_AFTER_MS = 30_000

export interface RetryCount {
  rateLimit: number
  busy: number
}

export interface RetryStep {
  waitMs: number
  /** send again with half the answer budget (busy) */
  halve: boolean
}

/** The next try for a failure (null: none — the error stands). Counts are of the retries already made. */
export function retryPlan(err: { code: AIErrorCode; retryAfter?: number }, done: RetryCount, o: { contentStarted: boolean; rand?: () => number }): RetryStep | null {
  if (o.contentStarted) return null
  const jitter = () => 0.75 + 0.5 * (o.rand ?? Math.random)()
  const wait = (n: number) => {
    if (err.retryAfter !== undefined) return err.retryAfter <= MAX_RETRY_AFTER_MS ? Math.max(0, err.retryAfter) : null
    return Math.round((RETRY_WAITS_MS[Math.min(n, RETRY_WAITS_MS.length - 1)] ?? 4000) * jitter())
  }
  if (err.code === 'rate_limit' && done.rateLimit < MAX_RATE_RETRIES) {
    const w = wait(done.rateLimit)
    return w === null ? null : { waitMs: w, halve: false }
  }
  if (err.code === 'busy' && done.busy < MAX_BUSY_RETRIES) {
    const w = wait(done.busy)
    return w === null ? null : { waitMs: w, halve: true }
  }
  return null
}
