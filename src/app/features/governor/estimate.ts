/**
 * What a request will cost before it is sent — a band from the one price table (src/shared/ai/prices.ts): the lower
 * end is the prompt plus the answer the caller expects, the upper end the prompt plus the whole answer budget (and, for
 * a model that reasons beyond its visible answer, the reasoning headroom). A model without a price has no band.
 */
import type { Route, Usage } from '@/shared/ai/types'
import { priceRow, costOf } from '@/shared/ai/prices'
import { capsOf } from '@/shared/ai/models'

/** A characters-per-token rule of thumb for prompts One builds. */
export const CHARS_PER_TOKEN = 4

export interface EstimateRequest {
  /** the prompt's size in characters (÷ 4) … */
  promptChars?: number
  /** … or in tokens */
  promptTokens?: number
  /** of the prompt, tokens read from the prompt cache (a prefix sent again within its time) */
  cachedTokens?: number
  /** the answer budget (max_tokens): the band's upper end */
  maxTokens: number
  /** the answer the caller expects (default: a short one, 400 tokens, at most maxTokens): the lower end */
  outTokens?: number
}

export interface Band {
  low: number
  high: number
}

const usage = (input: number, cacheRead: number, output: number): Usage => ({ input, cacheWrite: 0, cacheWrite1h: 0, cacheRead, output, reasoning: 0 })

/** The cost band of one request on a route (null: the route has no price). */
export function estimate(route: Pick<Route, 'p' | 'm'>, req: EstimateRequest, at: number = Date.now()): Band | null {
  const row = priceRow(route)
  if (!row) return null
  const prompt = Math.max(0, Math.round(req.promptTokens ?? (req.promptChars ?? 0) / CHARS_PER_TOKEN))
  const cached = Math.min(prompt, Math.max(0, Math.round(req.cachedTokens ?? 0)))
  const max = Math.max(0, Math.round(req.maxTokens))
  const out = Math.min(max, Math.max(0, Math.round(req.outTokens ?? 400)))
  // Claude's max_tokens already holds its thinking; a model that reasons on top of the visible answer needs room for it
  const caps = capsOf(route)
  const headroom = route.p !== 'anthropic' && caps?.reasoning && caps.reasoning.mandatory ? Math.max(1024, Math.round(max / 2)) : 0
  const low = costOf(usage(prompt - cached, cached, out), row, at).usd ?? 0
  const high = costOf(usage(prompt - cached, cached, max + headroom), row, at).usd ?? 0
  return { low, high: Math.max(low, high) }
}
