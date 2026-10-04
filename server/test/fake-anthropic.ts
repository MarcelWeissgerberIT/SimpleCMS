/**
 * A fake Messages API for agent tests (the real api.anthropic.com is never called): the server under
 * test points ANTHROPIC_BASE_URL here. Every POST /v1/messages is recorded (body + headers) and
 * answered — streamed as server-sent events like the real API when the request asks for a stream —
 * with what the test's script returns for it. Scripts are chosen per agent by the agent name in the
 * system prompt (`<agent_instructions name="…">`).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'

export interface FakeRequest {
  body: any
  headers: Record<string, string>
  /** the agent's name from the system prompt */
  agent: string
}

/** A scripted reply: the message's content blocks (tool_use input given whole), or an HTTP error. */
export interface Reply {
  content?: any[]
  stop_reason?: string
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  status?: number
  error?: { type: string; message: string }
  /** delay before answering (ms) */
  delay?: number
}

export type Script = (req: FakeRequest, n: number) => Reply | Promise<Reply>

export interface FakeAnthropic {
  url: string
  requests: FakeRequest[]
  /** requests of one agent, in order */
  of(agent: string): FakeRequest[]
  script(agent: string, fn: Script): void
  close(): Promise<void>
}

const text = (s: string) => ({ type: 'text', text: s })
export const say = (s: string): Reply => ({ content: [text(s)], stop_reason: 'end_turn' })
export const tools = (...calls: Array<[name: string, input: Record<string, unknown>]>): Reply => ({
  content: calls.map(([name, input], i) => ({ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2)}_${i}`, name, input })),
  stop_reason: 'tool_use',
})

/** The tool_result blocks of a request's last user message, by tool_use order. */
export function toolResults(req: FakeRequest): Array<{ content: string; is_error?: boolean }> {
  const last = req.body.messages[req.body.messages.length - 1]
  return (Array.isArray(last?.content) ? last.content : []).filter((b: any) => b.type === 'tool_result').map((b: any) => ({ content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content), is_error: b.is_error }))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function sse(events: Array<[string, unknown]>): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

/** The SSE stream of a message, block by block (text / tool input / thinking as deltas). */
function streamOf(model: string, reply: Reply): string {
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...reply.usage }
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { id: `msg_${Math.random().toString(36).slice(2)}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }],
  ]
  ;(reply.content ?? []).forEach((block, index) => {
    if (block.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }])
    } else if (block.type === 'tool_use') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }])
    } else if (block.type === 'thinking') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } }])
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: block }])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: reply.stop_reason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens, input_tokens: usage.input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens } }])
  events.push(['message_stop', { type: 'message_stop' }])
  return sse(events)
}

export async function fakeAnthropic(): Promise<FakeAnthropic> {
  const requests: FakeRequest[] = []
  const scripts = new Map<string, Script>()
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }))
      return
    }
    const body = JSON.parse(await readBody(req)) as any
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '')
    const agent = /<agent_instructions name="([^"]*)"/.exec(system)?.[1] ?? ''
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]))
    const record: FakeRequest = { body, headers, agent }
    requests.push(record)
    const n = requests.filter((r) => r.agent === agent).length - 1
    const script = scripts.get(agent)
    const reply: Reply = script ? await script(record, n) : say(`(no script for ${agent})`)
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay))
    if (reply.status) {
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: reply.error ?? { type: 'api_error', message: 'failed' } }))
      return
    }
    const model = reply.model ?? body.model
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.end(streamOf(model, reply))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model, content: reply.content ?? [], stop_reason: reply.stop_reason ?? 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50, ...reply.usage } }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    of: (agent) => requests.filter((r) => r.agent === agent),
    script: (agent, fn) => void scripts.set(agent, fn),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
