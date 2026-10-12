/**
 * Bands for loop steps, model switches and one-shots with MCP servers (Regler § 5.5, § 5.6, § 8.4) — pure, priced only by
 * the one cost function (src/shared/ai/prices.ts costOf), each request on its own (a long-context tier is per request).
 * A new file so the slice-1 estimate.ts stays as it is until the answer-budget rule is shared (B3); until then a
 * caller hands in `wireOut` (the wire's max_tokens for a visible answer budget — reasoning room where the wire adds it).
 *
 *  - nextStep: the next request of a loop. Context C = the last response's prompt (input + cache reads + writes); new
 *    input Δ = its output + the tool results it will get (characters ÷ 4; none for a pause_turn); output low / high =
 *    median / max of this run's step outputs (≥ 2 steps), else 400 / FIRST_STEP_OUT. C is a cache read only where the
 *    route caches explicitly or the last response reported ≥ 80 % of it as read — else input (OpenAI / OpenRouter cache
 *    implicitly and mostly unreported; the Jev Router may switch model each round: priced at its bound row's input). Δ is
 *    a cache write where the route caches explicitly. MCP: the next step reads the context max(1, k) times (k = the last
 *    response's server-side iterations).
 *  - switchBand: a model switch mid-run (H) writes the whole context to the new model's cache once (cold cache).
 *  - mcpOneShotBand: a one-shot with MCP servers may loop at the provider — its upper end counts 1 + MCP_ROUNDS context
 *    reads, each with the servers' tool lists.
 */
import type { PriceRow, Usage } from '@/shared/ai/types'
import { costOf } from '@/shared/ai/prices'
import type { Band } from './estimate'

/** The first request of a loop is braked and reserved on this answer (the wire keeps its own max_tokens). */
export const FIRST_STEP_OUT = 4096
/** A step's expected answer when the run has no history yet. */
export const STEP_OUT_LOW = 400
/** A one-shot with MCP servers: its band counts this many further context reads. */
export const MCP_ROUNDS = 5
/** A server's tool list when its tested list is not known (characters). */
export const MCP_TOOL_CHARS = 8000
/** Reported cache reads at least this share of the context: it is priced as read. */
export const CACHE_READ_SHARE = 0.8
const CHARS_PER_TOKEN = 4

const U = (x: Partial<Usage>): Usage => ({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0, ...x })
const usd = (row: PriceRow, u: Usage, at: number): number => costOf(u, row, at).usd ?? 0
const tokens = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0))
const same = (n: number) => n

/** The prompt of a response: what the next request re-reads. */
export const contextOf = (u: Usage): number => u.input + u.cacheRead + u.cacheWrite + u.cacheWrite1h

/** Output low / high of the next step: median / max of this run's step outputs (≥ 2), else 400 / FIRST_STEP_OUT. */
export function stepOutputs(steps: readonly Usage[]): { low: number; high: number } {
  if (steps.length < 2) return { low: STEP_OUT_LOW, high: FIRST_STEP_OUT }
  const outs = steps.map((s) => Math.max(0, s.output)).sort((a, b) => a - b)
  const mid = outs.length >> 1
  const median = outs.length % 2 ? outs[mid] : (outs[mid - 1] + outs[mid]) / 2
  return { low: Math.round(median), high: outs[outs.length - 1] }
}

export interface NextStepCtx {
  /** the route's price row (null: no price → no band) */
  row: PriceRow | null
  /** the last response */
  last: Usage
  /** this run's responses so far, the last included */
  steps: readonly Usage[]
  /** characters of the tool results the next request carries (0 for a pause_turn) */
  pendingChars: number
  /** server-side MCP iterations of the last response */
  mcpIterations?: number
  /** the route caches explicitly (Anthropic; anthropic/* on OpenRouter with cache_control) */
  explicitCache: boolean
  /** the cache counts as cold (the halt card waited over 5 minutes): the context is written again, never read */
  cold?: boolean
  /** the wire's max_tokens for a visible answer budget (default: the same) */
  wireOut?: (visible: number) => number
  at?: number
}

