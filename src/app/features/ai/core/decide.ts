/**
 * decide(): one decision request (slice SJ, Jev as Vorprüfer) after the gate prepared it — a lazy part of the OpenRouter
 * path (never loaded for a Claude-only person):
 *
 *  1. only a Jev version the gate resolved (class 'gate') — and, with a confirmed snapshot, that snapshot's version
 *     ('changed' otherwise, nothing sent); the tab's cooldown (three service failures in a row → 10 min of fast refusals,
 *     nothing sent); a price known (the decisions catalogue row at any age, else one public GET — a decision never runs
 *     without one, D45);
 *  2. the OpenRouter key for this request only, Jev's endpoint pins under the workspace's deny list (none → nothing sent);
 *  3. send through the transport (not streamed), 8 s per attempt, ONE more attempt for "busy" / a rate limit (its
 *     Retry-After when ≤ 3 s, else about 1 s) — never after the caller stopped;
 *  4. ONE ledger entry per response (role 'decide', the run as its group): reported cost, else the catalogue row
 *     (output priced 0); stopped or timed out after it went out → an estimate; refused with a status → zero; never sent
 *     → none;
 *  5. who answered: an operator outside the pins → 'upstream', another snapshot than the one confirmed → 'changed' — the
 *     answer is not used (still metered).
 * Every refusal is a JevFailure with the reason a card shows (JevWhy). Nothing here writes the workspace.
 */
import type { DataClass, DecideQuestion, DecideRequest, DecideTurn, PriceRow, StepNote } from '@/shared/ai/types'
import type { AIErrorCode } from '@/shared/ai/errors'
import { ProviderError } from '@/shared/ai/errors'
import type { JevWhy } from '@/shared/ai/decide'
import { isJevModel } from '@/shared/ai/jev'
import { checkDecideServed } from '@/shared/ai/wire/decisions'
import { getAIKey } from '../../../store/secrets'
import { AIError } from './errors'
import { prepare, settle, type Applied, type PrepareInput, type Prepared } from './gate'
import { isPurposeId, type PurposeId } from './purposes'
import { meterCall, type ResponseInput } from './meter'
import { modelInfo, priceFor } from './registry'
import { loadAdapter, referer, upstreamRule } from './call'
import { loadDecisionCatalog, peekDecisionCatalog, pinsFor } from './catalog'

export const DECIDE_TIMEOUT_MS = 8_000
/** the longest Retry-After a decision waits for (else about a second) */
export const DECIDE_RETRY_MAX_MS = 3_000
export const COOLDOWN_STRIKES = 3
export const COOLDOWN_MS = 10 * 60_000

/** A decision that did not happen (or must not be used): the code, and the reason a card shows. */
export class JevFailure extends AIError {
  why: JevWhy
  constructor(why: JevWhy, code: AIErrorCode, detail?: string, label?: string) {
    super(code, detail, undefined, label)
    this.name = 'JevFailure'
    this.why = why
  }
}

/** The reason a card shows for a failure (§ 3.5): the service's failures read 'unavailable', the rest as they are. */
export function whyOf(e: unknown): JevWhy {
  if (e instanceof JevFailure) return e.why
  const code = e instanceof AIError || e instanceof ProviderError ? e.code : null
  switch (code) {
    case 'policy':
      return 'policy'
    case 'no_key':
      return 'nokey'
    case 'no_route':
      return 'noroute'
    case 'off':
      return 'off'
    case 'reload':
      return 'reload'
    case 'context':
      return 'context'
    case 'timeout':
      return 'timeout'
    case 'aborted':
      return 'late'
    case 'empty':
      return 'empty'
    case 'no_endpoint':
      return 'endpoint'
    case 'unavailable':
    case 'overloaded':
    case 'offline':
    case 'model_gone':
    case 'busy':
    case 'rate_limit':
      return 'unavailable'
    default:
      return 'error'
  }
}

/* ------------------------------------------------------------------ */
/* The tab's cooldown                                                   */
/* ------------------------------------------------------------------ */

/** failures that count towards the cooldown (the service, not the request) */
const STRIKES: ReadonlySet<AIErrorCode> = new Set(['unavailable', 'overloaded', 'timeout', 'model_gone', 'empty'])
let strikes = 0
let coolUntil = 0
let coolCode: AIErrorCode | null = null

/** The tab's decisions cooldown (the health lamp reads it). */
export const decideCooldown = (): { until: number; strikes: number; code: AIErrorCode | null } => ({ until: coolUntil, strikes, code: coolCode })

