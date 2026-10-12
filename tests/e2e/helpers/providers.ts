/**
 * AI provider mocks for the e2e suite — nothing ever reaches a real host. `mockClaudeScript` answers
 * api.anthropic.com from a script in the Messages API shape: streamed requests get SSE, others a JSON message; each
 * request takes the next step (text, thinking, tool_use with its input in `input_json_delta` fragments — or raw, even
 * unparseable, JSON —, mcp_tool_use / mcp_tool_result, a pause_turn stop, a served model other than the requested one,
 * an API error). Returns every request as captured on the wire (method, path, anthropic-beta header, parsed body).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page, Request } from '@playwright/test'
import { AI_HOSTS, type AiHost } from './aiNet'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CapturedRequest {
  method: string
  path: string
  /** the anthropic-beta header ('' = none) */
  beta: string
  body: AnyState
}

export type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  /** `input` as a string is sent as it is (a deliberately unparseable one makes the SDK reject the stream) */
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> | string }
  | { type: 'mcp_tool_use'; id: string; server: string; name: string; input: Record<string, unknown> }
  | { type: 'mcp_tool_result'; id: string; text: string; error?: boolean }

export interface ClaudeTurn {
  blocks: ClaudeBlock[]
  /** default: tool_use when a tool_use block is in the turn, else end_turn */
  stop?: 'end_turn' | 'tool_use' | 'pause_turn' | 'max_tokens' | 'refusal'
  /** the model that answered (default: the requested one) — another one = Anthropic's refusal fallback */
  model?: string
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  /** usage.iterations: the hops of a refusal fallback ('message' = a hop that declined, 'fallback_message' = the one that served) */
  hops?: Array<{ type: 'message' | 'fallback_message'; model: string; input: number; output: number }>
  /** usage.output_tokens_details.thinking_tokens (part of the output) */
  thinking?: number
}

/** The usage fields a turn adds to the final usage report (iterations, thinking tokens). */
function moreUsage(turn: ClaudeTurn): AnyState {
  return {
    ...(turn.hops ? { iterations: turn.hops.map((h) => ({ type: h.type, model: h.model, input_tokens: h.input, output_tokens: h.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null })) } : {}),
    ...(turn.thinking !== undefined ? { output_tokens_details: { thinking_tokens: turn.thinking } } : {}),
  }
}

export interface ClaudeApiError {
  status: number
  json: unknown
}

export type ClaudeStep = ClaudeTurn | ClaudeApiError | ((req: CapturedRequest, n: number) => ClaudeTurn | ClaudeApiError)

let seq = 0

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

/** One streamed assistant message (Messages API SSE). */
export function claudeSse(turn: ClaudeTurn, requested = 'claude-opus-5-5'): string {
  const { blocks } = turn
  const stop = turn.stop ?? (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
  const u = turn.usage ?? {}
  let body = ev('message_start', {
    message: {
      id: `msg_script_${++seq}`,
      type: 'message',
      role: 'assistant',
      model: turn.model ?? requested,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: u.input ?? 1000, output_tokens: 1, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0 },
    },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'thinking') {
      body += ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.text } })
      body += ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig-e2e' } })
    } else if (b.type === 'tool_use') {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      const raw = typeof b.input === 'string' ? b.input : JSON.stringify(b.input)
      for (const chunk of raw.match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    } else if (b.type === 'mcp_tool_use') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_result', tool_use_id: b.id, is_error: !!b.error, content: [{ type: 'text', text: b.text }] } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: u.output ?? 80, ...moreUsage(turn) } })
  body += ev('message_stop', {})
  return body
}

