import { randomUUID } from 'node:crypto'
import type { WorkerTextRequest, WorkerCall } from '../../../src/shared/ai/worker.ts'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'

/** Convert the browser's closed JSON transcript to native Ollama tool messages.
 * This adapter only exchanges inference data: it never executes a function. */
export function localChatMessages(messages: WorkerTextRequest['messages']) {
  const names = new Map<string,string>()
  return messages.flatMap<any>(message => {
    let parsed: any
    try { parsed = JSON.parse(message.content) } catch { return [message] }
    if (message.role === 'assistant') {
      const blocks = Array.isArray(parsed) ? parsed : null
      const calls = blocks ? blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: b.input })) : parsed?.tool_calls
      if (!Array.isArray(calls) || !calls.length) return [message]
      for (const c of calls) names.set(c.id,c.name)
      return [{ role: 'assistant', content: blocks ? blocks.filter(b => b.type === 'text').map(b => b.text).join('\n') : parsed.content ?? '',
        tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }]
    }
    if (message.role === 'user') {
      const results = Array.isArray(parsed) && parsed.every(b => b.type === 'tool_result') ? parsed.map(b => ({ id: b.tool_use_id, content: b.content })) : parsed?.tool_result ? [parsed.tool_result] : null
      if (results) return results.map((r: any) => ({ role: 'tool', tool_call_id: r.id, ...(names.has(r.id) ? {tool_name:names.get(r.id)} : {}), content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) }))
    }
    return [message]
  })
}

export function localChatResult(message: any, request: WorkerTextRequest): { text: string; calls?: WorkerCall[] } {
  if (!message || message.content !== undefined && typeof message.content !== 'string') throw new Error('Invalid local model answer.')
  const raw = message.tool_calls ?? []
  if (!Array.isArray(raw) || raw.length > 8 || raw.length && !request.tools?.length) throw new Error('Unexpected local tool calls.')
  const validator = new AjvJsonSchemaValidator()
  const calls = raw.map((c: any): WorkerCall => {
    const tool = request.tools?.find(t => t.name === c?.function?.name)
    if (!tool || !c.function.arguments || typeof c.function.arguments !== 'object' || Array.isArray(c.function.arguments) || !validator.getValidator(tool.parameters)(c.function.arguments).valid) throw new Error('Invalid local tool arguments; no function was executed.')
    return { id: randomUUID(), name: tool.name, arguments: c.function.arguments }
  })
  const text = message.content ?? ''
  if (!calls.length && request.schema) {
    let answer: unknown
    try { answer = JSON.parse(text) } catch { throw new Error('The local model did not return valid JSON.') }
    if (!validator.getValidator(request.schema)(answer).valid) throw new Error('The local answer does not match the requested schema.')
  }
  return { text, ...(calls.length ? { calls } : {}) }
}
