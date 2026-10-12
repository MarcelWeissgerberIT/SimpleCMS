/**
 * OpenRouter Chat Completions — the wire, pure (no fetch, no DOM): the request body One sends for a model or for the
 * Jev Router (`build`, guarded by `assertSafeBody`), the stream parser (`createChatParser`, fed the `data` of each SSE
 * event) and the error table (`classify`). Every format follows the docs snapshot (ordocs: streaming, errors and
 * debugging, limits, provider selection, plugins, PDFs, reasoning tokens, structured outputs, the Jev Router guide);
 * none is checked against a real response yet — the open rows are listed as "verify with a real key".
 *
 * What a body always carries: the model's own `provider.only` pins, `allow_fallbacks: false`, the upstream rule
 * (`data_collection`, `zdr`), `require_parameters: true`, and the three account-default plugins switched off (web,
 * context-compression, response-healing). What it never carries: other models or fallbacks, MCP servers, OpenRouter's
 * server tools, web search options, transforms, a route, anything that identifies the person (user, trace, metadata).
 */
import type { AIEvent, Annotation, Caps, ChatRequest, Message, ModelInfo, Part, StepNote, StopReason, Turn, UpstreamRule, Usage, WireRequest } from '../types.ts'
import type { AIErrorCode } from '../errors.ts'
import { normalise } from '../usage.ts'
import { scrubSecrets } from '../keys.ts'
import { JEV_PLUGIN, JEV_ROUTER, ROUTER_PINS, isJevRouter, servedAs } from '../jev.ts'

export const OR_API = 'https://openrouter.ai/api/v1'
export const OR_CHAT_URL = `${OR_API}/chat/completions`

/**
 * The attribution headers, in ONE place (a header a browser's CORS preflight refuses is removed here): `null` = the
 * app's own address. `X-OpenRouter-Metadata` is never sent.
 */
export const OR_HEADERS: Readonly<Record<string, string | null>> = { 'HTTP-Referer': null, 'X-OpenRouter-Title': 'One', 'X-OpenRouter-App-Visibility': 'hidden' }

/** The account-default plugins every request switches off (a request never searches the web or rewrites itself). */
export const SWITCH_OFFS: ReadonlyArray<{ id: string; enabled: false }> = [
  { id: 'web', enabled: false },
  { id: 'context-compression', enabled: false },
  { id: 'response-healing', enabled: false },
]

/** PDFs are read by the model itself (never an OCR service): models without native files never get one. */
export const PDF_PLUGIN = { id: 'file-parser', pdf: { engine: 'native' } } as const

export interface BuildOpts {
  /** endpoint tags the request may use (`provider.only`) */
  pins: readonly string[]
  upstream: UpstreamRule
  /** the app's address (`HTTP-Referer`) */
  referer: string
  /** the Jev Router only: the pool (include list) and the exclusions */
  router?: { pool: readonly string[]; exclude: readonly string[] }
  /** a model priced per request: the price ceiling ($ per million tokens) */
  maxPrice?: { prompt: number; completion: number }
}

export interface Built {
  url: string
  body: Record<string, unknown>
  /** never the key — the transport adds it */
  headers: Record<string, string>
}

/** Reasoning room on top of the visible answer: max(1 024, 4 × the answer budget), never above the model's output cap. */
export function headroom(maxTokens: number, caps: Pick<Caps, 'maxOutput'>): number {
  return Math.max(0, Math.min(caps.maxOutput, Math.max(1024, 4 * Math.max(0, Math.round(maxTokens)))))
}

/** OpenRouter's effort scale, lowest first. */
const LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const rank = (e: string) => {
  const i = (LEVELS as readonly string[]).indexOf(e)
  return i < 0 ? 2 : i
}

/**
 * The effort a model takes for what One wants: the wanted one when listed (`null` list = every effort), else the next
 * listed one above it, else the highest listed. Never 'none' on a mandatory model.
 */