/** Forget the cooldown (a test; a new Vorprüfer confirmed). */
export function resetDecideCooldown(): void {
  strikes = 0
  coolUntil = 0
  coolCode = null
}

function strike(code: AIErrorCode): void {
  if (!STRIKES.has(code)) return
  strikes += 1
  if (strikes >= COOLDOWN_STRIKES) {
    coolUntil = Date.now() + COOLDOWN_MS
    coolCode = code
  }
}

/* ------------------------------------------------------------------ */
/* decide                                                               */
/* ------------------------------------------------------------------ */

export interface DecideOpts {
  /** the caller's stop (a run's deadline, the person's Stop) */
  signal?: AbortSignal
  /** the ledger's source ('agent:<id>:<run>' · 'help:ask' · 'workspace:ask' …) */
  source: string
  /** the ledger group (the run id) */
  group?: string
  /** the snapshot the person confirmed (a Jev model id, dated; 'openrouter:' in front is read too) — another one served → 'changed' */
  on?: string | null
  /** ms per attempt (default 8 s) */
  timeoutMs?: number
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', done)
      clearTimeout(t)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

/**
 * Make the decision rows known before a request prepares (the gate's reservation needs the price): the device's copy at
 * any age, else one public GET. Call it before prepare() — a run once, not per change.
 */
export async function primeDecisions(): Promise<void> {
  if ((await peekDecisionCatalog())?.rows.length) return
  await loadDecisionCatalog()
}

/** The price a decision is metered with (the catalogue row, at any age — one GET when none was ever read). */
async function priceOf(prepared: Prepared): Promise<PriceRow | null> {
  const route = prepared.route!
  if (priceFor(route)) return priceFor(route)
  await peekDecisionCatalog()
  if (priceFor(route)) return priceFor(route)
  await loadDecisionCatalog()
  return priceFor(route)
}

/** One decision request through the transport → the typed answers (or a JevFailure). */
export async function decide(prepared: Prepared, req: { state: Record<string, unknown>; questions: Record<string, DecideQuestion> }, o: DecideOpts): Promise<DecideTurn> {
  const route = prepared.route
  const label = prepared.label
  if (!route || route.p !== 'openrouter' || !isJevModel(route.m) || prepared.cls !== 'gate') throw new JevFailure('noroute', 'no_route', undefined, label)
  if (Date.now() < coolUntil) throw new JevFailure('cooldown', coolCode ?? 'unavailable', 'cooldown', label)
  if (o.signal?.aborted) throw new JevFailure('late', 'aborted', undefined, label)
  // the rules now resolve another Jev version than the one the person confirmed: nothing is sent (DJ19)
  const on = o.on ? o.on.replace(/^openrouter:/, '') : null
  if (on && on.replace(/-\d{8}$/, '') !== route.m) throw new JevFailure('changed', 'policy', `model:${route.m}`, label)
  const price = await priceOf(prepared)
  if (!price) throw new JevFailure('price', 'unknown', 'price', label)
  const key = await getAIKey('openrouter')
  if (!key) throw new JevFailure('nokey', 'no_key', undefined, label)
  const info = modelInfo(route)
  if (!info) throw new JevFailure('noroute', 'model_gone', route.m, label)
  const upstream = upstreamRule()
  const pins = await pinsFor(route.m, upstream)
  if (!pins) throw new JevFailure('endpoint', 'no_endpoint', route.m, label)
  let adapter
  try {
    adapter = await loadAdapter('openrouter')
  } catch (e) {
    throw new JevFailure(whyOf(e), e instanceof AIError ? e.code : 'unknown', undefined, label)
  }
  const request: DecideRequest = { kind: 'decide', route: { p: 'openrouter', m: route.m }, state: req.state, questions: req.questions }
  const promptChars = JSON.stringify({ state: req.state, questions: req.questions }).length
  const call = meterCall(prepared, { source: o.source, role: 'decide', ...(o.group ? { group: o.group } : {}), signal: o.signal ?? null })
  const meter = (r: Omit<ResponseInput, 'price' | 'promptChars'>) => call.response({ ...r, price, promptChars })
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctl.abort()
    }, o.timeoutMs ?? DECIDE_TIMEOUT_MS)
    const stop = () => ctl.abort()
    o.signal?.addEventListener('abort', stop, { once: true })
    try {
      const turn = await adapter.send(request, { key, model: info, signal: ctl.signal, onEvent: () => {}, pins: pins.tags, upstream, referer: referer() })
      const problem = checkDecideServed(turn.served, { requested: route.m, on, upstreams: pins.names })
      const steps: StepNote[] = problem === 'upstream' ? [{ k: 'upstream', code: `upstream:${turn.served.upstream ?? ''}`, to: turn.served.model }] : problem === 'changed' ? [{ k: 'substituted', from: on ?? route.m, to: turn.served.model }] : []
      meter({ served: turn.served.model, usage: turn.usage, outcome: problem ? 'policy' : 'ok', ...(steps.length ? { steps } : {}), ...(turn.served.upstream ? { upstream: turn.served.upstream } : {}) })
      if (problem) throw new JevFailure(problem, 'policy', problem === 'upstream' ? `upstream:${turn.served.upstream ?? ''}` : `model:${turn.served.model}`, label)
      strikes = 0
      return turn
    } catch (e) {
      if (e instanceof JevFailure) throw e
      if (!(e instanceof ProviderError)) throw new JevFailure('error', 'bad_request', e instanceof Error ? e.message : String(e), label)
      const stopped = !!o.signal?.aborted
      const code: AIErrorCode = e.code === 'aborted' && timedOut && !stopped ? 'timeout' : e.code
      // the response is metered whatever comes next (never sent: no entry)
      if (e.reach === 'refused') meter({ refused: true, outcome: code })
      else if (e.reach === 'sent') {
        const partial = (e.partial as DecideTurn | undefined) ?? null
        meter(partial?.usage ? { served: partial.served.model || null, usage: partial.usage, outcome: code, ...(partial.served.upstream ? { upstream: partial.served.upstream } : {}) } : { usage: null, streamedChars: 0, outcome: stopped ? 'aborted' : code })
      }
      if (stopped) throw new JevFailure('late', 'aborted', undefined, label)
      if (attempt === 0 && (code === 'busy' || code === 'rate_limit') && (e.retryAfter === undefined || e.retryAfter <= DECIDE_RETRY_MAX_MS)) {
        await sleep(e.retryAfter ?? Math.round(1000 * (0.75 + 0.5 * Math.random())), o.signal)
        if (o.signal?.aborted) throw new JevFailure('late', 'aborted', undefined, label)
        continue
      }
      strike(code)
      throw new JevFailure(whyOf(new ProviderError(code, undefined, { reach: e.reach })), code, e.detail, label)
    } finally {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', stop)
    }
  }
}

