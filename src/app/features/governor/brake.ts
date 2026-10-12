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
 *  - round: between two loop requests — go (reserve the next step) · halt (the AI terminal's card: E · H · Mod+.) · stop
 *    (agents of every mode: they never wait mid-run — owner decision 2).
 *  - startCheckPure: before a run — background runs are not started (one held record per agent per day), a manual
 *    "Jetzt ausführen" asks where it was pressed.
 *  - needsOfHistory / cheaperForHalt: H — only a cheaper model of the same provider whose band with the cold cache fits
 *    the rest, whose context holds the conversation and that can do what the history holds.
 */
import type { Caps, PriceRow, Route } from '@/shared/ai/types'
import type { Band } from './estimate'
import { fits, restMin, type Binding, type Rest } from './limits'
import { coldCost, switchBand } from './steps'

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

/**
 * H across thinking modes (an adaptive-thinking history continued on a model without thinking) waits for the owner's
 * real-key check (§ 15): until then H offers only models that think as the current one does.
 */
export const H_ACROSS_THINKING = false
let acrossThinking = H_ACROSS_THINKING
/** The seam (DEV / ?e2e) forces it for the browser spec; nothing else calls it. */
export function forceAcrossThinking(on: boolean): void {
  acrossThinking = on
}

/**
 * Owner decision 2 (Regler design § 20, built with the recommendation — pending confirmation): agents never wait for a
 * key mid-run; at the red line every agent run stops (status held, proposals kept). Only the AI terminal pauses. true:
 * agent runs halt too (a pause card on the agent page — run lock and timeout work in B6).
 */
export const AGENTS_WAIT_MID_RUN = false

export const isTerminalTask = (source: string): boolean => source.startsWith('terminal:')
export const isAgentRun = (source: string): boolean => source.startsWith('agent:')

/** Does a loop of this run wait for the person at the red line (halt card) — else it stops? */
export const waitsAtLine = (run: BrakeRun): boolean => isTerminalTask(run.source) || (AGENTS_WAIT_MID_RUN && isAgentRun(run.source))

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

/* ------------------------------------------------------------------ */
/* Loops (beforeRound)                                                  */
/* ------------------------------------------------------------------ */

/** H on the halt card: a cheaper model, its band with the cold cache, the cache write alone. */
export interface HaltCheaper {
  route: Route
  band: Band
  cold: number
  label: string
}

export interface Halt {
  spent: number
  limit: number
  rest: number
  /** the next step's band (null: no price) */
  next: Band | null
  /** where the needle would be after the step (spent + next.high) */
  to: number
  binding: Binding
  allow: number | null
  cheaper: HaltCheaper | null
  at: number
}

export type RoundVerdict = { go: true; reserve: number; band: Band | null } | { halt: Halt } | { stop: 'budget' | 'off'; band?: Band | null }

export interface RoundCtx {
  run: BrakeRun
  limited: boolean
  /** the next step's band (steps.ts nextStep) */
  next: Band | null
  /** the rests with the run's own reservation excluded */
  rest: Rest
  /** the binding line's spend and limit (limits.ts lineOf) */
  line: { spent: number; limit: number }
  /** H, when the caller found one (terminal only) */
  cheaper?: HaltCheaper | null
  /** AUS reached mid-run (G2) */
  off?: boolean
  now?: number
}

/** Before every further loop request (tool_use, pause_turn, the eager retry). */
export function round(ctx: RoundCtx): RoundVerdict {
  if (ctx.off) return { stop: 'off', band: ctx.next }
  if (!ctx.limited) return { go: true, reserve: ctx.next?.high ?? 0, band: ctx.next }
  const verdict = fits(ctx.next, ctx.rest)
  if (verdict === 'yes' && ctx.next) return { go: true, reserve: ctx.next.high, band: ctx.next }
  if (!waitsAtLine(ctx.run)) return { stop: 'budget', band: ctx.next }
  const budget = restMin(ctx.rest)
  const next = ctx.next
  return {
    halt: {
      spent: ctx.line.spent,
      limit: ctx.line.limit,
      rest: budget,
      next,
      to: ctx.line.spent + (next?.high ?? 0),
      binding: ctx.rest.binding ?? 'day',
      allow: next && allowFits(next.high, ctx.rest) ? ALLOW_USD : null,
      cheaper: ctx.cheaper ?? null,
      at: ctx.now ?? Date.now(),
    },
  }
}

/* ------------------------------------------------------------------ */
/* Starts                                                               */
/* ------------------------------------------------------------------ */

export type StartVerdict =
  | { start: true }
  /** a background run is not started: one held record per agent per day (count + time) */
  | { start: false; hold: RefuseDetail }
  /** a manual run asks where it was pressed: E (+1 $ for this run, today) when it then fits · cancel */
  | { start: false; ask: { allow: number | null; need: number; first: Band; rest: Rest; binding: Binding } }
  /** a manual run that cannot start at all */
  | { start: false; refuse: 'noprice' | 'scope' }

export interface StartCtx {
  run: BrakeRun
  limited: boolean
  scopeKnown: boolean
  /** the first step's band (the prompt + FIRST_STEP_OUT; G3: the run band) */
  first: Band | null
  /** the rests (day and month read — the async start check awaited loadToday / loadMonth) */
  rest: Rest
}

/** A start the person pressed (it may ask); scheduled, triggered and follow-up starts never wait for a key. */
export const asksAtStart = (mode: RunMode): boolean => mode === 'manual' || mode === 'interactive' || mode === 'bulk'

/** Before a run's first request (§ 5.6 start check), every mode. */
export function startCheckPure(ctx: StartCtx): StartVerdict {
  if (!ctx.limited) return { start: true }
  const manual = asksAtStart(ctx.run.mode)
  if (!ctx.scopeKnown) return manual ? { start: false, refuse: 'scope' } : { start: false, hold: 'scope' }
  const budget = restMin(ctx.rest)
  const binding = ctx.rest.binding ?? 'day'
  if (budget <= 0 && !manual) return { start: false, hold: binding }
  const verdict = fits(ctx.first, ctx.rest)
  if (verdict === 'yes') return { start: true }
  if (verdict === 'noprice' || !ctx.first) return manual ? { start: false, refuse: 'noprice' } : { start: false, hold: 'noprice' }
  if (!manual) return { start: false, hold: binding }
  return { start: false, ask: { allow: allowFits(ctx.first.high, ctx.rest) ? ALLOW_USD : null, need: Math.max(0, ctx.first.high - budget), first: ctx.first, rest: ctx.rest, binding } }
}

/* ------------------------------------------------------------------ */
/* H: what the history needs, which cheaper model can carry it          */
/* ------------------------------------------------------------------ */

export interface HistoryNeeds {
  /** tool calls or results in it */
  tools: boolean
  /** pictures (also inside tool results) */
  vision: boolean
  /** the largest PDF's page count (0: none; Infinity: a PDF whose count is not known) */
  pdfPages: number
  /** MCP tool calls in it */
  mcp: boolean
  /** thinking blocks (signed) in it */
  thinking: boolean
}

type Block = Record<string, unknown>
const isObj = (v: unknown): v is Block => !!v && typeof v === 'object' && !Array.isArray(v)

/** What a conversation holds that the model continuing it must be able to read (Messages API shapes). */
export function needsOfHistory(messages: ReadonlyArray<{ content?: unknown }>, opts: { pdfPages?: (block: Block) => number | null } = {}): HistoryNeeds {
  const needs: HistoryNeeds = { tools: false, vision: false, pdfPages: 0, mcp: false, thinking: false }
  const walk = (content: unknown, depth: number): void => {
    if (!Array.isArray(content) || depth > 4) return
    for (const b of content) {
      if (!isObj(b)) continue
      const type = String(b.type ?? '')
      if (type === 'tool_use' || type === 'tool_result' || type === 'server_tool_use') needs.tools = true
      if (type === 'mcp_tool_use' || type === 'mcp_tool_result') needs.tools = needs.mcp = true
      if (type === 'thinking' || type === 'redacted_thinking') needs.thinking = true
      if (type === 'image') needs.vision = true
      if (type === 'document' && isObj(b.source) && (b.source.media_type === 'application/pdf' || b.source.type === 'file')) needs.pdfPages = Math.max(needs.pdfPages, opts.pdfPages?.(b) ?? Infinity)
      walk(b.content, depth + 1)
    }
  }
  for (const m of messages) walk(m.content, 0)
  return needs
}

/** Can a model with these caps carry the conversation (its needs, `tokens` of context + answer)? */
export function capsHold(needs: HistoryNeeds, caps: Caps, tokens: number, mcpAttached = false): boolean {
  if (tokens > caps.context) return false
  if (needs.tools && !caps.tools) return false
  if (needs.vision && !caps.vision) return false
  if (needs.pdfPages > 0 && (!caps.pdf || needs.pdfPages > caps.pdf.maxPages)) return false
  if ((needs.mcp || mcpAttached) && !caps.mcp) return false
  return true
}

export interface HCandidate {
  route: Route
  label: string
  caps: Caps
  row: PriceRow | null
  /** $ per million blended (prices.ts blendedPerM) — the order of "cheaper" */
  blended: number | null
}

export interface HaltSwitchCtx {
  /** the lowest rest (the run's own reservation already excluded — nothing is reserved while the card waits) */
  rest: number
  /** C + Δ: what the next request carries */
  context: number
  outLow: number
  outHigh: number
  needs: HistoryNeeds
  mcpAttached?: boolean
  /** the current model's price and caps */
  current: { blended: number | null; caps: Caps | null }
  /** the wire's max_tokens of a candidate for a visible answer budget */
  wireOut?: (to: HCandidate, visible: number) => number
  /** does a model think (adaptive thinking — client.ts thinks(caps) in the app)? */
  thinks?: (caps: Caps | null) => boolean
  acrossThinking?: boolean
  at?: number
}

const reasons = (caps: Caps | null): boolean => !!caps && caps.reasoning !== false

/**
 * H: the most expensive model priced below the current one (the caller passes the same provider's, filters 2–4 and 6
 * passed) whose band with the cold cache fits the rest, whose context holds C + Δ + the answer, that can do what the
 * history holds — and, until the real-key check, that thinks as the current one does. null: none.
 */
export function cheaperForHalt(candidates: readonly HCandidate[], ctx: HaltSwitchCtx): HaltCheaper | null {
  const thinks = ctx.thinks ?? reasons
  const across = ctx.acrossThinking ?? acrossThinking
  const now = ctx.at ?? Date.now()
  let best: { c: HCandidate; band: Band } | null = null
  for (const c of candidates) {
    if (c.blended === null || ctx.current.blended === null || c.blended >= ctx.current.blended || !c.row) continue
    if (!across && thinks(c.caps) !== thinks(ctx.current.caps)) continue
    const out = ctx.wireOut ? ctx.wireOut(c, ctx.outHigh) : ctx.outHigh
    if (!capsHold(ctx.needs, c.caps, ctx.context + out, ctx.mcpAttached)) continue
    const band = switchBand({ to: c.row, context: ctx.context, outLow: ctx.outLow, outHigh: out, at: now })
    if (!band || band.high > ctx.rest) continue
    if (!best || (c.blended ?? 0) > (best.c.blended ?? 0)) best = { c, band }
  }
  if (!best) return null
  return { route: best.c.route, band: best.band, cold: coldCost(best.c.row, ctx.context, now) ?? 0, label: best.c.label }
}
