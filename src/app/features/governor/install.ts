/**
 * The Regler's brake at the gate (Regler G1 § 5.2 / § 5.3 / § 5.5) — the ONLY module that calls registerBeforeSend. It
 * enforces generation GEN.budget (shared/ai/generations.ts GEN_ENFORCED): a day / month budget of the workspace or this
 * browser's own line.
 *
 *  - money (prepare only): no line set → nothing (the identity: the gate reserves the band's upper end, every byte as
 *    before). With a line: brake.oneShot against the rests now (totals.ts, sync) — pass (reserve the band's upper end) ·
 *    cap a text answer without MCP (the facades send min(own, cap)) · refuse before sending: AIError('budget', <line>) with
 *    the fix the BrakeNote renders (E only when +1 $ makes it fit, B = a cheaper model of the same provider that fits),
 *    'noprice' without a price, 'scope' while a team account is not known. An allowance token (E) the request carries is
 *    spent once it is let through.
 *  - peek (precheck only): what money would say — never throws, never reserves.
 *  - install(): registers both (no I/O); after the first frame the totals follow the ledger — only while a line is set
 *    (no line: nothing is read; the ledger still opens on its first entry). main.tsx calls it before any service can
 *    start a request.
 *  - round (beforeRound, between two loop requests): the next step's band (steps.ts nextStep) against the rests with the
 *    run's own reservation left out — go (the reservation follows it) · halt (the AI terminal's card, with H when a
 *    cheaper model of the same provider carries the conversation within the rest) · stop (agents, background work).
 *  - start (startCheck, before a run's first request): the day (and the month) read first, then the first step's band
 *    (the prompt + FIRST_STEP_OUT) — background runs are held, a manual one asks.
 * A loop's first request is judged here as a one-shot on FIRST_STEP_OUT (agent/run.ts size.bandOut) and never capped.
 * A run's own budget (an agent's maxRunUsd) is one more line — only while a line of the Regler is set: without one, the
 * agent's own after-the-fact check decides as before (not one byte changes without a budget).
 */
import { GEN } from '@/shared/ai/generations'
import { thinksInside } from '@/shared/ai/wire/maxTokens'
import { blendedPerM } from '@/shared/ai/prices'
import { routeKey } from '@/shared/ai/route'
import type { Route } from '@/shared/ai/types'
import { precheck, registerBeforeSend, type BrakeCtx, type MoneyHint, type MoneyVerdict, type PrepareInput, type RoundCtx, type StartCheck } from '../ai/core/gate'
import { AIError } from '../ai/core/errors'
import { useWorkspace } from '../../store/store'
import { whenIdle } from '../../lib/idle'
import { cheaperForHalt, forceAcrossThinking, needsOfHistory, oneShot, round as roundVerdict, startCheckPure, type OneShotCtx, type RoundVerdict } from './brake'
import { estimate, wireOutFor, type Band } from './estimate'
import { fits, hasLimit, hasMonthLimit, limitsOf, lineOf, restMin, restOf, type Binding, type Limits, type Rest } from './limits'
import { contextOf, mcpOneShotBand, nextStep, stepOutputs } from './steps'
import { allowanceOf, consume } from './allow'
import { deviceLimitOf, DEVICE_KEY } from './device'
import { loadMonth, loadToday, startTotals, totalsNow, type TotalsNow } from './totals'
import { minOut, modeRow } from './modes'

/** The generation this module enforces (generations.ts GEN_ENFORCED names this file). */
export const ENFORCES = GEN.budget

/** The lines in force now: the workspace's and this browser's own. */
const limitsNow = (): Limits => limitsOf(useWorkspace.getState().governor, deviceLimitOf())

/** A run's own budget (an agent's maxRunUsd, exec.ts) and its spend so far, else none. */
const ownRun = (run: BrakeCtx['run'], spent = run.spent ?? 0): { budget: number; spent: number } | null =>
  typeof run.budget === 'number' && Number.isFinite(run.budget) ? { budget: run.budget, spent: Math.max(0, spent) } : null

/** The rests for this request: the lines, its run's budget, the allowance of its task or the token it carries. */
function restFor(ctx: BrakeCtx, l: Limits, t: TotalsNow): Rest {
  return restOf(l, t, { run: ownRun(ctx.run) }, allowanceOf({ source: ctx.run.source, allowance: ctx.run.allowance }))
}

/** The binding line's spend and limit now (the halt card, a held run, the brake note's bar). */
const lineNow = (l: Limits, t: TotalsNow, binding: Binding, run: { budget: number; spent: number } | null) => {
  const x = lineOf(l, t, binding, run)
  return { spent: x.spent, limit: Number.isFinite(x.limit) ? x.limit : 0 }
}

