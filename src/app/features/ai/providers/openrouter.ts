/**
 * OpenRouter — the transport (multi-provider S2), a lazy chunk: `fetch` + the shared SSE parser + the pure wire
 * (src/shared/ai/wire/openrouterChat.ts). It imports nothing from the store, other features or the Claude SDK (a Node
 * spec imports it with a stubbed fetch), and it never decides anything about data: the gate and core/call.ts hand it a
 * request that may go out, the key for this one request, the endpoint pins and the upstream rule.
 *
 *  - send(): one streamed chat request; a failure is a ProviderError (code, scrubbed detail, how far it got, the turn
 *    so far); a 'decide' request is refused ('capability') before anything is sent; `X-OpenRouter-Metadata` is never sent.
 *  - verify(): `GET /api/v1/key` — the key's credit, no text sent.
 *  - exchangeCode(): the OAuth (PKCE) code → a key (`POST /api/v1/auth/keys`); the account id it also returns is dropped.
 *  - mcp(): OpenRouter connects no MCP server — every one is skipped ('provider').
 */
import type { BuiltRequest, McpRendering, ProviderAdapter, SendContext, TurnOf, VerifyResult } from '@/shared/ai/adapter'
import type { ChatRequest, KeyCredit, McpPlan, Turn, WireRequest } from '@/shared/ai/types'
import { ProviderError } from '@/shared/ai/errors'
import { scrubSecrets } from '@/shared/ai/keys'
import { createSSEParser } from '@/shared/ai/sse'
import { isJevRouter } from '@/shared/ai/jev'
import { OR_API, WireFailure, build, capabilityProblem, classify, createChatParser } from '@/shared/ai/wire/openrouterChat'

export const OR_KEY_URL = `${OR_API}/key`
export const OR_AUTH_KEYS_URL = `${OR_API}/auth/keys`

const clip = (s: string, key?: string) => {
  const t = scrubSecrets(s, [key]).replace(/\s+/g, ' ').trim()
  return t.length > 240 ? `${t.slice(0, 239)}…` : t
}
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isAbort = (e: unknown) => (e instanceof DOMException || (e instanceof Error && 'name' in e)) && (e as Error).name === 'AbortError'

/** A non-2xx answer's body: JSON when it is JSON, else its text (never more than 8 000 characters read into a detail). */
async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text.slice(0, 8000)
  }
}

function buildOf(req: ChatRequest, ctx: Omit<SendContext, 'key' | 'signal' | 'onEvent'>): BuiltRequest {
  return build(req, ctx.model, { pins: ctx.pins ?? [], upstream: ctx.upstream ?? { deny: [], noCollect: true, zdr: false }, referer: ctx.referer ?? '', ...(ctx.router ? { router: ctx.router } : {}), ...(ctx.maxPrice ? { maxPrice: ctx.maxPrice } : {}) })
}

/** One streamed chat request → the whole turn (or a ProviderError). */
async function sendChat(req: ChatRequest, ctx: SendContext): Promise<Turn> {
  if (ctx.signal?.aborted) throw new ProviderError('aborted', undefined, { reach: 'none' })
  // what the model cannot take never leaves the device
  const missing = capabilityProblem(req, ctx.model.caps)
  if (missing) throw new ProviderError('capability', missing, { reach: 'none' })
  const built = buildOf(req, ctx)
  const router = isJevRouter(ctx.model.route.m)
  let res: Response
  try {
    res = await fetch(built.url, { method: 'POST', headers: { ...built.headers, Authorization: `Bearer ${ctx.key}` }, body: JSON.stringify(built.body), signal: ctx.signal })
  } catch (e) {
    // in flight when it ended: it may have been processed (an estimate, never zero)
    if (ctx.signal?.aborted || isAbort(e)) throw new ProviderError('aborted', undefined, { reach: 'sent' })
    throw new ProviderError('offline', clip(messageOf(e), ctx.key), { reach: 'sent' })
  }
  if (!res.ok) {
    const c = classify(res.status, await bodyOf(res), res.headers, { router })
    throw new ProviderError(c.code, clip(c.detail, ctx.key), { reach: 'refused', status: res.status, ...(c.retryAfter !== undefined ? { retryAfter: c.retryAfter } : {}), ...(c.limitSource ? { limitSource: c.limitSource } : {}) })
  }
  const parser = createChatParser(ctx.onEvent, { router })
  const fail = (e: unknown): never => {
    if (e instanceof WireFailure) throw new ProviderError(e.failure.code, clip(e.failure.detail, ctx.key), { reach: 'sent', partial: e.partial, ...(e.failure.retryAfter !== undefined ? { retryAfter: e.failure.retryAfter } : {}) })
    if (ctx.signal?.aborted || isAbort(e)) throw new ProviderError('aborted', undefined, { reach: 'sent', partial: parser.partial() })
    throw new ProviderError('offline', clip(messageOf(e), ctx.key), { reach: 'sent', partial: parser.partial() })
  }
  // a 200 that is JSON, not a stream: a whole completion, or (the docs) a body holding only an error
  if (!/text\/event-stream/i.test(res.headers.get('content-type') ?? '') && /json/i.test(res.headers.get('content-type') ?? '')) {
    try {
      parser.feed(await res.text())
      parser.feed('[DONE]')
      return parser.end()
    } catch (e) {
      return fail(e)
    }
  }
  const sse = createSSEParser((e) => parser.feed(e.data))
  try {
    const reader = res.body?.getReader()
    if (!reader) throw new WireFailure({ code: 'empty', detail: 'no response body' }, parser.partial())
    const dec = new TextDecoder('utf-8')
    const stop = () => void reader.cancel().catch(() => undefined)
    ctx.signal?.addEventListener('abort', stop, { once: true })
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        sse.feed(dec.decode(value, { stream: true }))
        if (ctx.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      }
      sse.feed(dec.decode())
      sse.end()
    } finally {
      ctx.signal?.removeEventListener('abort', stop)
    }
    if (ctx.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return parser.end()
  } catch (e) {
    return fail(e)
  }
}

