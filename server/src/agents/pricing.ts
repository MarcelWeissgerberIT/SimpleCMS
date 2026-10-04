/**
 * Estimated cost of a run, from the usage the Messages API reports (Anthropic list prices per million
 * tokens, first-party API). An estimate for the agent's budget (`maxRunUsd`), not an invoice: a model
 * this table does not know is priced like the most expensive one, so a budget stops early, never late.
 */
import type { RunUsage } from './types.ts'

interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const p = (input: number, output: number, cacheRead = input * 0.1, cacheWrite = input * 1.25): Price => ({ input, output, cacheRead, cacheWrite })

/** $ per million tokens (cached 2026-09-25). */
const PRICES: Array<[RegExp, Price]> = [
  [/^claude-(fable|mythos)-5-1/, p(10, 50, 0.25)],
  [/^claude-(fable|mythos)-5/, p(10, 50)],
  [/^claude-opus-5-5/, p(4, 20, 0.2)],
  [/^claude-opus-(5|4)/, p(5, 25)],
  [/^claude-sonnet-5-5/, p(2, 10, 0.2)],
  [/^claude-sonnet-5/, p(2, 10)],
  [/^claude-sonnet-4/, p(3, 15)],
  [/^claude-haiku-4/, p(1, 5)],
]
const UNKNOWN = p(10, 50)

export function priceOf(model: string): Price {
  return PRICES.find(([re]) => re.test(model))?.[1] ?? UNKNOWN
}

/** The usage block of a response (the fields we price). */
export interface ApiUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** One response's usage → tokens and estimated dollars. */
export function costOf(model: string, u: ApiUsage): RunUsage {
  const price = priceOf(model)
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  const usd = (u.input_tokens * price.input + write * price.cacheWrite + read * price.cacheRead + u.output_tokens * price.output) / 1_000_000
  return { input: u.input_tokens + write, output: u.output_tokens, cacheRead: read, usd }
}

export const addUsage = (a: RunUsage, b: RunUsage): RunUsage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, usd: a.usd + b.usd })

export const NO_USAGE: RunUsage = { input: 0, output: 0, cacheRead: 0, usd: 0 }

/** Output tokens the remaining budget pays for (at the model's output price). */
export const affordableOutput = (model: string, usd: number) => Math.floor((Math.max(0, usd) * 1_000_000) / priceOf(model).output)