export function clampEffort(want: string, efforts: readonly string[] | null, mandatory: boolean): string {
  if (!efforts) return mandatory && want === 'none' ? 'minimal' : want
  const allowed = [...efforts].filter((e) => !(mandatory && e === 'none')).sort((a, b) => rank(a) - rank(b))
  if (!allowed.length) return want
  if (allowed.includes(want)) return want
  return allowed.find((e) => rank(e) >= rank(want)) ?? allowed[allowed.length - 1]!
}

/** The lowest effort a model takes (structured answers of ≤ 2 000 tokens think as little as allowed). */
function lowestEffort(efforts: readonly string[] | null, mandatory: boolean): string {
  if (!efforts) return mandatory ? 'minimal' : 'none'
  const allowed = [...efforts].filter((e) => !(mandatory && e === 'none')).sort((a, b) => rank(a) - rank(b))
  return allowed[0] ?? (mandatory ? 'minimal' : 'none')
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Json = Record<string, unknown>

/** One part as Chat Completions content (`cache`: breakpoints marked for an Anthropic upstream). */
function contentPart(p: Part, cache: boolean): Json | null {
  const mark = (o: Json, c?: true): Json => (cache && c ? { ...o, cache_control: { type: 'ephemeral' } } : o)
  switch (p.type) {
    case 'text':
      return mark({ type: 'text', text: p.text }, p.cache)
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } }
    case 'document':
      if (p.pdf) return { type: 'file', file: { filename: p.title || 'document.pdf', file_data: `data:application/pdf;base64,${p.pdf.data}` } }
      return mark({ type: 'text', text: `<document title="${escAttr(p.title)}">\n${p.text ?? ''}\n</document>` }, p.cache)
    default:
      return null
  }
}

/** The messages of a request in Chat Completions form (tool rounds rendered as the API takes them). */
function renderMessages(req: ChatRequest, cache: boolean): Json[] {
  const out: Json[] = [{ role: 'system', content: req.system }]
  for (const m of req.messages) out.push(...renderMessage(m, cache))
  return out
}

function renderMessage(m: Message, cache: boolean): Json[] {
  if (m.role === 'assistant') {
    const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    const calls = m.parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call')
    return [{ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) }]
  }
  const results = m.parts.filter((p): p is Extract<Part, { type: 'tool_result' }> => p.type === 'tool_result')
  const content = m.parts.map((p) => contentPart(p, cache)).filter((x): x is Json => !!x)
  return [...results.map((r) => ({ role: 'tool', tool_call_id: r.callId, content: r.isError ? `Error: ${r.content}` : r.content })), ...(content.length ? [{ role: 'user', content }] : [])]
}

const hasPdf = (req: ChatRequest) => req.messages.some((m) => m.parts.some((p) => p.type === 'document' && !!p.pdf))

/**
 * The request as it goes over the wire. `model`: One's view of the model (caps, price, the catalogue's wire hints) —
 * the Jev Router's synthesised view when `model.route.m` is the router (chosen from the allow-list, never a flag).
 */