/** The same turn as a non-streaming JSON message. */
export function claudeJson(turn: ClaudeTurn, requested = 'claude-opus-5-5'): AnyState {
  const u = turn.usage ?? {}
  const content = turn.blocks.map((b) =>
    b.type === 'text'
      ? { type: 'text', text: b.text }
      : b.type === 'thinking'
        ? { type: 'thinking', thinking: b.text, signature: 'sig-e2e' }
        : b.type === 'tool_use'
          ? { type: 'tool_use', id: b.id, name: b.name, input: typeof b.input === 'string' ? {} : b.input }
          : b.type === 'mcp_tool_use'
            ? { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: b.input }
            : { type: 'mcp_tool_result', tool_use_id: b.id, is_error: !!b.error, content: [{ type: 'text', text: b.text }] },
  )
  const stop = turn.stop ?? (turn.blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
  return {
    id: `msg_script_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: turn.model ?? requested,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: u.input ?? 400, output_tokens: u.output ?? 40, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0, ...moreUsage(turn) },
  }
}

export const text = (t: string, more: Omit<ClaudeTurn, 'blocks'> = {}): ClaudeTurn => ({ blocks: [{ type: 'text', text: t }], ...more })

/**
 * api.anthropic.com → request n gets steps[n] (then `fallback`, default a short text). GET /v1/models answers a
 * one-model list (the free key check). Never lets a request through.
 */
export async function mockClaudeScript(ctx: BrowserContext | Page, steps: ClaudeStep[], opts: { fallback?: ClaudeStep } = {}): Promise<{ requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    if (req.method() === 'GET')
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }),
      })
    const body = JSON.parse(req.postData() ?? '{}') as AnyState
    const captured: CapturedRequest = { method: req.method(), path: url.pathname, beta: (await req.allHeaders())['anthropic-beta'] ?? '', body }
    requests.push(captured)
    const n = requests.length - 1
    const step = steps[n] ?? opts.fallback ?? text('Done.')
    const out = typeof step === 'function' ? step(captured, n) : step
    try {
      if ('status' in out) return await route.fulfill({ status: out.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(out.json) })
      if (body.stream === true) return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: claudeSse(out, body.model) })
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(claudeJson(out, body.model)) })
    } catch {
      /* the request was aborted (Stop) */
    }
  })
  return { requests }
}

/**
 * Requests to each AI host from now on — mocked or not, CORS preflights left out — as a live object, for "zero
 * requests" assertions with a positive control (the aiNet fixture counts per test; this counts from a point on).
 */
export function hostCounts(target: Page | BrowserContext): Record<AiHost, number> {
  const out: Record<AiHost, number> = { anthropic: 0, openai: 0, openrouter: 0 }
  const ctx = 'context' in target ? target.context() : target
  ctx.on('request', (req: Request) => {
    if (req.method() === 'OPTIONS') return
    const host = new URL(req.url()).host
    for (const [k, h] of Object.entries(AI_HOSTS) as Array<[AiHost, string]>) if (host === h && req.url().startsWith('https://')) out[k] += 1
  })
  return out
}

/* ------------------------------------------------------------------ */
/* OpenRouter (multi-provider S2) — every exchange from the documented formats (ordocs); nothing reaches openrouter.ai */
/* ------------------------------------------------------------------ */


const OR_DOC = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/ai/openrouter/doc/${name}.json`, import.meta.url)), 'utf8')) as AnyState
/** The trimmed public catalogue (≤ 40 rows). */
export const OR_CATALOGUE = (): AnyState => JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as AnyState

export interface ORCaptured {
  method: string
  path: string
  /** request headers, the Authorization header left out (it is only checked to be a Bearer key) */
  headers: Record<string, string>
  /** the key the request carried ('' = none) */
  bearer: string
  body: AnyState | null
}

/** One scripted answer to a chat POST. */
export type ORStep =
  | {
      /** the answer text (streamed in pieces of `chunk` characters, default 12) */
      text: string
      /** the model the chunks name (default: the request's model; the Jev Router: the first pool model) */
      model?: string
      provider?: string
      /** usage.cost (USD); null = the usage chunk carries no cost */
      cost?: number | null
      usage?: { prompt?: number; completion?: number; cached?: number; written?: number; reasoning?: number }
      reasoning?: string
      refusal?: string
      annotations?: boolean
      chunk?: number
    }
  /** a doc-derived stream fixture as it is */
  | { fixture: string }
  /** a pre-stream error answer (JSON) */
  | { status: number; json: unknown; headers?: Record<string, string> }
  /** text, then the mid-stream error frame */
  | { text?: string; midError: { code: number | string; message: string; type?: string } }
  /** the answer comes only after `ms` (a request stopped meanwhile was in flight: an estimate) */
  | { delay: number; then: ORStep }

export type ORStepFn = ORStep | ((req: ORCaptured, n: number) => ORStep)

/** How the consent page answers (`openrouter.ai/auth`): approve, deny (with or without `state`), or a code without `state`. */
export type ORConsent = 'approve' | 'deny' | 'deny-state' | 'code-no-state' | ((url: URL) => string)

export interface ORMockOpts {
  /** answers to chat POSTs, in order (then `fallback`, default a short text) */
  chat?: ORStepFn[]
  fallback?: ORStepFn
  /** GET /api/v1/key: 'ok' (the doc fixture), a status, or a function */
  key?: 'ok' | number | ((req: ORCaptured) => { status: number; json: unknown })
  /** POST /api/v1/auth/keys: the key it hands out, a status (an error), 'cors' (no answer the browser may read) */
  exchange?: string | number | 'cors'
  consent?: ORConsent
  /** /models/{id}/endpoints: tags per model (default: one endpoint per model, tag from its maker) */
  endpoints?: Record<string, Array<{ tag: string; name?: string }>>
}

export interface ORMock {
  requests: ORCaptured[]
  /** the chat POSTs ("exactly one request" assertions) */
  posts(): ORCaptured[]
  /** requests to a path (GETs of /models, /endpoints, /key; POSTs of /auth/keys) */
  to(path: string | RegExp, method?: string): ORCaptured[]
}

