/**
 * Metering: every response of every engine is one ledger entry (features/governor) — the requested route, the model
 * that answered, its usage priced by the one table (src/shared/ai/prices.ts), the request's purpose and data classes.
 *  - a response that ended without its usage report (stopped, failed mid-stream) is an ESTIMATE: the input Claude's
 *    message_start reported (else the prompt's characters ÷ 4) plus the streamed characters ÷ 4 — never $0;
 *  - a request refused with an HTTP status before any response started was not billed: zero tokens, still listed;
 *  - another model than the requested one answered (Anthropic's refusal fallback) → a 'refusal-fallback' step, priced
 *    at the model that answered;
 *  - demo answers are never metered, and neither is a gate check (precheck).
 * A facade call is one `meterCall`: one entry per response it gets (resumes, retries), its receipt (the sum) reported
 * through `onRun` and to the taps on its abort signal (runs.ts folds a run's requests into the card's receipt).
 */
import type { CostSource, LedgerEntry, LedgerRole, ProviderId, StepNote, Usage } from '@/shared/ai/types'
import type { AIErrorCode } from '@/shared/ai/errors'
import { costOf, priceRow } from '@/shared/ai/prices'
import { addUsage, estimateUsage, normalise, ZERO_USAGE } from '@/shared/ai/usage'
import { modelBase, sameModel } from '@/shared/ai/models'
import { routeKey } from '@/shared/ai/route'
import { meter } from '../../governor'
import { newId } from '../../../lib/ids'
import type { Prepared } from './gate'

/** One response as the engine saw it. */
export interface ResponseInput {
  /** the model the response named (absent: the requested one) */
  served?: string | null
  /** the usage the provider reported for the whole response (null: none — stopped or failed) */
  usage?: Usage | null
  /** what was known before it ended (Claude's message_start) */
  known?: Partial<Usage> | null
  /** the prompt's size, for an estimate without a known input */
  promptChars?: number
  /** characters that streamed in (text, thinking, tool input) */
  streamedChars?: number
  outcome?: 'ok' | AIErrorCode
  mcpCalls?: number
  /** refused with an HTTP status before any response started: nothing was billed */
  refused?: boolean
}

/** What a request (or a run of requests) cost — the receipt on run cards. */
export interface Receipt {
  /** the requested route, 'p:m' */
  route: string
  /** the model that answered (the latest response) */
  served: { p: ProviderId; model: string }
  usage: Usage
  /** null: a response had no price */
  usd: number | null
  /** 'estimate' when any response was estimated; 'none' when one had no price */
  costSource: CostSource
  steps: StepNote[]
  requests: number
}

export interface MeterOpts {
  /** the ledger's source id (fixed ids only — 'ai:<run>' …); default: the purpose */
  source?: string
  role?: LedgerRole
  /** the call's abort signal: taps on it hear of every entry (runs.ts) */
  signal?: AbortSignal | null
  /** the call's receipt so far, after every response */
  onRun?: (receipt: Receipt) => void
}

/* ------------------------------------------------------------------ */
/* Taps: the entries of the requests made with a signal                 */
/* ------------------------------------------------------------------ */

interface Tap {
  fns: Set<(e: LedgerEntry) => void>
  source?: string
}
const taps = new WeakMap<AbortSignal, Tap>()

/**
 * The requests made with `signal`: `source` names them in the ledger when a call names none, `onEntry` hears of every
 * entry — a caller that passes only its signal down (an AI-menu run through the transform, file, image … paths) gets
 * its receipt this way. Returns the unsubscribe.
 */
export function tapSignal(signal: AbortSignal, tap: { source?: string; onEntry?: (e: LedgerEntry) => void }): () => void {
  const t = taps.get(signal) ?? { fns: new Set() }
  const fn = tap.onEntry
  if (fn) t.fns.add(fn)
  if (tap.source) t.source = tap.source
  taps.set(signal, t)
  return () => {
    if (fn) t.fns.delete(fn)
  }
}

/* ------------------------------------------------------------------ */
/* Entries and receipts                                                 */
/* ------------------------------------------------------------------ */

/** One response → its ledger entry (null: demo, nothing was sent). */
export function meterResponse(prepared: Prepared, opts: Pick<MeterOpts, 'source' | 'role'>, r: ResponseInput): LedgerEntry | null {
  const route = prepared.route
  if (!route || prepared.provider === 'demo') return null
  const served = r.served && typeof r.served === 'string' ? r.served : route.m
  const fallback = !sameModel(route.m, served)
  const servedRoute = { p: route.p, m: fallback ? served : route.m }
  const at = Date.now()
  const row = priceRow(servedRoute)
  let usage: Usage
  let costSource: CostSource
  let usd: number | null
  if (r.usage) {
    usage = r.usage
    ;({ usd, source: costSource } = costOf(usage, row, at))
  } else if (r.refused) {
    usage = ZERO_USAGE
    usd = row ? 0 : null
    costSource = row ? row.source : 'none'
  } else {
    usage = estimateUsage(r.promptChars ?? 0, r.streamedChars ?? 0, r.known)
    usd = costOf(usage, row, at).usd
    costSource = row ? 'estimate' : 'none'
  }
  const steps: StepNote[] = fallback ? [{ k: 'refusal-fallback', from: route.m, to: modelBase(served) }] : []
  return meter({
    id: newId(),
    at,
    scope: '',
    purpose: prepared.purpose,
    cls: prepared.cls,
    source: opts.source || prepared.purpose,
    role: opts.role ?? 'main',
    route: routeKey(route),
    served: { p: route.p, model: servedRoute.m },
    classes: [...prepared.classes],
    usage,
    usd,
    costSource,
    priceAt: row?.at ?? '',
    mcpCalls: Math.max(0, r.mcpCalls ?? 0),
    outcome: r.outcome ?? 'ok',
    ...(prepared.reservation ? { reservation: prepared.reservation.id } : {}),
    ...(steps.length ? { steps } : {}),
  })
}