export function build(req: WireRequest, model: ModelInfo, opts: BuildOpts): Built {
  if (req.kind !== 'chat') throw new Error('openrouterChat.build: only chat requests (a decide request has its own wire)')
  const router = isJevRouter(model.route.m)
  const slug = router ? JEV_ROUTER : model.route.m
  const caps = model.caps
  const visible = Math.max(1, Math.round(req.maxTokens))
  const json = req.output.kind === 'json' ? req.output : null
  const hints = model.hints
  const r = hints?.reasoning
  const mandatory = !!r?.mandatory || (caps.reasoning !== false && caps.reasoning.mandatory)
  // reasoning only where the catalogue lists it — never on the router (it picks the effort; max_tokens / mode → 400)
  const reasons = !router && !!hints?.params.includes('reasoning') && (mandatory || !!req.route.effort)
  let reasoning: Json | null = null
  if (reasons) {
    const efforts = r ? r.efforts : null
    if (r && !r.efforts?.length && r.efforts !== null && r.supportsMax) reasoning = { max_tokens: headroom(visible, caps) }
    else if (!r || r.efforts === null || r.efforts.length) {
      const want = json && visible <= 2000 ? lowestEffort(efforts, mandatory) : (req.route.effort ?? 'low')
      reasoning = { effort: clampEffort(want, efforts, mandatory) }
    }
  }
  // the visible answer + reasoning room: models that reason (always the router — any pool model may), capped
  const room = router || reasons || mandatory ? headroom(visible, caps) : 0
  const maxTokens = Math.max(1, Math.min(caps.maxOutput, visible + room))
  const cache = req.cache === 'auto' && !router && slug.startsWith('anthropic/')
  const upstream = opts.upstream
  const pins = ROUTER_PINS === 'ignore' && router ? { ignore: [...upstream.deny] } : { only: [...opts.pins] }
  const provider: Json = {
    ...pins,
    allow_fallbacks: false,
    data_collection: upstream.noCollect ? 'deny' : 'allow',
    require_parameters: true,
    ...(upstream.zdr ? { zdr: true } : {}),
    ...(opts.maxPrice && !router ? { max_price: { prompt: opts.maxPrice.prompt, completion: opts.maxPrice.completion } } : {}),
  }
  const plugins: Json[] = [
    ...(router ? [{ id: JEV_PLUGIN, ...(req.route.effort ? { cost_tier: req.route.effort } : {}), models: [...(opts.router?.pool ?? [])], excluded_models: [...(opts.router?.exclude ?? [])] }] : []),
    ...SWITCH_OFFS.map((x) => ({ ...x })),
    ...(hasPdf(req) ? [{ id: PDF_PLUGIN.id, pdf: { ...PDF_PLUGIN.pdf } }] : []),
  ]
  const body: Json = {
    model: slug,
    messages: renderMessages(req, cache),
    stream: true,
    max_tokens: maxTokens,
    ...(reasoning ? { reasoning } : {}),
    ...(json ? { response_format: { type: 'json_schema', json_schema: { name: json.name, schema: json.schema, strict: true } } } : {}),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}),
    provider,
    plugins,
    ...(req.session ? { session_id: req.session } : {}),
  }
  assertSafeBody(body)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  for (const [k, v] of Object.entries(OR_HEADERS)) headers[k] = v ?? opts.referer
  return { url: OR_CHAT_URL, body, headers }
}

