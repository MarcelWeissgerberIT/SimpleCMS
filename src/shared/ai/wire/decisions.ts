/**
 * OpenRouter's decisions API — the wire, pure (no fetch, no DOM): the request One sends to a decision model
 * (`buildDecide`, guarded by `assertSafeDecideBody`), the answer read strictly (`parseDecide`) and the error table
 * (`classifyDecide`). Formats follow the docs snapshot (ordocs: the decisions API reference, the Jev guide and tutorial,
 * the gate / cascade / classification cookbooks); none is checked against a real response yet (SP-J1 …).
 *
 * A body always carries: a pinned Jev version, the state, the questions, `provider.only` (Jev's endpoint tags),
 * `allow_fallbacks: false`, `data_collection` (and `zdr`) per the upstream rule. Never: `require_parameters` (every
 * decision row lists no parameters — requiring them loosens nothing and might 404, SP-J1), `session_id`, `trace`, `user`,
 * `metadata`, `plugins`, `models`. A decision model writes no text: an answer is numbers, read against the questions asked.
 */
import type { DecideAnswer, DecideQuestion, DecideRequest, DecideTurn, UpstreamRule } from '../types.ts'
import { ProviderError } from '../errors.ts'
import { normalise } from '../usage.ts'
import { DECISIONS_URL, JEV_STATE_TOKENS, isJevModel } from '../jev.ts'
import { OR_HEADERS, classify, type Built, type Classified } from './openrouterChat.ts'

export interface DecideBuildOpts {
  /** Jev's endpoint tags (`provider.only`) */
  pins: readonly string[]
  upstream: UpstreamRule
  /** the app's address (`HTTP-Referer`) */
  referer: string
}

/** A question key One sends (the answers come back under it). */
export const QUESTION_KEY = /^[a-z][a-z0-9_]{0,31}$/

/** What a state + its questions take of the model's window, as One counts it: characters ÷ 4 + 300. */
export function decideTokens(state: unknown, questions: unknown): number {
  const chars = (JSON.stringify(state) ?? '').length + (JSON.stringify(questions) ?? '').length
  return Math.ceil(chars / 4) + 300
}

/** Is a request over One's state cap (it is never sent — 'context')? */
export const overCap = (req: Pick<DecideRequest, 'state' | 'questions'>): boolean => decideTokens(req.state, req.questions) > JEV_STATE_TOKENS

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** A question as the API takes it (only the documented fields). */
function renderQuestion(q: DecideQuestion): Json {
  if (q.type === 'noul') return { type: 'noul', instructions: q.instructions, ...(q.criteria ? { criteria: { true: q.criteria.true, false: q.criteria.false } } : {}) }
  if (q.type === 'choice') return { type: 'choice', instructions: q.instructions, criteria: { ...q.criteria } }
  return { type: 'score', instructions: q.instructions, criteria: [...q.criteria] }
}

/** The request as it goes over the wire (throws when it would break One's rules — assertSafeDecideBody). */
export function buildDecide(req: DecideRequest, opts: DecideBuildOpts): Built {
  const upstream = opts.upstream
  const body: Json = {
    model: req.route.m,
    state: req.state,
    questions: Object.fromEntries(Object.entries(req.questions).map(([k, q]) => [k, renderQuestion(q)])),
    provider: {
      only: [...opts.pins],
      allow_fallbacks: false,
      data_collection: upstream.noCollect ? 'deny' : 'allow',
      ...(upstream.zdr ? { zdr: true } : {}),
    },
  }
  assertSafeDecideBody(body)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  for (const [k, v] of Object.entries(OR_HEADERS)) headers[k] = v ?? opts.referer
  return { url: DECISIONS_URL, body, headers }
}

/** Body fields a decisions request never carries. */
export const DECIDE_FORBIDDEN = ['session_id', 'trace', 'user', 'metadata', 'plugins', 'models', 'require_parameters', 'stream'] as const

