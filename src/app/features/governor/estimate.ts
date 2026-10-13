/**
 * What a request will cost before it is sent — a band from the one price table (src/shared/ai/prices.ts): the lower
 * end is the prompt plus the answer the caller expects, the upper end the prompt plus what the wire allows for the whole
 * answer budget (shared/ai/wire/maxTokens.ts wireMaxTokens — the reasoning room included where the wire adds it, so a
 * reservation is never below what can be billed). A model without a price has no band.
 */
import type { Caps, PriceRow, Route, Usage, WireHints } from '@/shared/ai/types'
import { priceRow, costOf } from '@/shared/ai/prices'
import { capsOf } from '@/shared/ai/models'
import { wireMaxTokens } from '@/shared/ai/wire/maxTokens'

/** A characters-per-token rule of thumb for prompts One builds. */
export const CHARS_PER_TOKEN = 4

export interface EstimateRequest {
  /** the prompt's size in characters (÷ 4) … */
  promptChars?: number
  /** … or in tokens */
  promptTokens?: number
  /** of the prompt, tokens read from the prompt cache (a prefix sent again within its time) */
  cachedTokens?: number
  /** of the prompt, tokens written to the cache by this request (a cold cache after a model switch) — at the cache-write
   *  price, else input */
  writeTokens?: number
  /** the answer budget (max_tokens): the band's upper end */
  maxTokens: number
  /** the answer the caller expects (default: a short one, 400 tokens, at most maxTokens): the lower end */
  outTokens?: number
}

export interface Band {
  low: number
  high: number
}

const usage = (input: number, cacheRead: number, cacheWrite: number, output: number): Usage => ({ input, cacheWrite, cacheWrite1h: 0, cacheRead, output, reasoning: 0 })

/**
 * The wire's max_tokens for a visible answer budget on a route (shared/ai/wire/maxTokens.ts) — the `wireOut` / `costAt`
 * the brake's pure verdicts take (features/governor steps.ts, brake.ts).
 */
export function wireOutFor(route: Pick<Route, 'p' | 'm' | 'effort'>, known?: Caps | null, hints?: WireHints | null): (visible: number) => number {
  const caps = known ?? capsOf(route)
  return (visible) => wireMaxTokens(route, visible, caps, hints)
}

/**
 * The cost band of one request on a route (null: the route has no price). `row` / `known` / `hints`: what the caller
 * knows of a route the table does not hold (an OpenRouter model: the shortlist row and its catalogue facts; a route
 * priced per request: its stated bound — core/registry.ts priceFor), so a dynamic route never reserves 0.
 */
export function estimate(route: Pick<Route, 'p' | 'm' | 'effort'>, req: EstimateRequest, at: number = Date.now(), row: PriceRow | null = priceRow(route), known?: Caps | null, hints?: WireHints | null): Band | null {
  if (!row) return null
  const prompt = Math.max(0, Math.round(req.promptTokens ?? (req.promptChars ?? 0) / CHARS_PER_TOKEN))
  const cached = Math.min(prompt, Math.max(0, Math.round(req.cachedTokens ?? 0)))
  const written = Math.min(prompt - cached, Math.max(0, Math.round(req.writeTokens ?? 0)))
  const max = Math.max(0, Math.round(req.maxTokens))
  const out = Math.min(max, Math.max(0, Math.round(req.outTokens ?? 400)))
  // Claude's max_tokens already holds its thinking; a model that reasons on top of the visible answer gets the wire's
  // room for it (the router always — any pool model may reason) — the one rule the wire builds with
  const wire = max > 0 ? wireOutFor(route, known, hints)(max) : 0
  const input = prompt - cached - written
  // a cold cache is written at the row's cache-write price (5 minutes)
  const low = costOf(usage(input, cached, written, out), row, at).usd ?? 0
  const high = costOf(usage(input, cached, written, wire), row, at).usd ?? 0
  return { low, high: Math.max(low, high) }
}
