/**
 * What a request will cost before it is sent — a band from the one price table (src/shared/ai/prices.ts): the lower
 * end is the prompt plus the answer the caller expects, the upper end the prompt plus the whole answer budget (and, for
 * a model that reasons beyond its visible answer, the reasoning headroom). A model without a price has no band.
 */
import type { Caps, PriceRow, Route, Usage } from '@/shared/ai/types'
import { priceRow, costOf } from '@/shared/ai/prices'
import { capsOf } from '@/shared/ai/models'
import { isJevRouter } from '@/shared/ai/jev'

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

/**
 * The cost band of one request on a route (null: the route has no price). `row` / `caps`: what the caller knows of a
 * route the table does not hold (an OpenRouter model: the shortlist row; a route priced per request: its stated bound —
 * core/registry.ts priceFor), so a dynamic route never reserves 0.
 */
export function estimate(route: Pick<Route, 'p' | 'm'>, req: EstimateRequest, at: number = Date.now(), row: PriceRow | null = priceRow(route), known?: Caps | null): Band | null {
  if (!row) return null
  const prompt = Math.max(0, Math.round(req.promptTokens ?? (req.promptChars ?? 0) / CHARS_PER_TOKEN))
  const cached = Math.min(prompt, Math.max(0, Math.round(req.cachedTokens ?? 0)))
  const max = Math.max(0, Math.round(req.maxTokens))
  const out = Math.min(max, Math.max(0, Math.round(req.outTokens ?? 400)))
  // Claude's max_tokens already holds its thinking; a model that reasons on top of the visible answer needs room for it
  // (the wire's room: max(1 024, 4 × the answer) within the model's cap — always for the Jev Router, any pool model may reason)
  const caps = known ?? capsOf(route)
  const reasons = route.p !== 'anthropic' && (isJevRouter(route.m) || (!!caps?.reasoning && caps.reasoning.mandatory))
  const headroom = reasons ? Math.max(0, Math.min((caps?.maxOutput ?? Infinity) - max, Math.max(1024, 4 * max))) : 0
  const low = costOf(usage(prompt - cached, cached, out), row, at).usd ?? 0
  const high = costOf(usage(prompt - cached, cached, max + headroom), row, at).usd ?? 0
  return { low, high: Math.max(low, high) }
}
