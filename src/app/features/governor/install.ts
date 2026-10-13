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
 *    (no line: nothing is read; the ledger still opens on its first entry). Every metered workspace is noted for the
 *    device line whether a line is set or not (totals.ts noteMetered). main.tsx calls it before any service can start a
 *    request.
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
import { routeKey } from '@/shared/ai/route'
import type { Route } from '@/shared/ai/types'
import { registerBeforeSend, type BrakeCtx, type MoneyHint, type MoneyVerdict, type PrepareInput, type RoundCtx, type StartCheck } from '../ai/core/gate'
import { AIError } from '../ai/core/errors'
import { useWorkspace } from '../../store/store'
import { whenIdle } from '../../lib/idle'
import { oneShot, type OneShotCtx, type RoundVerdict } from './brake'
import { estimate, wireOutFor, type Band } from './estimate'
import { fits, hasLimit, hasMonthLimit, limitsOf, lineOf, restMin, restOf, type Binding, type Limits, type Rest } from './limits'
import { mcpOneShotBand, mcpReads } from './mcpBand'
import { allowanceOf, consume } from './allow'
import { deviceLimitOf, onDeviceLine } from './device'
import { loadMonth, loadToday, noteLedgerScopes, startNoting, startTotals, totalsNow, type TotalsNow } from './totals'
import { minOut, modeRow } from './modes'
import { registerUsageLamp } from './lampSource'
import { decideLeft, takeDecide } from './decide'

/** The generation this module enforces (generations.ts GEN_ENFORCED names this file). */
export const ENFORCES = GEN.budget

/** The lines in force now: the workspace's and this browser's own. */
export const limitsNow = (): Limits => limitsOf(useWorkspace.getState().governor, deviceLimitOf())

/** A run's own budget (an agent's maxRunUsd, exec.ts) and its spend so far, else none. */
export const ownRun = (run: BrakeCtx['run'], spent = run.spent ?? 0): { budget: number; spent: number } | null =>
  typeof run.budget === 'number' && Number.isFinite(run.budget) ? { budget: run.budget, spent: Math.max(0, spent) } : null

/** The rests for this request: the lines, its run's budget, the allowance of its task or the token it carries. */
function restFor(ctx: BrakeCtx, l: Limits, t: TotalsNow): Rest {
  return restOf(l, t, { run: ownRun(ctx.run) }, allowanceOf({ source: ctx.run.source, allowance: ctx.run.allowance }))
}

/** The binding line's spend and limit now (the halt card, a held run, the brake note's bar). */
export const lineNow = (l: Limits, t: TotalsNow, binding: Binding, run: { budget: number; spent: number } | null) => {
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
      ? { servers: ctx.mcp.servers, band: mcpOneShotBand({ row: ctx.price, promptTokens: size.promptTokens, servers: ctx.mcp.servers, toolChars: ctx.mcp.toolChars, maxTokens: size.bandOut, wireOut: wireOutFor(ctx.route, ctx.caps, ctx.hints), ...(ctx.mcp.rounds ? { rounds: ctx.mcp.rounds } : {}) }) }
      : undefined
  return { band: ctx.band, answer, minOut: min, maxTokens: size?.maxTokens ?? 0, ...(costAt ? { costAt } : {}), ...(mcp ? { mcp } : {}) }
}

const bandOf = (b: Band | null): Band | null => (b ? { low: b.low, high: b.high } : null)

/**
 * A decision (class 'gate', slice SJ: Jev's pre-checks of an agent run, "Belegt?") — never a key: no E, no cheaper model,
 * never capped (typed answers). A check of a run that holds its checks' band from its start (`run.decide`, decide.ts)
 * takes its band out of that reservation: the day / month line it was counted against is not asked again. What the
 * reservation no longer covers is judged like any request, what is left of it counted in. Never past 'scope' / 'noprice'.
 * Refused: AIError('budget') without a fix — the check is not sent ('budget'); an apply-mode run then waits as a whole
 * (agents/direct.ts 'line') — Jev never takes a run over the line, and never lets it write unchecked because of it.
 */
