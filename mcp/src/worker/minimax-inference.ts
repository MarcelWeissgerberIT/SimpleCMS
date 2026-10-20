/** MiniMax's OpenAI-compatible wire format; task tools and memory stay in the shared harness. */
import { InferenceLimit, type LocalInference } from './local-inference.ts'
import { MINIMAX_MODEL, type MiniMaxConfig } from './minimax-config.ts'

const ENDPOINT = 'https://api.minimax.io/v1/chat/completions'
// Published 2026-10-19, USD / million tokens. Estimates, not provider billing receipts.
export const MINIMAX_PRICE = { input: 0.15, cached: 0.015, output: 0.60 }
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

function wireMessages(messages: any[]) {
  return messages.map(m => {
    if (m.role === 'tool') {
      if (typeof m.tool_call_id !== 'string') throw new Error('MiniMax tool result has no call ID.')
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    }
    return { role: m.role, content: m.content ?? '', ...(m.reasoning_content !== undefined ? { reasoning_content: m.reasoning_content } : {}),
      ...(m.tool_calls?.length ? { tool_calls: m.tool_calls.map((c: any) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments) } })) } : {}) }
  })
}

export function miniMaxInference(config: MiniMaxConfig, budgetUsd: number | null, transport: typeof fetch = fetch): LocalInference {
  if (!config.apiKey) throw new Error('Set your MiniMax API key on the worker setup page before starting this task.')
  let cost = 0
  const inference: LocalInference = async request => {
    request.signal.throwIfAborted()
    const messages = wireMessages(request.messages)
    const inputBound = Math.min(request.contextTokens, Buffer.byteLength(JSON.stringify({ messages, tools: request.tools })) + 2048)
    const reserve = inputBound * MINIMAX_PRICE.input / 1e6
    const output = Math.min(request.outputTokens, budgetUsd === null ? request.outputTokens : Math.floor((budgetUsd - cost - reserve) * 1e6 / MINIMAX_PRICE.output))
    if (output < 256) throw new InferenceLimit('MiniMax cost limit reached. No further API request was sent.', 'budget')
    const reserved = reserve + output * MINIMAX_PRICE.output / 1e6
    cost += reserved // On an uncertain transport outcome, retain this conservative estimate; never retry automatically.
    const response = await transport(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: MINIMAX_MODEL, messages, tools: request.tools, stream: false, reasoning_effort: config.effort, max_completion_tokens: output }),
    })
    if (!response.ok) {
      if (response.status < 500) cost -= reserved
      throw new Error(response.status === 401 || response.status === 403 ? 'MiniMax rejected the API key. Check it on the worker setup page.' : response.status === 429 ? 'MiniMax rate or credit limit reached. Retry later after checking your account.' : `MiniMax request failed (HTTP ${response.status}).`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('MiniMax returned no response body.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('MiniMax response exceeded 2 MB.') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    let data: any
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('MiniMax returned invalid JSON. No tool call was executed.') }
    const usage = data.usage
    if (!integer(usage?.prompt_tokens) || !integer(usage?.completion_tokens)) throw new InferenceLimit('MiniMax returned no usable token usage. Stopped before executing tools; check provider billing.')
    const cached = Math.min(usage.prompt_tokens, integer(usage.prompt_tokens_details?.cached_tokens) ? usage.prompt_tokens_details.cached_tokens : 0)
    cost -= reserved
    cost += ((usage.prompt_tokens - cached) * MINIMAX_PRICE.input + cached * MINIMAX_PRICE.cached + usage.completion_tokens * MINIMAX_PRICE.output) / 1e6
    const choice = data.choices?.[0]
    if (choice?.finish_reason === 'length') throw new InferenceLimit('MiniMax reached its output limit. No partial tool call was executed. Split the work package or reduce thinking effort.')
    if (!['stop', 'tool_calls'].includes(choice?.finish_reason)) throw new Error('MiniMax returned an unsupported finish reason. No tool call was executed.')
    const message = choice.message
    if (message?.role !== 'assistant' || (message.content != null && typeof message.content !== 'string') || (message.reasoning_content != null && typeof message.reasoning_content !== 'string')) throw new Error('MiniMax returned an invalid assistant message.')
    const calls = message.tool_calls ?? []
    if (!Array.isArray(calls) || calls.length > 8 || new Set(calls.map((c: any) => c?.id)).size !== calls.length) throw new Error('MiniMax returned invalid tool calls.')
    for (const call of calls) if (typeof call?.id !== 'string' || !call.id || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') throw new Error('MiniMax returned an invalid tool call.')
    for (const call of calls) {
      if (call.id.length > 200 || call.function.arguments.length > 70000 || !request.tools.some(t => t.function?.name === call.function.name)) throw new Error('MiniMax returned an unavailable or oversized tool call.')
      let args: unknown
      try { args = JSON.parse(call.function.arguments) } catch { throw new Error('MiniMax returned invalid tool arguments. No tool call was executed.') }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('MiniMax tool arguments must be an object.')
    }
    if (choice.finish_reason === 'tool_calls' && !calls.length) throw new Error('MiniMax omitted its tool calls.')
    return { message, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
  }
  inference.cost = () => cost
  return inference
}
