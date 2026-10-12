/**
 * Usage of one response in One's own shape, whatever the provider reported. `input` never includes cache reads or
 * writes (so nothing is priced twice); `output` includes reasoning tokens, `reasoning` says how many of them it was.
 */
import type { ProviderId, Usage } from './types.ts'

type Raw = Record<string, unknown> | null | undefined

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export const ZERO_USAGE: Usage = { input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0 }

/** A provider's usage report → Usage. */
export function normalise(p: ProviderId, raw: Raw): Usage {
  const u = obj(raw)
  if (p === 'anthropic') {
    // input_tokens already leaves the cache out; cache_creation splits the writes by TTL when present
    const split = obj(u.cache_creation)
    const has = 'ephemeral_5m_input_tokens' in split || 'ephemeral_1h_input_tokens' in split
    const w1h = has ? num(split.ephemeral_1h_input_tokens) : 0
    const w5m = has ? num(split.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens)
    return { input: num(u.input_tokens), cacheWrite: w5m, cacheWrite1h: w1h, cacheRead: num(u.cache_read_input_tokens), output: num(u.output_tokens), reasoning: 0 }
  }
  if (p === 'openai') {
    // Responses: input_tokens counts cached and written tokens too
    const inD = obj(u.input_tokens_details)
    const outD = obj(u.output_tokens_details)
    const read = num(inD.cached_tokens)
    const write = num(inD.cache_write_tokens)
    const output = num(u.output_tokens)
    return { input: Math.max(0, num(u.input_tokens) - read - write), cacheWrite: write, cacheWrite1h: 0, cacheRead: read, output, reasoning: Math.min(output, num(outD.reasoning_tokens)) }
  }
  // OpenRouter (Chat Completions): prompt_tokens counts cached and written tokens too; `cost` is what it charged
  const inD = obj(u.prompt_tokens_details)
  const outD = obj(u.completion_tokens_details)
  const read = num(inD.cached_tokens)
  const write = num(inD.cache_write_tokens)
  const output = num(u.completion_tokens)
  const cost = u.cost
  return {
    input: Math.max(0, num(u.prompt_tokens) - read - write),
    cacheWrite: write,
    cacheWrite1h: 0,
    cacheRead: read,
    output,
    reasoning: Math.min(output, num(outD.reasoning_tokens)),
    ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { reportedUsd: cost } : {}),
  }
}

/**
 * Usage of a response that ended without a usage report (stopped, failed): the known part (Anthropic's message_start
 * says the input) or the prompt size ÷ 4, and the streamed characters ÷ 4 as output.
 */
export function estimateUsage(promptChars: number, streamedChars: number, known?: Partial<Usage> | null): Usage {
  const input = known?.input ?? Math.ceil(Math.max(0, promptChars) / 4)
  return {
    input,
    cacheWrite: known?.cacheWrite ?? 0,
    cacheWrite1h: known?.cacheWrite1h ?? 0,
    cacheRead: known?.cacheRead ?? 0,
    output: Math.max(known?.output ?? 0, Math.ceil(Math.max(0, streamedChars) / 4)),
    reasoning: known?.reasoning ?? 0,
  }
}

/** Two usages added up. */
export function addUsage(a: Usage, b: Usage): Usage {
  const reported = a.reportedUsd !== undefined || b.reportedUsd !== undefined ? { reportedUsd: (a.reportedUsd ?? 0) + (b.reportedUsd ?? 0) } : {}
  return { input: a.input + b.input, cacheWrite: a.cacheWrite + b.cacheWrite, cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h, cacheRead: a.cacheRead + b.cacheRead, output: a.output + b.output, reasoning: a.reasoning + b.reasoning, ...reported }
}
