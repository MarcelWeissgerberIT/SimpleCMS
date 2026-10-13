/**
 * Claude (Anthropic) — today's request paths, moved here unchanged from client.ts (multi-provider S2): the SDK, loaded
 * lazily on first use (the only place `@anthropic-ai/sdk` is imported at run time), the wire counter, error mapping,
 * the key check, metering of every response (finalOf / metered), the streamed, MCP and structured requests. The
 * facades in client.ts call streamOnce / structuredOnce and re-export every public name here, so callers keep their
 * imports. The key is opened per request (getAIKey) and goes to api.anthropic.com only.
 */
import type AnthropicSDK from '@anthropic-ai/sdk'
import type { Middleware } from '@anthropic-ai/sdk'
import type { BetaContentBlock, BetaMessage, BetaMessageParam, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { useWorkspace } from '../../../store/store'
import { getAIKey } from '../../../store/secrets'
import type { Caps, LedgerEntry, Route } from '@/shared/ai/types'
import { DEFAULT_CLAUDE_MODEL } from '@/shared/ai/models'
import { legacyRule } from '@/shared/ai/route'
import { thinksInside } from '@/shared/ai/wire/maxTokens'
import { AIError, type AIErrorCode } from '../core/errors'
import { capped, type Prepared } from '../core/gate'
import { claudeCut, claudeResponse, deltaChars, type MeterCall } from '../core/meter'
import { MCP_BETA, attachMcp, currentSetup, mcpNames, noteRefused, refusedNames, type Codewords, type McpAttachment } from '../mcp-servers/config'
import { foldMcpBlock, skippedCall, type McpCall } from '../mcp-servers/activity'
import { createMediaCollector } from '../media/collect'
import type { MediaItem } from '../media/types'
import type { AIModelId, StreamOptions, StructuredOptions, StructuredUsage } from '../client'

/**
 * What a Claude request may ask for, from the model's capabilities (never its id): Opus / Sonnet 5.5 think adaptively
 * with an effort and have Anthropic's refusal fallback (the beta request); Haiku 4.5 has neither (the plain request).
 */
export const thinks = (caps: Caps | null | undefined): boolean => thinksInside(caps)

/** The route a prepared request goes to (null: demo — no request is made). */
function claudeRoute(prepared: Prepared): Route {
  if (!prepared.route) throw new AIError('no_key')
  return prepared.route
}

type SDKModule = typeof import('@anthropic-ai/sdk')
let sdkPromise: Promise<SDKModule> | null = null
function loadSDK(): Promise<SDKModule> {
  sdkPromise ??= import('@anthropic-ai/sdk').catch((e) => {
    sdkPromise = null
    throw e
  })
  return sdkPromise
}

/**
 * What went over the network for one request, all its attempts (retries) together — keyed by the request's own abort
 * signal (a stream's controller, metered()'s own): `sent` attempts went out, `ok` one was answered 2xx (a stream
 * connected), `cut` the last one was in flight when it was stopped or failed.
 */
interface Wire {
  sent: number
  ok: boolean
  cut: boolean
}
const wires = new WeakMap<AbortSignal, Wire>()

/** Every request the SDK sends passes here (client middleware): its attempts are counted, nothing is changed. */
const wireMiddleware: Middleware = async (request, next, ctx) => {
  const key = ctx.options?.signal ?? null
  let w = key ? wires.get(key) : undefined
  if (key && !w) {
    w = { sent: 0, ok: false, cut: false }
    wires.set(key, w)
  }
  if (w) {
    w.sent += 1
    w.cut = true
  }
  const res = await next(request)
  if (w) {
    w.cut = false
    if (res.ok) w.ok = true
  }
  return res
}

/**
 * How far a request got that ended without its whole response: 'none' — nothing went out (stopped before it was sent:
 * no ledger entry); 'refused' — every attempt was answered with an error status (nothing billed); 'sent' — an attempt
 * was in flight when it ended, or its response had started (it may have been billed: an estimate).
 */
export function reachOf(signal: AbortSignal | null | undefined): 'none' | 'refused' | 'sent' {
  const w = signal ? wires.get(signal) : undefined
  if (!w?.sent) return 'none'
  return w.ok || w.cut ? 'sent' : 'refused'
}

let cached: { key: string; client: AnthropicSDK } | null = null
async function getClient(apiKey: string): Promise<{ client: AnthropicSDK; sdk: SDKModule }> {
  let sdk: SDKModule
  try {
    sdk = await loadSDK()
  } catch (e) {
    // online, yet our own file did not load: a tab left open across an update (its build's files are gone)
    throw new AIError(navigator.onLine ? 'outdated' : 'offline', `Could not load the Claude SDK: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!cached || cached.key !== apiKey) {
    const Anthropic = sdk.default
    cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, middleware: [wireMiddleware] }) }
  }
  return { client: cached.client, sdk }
}

/**
 * The SDK client for the configured key (workspace agent, agent/run.ts). The key goes to
 * api.anthropic.com only. Throws AIError('no_key') without a key.
 */
export async function claudeClient(): Promise<{ client: AnthropicSDK; sdk: SDKModule; model: AIModelId }> {
  const apiKey = await getAIKey('anthropic')
  if (!apiKey) throw new AIError('no_key')
  const settings = useWorkspace.getState().settings
  const { client, sdk } = await getClient(apiKey)
  return { client, sdk, model: legacyRule(settings.aiModel, true)[0]?.m ?? DEFAULT_CLAUDE_MODEL }
}

export type { SDKModule }

/**
 * Map anything thrown by the SDK to an AIError (most specific class first). `mcp`: the MCP servers
 * the request attached — an API error about one of them becomes 'mcp' / 'mcp_auth' (it is not the
 * key's fault), and no message ever carries one of their tokens.
 */
export function toAIError(e: unknown, sdk: SDKModule | null, mcp?: Pick<McpAttachment, 'names' | 'servers'> | null): AIError {
  const err = mapError(e, sdk, mcp)
  if (!mcp) return err
  // a server could echo what it was sent: the tokens never reach a message, a detail or a log
  const tokens = mcp.servers.map((x) => x.authorization_token ?? '').filter((x) => x.length >= 4)
  const scrub = (v: string) => tokens.reduce((out, tok) => out.split(tok).join('••••'), v)
  if (err.detail) err.detail = scrub(err.detail)
  err.message = scrub(err.message)
  return err
}

/** Anthropic's 400 for an account without credit or over its spend limit. */
const NO_CREDIT_RE = /credit balance is too low|usage limits/i

function mapError(e: unknown, sdk: SDKModule | null, mcp?: Pick<McpAttachment, 'names' | 'servers'> | null): AIError {
  if (e instanceof AIError) return e
  if (e instanceof DOMException && e.name === 'AbortError') return new AIError('aborted')
  if (sdk) {
    const A = sdk.default
    if (e instanceof A.APIUserAbortError) return new AIError('aborted')
    if (mcp?.names.length && e instanceof A.APIError && e.status !== undefined) {
      const server = mcpServerOf(e.message, mcp.names)
      if (server !== null) {
        const detail = cleanMessage(e.message)
        if (MCP_AUTH_RE.test(detail)) {
          // left out of later requests that don't address it, until its token changes (config.ts)
          if (server) noteRefused(server)
          return new AIError('mcp_auth', undefined, server)
        }
        return new AIError('mcp', detail.length > 240 ? `${detail.slice(0, 239)}…` : detail, server)
      }
    }
    if (e instanceof A.AuthenticationError) return new AIError('invalid_key', e.message)
    if (e instanceof A.PermissionDeniedError) return new AIError('permission', e.message)
    if (e instanceof A.RateLimitError) return new AIError('rate_limit', e.message)
    if (e instanceof A.APIConnectionError) return new AIError('offline', e.message)
    // no credit left / a spend limit reached (Anthropic says so in a 400 — wording verify with a real key, SP-A1)
    if (e instanceof A.BadRequestError && NO_CREDIT_RE.test(e.message)) return new AIError('no_credit', cleanMessage(e.message))
    if (e instanceof A.BadRequestError) return new AIError('bad_request', cleanMessage(e.message))
    if (e instanceof A.InternalServerError) return new AIError(e.status === 529 ? 'overloaded' : 'unknown', e.message)
    if (e instanceof A.APIError) return new AIError(e.status === 529 ? 'overloaded' : 'unknown', cleanMessage(e.message))
  }
  if (e instanceof TypeError) return new AIError('offline', e.message)
  return new AIError('unknown', e instanceof Error ? e.message : String(e))
}

/** An MCP server turned the token down. */
const MCP_AUTH_RE = /\b(401|403)\b|unauthori[sz]ed|forbidden|authenticat|invalid[^.]{0,40}token|token[^.]{0,40}(invalid|expired|revoked|rejected)|expired/i

/** The server an API error message is about: its name, '' (MCP, but which one is unclear), null (not about MCP). */
function mcpServerOf(msg: string, names: string[]): string | null {
  const text = msg.toLowerCase()
  const named = names.find((n) => new RegExp(`(^|[^a-z0-9_-])${n.replace(/[-]/g, '\\-')}([^a-z0-9_-]|$)`).test(text))
  if (!/\bmcp\b|mcp_|mcp server/i.test(msg)) return null
  return named ?? (names.length === 1 ? names[0] : '')
}

function cleanMessage(msg: string): string {
  // SDK messages look like '400 {"type":"error","error":{"message":"…"}}'
  const m = msg.match(/"message"\s*:\s*"((?:[^"\\]|\\.)+)"/)
  if (!m) return msg
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return m[1]
  }
}

/** Check a key without spending tokens (lists one model). */
export async function verifyKey(apiKey: string, signal?: AbortSignal): Promise<'ok' | AIErrorCode> {
  let sdk: SDKModule | null = null
  try {
    const got = await getClient(apiKey)
    sdk = got.sdk
    await got.client.models.list({ limit: 1 }, { signal })
    return 'ok'
  } catch (e) {
    return toAIError(e, sdk).code
  }
}

/** Servers that did not join the request: addressed but switched off or without a token here, and those left out because they rejected their token. */
function skippedOf(codewords: Codewords | null | undefined, attached: McpAttachment | null, refusedOut: string[] = []): McpCall[] {
  const out = refusedOut.filter((n) => !attached?.names.includes(n)).map((n) => skippedCall(n, 'refused'))
  if (!codewords) return out
  return [...codewords.off.map((n) => skippedCall(n, 'off')), ...codewords.forced.filter((n) => !attached?.names.includes(n)).map((n) => skippedCall(n, 'token')), ...out]
}

/**
 * A server the request did not address rejected its token: try once more without it (it is then skipped) — only when
 * the failed request made no MCP call yet (a call that already ran must never run twice).
 */
const retryWithout = (err: AIError, forced: string[] | undefined, sawMcp: boolean) => !sawMcp && err.code === 'mcp_auth' && !!err.server && !(forced ?? []).includes(err.server)

/** An MCP call or its result in a response. */
const isMcpBlock = (b: { type: string }) => b.type === 'mcp_tool_use' || b.type === 'mcp_tool_result'

/** A paused turn (server-side tool loop) is resumed at most this often. */
const MAX_RESUMES = 3

/** A Claude stream as metering reads it (MessageStream / BetaMessageStream). */
interface ClaudeStream<M> {
  on(event: 'streamEvent', listener: (event: unknown) => void): unknown
  finalMessage(): Promise<M>
  readonly currentMessage: unknown
  readonly controller: AbortController
}

/**
 * A Claude stream's final message, metered as one response; a stream that ends without one (stopped, failed) is
 * metered from what arrived (its message_start, the characters streamed) and the error goes on — unless it never went
 * out (no entry) or every attempt was refused with a status (zero).
 */
export async function finalOf<M extends { model?: unknown; usage?: unknown; content?: unknown; stop_reason?: unknown }>(
  stream: ClaudeStream<M>,
  call: MeterCall,
  promptChars: () => number,
  sdk: SDKModule | null,
  signal?: AbortSignal,
): Promise<M> {
  let chars = 0
  stream.on('streamEvent', (event: unknown) => (chars += deltaChars(event)))
  let msg: M
  try {
    msg = await stream.finalMessage()
  } catch (e) {
    const reach = reachOf(stream.controller.signal)
    if (reach !== 'none') call.response(claudeCut(stream.currentMessage as M | undefined, { promptChars: promptChars(), streamedChars: chars, outcome: signal?.aborted ? 'aborted' : toAIError(e, sdk).code, sent: reach === 'sent' }))
    throw e
  }
  call.response(claudeResponse(msg, chars))
  return msg
}

/**
 * A non-streamed Claude request, metered as one response (a failure from what is known: the request's size). `request`
 * sends with the signal it is given — the request's own, so the wire is read for this request alone.
 */
export async function metered<M extends { model?: unknown; usage?: unknown; content?: unknown; stop_reason?: unknown }>(
  call: MeterCall,
  request: (signal: AbortSignal) => Promise<M>,
  promptChars: () => number,
  sdk: SDKModule | null,
  signal?: AbortSignal,
): Promise<{ msg: M; entry: LedgerEntry | null }> {
  const own = new AbortController()
  const abort = () => own.abort()
  if (signal?.aborted) own.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let msg: M
  try {
    msg = await request(own.signal)
  } catch (e) {
    const reach = reachOf(own.signal)
    if (reach !== 'none') call.response(claudeCut(null, { promptChars: promptChars(), streamedChars: 0, outcome: signal?.aborted ? 'aborted' : toAIError(e, sdk).code, sent: reach === 'sent' }))
    throw e
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  return { msg, entry: call.response(claudeResponse(msg)) }
}

export async function streamOnce(opts: StreamOptions, again: boolean, prepared: Prepared, call: MeterCall): Promise<string> {
  const { system, prompt, onToken, signal, mcp, codewords, onMcp: report, onMedia, setup, maxResumes } = opts
  const apiKey = await getAIKey('anthropic')
  if (!apiKey) throw new AIError('no_key')
  if (signal?.aborted) throw new AIError('aborted')
  // the model the gate routed to, and what it can do (caps — never a model id check)
  const model = claudeRoute(prepared).m
  const deep = thinks(prepared.caps)
  let sdk: SDKModule | null = null
  let attached: McpAttachment | null = null
  // an MCP call of this request started (streamWithMcp): no retry without a server after that
  const seen = { mcp: false }
  try {
    const got = await getClient(apiKey)
    sdk = got.sdk
    const { client } = got
    if (signal?.aborted) throw new AIError('aborted')
    const messages: AnthropicSDK.MessageParam[] = [{ role: 'user', content: prompt }]
    let text = ''
    const onText = (delta: string) => {
      text += delta
      onToken?.(delta)
    }

    const cw = mcp === false ? null : codewords
    // a route that may not receive MCP (a data rule — a member class): no server joins, each is said (B6)
    const mcpOk = prepared.allows('mcp')
    attached = mcp === false || !mcpOk ? null : await attachMcp(setup, mcp ?? 'fixed', { forced: cw?.forced, picked: cw?.picked })
    if (signal?.aborted) throw new AIError('aborted')
    // a server joined: the request carries MCP (the ledger's classes say so — D-S2-27)
    if (attached && !prepared.classes.includes('mcp')) prepared.classes.push('mcp')
    // servers that stay out are listed first, before any call of the request
    const policyOut = mcp !== false && !mcpOk ? mcpNames(setup ?? currentSetup(), mcp ?? 'fixed', cw?.forced).map((n) => skippedCall(n, 'policy')) : []
    const skipped = [...skippedOf(cw, attached, mcp === false || !mcpOk ? [] : refusedNames(setup ?? currentSetup(), mcp ?? 'fixed', cw?.forced)), ...policyOut]
    const onMcp = skipped.length && report ? (calls: McpCall[]) => report([...skipped, ...calls]) : report
    if (skipped.length) onMcp?.([])
    let stopReason: string | null
    const promptChars = () => system.length + prompt.length
    if (attached) {
      const final = await streamWithMcp(client, model, deep, `${system}\n\n${attached.system}`, prompt, attached, onText, onMcp, signal, { onMedia, maxResumes, seen, call, sdk })
      stopReason = final.stop_reason
      text = answerText(final.content) || text
    } else if (!deep) {
      // the governor's cap near the red line (a text answer without MCP): never above today's budget
      const stream = client.messages.stream({ model, max_tokens: capped(8000, prepared), system, messages })
      const abort = () => stream.abort()
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('text', onText)
      try {
        stopReason = (await finalOf(stream, call, promptChars, sdk, signal)).stop_reason
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    } else {
      // Opus / Sonnet 5.5: thinking is always on (adaptive) — never send `thinking`.
      // Refusal fallbacks route a declined request to Anthropic's recommended model.
      const stream = client.beta.messages.stream({
        model,
        max_tokens: capped(16000, prepared),
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system,
        messages,
      })
      const abort = () => stream.abort()
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('text', onText)
      try {
        stopReason = (await finalOf(stream, call, promptChars, sdk, signal)).stop_reason
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    }

    if (stopReason === 'refusal') throw new AIError('refusal')
    if (!text.trim()) throw new AIError('empty')
    return text
  } catch (e) {
    if (signal?.aborted) throw new AIError('aborted')
    const err = toAIError(e, sdk, attached)
    if (!again && retryWithout(err, codewords?.forced, seen.mcp)) return streamOnce(opts, true, prepared, call)
    throw err
  }
}

/**
 * One streamed request with MCP servers attached (beta: the connector). Tool calls run inside the
 * response; a paused turn is sent back unchanged to continue it. Resolves with the last message.
 */
async function streamWithMcp(
  client: AnthropicSDK,
  model: string,
  /** the model thinks with an effort and has the refusal fallback (thinks(caps)) */
  opus: boolean,
  system: string,
  prompt: string,
  mcp: McpAttachment,
  onText: (delta: string) => void,
  onMcp: ((calls: McpCall[]) => void) | undefined,
  signal: AbortSignal | undefined,
  more: { onMedia?: (items: MediaItem[]) => void; maxResumes?: number; seen?: { mcp: boolean }; call: MeterCall; sdk: SDKModule | null },
): Promise<BetaMessage> {
  const messages: BetaMessageParam[] = [{ role: 'user', content: prompt }]
  let calls: McpCall[] = []
  // media in the results: cards for the person, nothing is fetched (features/ai/media)
  const media = more.onMedia ? createMediaCollector() : null
  const maxResumes = more.maxResumes ?? MAX_RESUMES
  for (let resumes = 0; ; resumes++) {
    const params: BetaMessageStreamParams = {
      model,
      // with MCP servers never capped (max_tokens bounds the output only — the brake judges their rounds)
      max_tokens: opus ? 16000 : 8000,
      system,
      messages,
      ...mcpParams(mcp),
      // Opus / Sonnet 5.5: thinking is always on (adaptive) — never send `thinking`; refusal fallbacks as above
      ...(opus ? { betas: [FALLBACK_BETA, MCP_BETA], fallbacks: 'default' as const, output_config: { effort: 'low' as const } } : { betas: [MCP_BETA] }),
    }
    const stream = client.beta.messages.stream(params)
    const abort = () => stream.abort()
    signal?.addEventListener('abort', abort, { once: true })
    stream.on('text', onText)
    // a call counts from its first byte: an error later in the same response must not send it again
    stream.on('streamEvent', (event) => {
      if (more.seen && event.type === 'content_block_start' && isMcpBlock(event.content_block)) more.seen.mcp = true
    })
    stream.on('contentBlock', (block: BetaContentBlock) => {
      if (more.seen && isMcpBlock(block)) more.seen.mcp = true
      if (media?.block(block)) more.onMedia?.(media.items)
      const next = foldMcpBlock(calls, block)
      if (next === calls) return
      calls = next
      onMcp?.(calls)
    })
    let final: BetaMessage
    try {
      // one ledger entry per response: every resume of a paused turn is one
      final = await finalOf(stream, more.call, () => system.length + JSON.stringify(messages).length, more.sdk, signal)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
    if (final.stop_reason !== 'pause_turn' || resumes >= maxResumes) {
      // links Claude wrote to a host a result used count too
      if (media?.answer(answerText(final.content))) more.onMedia?.(media.items)
      return final
    }
    messages.push({ role: 'assistant', content: final.content })
  }
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/**
 * The MCP half of a request: the servers and one `mcp_toolset` per server (the beta goes with `betas`), plus
 * automatic prompt caching — the server-side tool loop re-reads system + tool listings + results on every step,
 * and a paused turn sends them again.
 */
function mcpParams(mcp: McpAttachment) {
  return { mcp_servers: mcp.servers, tools: mcp.toolsets, cache_control: { type: 'ephemeral' as const } }
}

/** The answer of a response: the text after its last MCP tool call (all text when it made none). */
function answerText(content: BetaContentBlock[]): string {
  let start = 0
  content.forEach((b, i) => {
    if (b.type === 'mcp_tool_use' || b.type === 'mcp_tool_result') start = i + 1
  })
  const pick = (from: number) =>
    content
      .slice(from)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
  return pick(start).trim() ? pick(start) : pick(0)
}

const usageOfEntry = (e: LedgerEntry | null): StructuredUsage | null =>
  e ? { p: e.served.p, model: e.served.model, input: e.usage.input, output: e.usage.output, cacheRead: e.usage.cacheRead, cacheWrite: e.usage.cacheWrite + e.usage.cacheWrite1h, usd: e.usd } : null

export async function structuredOnce(opts: StructuredOptions, again: boolean, prepared: Prepared, call: MeterCall): Promise<string> {
  const { system, prompt, schema, maxTokens = 4096, signal, maxRetries = 4, mcp, onUsage } = opts
  const apiKey = await getAIKey('anthropic')
  if (!apiKey) throw new AIError('no_key')
  if (signal?.aborted) throw new AIError('aborted')
  // the model the gate routed to, and what it can do (caps — never a model id check)
  const model = claudeRoute(prepared).m
  const opus = thinks(prepared.caps)
  const used = (e: LedgerEntry | null) => {
    const u = usageOfEntry(e)
    if (u) onUsage?.(u)
  }
  let sdk: SDKModule | null = null
  let attached: McpAttachment | null = null
  // a paused turn made MCP calls: no retry without a server after that
  let sawMcp = false
  try {
    const got = await getClient(apiKey)
    sdk = got.sdk
    const { client } = got
    if (signal?.aborted) throw new AIError('aborted')
    const messages: AnthropicSDK.MessageParam[] = [{ role: 'user', content: prompt }]
    const format = { type: 'json_schema' as const, schema }
    const promptChars = () => system.length + prompt.length
    let stopReason: string | null
    let blocks: Array<{ type: string; text?: string }>
    // a route that may not receive MCP (a data rule): no server joins
    attached = mcp === false || !prepared.allows('mcp') ? null : await attachMcp(undefined, mcp ?? 'fixed')
    if (signal?.aborted) throw new AIError('aborted')
    if (attached && !prepared.classes.includes('mcp')) prepared.classes.push('mcp')
    if (attached) {
      // with MCP servers ("All AI calls"): the beta request, a paused turn resumed; the answer is the text after the last tool call
      const turn: BetaMessageParam[] = [{ role: 'user', content: prompt }]
      let msg: BetaMessage
      for (let resumes = 0; ; resumes++) {
        const mcp = attached
        // one ledger entry per response: every resume of a paused turn is one
        const got = await metered(
          call,
          (sig) =>
            client.beta.messages.create(
              {
                model,
                max_tokens: capped(maxTokens, prepared),
                system: `${system}\n\n${mcp.system}`,
                messages: turn,
                ...mcpParams(mcp),
                ...(opus ? { betas: [FALLBACK_BETA, MCP_BETA], fallbacks: 'default' as const, output_config: { effort: 'low' as const, format } } : { betas: [MCP_BETA], output_config: { format } }),
              },
              { signal: sig, maxRetries },
            ),
          // the system prompt, the servers' part and the turn so far (it holds the prompt)
          () => system.length + mcp.system.length + JSON.stringify(turn).length,
          sdk,
          signal,
        )
        msg = got.msg
        used(got.entry)
        if (msg.content.some(isMcpBlock)) sawMcp = true
        if (msg.stop_reason !== 'pause_turn' || resumes >= MAX_RESUMES) break
        turn.push({ role: 'assistant', content: msg.content })
      }
      stopReason = msg.stop_reason
      blocks = [{ type: 'text', text: answerText(msg.content) }]
    } else if (!opus) {
      const { msg, entry } = await metered(call, (sig) => client.messages.create({ model, max_tokens: capped(maxTokens, prepared), system, messages, output_config: { format } }, { signal: sig, maxRetries }), promptChars, sdk, signal)
      used(entry)
      stopReason = msg.stop_reason
      blocks = msg.content
    } else {
      // Opus / Sonnet 5.5: thinking is always on (adaptive) — never send `thinking`; low effort keeps
      // a field fill cheap. Refusal fallbacks route a declined request to Anthropic's recommended model.
      const { msg, entry } = await metered(
        call,
        (sig) =>
          client.beta.messages.create(
            { model, max_tokens: capped(maxTokens, prepared), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low', format }, system, messages },
            { signal: sig, maxRetries },
          ),
        promptChars,
        sdk,
        signal,
      )
      used(entry)
      stopReason = msg.stop_reason
      blocks = msg.content
    }
    if (stopReason === 'refusal') throw new AIError('refusal')
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    if (!text.trim()) throw new AIError('empty')
    return text
  } catch (e) {
    if (signal?.aborted) throw new AIError('aborted')
    const err = toAIError(e, sdk, attached)
    if (!again && retryWithout(err, undefined, sawMcp)) return structuredOnce(opts, true, prepared, call)
    throw err
  }
}
