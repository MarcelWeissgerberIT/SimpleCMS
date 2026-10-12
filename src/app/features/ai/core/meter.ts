/**
 * Metering: every response of every engine is one ledger entry (features/governor) — the requested route, the model
 * that answered, its usage priced by the one table (src/shared/ai/prices.ts), the request's purpose and data classes.
 *  - a response that ended without its usage report (stopped, failed mid-stream) after it went out is an ESTIMATE:
 *    the input Claude's message_start reported (else the request's size ÷ 4: prompt, documents, pictures, tools) plus
 *    the streamed characters ÷ 4 — never $0;
 *  - a request every attempt of which was answered with an HTTP error status was not billed: zero tokens, still listed;
 *    one that never went out (stopped before it was sent) is no entry at all (client.ts `reachOf`);
 *  - another model than the requested one answered (Anthropic's refusal fallback) → a 'refusal-fallback' step; each
 *    hop is priced at its own model (usage.iterations), else the whole response at the model that answered;
 *  - demo answers are never metered, and neither is a gate check (precheck).
 * A facade call is one `meterCall`: one entry per response it gets (resumes, retries), its receipt (the sum) reported
 * through `onRun` and to the taps on its abort signal (runs.ts folds a run's requests into the card's receipt).
 */
import type { CostSource, LedgerEntry, LedgerRole, PriceRow, ProviderId, StepNote, Turn, Usage } from '@/shared/ai/types'
import type { ProviderError } from '@/shared/ai/errors'
import type { AIErrorCode } from '@/shared/ai/errors'
import { costOf, costSourceOf, priceRow } from '@/shared/ai/prices'
import { addUsage, estimateUsage, normalise, ZERO_USAGE } from '@/shared/ai/usage'
import { modelBase, sameModel } from '@/shared/ai/models'
import { routeKey } from '@/shared/ai/route'
import { CHARS_PER_TOKEN, meter } from '../../governor'
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
  /** every attempt was answered with an HTTP error status: nothing was billed */
  refused?: boolean
  /** the hops of a response another model finished (usage.iterations): each priced at its own model */
  parts?: Array<{ model: string | null; usage: Usage }>
  /** a neutral provider's response: the price row to use (the shortlist's, the served model's, a stated bound) */
  price?: PriceRow | null
  /** what happened on the way (substituted, routed, upstream) — a neutral provider's own */
  steps?: StepNote[]
  /** the operator that served it (OpenRouter's upstream) */
  upstream?: string
}