/* ------------------------------------------------------------------ */
/* The e2e seam (`window.__oneAI.decide`, ?e2e only — core/gate.ts)       */
/* ------------------------------------------------------------------ */

interface SeamInput {
  purpose?: string
  sources?: unknown
  carries?: DataClass[]
  decider?: { p: 'openrouter'; m: string } | null
  applied?: Applied | null
  on?: string | null
  state: Record<string, unknown>
  questions: Record<string, DecideQuestion>
  source?: string
  group?: string
  timeoutMs?: number
}

/** One decision as a spec drives it: the gate, decide, settle — the answers, or the refusal's code and reason. */
export async function decideSeam(input: unknown): Promise<Record<string, unknown>> {
  const i = input as SeamInput
  let prepared: Prepared | null = null
  try {
    await primeDecisions()
    prepared = prepare({
      purpose: (isPurposeId(i.purpose) ? i.purpose : 'gate.precheck') as PurposeId,
      sources: (Array.isArray(i.sources) ? i.sources : [{ all: true }]) as PrepareInput['sources'],
      carries: i.carries ?? [],
      decider: i.decider ?? null,
      applied: i.applied ?? { people: true, transcript: true, visible: true },
      size: { promptChars: JSON.stringify({ state: i.state, questions: i.questions }).length, maxTokens: 0 },
    })
    const turn = await decide(prepared, { state: i.state, questions: i.questions }, { source: i.source ?? 'e2e:decide', ...(i.group ? { group: i.group } : {}), on: i.on ?? null, ...(i.timeoutMs ? { timeoutMs: i.timeoutMs } : {}) })
    return JSON.parse(JSON.stringify({ ok: true, answers: turn.answers, served: turn.served, usage: turn.usage, route: prepared.route, level: prepared.level, reserved: prepared.reservation?.usd ?? null })) as Record<string, unknown>
  } catch (e) {
    return { ok: false, code: e instanceof AIError ? e.code : 'unknown', why: whyOf(e), detail: e instanceof AIError ? (e.detail ?? null) : String(e) }
  } finally {
    settle(prepared)
  }
}
