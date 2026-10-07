/**
 * one-worker — a running cost estimate from Claude Code's token counts (stream-json usage per message). Claude Code
 * reports the exact cost only at the end; this is what One shows meanwhile, marked as an estimate. $ per million
 * tokens: input, output, and the cache-read multiplier (cache writes are 1.25 × input). Unknown models: no estimate.
 */
const PRICES: Array<[RegExp, number, number, number]> = [
  [/fable-5-1|mythos-5-1/, 10, 50, 0.025],
  [/fable-5|mythos-5/, 10, 50, 0.1],
  [/opus-5-5/, 4, 20, 0.05],
  [/opus-(5|4-[5-8])/, 5, 25, 0.1],
  [/sonnet-5/, 2, 10, 0.1],
  [/sonnet-4/, 3, 15, 0.1],
  [/haiku-4-5/, 1, 5, 0.1],
]

export interface Usage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export function estimateCost(model: string | null, usages: Iterable<Usage>): number | null {
  const row = model ? PRICES.find(([re]) => re.test(model)) : undefined
  if (!row) return null
  const [, inp, out, read] = row
  let usd = 0
  for (const u of usages) usd += (u.input * inp + u.cacheWrite * inp * 1.25 + u.cacheRead * inp * read + u.output * out) / 1_000_000
  return usd
}

/** The usage of one stream-json assistant message (missing fields = 0). */
export function usageOf(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const n = (k: string) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0)
  return { input: n('input_tokens'), output: n('output_tokens'), cacheWrite: n('cache_creation_input_tokens'), cacheRead: n('cache_read_input_tokens') }
}
