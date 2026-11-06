/** Fixed Ollama Cloud endpoint; task tools, permissions and memory stay in the shared harness. */
import { InferenceLimit, type LocalInference } from './local-inference.ts'
import type { OllamaCloudConfig } from './ollama-cloud-config.ts'

const ENDPOINT = 'https://ollama.com/v1/chat/completions'
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

function wireMessages(messages: any[]) {
  return messages.map(m => {
    if (m.role === 'tool') {
      if (typeof m.tool_call_id !== 'string') throw new Error('Ollama Cloud tool result has no call ID.')
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    }
    return { role: m.role, content: m.content ?? '', ...(m.reasoning_content !== undefined ? { reasoning_content: m.reasoning_content } : {}),
      ...(m.tool_calls?.length ? { tool_calls: m.tool_calls.map((c: any) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments) } })) } : {}) }
  })
}

export function ollamaCloudInference(config: OllamaCloudConfig, transport: typeof fetch = fetch): LocalInference {
  if (!config.apiKey) throw new Error('Set your Ollama Cloud API key on the worker setup page before starting this task.')
  const inference: LocalInference = async request => {
    request.signal.throwIfAborted()
    const messages = wireMessages(request.messages)
    const response = await transport(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, tools: request.tools, stream: false, max_tokens: request.outputTokens }),
    })
    if (!response.ok) {
      throw new Error(response.status === 401 || response.status === 403 ? 'Ollama Cloud rejected the API key. Check it on the worker setup page.' : response.status === 429 ? 'Ollama Cloud rate or credit limit reached. Retry later after checking your account.' : `Ollama Cloud request failed (HTTP ${response.status}).`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Ollama Cloud returned no response body.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Ollama Cloud response exceeded 2 MB.') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    let data: any
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('Ollama Cloud returned invalid JSON. No tool call was executed.') }
    const usage = data.usage
    if (!integer(usage?.prompt_tokens) || !integer(usage?.completion_tokens)) throw new InferenceLimit('Ollama Cloud returned no usable token usage. Stopped before executing tools; check provider billing.')
    const choice = data.choices?.[0]
    if (choice?.finish_reason === 'length') throw new InferenceLimit('Ollama Cloud reached its output limit. No partial tool call was executed. Split the task into smaller work packages.')
    if (!['stop', 'tool_calls'].includes(choice?.finish_reason)) throw new Error('Ollama Cloud returned an unsupported finish reason. No tool call was executed.')
    const message = choice.message
    if (message?.role !== 'assistant' || (message.content != null && typeof message.content !== 'string') || (message.reasoning_content != null && typeof message.reasoning_content !== 'string')) throw new Error('Ollama Cloud returned an invalid assistant message.')
    const calls = message.tool_calls ?? []
    if (!Array.isArray(calls) || calls.length > 8 || new Set(calls.map((c: any) => c?.id)).size !== calls.length) throw new Error('Ollama Cloud returned invalid tool calls.')
    for (const call of calls) if (typeof call?.id !== 'string' || !call.id || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') throw new Error('Ollama Cloud returned an invalid tool call.')
    for (const call of calls) {
      if (call.id.length > 200 || call.function.arguments.length > 70000 || !request.tools.some(t => t.function?.name === call.function.name)) throw new Error('Ollama Cloud returned an unavailable or oversized tool call.')
      let args: unknown
      try { args = JSON.parse(call.function.arguments) } catch { throw new Error('Ollama Cloud returned invalid tool arguments. No tool call was executed.') }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Ollama Cloud tool arguments must be an object.')
    }
    if (choice.finish_reason === 'tool_calls' && !calls.length) throw new Error('Ollama Cloud omitted its tool calls.')
    return { message, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
  }
  inference.unmetered = true
  return inference
}