/** What a request (or a run of requests) cost — the receipt on run cards. */
export interface Receipt {
  /** the requested route, 'p:m' */
  route: string
  /** the model that answered (the latest response) and the operator that served it (OpenRouter) */
  served: { p: ProviderId; model: string; upstream?: string }
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
  // Claude: another model than the requested one = the refusal fallback; other providers report their own steps
  const claude = route.p === 'anthropic'
  const fallback = claude && !sameModel(route.m, served)
  const servedRoute = { p: route.p, m: claude ? (fallback ? served : route.m) : served }
  const at = Date.now()
  const row = r.price !== undefined ? r.price : priceRow(servedRoute)
  let usage: Usage
  let costSource: CostSource
  let usd: number | null
  if (r.usage && r.parts?.length) {
    // a refusal fallback: the declined hop at the requested model, the serving hop at the model that served it
    usage = r.usage
    usd = 0
    for (const part of r.parts) {
      const c = costOf(part.usage, priceRow({ p: route.p, m: part.model || route.m }), at).usd
      usd = usd === null || c === null ? null : usd + c
    }
    costSource = usd === null ? 'none' : row ? costSourceOf(row) : 'table'
  } else if (r.usage) {
    usage = r.usage
    ;({ usd, source: costSource } = costOf(usage, row, at))
  } else if (r.refused) {
    // every attempt answered with an error status: nothing was billed — an exact zero, never an estimate (a router's
    // stated bound or a missing row says nothing about a request that was refused)
    usage = ZERO_USAGE
    usd = row || !claude ? 0 : null
    costSource = row && row.source !== 'bound' ? costSourceOf(row) : claude ? 'none' : 'reported'
  } else {
    usage = estimateUsage(r.promptChars ?? 0, r.streamedChars ?? 0, r.known)
    usd = costOf(usage, row, at).usd
    costSource = row ? 'estimate' : 'none'
  }
  const steps: StepNote[] = fallback ? [{ k: 'refusal-fallback', from: route.m, to: modelBase(served) }] : [...(r.steps ?? [])]
  return meter({
    id: newId(),
    at,
    scope: '',
    purpose: prepared.purpose,
    cls: prepared.cls,
    source: opts.source || prepared.purpose,
    role: opts.role ?? 'main',
    route: routeKey(route),
    served: { p: route.p, model: servedRoute.m, ...(r.upstream ? { upstream: r.upstream.slice(0, 80) } : {}) },
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
    served: { p: e.served.p, model: e.served.model, ...(e.served.upstream ? { upstream: e.served.upstream } : {}) },
    usage: r ? addUsage(r.usage, e.usage) : e.usage,
    usd,
    costSource,
    steps,
    requests: (r?.requests ?? 0) + 1,
  }
}

/** One model's share of a conversation or a run — a line on its receipt (provider · model · requests · tokens · $). */
export interface ModelLine {
  p: ProviderId
  /** the model that answered */
  model: string
  requests: number
  input: number
  output: number
  cacheRead: number
  /** 5-minute and 1-hour cache writes */
  cacheWrite: number
  /** null: a response had no price */
  usd: number | null
  /** 'estimate' when any response was estimated, 'none' without a price */
  source: CostSource
}

/** The lines with one more response, one line per provider × model that answered (pure). */
export function addToLines(lines: readonly ModelLine[] | null | undefined, e: LedgerEntry): ModelLine[] {
  const out = [...(lines ?? [])]
  const i = out.findIndex((l) => l.p === e.served.p && l.model === e.served.model)
  const cur: ModelLine = i >= 0 ? out[i] : { p: e.served.p, model: e.served.model, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, source: e.costSource }
  const usd = cur.usd === null || e.usd === null ? null : cur.usd + e.usd
  const next: ModelLine = {
    ...cur,
    requests: cur.requests + 1,
    input: cur.input + e.usage.input,
    output: cur.output + e.usage.output,
    cacheRead: cur.cacheRead + e.usage.cacheRead,
    cacheWrite: cur.cacheWrite + e.usage.cacheWrite + e.usage.cacheWrite1h,
    usd,
    source: usd === null ? 'none' : cur.source === 'estimate' || e.costSource === 'estimate' ? 'estimate' : e.costSource,
  }
  if (i >= 0) out[i] = next
  else out.push(next)
  return out
}

/** A stored list of model lines (run records, the terminal's state) — only lines that hold; [] for anything else. */
export function readLines(v: unknown): ModelLine[] {
  if (!Array.isArray(v)) return []
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
  const out: ModelLine[] = []
  for (const x of v.slice(0, 24)) {
    if (!x || typeof x !== 'object') continue
    const l = x as Record<string, unknown>
    if ((l.p !== 'anthropic' && l.p !== 'openai' && l.p !== 'openrouter') || typeof l.model !== 'string' || !l.model || l.model.length > 200) continue
    const source = l.source === 'reported' || l.source === 'table' || l.source === 'catalogue' || l.source === 'estimate' || l.source === 'none' ? l.source : 'none'
    out.push({ p: l.p, model: l.model, requests: num(l.requests), input: num(l.input), output: num(l.output), cacheRead: num(l.cacheRead), cacheWrite: num(l.cacheWrite), usd: l.usd === null ? null : num(l.usd), source })
  }
  return out
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

interface HopLike {
  type?: unknown
  model?: unknown
}

/**
 * A Claude response that arrived whole. A refusal fallback names its hops in `usage.iterations`: a `fallback_message`
 * entry says which model served it (the signal the API documents), and every `message` / `fallback_message` hop is
 * priced at its own model — the declined hop at the requested one.
 */
export function claudeResponse(msg: ClaudeMessageLike, streamedChars = 0): ResponseInput {
  const raw = rawUsage(msg.usage)
  const hops = (Array.isArray(raw?.iterations) ? (raw.iterations as HopLike[]) : []).filter((h) => h && (h.type === 'message' || h.type === 'fallback_message'))
  const served = hops.find((h) => h.type === 'fallback_message' && typeof h.model === 'string')?.model as string | undefined
  return {
    served: served ?? (typeof msg.model === 'string' ? msg.model : null),
    usage: normalise('anthropic', raw),
    streamedChars,
    outcome: msg.stop_reason === 'refusal' ? 'refusal' : 'ok',
    mcpCalls: mcpCount(msg.content),
    ...(served ? { parts: hops.map((h) => ({ model: typeof h.model === 'string' ? h.model : null, usage: normalise('anthropic', h as Record<string, unknown>) })) } : {}),
  }
}

/**
 * A Claude response that ended without its final message (stopped, failed): what its message_start said, the
 * characters that streamed. `sent`: an attempt was in flight or answered when it ended (client.ts `reachOf` 'sent') —
 * else every attempt was refused with an error status, and nothing was billed.
 */
export function claudeCut(snapshot: ClaudeMessageLike | null | undefined, o: { promptChars: number; streamedChars: number; outcome: AIErrorCode; sent: boolean }): ResponseInput {
  const u = snapshot?.usage ? normalise('anthropic', rawUsage(snapshot.usage)) : null
  return {
    served: typeof snapshot?.model === 'string' ? snapshot.model : null,
    usage: null,
    known: u ? { input: u.input, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, cacheWrite1h: u.cacheWrite1h, output: u.output } : null,
    promptChars: o.promptChars,
    streamedChars: o.streamedChars,
    outcome: o.outcome,
    mcpCalls: mcpCount(snapshot?.content),
    refused: !o.sent,
  }
}

/* ------------------------------------------------------------------ */
/* Neutral providers (OpenRouter): turns and cut responses              */
/* ------------------------------------------------------------------ */

/**
 * A neutral provider's whole turn. Its reported cost wins (costOf); without one it is priced at `price` (the shortlist
 * row; for the Jev Router the served model's row, else the bound — never $0). A turn without a usage report is an
 * estimate from the request's size and what streamed.
 */
export function neutralResponse(turn: Turn, o: { price: PriceRow | null; steps?: StepNote[]; promptChars: number; outcome?: 'ok' | AIErrorCode }): ResponseInput {
  return {
    served: turn.served,
    usage: turn.usage,
    promptChars: o.promptChars,
    streamedChars: turn.streamedChars,
    outcome: o.outcome ?? (turn.stop === 'refusal' ? 'refusal' : 'ok'),
    mcpCalls: 0,
    price: o.price,
    ...(o.steps?.length ? { steps: o.steps } : {}),
    ...(turn.upstream ? { upstream: turn.upstream } : {}),
  }
}

/**
 * A neutral provider's response that ended without its turn (failed, stopped): refused with a status → nothing billed;
 * otherwise an estimate from the request's size, the usage it reported so far and what streamed.
 */
export function neutralCut(e: ProviderError, o: { promptChars: number; price: PriceRow | null; aborted?: boolean }): ResponseInput {
  const partial = (e.partial as Turn | undefined) ?? null
  const u = partial?.usage ?? null
  return {
    served: partial?.served ?? null,
    usage: null,
    known: u ? { input: u.input, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, cacheWrite1h: u.cacheWrite1h, output: u.output } : null,
    promptChars: o.promptChars,
    streamedChars: partial?.streamedChars ?? 0,
    outcome: o.aborted ? 'aborted' : e.code,
    mcpCalls: 0,
    refused: e.reach === 'refused',
    price: o.price,
    ...(partial?.upstream ? { upstream: partial.upstream } : {}),
  }
}

/** Prompt characters a picture counts as in an estimate (Claude: about width × height ÷ 750 tokens). */
export const imageChars = (width: number, height: number): number => Math.ceil((Math.max(1, width) * Math.max(1, height)) / 750) * CHARS_PER_TOKEN

/** Prompt characters a PDF counts as in an estimate: the text and a picture of every page (about 3,000 tokens each). */
export const pdfChars = (pages: number): number => Math.max(1, Math.round(pages)) * 3000 * CHARS_PER_TOKEN

/** Characters a stream event carries (text, thinking, tool input) — for an estimate when the stream is cut. */
export function deltaChars(event: unknown): number {
  const ev = event as { type?: unknown; delta?: Record<string, unknown> } | null
  if (!ev || ev.type !== 'content_block_delta' || !ev.delta) return 0
  const d = ev.delta
  const s = typeof d.text === 'string' ? d.text : typeof d.thinking === 'string' ? d.thinking : typeof d.partial_json === 'string' ? d.partial_json : ''
  return s.length
}