/** What the brake judges: the request's band — with MCP servers their rounds and tool lists (never capped then). */
function judged(ctx: BrakeCtx): Pick<OneShotCtx, 'band' | 'answer' | 'minOut' | 'maxTokens' | 'costAt' | 'mcp'> {
  const row = modeRow(ctx.purpose)
  // a loop's first request is never capped (rounds are braked from B6); a call's own answer kind wins (a picture's JSON)
  const answer = ctx.answer ?? (row.answer === 'text' ? 'text' : 'structured')
  const size = ctx.size
  const min = minOut(ctx.purpose, ctx.route.p === 'anthropic' && thinksInside(ctx.caps)) ?? 0
  const costAt = size ? (cap: number) => estimate(ctx.route, { promptTokens: size.promptTokens, maxTokens: cap }, Date.now(), ctx.price, ctx.caps, ctx.hints)?.high ?? null : undefined
  const mcp =
    ctx.mcp.servers > 0 && size
      ? { servers: ctx.mcp.servers, band: mcpOneShotBand({ row: ctx.price, promptTokens: size.promptTokens, servers: ctx.mcp.servers, toolChars: ctx.mcp.toolChars, maxTokens: size.bandOut, wireOut: wireOutFor(ctx.route, ctx.caps, ctx.hints) }) }
      : undefined
  return { band: ctx.band, answer, minOut: min, maxTokens: size?.maxTokens ?? 0, ...(costAt ? { costAt } : {}), ...(mcp ? { mcp } : {}) }
}

const bandOf = (b: Band | null): Band | null => (b ? { low: b.low, high: b.high } : null)

/** The money phase (prepare only): identity without a line, else pass · cap · refuse. */
export function money(ctx: BrakeCtx): MoneyVerdict | void {
  const l = limitsNow()
  if (!hasLimit(l)) return
  const run = ownRun(ctx.run)
  const t = totalsNow()
  const rest = restFor(ctx, l, t)
  const base: OneShotCtx = { limited: true, scopeKnown: t.scopeId !== null, ...judged(ctx) }
  let v = oneShot(base, rest)
  // the cheaper routes are looked up only for a refusal that can name one
  let cheaper: ReadonlyArray<{ route: Route; band: Band | null }> = []
  if (v.kind === 'refuse' && v.fix) {
    cheaper = ctx.cheaper()
    v = oneShot({ ...base, cheaper }, rest)
  }
  if (v.kind === 'identity') return
  if (v.kind === 'refuse') {
    if (!v.fix) throw new AIError('budget', v.detail, undefined, ctx.label)
    const f = v.fix
    const line = f.rest.binding ? lineNow(l, t, f.rest.binding, run) : null
    throw new AIError('budget', v.detail, undefined, ctx.label, [
      {
        kind: 'brake',
        allow: f.allow,
        need: f.need,
        ...(f.cheaper ? { cheaper: f.cheaper, cheaperBand: bandOf(cheaper.find((c) => routeKey(c.route) === routeKey(f.cheaper!))?.band ?? null) } : {}),
        band: { low: f.band.low, high: f.band.high },
        rest: restMin(f.rest),
        binding: f.rest.binding,
        ...(line ? { line } : {}),
        purpose: ctx.purpose,
      },
    ])
  }
  // let through: the token it carried is spent ("nur für diese Anfrage"); a task's allowance stays for its task
  const granted = allowanceOf({ source: ctx.run.source, allowance: ctx.run.allowance })
  if (ctx.run.allowance) consume(ctx.run.allowance)
  const steps = [...(v.kind === 'cap' ? [v.step] : []), ...(granted > 0 ? [{ k: 'allowance' as const, code: String(granted) }] : [])]
  return {
    reserve: v.reserve,
    // capped: the band of what it may cost now (the capped answer), else the band it was judged on
    band: v.kind === 'cap' ? { low: Math.min(v.band.low, v.reserve), high: v.reserve } : bandOf(v.band),
    ...(v.kind === 'cap' ? { maxTokens: v.maxTokens } : {}),
    ...(granted > 0 ? { allowance: granted } : {}),
    ...(steps.length ? { steps } : {}),
  }
}

/** precheck: what the money phase would say (null: no line) — never throws, never reserves. */
export function peek(ctx: BrakeCtx): MoneyHint | null {
  const l = limitsNow()
  if (!hasLimit(l)) return null
  const rest = restFor(ctx, l, totalsNow())
  const j = judged(ctx)
  const band = j.mcp ? j.mcp.band : j.band
  // precheck usually has no size: no band to judge — the price and the rest still say something
  const said = band ? fits(band, rest) : !ctx.price ? 'noprice' : restMin(rest) > 0 ? 'yes' : 'no'
  return { band: bandOf(band), rest, fits: said }
}

/* ------------------------------------------------------------------ */
/* Loops and starts                                                     */
/* ------------------------------------------------------------------ */

/** A route that caches the conversation explicitly (Claude's automatic prompt caching): the context is read, Δ written. */
const explicitCache = (ctx: RoundCtx): boolean => ctx.route.p === 'anthropic'