/** The next loop request's band (null: no price). */
export function nextStep(ctx: NextStepCtx): Band | null {
  const { row, last } = ctx
  if (!row) return null
  const at = ctx.at ?? Date.now()
  const wire = ctx.wireOut ?? same
  const C = tokens(contextOf(last))
  const delta = tokens(last.output + ctx.pendingChars / CHARS_PER_TOKEN)
  const k = Math.max(1, Math.round(ctx.mcpIterations ?? 1))
  const readC = !ctx.cold && (ctx.explicitCache || (C > 0 && last.cacheRead >= CACHE_READ_SHARE * C))
  // the first read of this step: C (read, written again when cold, else input) + Δ (written where the route caches)
  const ctxPart: Partial<Usage> = readC ? { cacheRead: C } : ctx.cold && ctx.explicitCache ? { cacheWrite: C } : { input: C }
  const first = (out: number): Usage => {
    const u = U({ ...ctxPart, output: out })
    if (ctx.explicitCache) u.cacheWrite += delta
    else u.input += delta
    return u
  }
  // every further server-side iteration reads it all again (what was written is read now)
  const again = ctx.explicitCache || readC ? U({ cacheRead: C + delta }) : U({ input: C + delta })
  const out = stepOutputs(ctx.steps)
  const more = (k - 1) * usd(row, again, at)
  const low = usd(row, first(out.low), at) + more
  const high = usd(row, first(tokens(wire(out.high))), at) + more
  return { low, high: Math.max(low, high) }
}

export interface SwitchCtx {
  /** the new model's price row */
  to: PriceRow | null
  /** what the next request carries: C + Δ */
  context: number
  outLow: number
  outHigh: number
  wireOut?: (visible: number) => number
  at?: number
}

/** A switch to another model mid-run: the context written to its cache once (cacheWrite, the row's input where it has
 *  none) + the answer at its price. */
export function switchBand(ctx: SwitchCtx): Band | null {
  if (!ctx.to) return null
  const at = ctx.at ?? Date.now()
  const wire = ctx.wireOut ?? same
  const C = tokens(ctx.context)
  const low = usd(ctx.to, U({ cacheWrite: C, output: tokens(ctx.outLow) }), at)
  const high = usd(ctx.to, U({ cacheWrite: C, output: tokens(wire(ctx.outHigh)) }), at)
  return { low, high: Math.max(low, high) }
}

/** What writing the context to a model's cache costs alone (the halt card's "≈ 0,09 $"). */
export const coldCost = (to: PriceRow | null, context: number, at = Date.now()): number | null => (to ? usd(to, U({ cacheWrite: tokens(context) }), at) : null)

export interface McpOneShotCtx {
  row: PriceRow | null
  promptTokens: number
  /** servers attached to the request */
  servers: number
  /** each server's tested tool list (its JSON length in characters; null / missing: MCP_TOOL_CHARS) */
  toolChars?: ReadonlyArray<number | null>
  /** the visible answer budget asked for */
  maxTokens: number
  /** the answer expected (default 400) */
  outTokens?: number
  wireOut?: (visible: number) => number
  at?: number
}

/** A one-shot with MCP servers: low = one request; high = 1 + MCP_ROUNDS context reads (tool lists in each) + the answer. */
export function mcpOneShotBand(ctx: McpOneShotCtx): Band | null {
  if (!ctx.row) return null
  const at = ctx.at ?? Date.now()
  const wire = ctx.wireOut ?? same
  let toolChars = 0
  for (let i = 0; i < Math.max(0, ctx.servers); i++) toolChars += ctx.toolChars?.[i] ?? MCP_TOOL_CHARS
  const per = tokens(ctx.promptTokens + toolChars / CHARS_PER_TOKEN)
  const max = tokens(ctx.maxTokens)
  const low = usd(ctx.row, U({ input: per, output: Math.min(max, tokens(ctx.outTokens ?? STEP_OUT_LOW)) }), at)
  const high = usd(ctx.row, U({ input: per, output: tokens(wire(max)) }), at) + MCP_ROUNDS * usd(ctx.row, U({ input: per }), at)
  return { low, high: Math.max(low, high) }
}