/** `GET /api/v1/key` → the key's credit (no text is sent). 402 = a valid key without credit ('no_credit'). */
export async function verify(key: string, signal?: AbortSignal): Promise<VerifyResult> {
  let res: Response
  try {
    res = await fetch(OR_KEY_URL, { method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal })
  } catch (e) {
    return { ok: false, code: signal?.aborted || isAbort(e) ? 'aborted' : 'offline' }
  }
  if (!res.ok) return { ok: false, code: classify(res.status, await bodyOf(res), res.headers).code }
  const json = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null
  return { ok: true, credit: creditOf(json?.data) }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The key fields One shows (SP-R3: verify with a real key). */
export function creditOf(d: Record<string, unknown> | null | undefined): KeyCredit {
  return {
    limit: num(d?.limit),
    remaining: num(d?.limit_remaining),
    used: Math.max(0, num(d?.usage) ?? 0),
    free: d?.is_free_tier === true,
    reset: typeof d?.limit_reset === 'string' ? d.limit_reset.slice(0, 16) : null,
  }
}

export type Exchange = { ok: true; key: string } | { ok: false; status: number | null; detail: string }

/** The PKCE code → a key (the code is single use). `status: null` = it never got an answer (network, CORS). */
export async function exchangeCode(code: string, verifier: string, signal?: AbortSignal): Promise<Exchange> {
  let res: Response
  try {
    res = await fetch(OR_AUTH_KEYS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }), signal })
  } catch (e) {
    return { ok: false, status: null, detail: clip(messageOf(e)) }
  }
  const body = await bodyOf(res)
  const key = res.ok && body && typeof body === 'object' && typeof (body as { key?: unknown }).key === 'string' ? (body as { key: string }).key.trim() : ''
  if (key) return { ok: true, key }
  const msg = body && typeof body === 'object' && typeof (body as { error?: { message?: unknown } }).error?.message === 'string' ? (body as { error: { message: string } }).error.message : typeof body === 'string' ? body : ''
  return { ok: false, status: res.ok ? 502 : res.status, detail: clip(msg, key) }
}

/** OpenRouter renders no MCP server: every one is skipped as 'provider' (never a token opened, never a server named). */
export function mcp(plan: McpPlan): McpRendering {
  return { native: null, skipped: plan.servers.map((s) => ({ server: s.name, why: 'provider' as const })) }
}

export const openrouter: ProviderAdapter = {
  id: 'openrouter',
  kinds: ['chat'],
  retriesInside: false,
  build: (req, ctx) => buildOf(req, ctx),
  async send<R extends WireRequest>(req: R, ctx: SendContext): Promise<TurnOf<R>> {
    // the decide kind has its own wire (a later slice): refused before anything is sent
    if (req.kind !== 'chat') throw new ProviderError('capability', 'decide', { reach: 'none' })
    return (await sendChat(req, ctx)) as TurnOf<R>
  },
  mcp: (plan) => mcp(plan),
  verify,
}
