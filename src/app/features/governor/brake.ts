/**
 * The brake's verdicts (Regler § 5.5 – § 5.8) — pure: what a request, a loop round or a run's start may do against the
 * rests. The gate (install.ts, B5) turns a refusal into AIError('budget', …) with the fix; nothing here throws, stores or
 * sends. Prices come in as bands (estimate / steps.ts) and as an injected cost of a capped answer.
 *
 *  - oneShot: no limit → identity · no scope → refused 'scope' · no price → refused 'noprice' · fits → pass (reserve the
 *    upper end) · a TEXT request without MCP servers → the largest answer budget ≥ minOut that fits (cap) · else refused
 *    before sending, with E (+1 $ once on the day and month lines) only when that makes it fit, the need otherwise, and a
 *    cheaper model of the same provider whose band fits. Structured answers (a cut JSON is worth nothing) and requests
 *    with MCP servers (max_tokens bounds the output only) are never capped.
 * Loops, starts and H (round, startCheckPure, cheaperForHalt …) live in halt.ts — loaded only with the lazy loops chunk
 * (loops.ts), so a person without a budget never downloads them.
 */
import type { Route } from '@/shared/ai/types'
import type { Band } from './estimate'
import { fits, restMin, type Binding, type Rest } from './limits'

export type RunMode = 'interactive' | 'manual' | 'scheduled' | 'trigger' | 'bulk' | 'follow-up'

/** The run a request belongs to, as the brake sees it. */
export interface BrakeRun {
  /** the ledger source ('ai:<run>:<what>' · 'terminal:<conv>:<task>' · 'agent:<id>:<run>' …) */
  source: string
  mode: RunMode
}

/** What one press of E allows. */
export const ALLOW_USD = 1

/**
 * Does one press of E make a band's upper end fit? E raises the day and month lines only (limits.ts restOf) — never a
 * run's own budget: with the run line binding, E is not offered (it would be offered again after every press).
 */
export const allowFits = (high: number, rest: Rest): boolean => high <= Math.min(rest.day, rest.month) + ALLOW_USD && high <= rest.run

/* ------------------------------------------------------------------ */
/* One-shots (the money phase of prepare)                               */
/* ------------------------------------------------------------------ */

export interface BrakeFix {
  kind: 'brake'
  /** what E allows (null: E would not make it fit) */
  allow: number | null
  /** what is missing (band upper end − rest) */
  need: number
  /** a cheaper model of the same provider whose band fits */
  cheaper?: Route
  band: Band
  rest: Rest
}

export type RefuseDetail = Binding | 'noprice' | 'scope'

export type OneShotVerdict =
  | { kind: 'identity' }
  | { kind: 'pass'; reserve: number; band: Band }
  | { kind: 'cap'; reserve: number; maxTokens: number; band: Band; step: { k: 'brake'; code: 'cap'; to: string } }
  | { kind: 'refuse'; detail: RefuseDetail; fix?: BrakeFix }

export interface OneShotCtx {
  /** any line set (none: identity) */
  limited: boolean
  /** the ledger scope is known (a team account loaded) */
  scopeKnown: boolean
  /** the request's band (null: no price) */
  band: Band | null
  /** a text answer may be capped; a structured one never */
  answer: 'text' | 'structured'
  /** the smallest useful answer (modes.ts minOut) */
  minOut: number
  /** the visible answer budget asked for */
  maxTokens: number
  /** the request's upper end with a visible answer budget `cap` (the wire's reasoning room included) */
  costAt?: (cap: number) => number | null
  /** MCP servers attached: their band (steps.ts mcpOneShotBand) is the request's, and it is never capped */
  mcp?: { servers: number; band: Band | null }
  /** cheaper models of the same provider (filters passed), with their bands */
  cheaper?: ReadonlyArray<{ route: Route; band: Band | null }>
}

/** The largest visible answer budget in [minOut, maxTokens) whose upper end fits `budget` (null: none). */
export function capFor(costAt: (cap: number) => number | null, minOut: number, maxTokens: number, budget: number): number | null {
  const ok = (cap: number) => {
    const c = costAt(cap)
    return c !== null && c <= budget
  }
  let lo = Math.max(1, Math.floor(minOut))
  let hi = Math.floor(maxTokens) - 1
  if (hi < lo || !ok(lo)) return null
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ok(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The most expensive candidate whose band fits `budget` and is below the current band (one-shots, B). */
export function cheaperRoute(current: Band, candidates: ReadonlyArray<{ route: Route; band: Band | null }>, budget: number): Route | undefined {
  let best: { route: Route; band: Band } | undefined
  for (const c of candidates) {
    if (!c.band || c.band.high > budget || c.band.high >= current.high) continue
    if (!best || c.band.high > best.band.high) best = { route: c.route, band: c.band }
  }
  return best?.route
}

/** The money phase of one request (§ 5.5). */
export function oneShot(ctx: OneShotCtx, rest: Rest): OneShotVerdict {
  if (!ctx.limited) return { kind: 'identity' }
  if (!ctx.scopeKnown) return { kind: 'refuse', detail: 'scope' }
  const withMcp = !!ctx.mcp && ctx.mcp.servers > 0
  const band = withMcp ? (ctx.mcp?.band ?? null) : ctx.band
  const verdict = fits(band, rest)
  if (verdict === 'noprice' || !band) return { kind: 'refuse', detail: 'noprice' }
  if (verdict === 'yes') return { kind: 'pass', reserve: band.high, band }
  const budget = restMin(rest)
  if (ctx.answer === 'text' && !withMcp && ctx.costAt) {
    const cap = capFor(ctx.costAt, ctx.minOut, ctx.maxTokens, budget)
    if (cap !== null) return { kind: 'cap', reserve: ctx.costAt(cap) ?? budget, maxTokens: cap, band, step: { k: 'brake', code: 'cap', to: String(cap) } }
  }
  const cheaper = cheaperRoute(band, ctx.cheaper ?? [], budget)
  return {
    kind: 'refuse',
    detail: rest.binding ?? 'day',
    fix: { kind: 'brake', allow: allowFits(band.high, rest) ? ALLOW_USD : null, need: Math.max(0, band.high - budget), ...(cheaper ? { cheaper } : {}), band, rest },
  }
}

export type { HaltCheaper, Halt, RoundVerdict, RoundCtx, StartVerdict, StartCtx, HistoryNeeds, HCandidate, HaltSwitchCtx } from './halt'