/** The next step's band: the low end without tool results, the high end with the clip bound of each (steps.ts). */
function nextBand(ctx: RoundCtx, cold: boolean): Band | null {
  const base = { row: ctx.price, last: ctx.last, steps: ctx.steps, mcpIterations: ctx.mcpIterations, explicitCache: explicitCache(ctx), cold, wireOut: wireOutFor(ctx.route, ctx.prepared.caps, ctx.hints) }
  const low = nextStep({ ...base, pendingChars: ctx.pending.low })
  const high = nextStep({ ...base, pendingChars: ctx.pending.high })
  return low && high ? { low: low.low, high: Math.max(low.low, high.high) } : null
}

/** Between two loop requests (beforeRound): go · halt (the AI terminal) · stop (agents, background) — null: no line. */
export function round(ctx: RoundCtx): RoundVerdict | null {
  const l = limitsNow()
  if (!hasLimit(l)) return null
  const t = totalsNow()
  const prepared = ctx.prepared
  const runOwn = ownRun(prepared.run, ctx.spent)
  // the run's own reservation is what it may spend — never counted against it
  const rest = restOf(l, t, { reservation: prepared.reservation?.id ?? null, run: runOwn }, allowanceOf({ source: prepared.run.source }))
  const cold = !!ctx.cold
  const next = nextBand(ctx, cold)
  const binding = rest.binding ?? 'day'
  const line = lineNow(l, t, binding, runOwn)
  const base = { run: { source: prepared.run.source, mode: prepared.run.mode }, limited: true, next, rest, line }
  const v = roundVerdict(base)
  if (!('halt' in v) || !next) return v
  // H: a cheaper model of the same provider whose band with the cold cache fits the rest and that carries the conversation
  const C = contextOf(ctx.last)
  const out = stepOutputs(ctx.steps)
  const hist = ctx.history?.() ?? []
  const cheaper = cheaperForHalt(ctx.candidates(), {
    rest: restMin(rest),
    context: C + ctx.last.output + Math.round(ctx.pending.high / 4),
    outLow: out.low,
    outHigh: out.high,
    needs: needsOfHistory(hist),
    mcpAttached: !!ctx.mcpAttached,
    current: { blended: blendedPerM(ctx.price), caps: prepared.caps },
    wireOut: (to, visible) => wireOutFor(to.route, to.caps)(visible),
    ...(ctx.thinks ? { thinks: ctx.thinks } : {}),
  })
  return cheaper ? roundVerdict({ ...base, cheaper }) : v
}

/** Before a run's first request (startCheck): the totals read in full first; the first step's band against the rests. */
export async function startRun(input: PrepareInput): Promise<StartCheck> {
  const l = limitsNow()
  if (!hasLimit(l)) return { start: true }
  follow()
  await loadToday()
  if (hasMonthLimit(l)) await loadMonth()
  // the gate's own checks first (no key, a data rule …): a run it refuses fails there as before — not held here
  let hint: MoneyHint | null | undefined
  let run: BrakeCtx['run']
  try {
    const pre = precheck(input)
    hint = pre.hint
    run = pre.run
  } catch {
    return { start: true }
  }
  if (!hint) return { start: true }
  const t = totalsNow()
  const v = startCheckPure({ run: { source: run.source, mode: run.mode }, limited: true, scopeKnown: t.scopeId !== null, first: hint.band, rest: hint.rest })
  const binding = hint.rest.binding
  return binding ? { ...v, line: lineNow(limitsNow(), t, binding, ownRun(run)) } : v
}

/* ------------------------------------------------------------------ */
/* Install                                                              */
/* ------------------------------------------------------------------ */

let installed = false
let following = false

/** A line is set: the totals follow the ledger (in idle, after the first frame) — once; the month when a month line is. */
function follow(): void {
  const l = limitsNow()
  if (!hasLimit(l)) return
  if (!following) {
    following = true
    startTotals()
    whenIdle(() => void loadToday(), { timeout: 3000 })
  }
  if (hasMonthLimit(l)) whenIdle(() => void loadMonth(), { timeout: 5000 })
}

/** Register the brake (no I/O) and, after the first frame, follow the ledger while a line is set. Idempotent. */
export function install(): void {
  if (installed) return
  installed = true
  registerBeforeSend({ money, peek, round, start: startRun })
  if (typeof window === 'undefined') return
  // the seam (DEV / ?e2e): H across thinking modes for the browser spec (the owner's real-key check flips it for real)
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')) {
    const w = window as unknown as { __oneGovernor?: Record<string, unknown> }
    w.__oneGovernor = { ...(w.__oneGovernor ?? {}), acrossThinking: forceAcrossThinking }
  }
  const start = () => {
    follow()
    // a line set later: the workspace's (governor) or this browser's own (its device stamp moves settings.ai; another
    // tab's line arrives as a storage event)
    useWorkspace.subscribe((s, prev) => {
      if (s.governor !== prev.governor || s.settings.ai !== prev.settings.ai) follow()
    })
    window.addEventListener('storage', (e) => {
      if (e.key === DEVICE_KEY) follow()
    })
  }
  // never before the first paint: the frame, then a task after it
  requestAnimationFrame(() => setTimeout(start, 0))
}
