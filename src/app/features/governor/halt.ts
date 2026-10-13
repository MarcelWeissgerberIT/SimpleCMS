/**
 * The brake's verdicts for loops and starts (Regler § 5.6 – § 5.8) — pure, split from brake.ts so they load only with the
 * lazy loops chunk (loops.ts: a line is set). Nothing here throws, stores or sends.
 *
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
import { ALLOW_USD, allowFits, type BrakeRun, type RefuseDetail, type RunMode } from './brake'

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
 * Owner decision 2 (Regler design § 20, confirmed by the owner): agents never wait for a
 * key mid-run; at the red line every agent run stops (status held, proposals kept). Only the AI terminal pauses. true:
 * agent runs halt too (a pause card on the agent page — run lock and timeout work in B6).
 */
export const AGENTS_WAIT_MID_RUN = false

export const isTerminalTask = (source: string): boolean => source.startsWith('terminal:')
export const isAgentRun = (source: string): boolean => source.startsWith('agent:')

/** Does a loop of this run wait for the person at the red line (halt card) — else it stops? */
export const waitsAtLine = (run: BrakeRun): boolean => isTerminalTask(run.source) || (AGENTS_WAIT_MID_RUN && isAgentRun(run.source))

/* ------------------------------------------------------------------ */
/* Loops (beforeRound)                                                  */
/* ------------------------------------------------------------------ */

/** H on the halt card: a cheaper model, its band with the cold cache, the cache write alone and the context it writes. */
export interface HaltCheaper {
  route: Route
  band: Band
  cold: number
  label: string
  /** C + Δ: the tokens the switch writes to the new model's cache */
  tokens: number
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

/** A stop names the line that bound, the lowest rest and that line's spend / limit (a held run's row says them). */
export type RoundVerdict =
  | { go: true; reserve: number; band: Band | null }
  | { halt: Halt }
  | { stop: 'budget' | 'off'; band?: Band | null; binding?: RefuseDetail; rest?: number; line?: { spent: number; limit: number } }

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
  const budget = restMin(ctx.rest)
  if (!waitsAtLine(ctx.run)) return { stop: 'budget', band: ctx.next, binding: ctx.rest.binding ?? 'day', rest: budget, line: ctx.line }
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
  return { route: best.c.route, band: best.band, cold: coldCost(best.c.row, ctx.context, now) ?? 0, label: best.c.label, tokens: Math.max(0, Math.round(ctx.context)) }
}