/** Throws when a decisions body breaks One's rules (buildDecide calls it; tests call it on hand-made bodies). */
export function assertSafeDecideBody(body: unknown): void {
  const fail = (why: string): never => {
    throw new Error(`unsafe decisions body: ${why}`)
  }
  if (!isObj(body)) fail('not an object')
  const b = body as Json
  for (const k of DECIDE_FORBIDDEN) if (k in b) fail(`"${k}" is never sent`)
  for (const k of Object.keys(b)) if (!['model', 'state', 'questions', 'provider'].includes(k)) fail(`"${k}" is never sent`)
  if (!isJevModel(b.model)) fail(`model "${String(b.model)}" is not a pinned Jev version`)
  const p = isObj(b.provider) ? b.provider : fail('no provider pins')
  for (const k of Object.keys(p)) if (!['only', 'allow_fallbacks', 'data_collection', 'zdr'].includes(k)) fail(`provider.${k} is never sent`)
  if (!Array.isArray(p.only) || !p.only.length || !p.only.every((x) => typeof x === 'string' && x.length > 0)) fail('provider.only must name the endpoints')
  if (p.allow_fallbacks !== false) fail('allow_fallbacks must be false')
  if (p.data_collection !== 'deny' && p.data_collection !== 'allow') fail('data_collection must be stated')
  if ('zdr' in p && p.zdr !== true) fail('zdr is sent only as true')
  if (!isObj(b.state)) fail('the state is an object')
  const qs = isObj(b.questions) ? b.questions : fail('no questions')
  const keys = Object.keys(qs)
  if (!keys.length) fail('no questions')
  for (const k of keys) {
    if (!QUESTION_KEY.test(k)) fail(`question key "${k}"`)
    const q = qs[k]
    if (!isObj(q) || (q.type !== 'noul' && q.type !== 'choice' && q.type !== 'score') || typeof q.instructions !== 'string' || !q.instructions) fail(`question "${k}"`)
  }
  if (decideTokens(b.state, b.questions) > JEV_STATE_TOKENS) fail('the state is over the cap')
}

/* ------------------------------------------------------------------ */
/* The answer                                                           */
/* ------------------------------------------------------------------ */

const prob = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null)

/** A probabilities map: only the listed options, each a probability (anything else left out). */
function probsOf(v: unknown, allowed: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isObj(v)) return out
  for (const k of allowed) {
    const p = prob(v[k])
    if (p !== null) out[k] = p
  }
  return out
}

/** One answer read against its question (null: missing, of another type, out of range, an option not offered). */
function readAnswer(a: unknown, q: DecideQuestion): DecideAnswer | null {
  if (!isObj(a) || a.type !== q.type) return null
  if (q.type === 'noul') {
    const p = prob(a.noul)
    return p === null ? null : { type: 'noul', p }
  }
  const confidence = a.confidence === undefined || a.confidence === null ? null : prob(a.confidence)
  if (confidence === null && a.confidence !== undefined && a.confidence !== null) return null
  if (q.type === 'choice') {
    const options = Object.keys(q.criteria)
    if (typeof a.choice !== 'string' || !options.includes(a.choice)) return null
    return { type: 'choice', choice: a.choice, confidence, probs: probsOf(a.probabilities, options) }
  }
  const n = q.criteria.length
  if (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > n - 1) return null
  return { type: 'score', score: a.score, confidence, probs: probsOf(a.probabilities, q.criteria.map((_, i) => String(i))) }
}

/**
 * A 200 answer → the turn. Every question asked must come back with its type (noul in [0, 1]; a choice among the offered
 * options; a score on the scale) and the response must name its model — else a ProviderError 'empty' that went out (it
 * was answered: metered from the usage it reported, carried as the partial turn). `usage.output_tokens` is kept (it is
 * priced at the row's output price — 0 for decisions); `usage.cost` is the reported cost.
 */
export function parseDecide(json: unknown, questions: Readonly<Record<string, DecideQuestion>>): DecideTurn {
  const j = isObj(json) ? json : {}
  const usage = isObj(j.usage) ? normalise('openrouter', j.usage) : null
  const model = typeof j.model === 'string' ? j.model.slice(0, 200) : ''
  const upstream = typeof j.provider === 'string' && j.provider ? j.provider.slice(0, 80) : undefined
  const served = { model, ...(upstream ? { upstream } : {}) }
  const empty = (detail: string): never => {
    throw new ProviderError('empty', detail, { reach: 'sent', partial: { kind: 'decide', answers: {}, served, usage } satisfies DecideTurn })
  }
  if (!model) empty('the answer names no model')
  const raw = isObj(j.answers) ? j.answers : empty('no answers')
  const answers: Record<string, DecideAnswer> = {}
  for (const [k, q] of Object.entries(questions)) {
    const a = readAnswer(raw[k], q)
    if (!a) empty(raw[k] === undefined ? `no answer to "${k}"` : `the answer to "${k}" does not fit its question`)
    answers[k] = a!
  }
  return { kind: 'decide', answers, served, usage }
}

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

/**
 * An error answer of the decisions surface → One's code: the chat table (classify — 401, 402 credits vs in-flight
 * "busy", 403 permission / moderation / budgets, 404 no endpoints vs a gone model, 429, 5xx) plus what the decisions
 * reference lists on its own: 413 → 'context', 524 → 'timeout', 529 → 'overloaded'.
 */
export function classifyDecide(status: number, body: unknown, headers?: Record<string, string> | Headers | null): Classified {
  const c = classify(status, body, headers)
  if (status === 413) return { ...c, code: 'context' }
  if (status === 524) return { ...c, code: 'timeout' }
  if (status === 529) return { ...c, code: 'overloaded' }
  return c
}