function decision(ctx: BrakeCtx, l: Limits): MoneyVerdict {
  const t = totalsNow()
  if (t.scopeId === null) throw new AIError('budget', 'scope', undefined, ctx.label)
  const band = ctx.band
  if (!band) throw new AIError('budget', 'noprice', undefined, ctx.label)
  if (takeDecide(ctx.run.decide, band)) return { reserve: band.high, band: bandOf(band) }
  // the reservation's rest (if any) counts as room; the run's allowance (+1 $ for its start) too
  const left = ctx.run.decide ? decideLeft(ctx.run.decide) : 0
  const rest = restOf(l, t, { reservation: left > 0 ? ctx.run.decide : null }, allowanceOf({ source: ctx.run.source }))
  if (fits(band, rest) !== 'yes') throw new AIError('budget', rest.binding ?? 'day', undefined, ctx.label)
  if (left > 0) takeDecide(ctx.run.decide, { low: 0, high: left })
  return { reserve: band.high, band: bandOf(band) }
}

/** The money phase (prepare only): identity without a line, else pass · cap · refuse. */
export function money(ctx: BrakeCtx): MoneyVerdict | void {
  const l = limitsNow()
  if (!hasLimit(l)) return
  if (ctx.cls === 'gate') return decision(ctx, l)
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
        // MCP servers attached: the band counts their rounds (the note says so)
        ...(base.mcp ? { mcpRounds: mcpReads(ctx.mcp.rounds) } : {}),
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
/* Loops and starts — a lazy chunk (loops.ts), loaded only while a line is set */
/* ------------------------------------------------------------------ */

const loops = () => import('./loops')

/** Between two loop requests (beforeRound): go · halt (the AI terminal) · stop (agents, background) — null: no line. */
export function round(ctx: RoundCtx): RoundVerdict | null | Promise<RoundVerdict | null> {
  if (!hasLimit(limitsNow())) return null
  return loops().then((m) => m.roundAt(ctx))
}

/** the seam (DEV / ?e2e): every start passes — a spec stands for an estimate that let a run through */
let passStarts = false

/** Before a run's first request (startCheck): the totals read in full first; the first step's band against the rests. */
export async function startRun(input: PrepareInput): Promise<StartCheck> {
  if (!hasLimit(limitsNow()) || passStarts) return { start: true }
  return (await loops()).startAt(input, follow)
}

/* ------------------------------------------------------------------ */
/* Install                                                              */
/* ------------------------------------------------------------------ */

let installed = false
let following = false
/** this browser's own line as last followed ('' = none) */
let deviceSeen = ''

/**
 * A line is set: the totals follow the ledger (in idle, after the first frame) — once; the month when a month line is.
 * This browser's own line, when it appears or moves (also in a tab that already follows a workspace budget): the
 * workspaces it counts are listed again from the ledger's own keys and every one of them is read now.
 */
export function follow(): void {
  const l = limitsNow()
  const dev = deviceLimitOf()
  const sig = dev ? `${dev.day ?? ''}|${dev.month ?? ''}` : ''
  const deviceMoved = sig !== '' && sig !== deviceSeen
  deviceSeen = sig
  if (!hasLimit(l)) return
  const read = deviceMoved ? () => void noteLedgerScopes().then(loadToday, loadToday) : () => void loadToday()
  if (!following) {
    following = true
    startTotals()
    whenIdle(read, { timeout: 3000 })
  } else if (deviceMoved) whenIdle(read, { timeout: 3000 })
  if (hasMonthLimit(l)) whenIdle(() => void loadMonth(), { timeout: 5000 })
}

/** Register the brake (no I/O) and, after the first frame, follow the ledger while a line is set. Idempotent. */
export function install(): void {
  if (installed) return
  installed = true
  registerBeforeSend({ money, peek, round, start: startRun })
  if (typeof window === 'undefined') return
  // every workspace that spends here goes on the device line's list — a line set later counts it (no I/O until a meter)
  startNoting()
  // VERBRAUCH on Start (fitted only while a budget exists; it reads the tab's totals in idle — no storage at boot)
  registerUsageLamp()
  // the seam (DEV / ?e2e): H across thinking modes for the browser spec (the owner's real-key check flips it for real)
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')) {
    const w = window as unknown as { __oneGovernor?: Record<string, unknown> }
    w.__oneGovernor = {
      ...(w.__oneGovernor ?? {}),
      acrossThinking: (on: boolean) => loops().then((m) => m.forceAcrossThinking(on)),
      passStarts: (on: boolean) => {
        passStarts = on
      },
    }
  }
  const start = () => {
    follow()
    // a line set later: the workspace's (governor) or this browser's own (written here: device.ts DEVICE_EVENT; in
    // another tab: the storage event)
    useWorkspace.subscribe((s, prev) => {
      if (s.governor !== prev.governor || s.settings.ai !== prev.settings.ai) follow()
    })
    onDeviceLine(follow)
  }
  // never before the first paint: the frame, then a task after it
  requestAnimationFrame(() => setTimeout(start, 0))
}
