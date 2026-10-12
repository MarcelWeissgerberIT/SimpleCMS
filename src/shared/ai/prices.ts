/**
 * One price table for every direct model (USD per million tokens, list prices read on PRICES_DATE), and the one cost
 * function every receipt, budget and estimate uses. OpenRouter models are priced from the person's catalogue rows (or
 * the cost OpenRouter reports) — no OpenRouter model is named here. A model without a price has none: `usd: null`,
 * never "the most expensive known row".
 */
import type { CostSource, PriceCols, PriceOverride, PriceRow, Route, Usage } from './types.ts'

export const PRICES_DATE = '2026-10-12'

const row = (cols: PriceCols, overrides?: PriceOverride[]): PriceRow => ({ ...cols, ...(overrides ? { overrides } : {}), source: 'table', at: PRICES_DATE })

/** Every column × k (a long-context tier of the same model). */
const times = (c: PriceCols, k: number, minPrompt: number): PriceOverride => ({
  minPrompt,
  input: c.input * k,
  output: c.output * k,
  cacheRead: c.cacheRead * k,
  cacheWrite: c.cacheWrite * k,
  ...(c.cacheWrite1h !== undefined ? { cacheWrite1h: c.cacheWrite1h * k } : {}),
})

const HAIKU_55: PriceCols = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2 }
/** OpenAI above 272K prompt tokens: input and cache × 2, output × 1.5. */
const openaiLong = (c: PriceCols): PriceOverride => ({ minPrompt: 272_000, input: c.input * 2, cacheRead: c.cacheRead * 2, cacheWrite: c.cacheWrite * 2, output: c.output * 1.5 })
const LUNA: PriceCols = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
const SOL: PriceCols = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }
const ASTRA: PriceCols = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }

/** Keyed 'p:m'. */
export const PRICES: Readonly<Record<string, PriceRow>> = {
  'anthropic:claude-opus-5-5': row({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 }),
  // Sonnet 5.5 cache reads are $0.10 (One said $0.20 before)
  'anthropic:claude-sonnet-5-5': row({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 }),
  'anthropic:claude-haiku-4-5': row({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 }),
  'anthropic:claude-haiku-5-5': row(HAIKU_55, [times(HAIKU_55, 5, 100_000)]),
  'openai:gpt-6-luna': row(LUNA, [openaiLong(LUNA)]),
  'openai:gpt-6.1-sol': row(SOL, [openaiLong(SOL)]),
  'openai:gpt-6-astra': row(ASTRA, [openaiLong(ASTRA)]),
}

/** The table row of a direct route (null: not in the table — an OpenRouter model, an unknown id). A dated snapshot id
 *  ('…-20261001', as a response may name the model) is priced as its model. */
export function priceRow(route: Pick<Route, 'p' | 'm'>): PriceRow | null {
  return PRICES[`${route.p}:${route.m}`] ?? (route.p === 'openrouter' ? null : (PRICES[`${route.p}:${route.m.replace(/-\d{8}$/, '')}`] ?? null))
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export const PRICE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'image', 'webSearch', 'request'] as const satisfies ReadonlyArray<keyof PriceCols>

/** Does an override apply to a response of `prompt` tokens at `at`? */
function applies(o: PriceOverride, prompt: number, at: Date): boolean {
  if (o.minPrompt !== undefined && prompt < o.minPrompt) return false
  if (o.utcDays?.length && !o.utcDays.map((d) => d.toLowerCase().slice(0, 3)).includes(DAYS[at.getUTCDay()] ?? '')) return false
  if (o.utcStart !== undefined || o.utcEnd !== undefined) {
    const h = at.getUTCHours()
    const start = o.utcStart ?? 0
    const end = o.utcEnd ?? 24
    const inside = start <= end ? h >= start && h < end : h >= start || h < end
    if (!inside) return false
  }
  return true
}

/** The columns in force for a response (overrides in order; a later one wins per column). */
export function effectiveCols(r: PriceRow, prompt: number, at: Date): PriceCols {
  const cols: PriceCols = { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, cacheWrite1h: r.cacheWrite1h, reasoning: r.reasoning, image: r.image, webSearch: r.webSearch, request: r.request }
  for (const o of r.overrides ?? []) {
    if (!applies(o, prompt, at)) continue
    for (const k of PRICE_KEYS) {
      const v = o[k]
      if (typeof v === 'number') cols[k] = v
    }
  }
  return cols
}

/** Prompt tokens of a response: input + cache reads + cache writes. */
export const promptTokens = (u: Usage): number => u.input + u.cacheRead + u.cacheWrite + u.cacheWrite1h

/**
 * What a response cost. A reported cost wins; without a price row there is no price (`usd: null`). Cache reads and
 * writes are priced once each (input never includes them); reasoning tokens are part of `output` and priced at the
 * reasoning column when the row has one.
 */
export function costOf(u: Usage, r: PriceRow | null, at: number | Date = Date.now()): { usd: number | null; source: CostSource } {
  if (typeof u.reportedUsd === 'number' && Number.isFinite(u.reportedUsd) && u.reportedUsd >= 0) return { usd: u.reportedUsd, source: 'reported' }
  if (!r) return { usd: null, source: 'none' }
  const c = effectiveCols(r, promptTokens(u), at instanceof Date ? at : new Date(at))
  const reasoning = Math.min(Math.max(0, u.reasoning), Math.max(0, u.output))
  const plainOut = Math.max(0, u.output) - reasoning
  const write1h = c.cacheWrite1h ?? c.cacheWrite * 1.6
  const usd =
    (Math.max(0, u.input) * c.input +
      Math.max(0, u.cacheWrite) * c.cacheWrite +
      Math.max(0, u.cacheWrite1h) * write1h +
      Math.max(0, u.cacheRead) * c.cacheRead +
      plainOut * c.output +
      reasoning * (c.reasoning ?? c.output)) /
      1_000_000 +
    (c.request ?? 0)
  return { usd, source: r.source }
}

/** Blended price per million tokens (3 in : 1 out) — for labels and the ceiling. */
export function blendedPerM(r: PriceRow | null): number | null {
  if (!r) return null
  return (3 * r.input + r.output) / 4
}

/** The price label of a model: cheap ≤ $1, mid ≤ $6, expensive above (blended per million); unknown without a price. */
export function tierLabel(r: PriceRow | null): 'cheap' | 'mid' | 'expensive' | 'unknown' {
  const b = blendedPerM(r)
  if (b === null || b < 0) return 'unknown'
  return b <= 1 ? 'cheap' : b <= 6 ? 'mid' : 'expensive'
}