/** Body fields One never sends (other models, server tools, web search, rewriting, identity). */
export const FORBIDDEN_FIELDS = ['models', 'fallbacks', 'mcp_servers', 'web_search_options', 'transforms', 'route', 'user', 'trace', 'metadata'] as const

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** Throws when a body breaks One's rules (build() calls it; tests call it on hand-made bodies). */
export function assertSafeBody(body: unknown): void {
  const fail = (why: string): never => {
    throw new Error(`unsafe OpenRouter body: ${why}`)
  }
  if (!isObj(body)) fail('not an object')
  const b = body as Json
  for (const k of FORBIDDEN_FIELDS) if (k in b) fail(`"${k}" is never sent`)
  const model = typeof b.model === 'string' ? b.model : fail('no model')
  if (model.startsWith('openrouter/') || model.startsWith('~') || model.includes('@')) fail(`model "${model}" is a router or an alias`)
  const router = model === JEV_ROUTER
  if (Array.isArray(b.tools)) for (const t of b.tools) if (!isObj(t) || t.type !== 'function') fail('only function tools (no server tools)')
  const p = isObj(b.provider) ? b.provider : fail('no provider pins')
  if (p.allow_fallbacks !== false) fail('allow_fallbacks must be false')
  const only = Array.isArray(p.only) ? p.only : null
  if (!only?.length && !(router && ROUTER_PINS === 'ignore' && Array.isArray(p.ignore))) fail('provider.only must name the endpoints')
  if (p.require_parameters !== true) fail('require_parameters must be true')
  if (p.data_collection !== 'deny' && p.data_collection !== 'allow') fail('data_collection must be stated')
  const plugins = Array.isArray(b.plugins) ? b.plugins : fail('no plugins (the switch-offs)')
  const ids = plugins.map((x) => (isObj(x) && typeof x.id === 'string' ? x.id : ''))
  for (const s of SWITCH_OFFS) {
    const x = plugins.find((y) => isObj(y) && y.id === s.id)
    if (!isObj(x) || x.enabled !== false) fail(`plugin "${s.id}" must be switched off`)
  }
  for (const [i, id] of ids.entries()) {
    const x = plugins[i] as Json
    if (id === 'file-parser') {
      if (!isObj(x.pdf) || x.pdf.engine !== 'native') fail('PDFs only natively')
    } else if (id === JEV_PLUGIN) {
      if (!router) fail(`the ${JEV_PLUGIN} plugin only with the Jev Router`)
    } else if (!SWITCH_OFFS.some((s) => s.id === id)) fail(`plugin "${id}" is never sent`)
  }
  if (ids.filter((id) => id === JEV_PLUGIN).length > 1) fail('one router plugin')
  if (router) {
    const x = plugins.find((y) => isObj(y) && y.id === JEV_PLUGIN)
    if (!isObj(x)) fail('the Jev Router needs its plugin (pool and exclusions)')
    const j = x as Json
    if (!Array.isArray(j.models) || !j.models.length) fail('the Jev Router needs its pool')
    if (!Array.isArray(j.excluded_models) || !j.excluded_models.length) fail('the Jev Router needs its exclusions')
    if ('allowed_models' in j) fail('allowed_models is not sent (models only)')
    if ('reasoning' in b || 'reasoning_effort' in b) fail('no reasoning settings on the Jev Router')
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

export interface Classified {
  code: AIErrorCode
  /** scrubbed, ≤ 240 characters */
  detail: string
  /** ms to wait (Retry-After) */
  retryAfter?: number
  limitSource?: string
}

/** A documented error_type → the HTTP status it stands for (errors doc, "Typed error codes"). */
const TYPE_STATUS: Record<string, number> = {
  context_length_exceeded: 400,
  max_tokens_exceeded: 400,
  token_limit_exceeded: 400,
  string_too_long: 400,
  invalid_request: 400,
  invalid_prompt: 400,
  invalid_image: 400,
  image_too_large: 400,
  image_too_small: 400,
  unsupported_image_format: 400,
  image_download_failed: 400,
  authentication: 401,
  payment_required: 402,
  permission_denied: 403,
  content_policy_violation: 403,
  refusal: 403,
  not_found: 404,
  image_not_found: 404,
  precondition_failed: 412,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limit_exceeded: 429,
  server: 500,
  unmapped: 500,
  provider_unavailable: 502,
  provider_overloaded: 503,
  timeout: 504,
}

const BUDGET_403 = ['openrouter_guardrail_budget', 'openrouter_workspace_budget', 'openrouter_key_limit']

function retryAfterOf(headers: Record<string, string> | Headers | null | undefined): number | undefined {
  const raw = headers ? (typeof (headers as Headers).get === 'function' ? (headers as Headers).get('retry-after') : ((headers as Record<string, string>)['retry-after'] ?? (headers as Record<string, string>)['Retry-After'])) : null
  if (!raw) return undefined
  const s = Number(raw)
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

const clipDetail = (s: string) => {
  const t = scrubSecrets(s.replace(/\s+/g, ' ').trim())
  return t.length > 240 ? `${t.slice(0, 239)}…` : t
}

/**
 * An error answer → One's code. `body`: the parsed JSON (or text) of a non-2xx answer, or the `error` object of a
 * mid-stream frame (`{ error: … }`); `router`: the request went to the Jev Router (its 404 means "no eligible model in
 * your list" — never a gone model, never sent again).
 */
export function classify(status: number, body: unknown, headers?: Record<string, string> | Headers | null, o: { router?: boolean } = {}): Classified {
  const err = isObj(body) && isObj(body.error) ? body.error : isObj(body) ? body : {}
  const meta = isObj(err.metadata) ? err.metadata : {}
  const message = typeof err.message === 'string' ? err.message : typeof body === 'string' ? body : ''
  const type = typeof meta.error_type === 'string' ? meta.error_type : typeof err.error_type === 'string' ? err.error_type : ''
  const limitSource = typeof meta.limit_source === 'string' ? meta.limit_source : undefined
  // a mid-stream frame: a numeric code is the status, a string code is read through its error type
  let s = status
  if (status === 200 || !status) s = typeof err.code === 'number' ? err.code : (TYPE_STATUS[type] ?? (err.code === 'server_error' ? 502 : 500))
  const detail = clipDetail(message)
  const retryAfter = retryAfterOf(headers)
  const out = (code: AIErrorCode, more: Partial<Classified> = {}): Classified => ({ code, detail, ...(retryAfter !== undefined ? { retryAfter } : {}), ...(limitSource ? { limitSource } : {}), ...more })
  if (s === 401) return out('invalid_key')
  if (s === 402) return out(limitSource === 'openrouter_in_flight_budget' ? 'busy' : 'no_credit')
  if (s === 403) {
    if (limitSource && BUDGET_403.includes(limitSource)) return out('no_credit')
    if (type === 'content_policy_violation' || type === 'refusal' || Array.isArray(meta.reasons) || typeof meta.flagged_input === 'string') return out('moderation')
    return out('permission')
  }
  if (s === 404) {
    if (o.router) return out('no_endpoint', { detail: detail ? `router: ${detail}` : 'router' })
    return out(/no endpoints found/i.test(message) ? 'no_endpoint' : 'model_gone')
  }
  if (s === 400) return out(type === 'context_length_exceeded' ? 'context' : 'bad_request')
  if (s === 413 || s === 422 || s === 412) return out('bad_request')
  if (s === 408 || s === 502 || s === 503) return out('unavailable')
  if (s === 504) return out('timeout')
  if (s === 429) return out('rate_limit')
  if (s >= 500) return out('unavailable')
  return out('unknown')
}

/* ------------------------------------------------------------------ */
/* The stream                                                           */
/* ------------------------------------------------------------------ */

/** A failure the stream reported (an error frame, a 200 that held only an error): the turn so far goes along. */
export class WireFailure extends Error {
  readonly failure: Classified
  readonly partial: Turn
  constructor(failure: Classified, partial: Turn) {
    super(`openrouter: ${failure.code}${failure.detail ? ` — ${failure.detail}` : ''}`)
    this.name = 'WireFailure'
    this.failure = failure
    this.partial = partial
  }
}

export interface ChatParser {
  /** one SSE event's data (a JSON chunk or "[DONE]"); throws WireFailure on an error frame */
  feed(data: string): void
  /** the whole turn; throws WireFailure when the stream ended before it said it was done */
  end(): Turn
  /** the turn so far (for a stream that was cut) */
  partial(): Turn
}

interface CallAcc {
  id: string
  name: string
  args: string
}

const FINISH: Record<string, StopReason> = { stop: 'end', tool_calls: 'tool_calls', length: 'max_tokens', content_filter: 'content_filter' }

/**
 * The Chat Completions stream → events and one Turn. `delta.content` → text, `delta.reasoning` → notes, tool calls
 * assembled by index (a call cut off mid-way is never part of the turn), a refusal → stop 'refusal', the usage chunk
 * (sent once more with the finish reason) → usage, `model` / `provider` → served, url citations → annotations.
 */
export function createChatParser(onEvent: (e: AIEvent) => void, o: { router?: boolean } = {}): ChatParser {
  let text = ''
  let refusal = ''
  let started = false
  let stop: StopReason | null = null
  let done = false
  let usage: Usage | null = null
  let served: string | null = null
  let upstream: string | undefined
  let chars = 0
  let anyChunk = false
  const calls = new Map<number, CallAcc>()
  const annotations: Annotation[] = []

  const content = () => {
    if (started) return
    started = true
    onEvent({ t: 'content' })
  }

  /** `final`: the stream is over — a call that did not complete (not cut by the budget) is reported once */
  const turn = (final = false): Turn => {
    const parts: Part[] = text ? [{ type: 'text', text }] : []
    for (const c of [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)) {
      const input = parseArgs(c.args)
      if (input && c.name) parts.push({ type: 'tool_call', id: c.id, name: c.name, input })
      else if (final && stop !== 'max_tokens' && c.name) onEvent({ t: 'tool_input_error', id: c.id, name: c.name })
    }
    return {
      kind: 'chat',
      parts,
      stop: refusal ? 'refusal' : (stop ?? 'end'),
      usage,
      served,
      ...(upstream ? { upstream } : {}),
      streamedChars: chars,
      ...(annotations.length ? { annotations } : {}),
    }
  }

  const see = (model: unknown, provider: unknown) => {
    const m = typeof model === 'string' && model ? model : served
    const u = typeof provider === 'string' && provider ? provider : upstream
    if (m === served && u === upstream) return
    served = m
    upstream = u
    if (served) onEvent({ t: 'served', model: served, ...(upstream ? { upstream } : {}) })
  }

  const annotate = (v: unknown) => {
    if (!Array.isArray(v)) return
    for (const a of v) {
      if (!isObj(a) || a.type !== 'url_citation') continue
      const c = isObj(a.url_citation) ? a.url_citation : a
      if (typeof c.url !== 'string') continue
      if (annotations.some((x) => x.url === c.url)) continue
      annotations.push({ type: 'url_citation', url: c.url, ...(typeof c.title === 'string' ? { title: c.title } : {}) })
    }
  }

  return {
    feed(data: string) {
      if (done) return
      if (data.trim() === '[DONE]') {
        done = true
        return
      }
      let chunk: unknown
      try {
        chunk = JSON.parse(data)
      } catch {
        return // not JSON (the docs: ignore)
      }
      if (!isObj(chunk)) return
      anyChunk = true
      see(chunk.model, chunk.provider)
      if (isObj(chunk.error)) throw new WireFailure(classify(200, { error: chunk.error }, null, o), turn())
      const choice = Array.isArray(chunk.choices) && isObj(chunk.choices[0]) ? chunk.choices[0] : null
      if (choice) {
        const d = isObj(choice.delta) ? choice.delta : isObj(choice.message) ? choice.message : {}
        if (typeof d.content === 'string' && d.content) {
          content()
          text += d.content
          chars += d.content.length
          onEvent({ t: 'text', delta: d.content })
        }
        if (typeof d.reasoning === 'string' && d.reasoning) {
          content()
          chars += d.reasoning.length
          onEvent({ t: 'note', text: d.reasoning })
        }
        if (typeof d.refusal === 'string' && d.refusal) {
          content()
          refusal += d.refusal
        }
        if (Array.isArray(d.tool_calls))
          for (const t of d.tool_calls) {
            if (!isObj(t)) continue
            const i = typeof t.index === 'number' ? t.index : calls.size
            const f = isObj(t.function) ? t.function : {}
            content()
            const acc = calls.get(i) ?? { id: '', name: '', args: '' }
            if (typeof t.id === 'string' && t.id) acc.id = t.id
            if (typeof f.name === 'string' && f.name) acc.name = f.name
            if (typeof f.arguments === 'string') {
              acc.args += f.arguments
              chars += f.arguments.length
            }
            calls.set(i, acc)
          }
        annotate(d.annotations)
        annotate(choice.annotations)
        const fin = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
        if (fin === 'error') throw new WireFailure(classify(200, { error: { code: 502, message: 'the stream ended with an error' } }, null, o), turn())
        // the usage chunk repeats the finish reason: an accounting frame, not a second end
        if (fin && stop === null) stop = FINISH[fin] ?? 'end'
      }
      if (isObj(chunk.usage)) {
        usage = normalise('openrouter', chunk.usage)
        onEvent({ t: 'usage', usage })
      }
    },
    end() {
      if (!done && stop === null) throw new WireFailure({ code: anyChunk ? 'unavailable' : 'empty', detail: 'the stream ended before it was done' }, turn())
      return turn(true)
    },
    partial: () => turn(),
  }
}

/** A tool call's arguments as an object (null: not complete JSON, or not an object). */
function parseArgs(s: string): Record<string, unknown> | null {
  if (!s.trim()) return {}
  try {
    const v = JSON.parse(s) as unknown
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Before and after: what the model can take, who answered              */
/* ------------------------------------------------------------------ */

/** What a request needs that the model cannot do (null: nothing) — checked before anything is sent. */
export function capabilityProblem(req: ChatRequest, caps: Caps): 'vision' | 'pdf' | 'structured' | 'tools' | null {
  for (const m of req.messages)
    for (const p of m.parts) {
      if (p.type === 'image' && (!caps.vision || (p.data.length * 3) / 4 > caps.vision.maxBytes)) return 'vision'
      if (p.type === 'document' && p.pdf && (!caps.pdf || p.pdf.pages > caps.pdf.maxPages || (p.pdf.data.length * 3) / 4 > caps.pdf.maxBytes)) return 'pdf'
    }
  if (req.output.kind === 'json' && !caps.structured) return 'structured'
  if (req.tools?.length && !caps.tools) return 'tools'
  return null
}

// a model id's base and "served as" live with the router's constants (jev.ts — eager, no wire): the receipt and the
// served price match a dated revision with the same rule as the pool check
export { servedAs, slugBase } from '../jev.ts'

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface ServedCheck {
  /** 'substituted' (another model of the request answered) or 'routed' (the router chose) — or none */
  step: StepNote | null
  /** set: the answer must not be used (D-S2-16) — 'upstream:<name>', 'model:<slug>' or 'web' */
  problem: string | null
}

/**
 * After the answer (D-S2-16): the served upstream must be one the pins name and not one the deny list names; a model
 * the request did not ask for must not be one One refuses; a router answer must come from its pool; an answer that cites
 * web sources came from a model that searched the web. `refused`: the caller's slug judge (models.ts refusedSlug).
 */
export function checkServed(
  turn: Pick<Turn, 'served' | 'upstream' | 'annotations'>,
  o: { requested: string; router: boolean; pool?: readonly string[]; upstreams?: readonly string[] | null; deny: readonly string[]; refused: (slug: string) => boolean },
): ServedCheck {
  const served = turn.served ?? null
  const step: StepNote | null = served && o.router ? { k: 'routed', from: o.requested, to: served } : served && !servedAs(served, o.requested) ? { k: 'substituted', from: o.requested, to: served } : null
  const up = turn.upstream
  if (up && (o.deny.some((d) => sameName(d, up)) || (o.upstreams?.length && !o.upstreams.some((u) => sameName(u, up))))) return { step, problem: `upstream:${up}` }
  if (served && o.router && !(o.pool ?? []).some((p) => servedAs(served, p))) return { step, problem: `model:${served}` }
  if (served && !servedAs(served, o.requested) && o.refused(served)) return { step, problem: `model:${served}` }
  if (turn.annotations?.length) return { step, problem: 'web' }
  return { step, problem: null }
}
