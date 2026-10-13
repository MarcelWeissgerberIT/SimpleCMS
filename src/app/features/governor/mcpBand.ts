/**
 * The one-shot side of the loop steps (Regler § 5.5, § 5.6) — pure and small, so the gate's money phase (install.ts) and
 * the run starts read it without the loop chunk (steps.ts, loaded with loops.ts only while a line is set):
 *  - FIRST_STEP_OUT: a loop's first request is braked on this answer (the wire keeps its own max_tokens);
 *  - mcpOneShotBand: a one-shot with MCP servers may loop at the provider — its upper end counts 1 + MCP_ROUNDS context
 *    reads, each with the servers' tool lists, and one full answer per request the call may send (its paused turns are
 *    resumed as whole requests: `rounds` = 1 + the call's resumes — never fewer reads than requests).
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
export const CHARS_PER_TOKEN = 4

export const U = (x: Partial<Usage>): Usage => ({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0, ...x })
export const usd = (row: PriceRow, u: Usage, at: number): number => costOf(u, row, at).usd ?? 0
export const tokens = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0))
export const same = (n: number) => n

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
  /** how many requests the call may send — the first and each paused turn it resumes (default 1) */
  rounds?: number
  wireOut?: (visible: number) => number
  at?: number
}

/** The further context reads an MCP one-shot's band counts (the brake note says "up to n rounds"). */
export const mcpReads = (rounds = 1): number => Math.max(MCP_ROUNDS, Math.max(1, Math.round(rounds)) - 1)

/**
 * A one-shot with MCP servers: low = one request; high = every request the call may send with its full answer (`rounds`)
 * and 1 + mcpReads(rounds) context reads in all (tool lists in each).
 */
export function mcpOneShotBand(ctx: McpOneShotCtx): Band | null {
  if (!ctx.row) return null
  const at = ctx.at ?? Date.now()
  const wire = ctx.wireOut ?? same
  let toolChars = 0
  for (let i = 0; i < Math.max(0, ctx.servers); i++) toolChars += ctx.toolChars?.[i] ?? MCP_TOOL_CHARS
  const per = tokens(ctx.promptTokens + toolChars / CHARS_PER_TOKEN)
  const max = tokens(ctx.maxTokens)
  const requests = Math.max(1, Math.round(ctx.rounds ?? 1))
  const reads = 1 + mcpReads(requests)
  const low = usd(ctx.row, U({ input: per, output: Math.min(max, tokens(ctx.outTokens ?? STEP_OUT_LOW)) }), at)
  const high = requests * usd(ctx.row, U({ input: per, output: tokens(wire(max)) }), at) + (reads - requests) * usd(ctx.row, U({ input: per }), at)
  return { low, high: Math.max(low, high) }
}
