/**
 * The Regler's loops and starts (Regler § 5.6 / § 5.8) — a lazy chunk: install.ts loads it only while a line is set (no
 * budget: the brake's round and start answer "go" without it).
 *  - roundAt (beforeRound, between two loop requests): the next step's band (steps.ts nextStep) against the rests with
 *    the run's own reservation left out — go · halt (the AI terminal's card, with H when a cheaper model of the same
 *    provider carries the conversation within the rest) · stop (agents, background work).
 *  - startAt (startCheck, before a run's first request): the day (and the month) read first, then the first step's band
 *    (the prompt + FIRST_STEP_OUT) — background runs are held, a manual one asks.
 */
import { blendedPerM } from '@/shared/ai/prices'
import { precheck, type BrakeCtx, type MoneyHint, type PrepareInput, type RoundCtx, type StartCheck } from '../ai/core/gate'
import { cheaperForHalt, forceAcrossThinking, needsOfHistory, round as roundVerdict, startCheckPure, type RoundVerdict } from './halt'
import { wireOutFor, type Band } from './estimate'
import { hasLimit, hasMonthLimit, restMin, restOf } from './limits'
import { contextOf, nextStep, stepOutputs } from './steps'
import { allowanceOf } from './allow'
import { loadMonth, loadToday, totalsNow } from './totals'
import { limitsNow, lineNow, ownRun } from './install'

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
export function roundAt(ctx: RoundCtx): RoundVerdict | null {
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
export async function startAt(input: PrepareInput, follow: () => void): Promise<StartCheck> {
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

/** The seam (DEV / ?e2e, install.ts): H across thinking modes for the browser spec. */
export { forceAcrossThinking }
