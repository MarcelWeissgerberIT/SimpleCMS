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
 * Loops (the terminal, agents) are braked per round from B6; their first request passes here uncapped.
 */
import { GEN } from '@/shared/ai/generations'
import { thinksInside } from '@/shared/ai/wire/maxTokens'
import { registerBeforeSend, type BrakeCtx, type MoneyHint, type MoneyVerdict } from '../ai/core/gate'
import { AIError } from '../ai/core/errors'
import { useWorkspace } from '../../store/store'
import { whenIdle } from '../../lib/idle'
import { oneShot, type OneShotCtx } from './brake'
import { estimate, wireOutFor, type Band } from './estimate'
import { fits, hasLimit, hasMonthLimit, limitsOf, restMin, restOf, type Limits, type Rest } from './limits'
import { mcpOneShotBand } from './steps'
import { allowanceOf, consume } from './allow'
import { deviceLimitOf, DEVICE_KEY } from './device'
import { loadMonth, loadToday, startTotals, totalsNow, type TotalsNow } from './totals'
import { minOut, modeRow } from './modes'

/** The generation this module enforces (generations.ts GEN_ENFORCED names this file). */
export const ENFORCES = GEN.budget

/** The lines in force now: the workspace's and this browser's own. */
const limitsNow = (): Limits => limitsOf(useWorkspace.getState().governor, deviceLimitOf())

/** A run's own budget (an agent's maxRunUsd — passed from B6), else none. */
const ownRun = (ctx: BrakeCtx): { budget: number; spent: number } | null =>
  typeof ctx.run.budget === 'number' && Number.isFinite(ctx.run.budget) ? { budget: ctx.run.budget, spent: Math.max(0, ctx.run.spent ?? 0) } : null

/** The rests for this request: the lines, its run's budget, the allowance of its task or the token it carries. */
function restFor(ctx: BrakeCtx, l: Limits, t: TotalsNow): Rest {
  return restOf(l, t, { run: ownRun(ctx) }, allowanceOf({ source: ctx.run.source, allowance: ctx.run.allowance }))
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
  const run = ownRun(ctx)
  if (!hasLimit(l) && !run) return
  const t = totalsNow()
  const rest = restFor(ctx, l, t)
  const base: OneShotCtx = { limited: true, scopeKnown: t.scopeId !== null, ...judged(ctx) }
  let v = oneShot(base, rest)
  // the cheaper routes are looked up only for a refusal that can name one
  if (v.kind === 'refuse' && v.fix) v = oneShot({ ...base, cheaper: ctx.cheaper() }, rest)
  if (v.kind === 'identity') return
  if (v.kind === 'refuse') {
    if (!v.fix) throw new AIError('budget', v.detail, undefined, ctx.label)
    const f = v.fix
    throw new AIError('budget', v.detail, undefined, ctx.label, [
      { kind: 'brake', allow: f.allow, need: f.need, ...(f.cheaper ? { cheaper: f.cheaper } : {}), band: { low: f.band.low, high: f.band.high }, rest: restMin(f.rest), binding: f.rest.binding },
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
  const run = ownRun(ctx)
  if (!hasLimit(l) && !run) return null
  const rest = restFor(ctx, l, totalsNow())
  const j = judged(ctx)
  const band = j.mcp ? j.mcp.band : j.band
  // precheck usually has no size: no band to judge — the price and the rest still say something
  const said = band ? fits(band, rest) : !ctx.price ? 'noprice' : restMin(rest) > 0 ? 'yes' : 'no'
  return { band: bandOf(band), rest, fits: said }
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
  registerBeforeSend({ money, peek })
  if (typeof window === 'undefined') return
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
