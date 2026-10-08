/**
 * AI terminal e2e helpers (shared by the terminal specs): the Claude API mocked in the Messages API shape — streamed
 * requests (the terminal's tasks) get the next scripted SSE message, others (an MCP server's connection test) a JSON
 * answer; nothing reaches api.anthropic.com.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { expect, wsEval, MOD } from '../fixtures'

export type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  /** an MCP server's call and its result (the Messages API MCP connector: Anthropic called the server) */
  | { type: 'mcp_tool_use'; id: string; server: string; name: string; input: Record<string, unknown> }
  | { type: 'mcp_tool_result'; id: string; text: string }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
export function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_term_${++msgSeq}`, type: 'message', role: 'assistant', model: 'e2e-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'mcp_tool_use') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    } else if (b.type === 'mcp_tool_result') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_result', tool_use_id: b.id, is_error: false, content: [{ type: 'text', text: b.text }] } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 90 } })
  body += ev('message_stop', {})
  return body
}

/** A tool call as the next streamed answer. */
export const call = (id: string, name: string, input: Record<string, unknown>) => () => sseMessage([{ type: 'tool_use', id, name, input }])
/** The closing text as the next streamed answer. */
export const say = (text: string) => () => sseMessage([{ type: 'text', text }])

/** An API error answer (e.g. an MCP server that rejected its token). */
export interface ApiError {
  status: number
  json: unknown
}
export const mcpError = (message: string): ApiError => ({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message } } })

export type Step = (body: AnyState) => string | ApiError | Promise<string | ApiError>

export interface Mocked {
  /** streamed requests (the terminal's tasks), in order */
  bodies: AnyState[]
  /** other requests (MCP connection tests) */
  checks: AnyState[]
}

/**
 * api.anthropic.com → streamed request n gets script[n] (later ones a short answer); `inspect`: the text of every
 * connection test (an MCP server's tool listing, mcp-servers/generate.ts).
 */
export async function mockAgent(ctx: BrowserContext, script: Step[], opts: { inspect?: (body: AnyState) => string | ApiError } = {}): Promise<Mocked> {
  const out: Mocked = { bodies: [], checks: [] }
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    const body = JSON.parse(req.postData() ?? '{}')
    try {
      if (body.stream !== true) {
        out.checks.push(body)
        const r = opts.inspect?.(body) ?? 'TOOLS: search_records\n---\nLooks things up.'
        if (typeof r !== 'string') return await route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.json) })
        return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: `msg_chk_${++msgSeq}`, type: 'message', role: 'assistant', model: 'e2e-mock', content: [{ type: 'text', text: r }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }) })
      }
      out.bodies.push(body)
      const step = script[out.bodies.length - 1] ?? say('Done.')
      const r = await step(body)
      if (typeof r !== 'string') return await route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.json) })
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: r })
    } catch {
      /* the request was aborted (Stop) */
    }
  })
  return out
}

export const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
export const terminal = (page: Page, name = 'AI terminal') => page.getByRole('region', { name })
export const prompt = (page: Page) => terminal(page).getByRole('textbox', { name: /Task for the agent|Aufgabe für den Agenten/ })

/** The text of the user turn of a request (context + task). */
export const userText = (body: AnyState, i = 0) => JSON.stringify((body.messages as AnyState[]).filter((m) => m.role === 'user')[i]?.content ?? '')

/** A tool result Claude got back, by tool_use id. */
export const toolResult = (body: AnyState, id: string): AnyState | undefined =>
  (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)

/** A tool result's text (whatever shape the SDK sent it in). */
export const resultText = (body: AnyState | undefined, id: string): string => {
  const r = body ? toolResult(body, id) : undefined
  if (!r) return ''
  return typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
}

export async function openTerminal(page: Page) {
  await page.keyboard.press(`${MOD}+j`)
  await expect(terminal(page)).toBeVisible()
  await expect(prompt(page)).toBeFocused()
}

export async function run(page: Page, task: string) {
  await prompt(page).fill(task)
  await prompt(page).press('Enter')
}