const sameStep = (a: StepNote, b: StepNote) => a.k === b.k && a.from === b.from && a.to === b.to

/** A receipt with one more response (pure). */
export function addToReceipt(r: Receipt | null | undefined, e: LedgerEntry): Receipt {
  const steps = [...(r?.steps ?? [])]
  for (const s of e.steps ?? []) if (!steps.some((x) => sameStep(x, s))) steps.push(s)
  const usd = r && r.usd === null ? null : e.usd === null ? null : (r?.usd ?? 0) + e.usd
  const costSource: CostSource = usd === null ? 'none' : r?.costSource === 'estimate' || e.costSource === 'estimate' ? 'estimate' : e.costSource
  return {
    route: r?.route ?? e.route,
    served: { p: e.served.p, model: e.served.model },
    usage: r ? addUsage(r.usage, e.usage) : e.usage,
    usd,
    costSource,
    steps,
    requests: (r?.requests ?? 0) + 1,
  }
}

export interface MeterCall {
  /** meter one response (null: demo) */
  response(r: ResponseInput): LedgerEntry | null
  /** the receipt of the responses so far (null: none yet) */
  receipt(): Receipt | null
}

/** One facade call: its responses metered, its receipt reported. */
export function meterCall(prepared: Prepared, opts: MeterOpts = {}): MeterCall {
  let receipt: Receipt | null = null
  return {
    response(r) {
      const tap = opts.signal ? taps.get(opts.signal) : undefined
      const e = meterResponse(prepared, { role: opts.role, source: opts.source || tap?.source }, r)
      if (!e) return null
      receipt = addToReceipt(receipt, e)
      try {
        opts.onRun?.(receipt)
      } catch (err) {
        console.warn('[one] ai: a receipt listener failed', err)
      }
      for (const fn of tap?.fns ?? []) {
        try {
          fn(e)
        } catch (err) {
          console.warn('[one] ai: a meter tap failed', err)
        }
      }
      return e
    },
    receipt: () => receipt,
  }
}

/* ------------------------------------------------------------------ */
/* Claude responses (plain shapes — no SDK types here)                  */
/* ------------------------------------------------------------------ */

interface ClaudeMessageLike {
  model?: unknown
  usage?: unknown
  content?: unknown
  stop_reason?: unknown
}

const blocks = (v: unknown): Array<{ type?: unknown }> => (Array.isArray(v) ? (v as Array<{ type?: unknown }>) : [])
const mcpCount = (content: unknown) => blocks(content).filter((b) => b?.type === 'mcp_tool_use').length
const rawUsage = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)

/** A Claude response that arrived whole. */
export function claudeResponse(msg: ClaudeMessageLike, streamedChars = 0): ResponseInput {
  return {
    served: typeof msg.model === 'string' ? msg.model : null,
    usage: normalise('anthropic', rawUsage(msg.usage)),
    streamedChars,
    outcome: msg.stop_reason === 'refusal' ? 'refusal' : 'ok',
    mcpCalls: mcpCount(msg.content),
  }
}

/**
 * A Claude response that ended without its final message (stopped, failed): what its message_start said, the
 * characters that streamed. `httpStatus`: the request was refused with a status — with no message_start and nothing
 * streamed, nothing was billed.
 */
export function claudeCut(snapshot: ClaudeMessageLike | null | undefined, o: { promptChars: number; streamedChars: number; outcome: AIErrorCode; httpStatus: boolean }): ResponseInput {
  const u = snapshot?.usage ? normalise('anthropic', rawUsage(snapshot.usage)) : null
  return {
    served: typeof snapshot?.model === 'string' ? snapshot.model : null,
    usage: null,
    known: u ? { input: u.input, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, cacheWrite1h: u.cacheWrite1h, output: u.output } : null,
    promptChars: o.promptChars,
    streamedChars: o.streamedChars,
    outcome: o.outcome,
    mcpCalls: mcpCount(snapshot?.content),
    refused: o.httpStatus && !snapshot && o.streamedChars === 0,
  }
}

/** Characters a stream event carries (text, thinking, tool input) — for an estimate when the stream is cut. */
export function deltaChars(event: unknown): number {
  const ev = event as { type?: unknown; delta?: Record<string, unknown> } | null
  if (!ev || ev.type !== 'content_block_delta' || !ev.delta) return 0
  const d = ev.delta
  const s = typeof d.text === 'string' ? d.text : typeof d.thinking === 'string' ? d.thinking : typeof d.partial_json === 'string' ? d.partial_json : ''
  return s.length
}
