/**
 * AI provider mocks for the e2e suite — nothing ever reaches a real host. `mockClaudeScript` answers
 * api.anthropic.com from a script in the Messages API shape: streamed requests get SSE, others a JSON message; each
 * request takes the next step (text, thinking, tool_use with its input in `input_json_delta` fragments — or raw, even
 * unparseable, JSON —, mcp_tool_use / mcp_tool_result, a pause_turn stop, a served model other than the requested one,
 * an API error). Returns every request as captured on the wire (method, path, anthropic-beta header, parsed body).
 */
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
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: u.output ?? 80 } })
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
    usage: { input_tokens: u.input ?? 400, output_tokens: u.output ?? 40, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0 },
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