const orCors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-expose-headers': 'retry-after' }
let orSeq = 0

/** One Chat Completions chunk (doc shape). */
const orChunk = (model: string, provider: string, delta: AnyState, finish: string | null = null, more: AnyState = {}) => ({ id: `gen-e2e-${orSeq}`, provider, model, object: 'chat.completion.chunk', created: 1790000000, choices: [{ index: 0, delta, finish_reason: finish, native_finish_reason: finish, logprobs: null }], ...more })

/** A scripted answer → its SSE (doc shape: deltas, the last content chunk, the usage chunk repeating the finish, [DONE]). */
export function orSse(step: Extract<ORStep, { text: string }>, model: string, defaultProvider = 'Nordwind'): string {
  orSeq++
  const provider = step.provider ?? defaultProvider
  const m = step.model ?? model
  const pieces = step.text ? (step.text.match(new RegExp(`[\\s\\S]{1,${step.chunk ?? 12}}`, 'g')) ?? []) : []
  const u = step.usage ?? {}
  const completion = u.completion ?? Math.max(1, Math.ceil(step.text.length / 4))
  const prompt = u.prompt ?? 900
  const usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, ...(step.cost === null ? {} : { cost: step.cost ?? 0.0003 }), is_byok: false, prompt_tokens_details: { cached_tokens: u.cached ?? 0, cache_write_tokens: u.written ?? 0 }, completion_tokens_details: { reasoning_tokens: u.reasoning ?? 0 } }
  const finish = step.refusal ? 'content_filter' : 'stop'
  const chunks: AnyState[] = []
  if (step.reasoning) chunks.push(orChunk(m, provider, { role: 'assistant', content: '', reasoning: step.reasoning }))
  if (step.refusal) chunks.push(orChunk(m, provider, { role: 'assistant', content: '', refusal: step.refusal }))
  pieces.forEach((p, i) => chunks.push(orChunk(m, provider, i === 0 && !step.reasoning ? { role: 'assistant', content: p } : { content: p })))
  chunks.push(orChunk(m, provider, { content: '', ...(step.annotations ? { annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.org/report', title: 'Report', content: 'x', start_index: 0, end_index: 1 } }] } : {}) }, finish))
  chunks.push(orChunk(m, provider, { content: '' }, finish, { usage }))
  return `: OPENROUTER PROCESSING\n\n${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`
}

/** The model a chunk names by default: the request's own, or (the Jev Router) the first model of its pool. */
function orServed(body: AnyState | null): string {
  const m = typeof body?.model === 'string' ? body.model : 'vendor-a/model-b'
  if (m !== 'typesafe/jev-router') return m
  const plug = Array.isArray(body?.plugins) ? body.plugins.find((p: AnyState) => p?.id === 'jev-router') : null
  return Array.isArray(plug?.models) && typeof plug.models[0] === 'string' ? plug.models[0] : 'vendor-a/model-b'
}

/** Endpoints of a model (synthesised — research § 4.7 shape, verify with a real key). */
const orEndpoints = (id: string, list?: Array<{ tag: string; name?: string }>) => {
  const eps = list ?? [{ tag: id === 'typesafe/jev-router' ? 'typesafe' : (id.split('/')[0] ?? 'nordwind'), name: id === 'typesafe/jev-router' ? 'TypeSafe' : 'Nordwind' }]
  return { data: { id, name: id, endpoints: eps.map((e) => ({ name: `${e.name ?? e.tag} | ${id}`, model_name: id, context_length: 131072, pricing: { prompt: '0.0000003', completion: '0.0000012' }, provider_name: e.name ?? e.tag, tag: e.tag, quantization: 'fp8', max_completion_tokens: 16384, max_prompt_tokens: null, supported_parameters: ['max_tokens', 'response_format', 'structured_outputs', 'tools', 'reasoning'], status: 0, uptime_last_30m: 99.5, supports_implicit_caching: false })) } }
}

/**
 * openrouter.ai → scripted answers: chat POSTs (SSE from the documented chunk shapes, pre-stream errors, mid-stream error
 * frames, a hanging stream), the key check, the catalogue (the trimmed fixture), endpoint lists, the PKCE exchange and the
 * consent page. CORS preflights are answered. Never lets a request through.
 */
export async function mockOpenRouter(ctx: BrowserContext | Page, opts: ORMockOpts = {}): Promise<ORMock> {
  const requests: ORCaptured[] = []
  let n = 0
  await ctx.route('https://openrouter.ai/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: orCors })
    const url = new URL(req.url())
    const headers = await req.allHeaders()
    const auth = headers.authorization ?? ''
    const { authorization: _auth, ...rest } = headers
    let body: AnyState | null = null
    try {
      body = req.postData() ? (JSON.parse(req.postData()!) as AnyState) : null
    } catch {
      body = null
    }
    const cap: ORCaptured = { method: req.method(), path: url.pathname, headers: rest, bearer: auth.replace(/^Bearer\s+/i, ''), body }
    requests.push(cap)
    const json = (status: number, j: unknown, h: Record<string, string> = {}) => route.fulfill({ status, headers: { ...orCors, 'content-type': 'application/json', ...h }, body: JSON.stringify(j) })
    try {
      // the consent page: back to the app with a code (or a denial)
      if (url.pathname === '/auth') {
        const cb = url.searchParams.get('callback_url') ?? ''
        const state = url.searchParams.get('state') ?? ''
        const c = opts.consent ?? 'approve'
        const target = typeof c === 'function' ? c(url) : (() => {
          const u = new URL(cb)
          if (c === 'approve') u.searchParams.set('code', 'code-e2e-0001'), state && u.searchParams.set('state', state)
          else if (c === 'code-no-state') u.searchParams.set('code', 'code-e2e-0002')
          else {
            u.searchParams.set('error', 'access_denied')
            if (c === 'deny-state' && state) u.searchParams.set('state', state)
          }
          return u.href
        })()
        return route.fulfill({ status: 302, headers: { location: target } })
      }
      if (req.method() === 'GET' && url.pathname === '/api/v1/models') return json(200, OR_CATALOGUE())
      const ep = url.pathname.match(/^\/api\/v1\/models\/(.+)\/endpoints$/)
      if (req.method() === 'GET' && ep) return json(200, orEndpoints(ep[1]!, opts.endpoints?.[ep[1]!]))
      if (url.pathname === '/api/v1/key') {
        const k = opts.key ?? 'ok'
        if (typeof k === 'function') {
          const out = k(cap)
          return json(out.status, out.json)
        }
        if (typeof k === 'number') return json(k, { error: { code: k, message: k === 401 ? 'User not found' : 'Insufficient credits' } })
        return json(200, OR_DOC('key').json)
      }
      if (url.pathname === '/api/v1/auth/keys') {
        const x = opts.exchange ?? 'sk-or-v1-e2e0000000000000000000000000000000000000000000000000000000000'
        if (x === 'cors') return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' })
        if (typeof x === 'number') return json(x, { error: { code: x, message: x === 400 ? 'Invalid code_challenge_method' : 'Invalid code or code_verifier' } })
        return json(200, { key: x, user_id: 'user_e2e_fixture' })
      }
      if (req.method() === 'POST' && url.pathname === '/api/v1/chat/completions') {
        const i = n++
        const raw = opts.chat?.[i] ?? opts.fallback ?? { text: 'Done.' }
        let step = typeof raw === 'function' ? raw(cap, i) : raw
        while ('delay' in step) {
          await new Promise((r) => setTimeout(r, step && 'delay' in step ? step.delay : 0))
          step = step.then
        }
        if ('status' in step) return json(step.status, step.json, step.headers)
        if ('fixture' in step) return route.fulfill({ status: 200, headers: { ...orCors, 'content-type': 'text/event-stream' }, body: OR_DOC(step.fixture).sse })
        if ('midError' in step) {
          const m = orServed(body)
          const pre = step.text ? `data: ${JSON.stringify(orChunk(m, 'Nordwind', { role: 'assistant', content: step.text }))}\n\n` : ''
          const err = { id: 'gen-e2e-err', object: 'chat.completion.chunk', created: 1790000000, model: m, provider: 'Nordwind', error: { code: step.midError.code, message: step.midError.message, ...(step.midError.type ? { metadata: { error_type: step.midError.type } } : {}) }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] }
          return route.fulfill({ status: 200, headers: { ...orCors, 'content-type': 'text/event-stream' }, body: `${pre}data: ${JSON.stringify(err)}\n\ndata: [DONE]\n\n` })
        }
        return route.fulfill({ status: 200, headers: { ...orCors, 'content-type': 'text/event-stream' }, body: orSse(step, orServed(body)) })
      }
      return json(404, { error: { code: 404, message: 'not mocked' } })
    } catch {
      /* the request was aborted (Stop) */
    }
  })
  return {
    requests,
    posts: () => requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/chat/completions'),
    to: (path, method) => requests.filter((r) => (typeof path === 'string' ? r.path === path : path.test(r.path)) && (!method || r.method === method)),
  }
}

/** Write endpoint lists into the device's cache (the `?e2e` seam) — specs seed them instead of counting their GETs. */
export async function seedEndpoints(page: Page, map: Record<string, Array<{ tag: string; name?: string }>>): Promise<void> {
  await page.evaluate((m) => (window as unknown as { __oneAI: { seedEndpoints(x: unknown): Promise<void> } }).__oneAI.seedEndpoints(m), map)
}
