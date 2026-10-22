/** Browser-owned One tools; Copilot supplies bounded decisions through the personal worker. */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Prepared } from '../core/gate'
import { beforeRound } from '../core/gate'
import { AIError } from '../core/errors'
import { meterCall, neutralResponse } from '../core/meter'
import { shapeOf, withShape } from '../core/shape'
import { CopilotContent } from '../core/copilotContent'
import { sendWorkerText } from '../core/workerModels'
import type { Turn } from '@/shared/ai/types'
import type { WorkerFunction } from '@/shared/ai/worker'
import { WORKER_MCP_FUNCTIONS, isWorkerMcpFunction, workerMcpSession } from '../core/workerMcp'
import { AGENT_SYSTEM, type runAgent, type RunEnd } from './run'
import { TERMINAL_TOOLS, MAX_TOOL_CALLS, RESULT_CHARS, argLabel, clipResult, withReadLimit, withToolScope } from './tools'

/** JSON transcripts close every tool call explicitly. Unsupported binary parts fail before sending. */
export async function copilotMessages(messages: BetaMessageParam[], material: CopilotContent) {
  material.reset()
  const result: Array<{role:'user'|'assistant'|'system';content:string}> = []
  for (const m of messages) {
    if (typeof m.content === 'string') { result.push({role:m.role,content:await material.part({type:'text',text:m.content})});continue }
    const parts = []
    for (const b of m.content) {
      if (b.type==='image' && b.source.type==='base64') parts.push({type:'text',text:await material.part({type:'image',mime:b.source.media_type,data:b.source.data})})
      else if (b.type==='document' && b.source.type==='base64' && b.source.media_type==='application/pdf') parts.push({type:'text',text:await material.part({type:'document',title:b.title??'PDF',pdf:{data:b.source.data,pages:1}})})
      else if (b.type==='document' && b.source.type==='text') parts.push({type:'text',text:await material.part({type:'document',title:b.title??'Document',text:b.source.data})})
      else if (b.type==='text') parts.push({...b,text:await material.part({type:'text',text:b.text})})
      else if (b.type==='tool_use') parts.push(b)
      else if (b.type==='tool_result') {
        if (Array.isArray(b.content) && b.content.some(p=>p.type!=='text')) throw new AIError('capability','Copilot accepts text tool results only.')
        const content=typeof b.content==='string'?await material.part({type:'text',text:b.content}):await Promise.all((b.content??[]).map(async p=>({...p,text:await material.part({type:'text',text:p.type==='text'?p.text:''})})))
        parts.push({...b,content})
      } else throw new AIError('capability','Unsupported private provider history. Start a fresh task.')
    }
    result.push({role:m.role,content:JSON.stringify(parts)})
  }
  return result
}
export async function runCopilotAgent(opts: Parameters<typeof runAgent>[0], prepared: Prepared, messages: BetaMessageParam[]): Promise<RunEnd> {
  const route = prepared.route!, { signal, hooks, stage } = opts
  const shape = shapeOf(prepared), seen = shape ? prepared.visible : null
  const tools = opts.tools ?? TERMINAL_TOOLS
  let remote: ReturnType<typeof workerMcpSession> | null = null
  let calls = 0, rounds = 0, spent = 0
  const used: import('@/shared/ai/types').Usage[] = [], repeated = new Map<string, number>()
  const call = meterCall(prepared, { source: opts.run?.source ?? opts.ledgerSource, signal })
  const system = (opts.system ?? AGENT_SYSTEM) + (opts.mcp ? '\n\n' + opts.mcp.system : '')
  // Credentials remain only on the authenticated worker/MCP path, never in definitions or messages.
  if (opts.mcp) {
    if (!opts.mcp.worker || !prepared.allows('mcp')) throw new AIError('capability', 'Selected MCP connections are unavailable on this route.')
    remote = workerMcpSession(opts.mcp.worker, signal, hooks.mcp)
  }
  const definitions: WorkerFunction[] = [...tools.map(t => ({ name: t.name, description: t.description.slice(0,400), parameters: t.input_schema })), ...(remote ? WORKER_MCP_FUNCTIONS : [])]
  const material = new CopilotContent(signal)
  const run = async () => {
    while (++rounds <= 40) {
      if (signal.aborted) throw new AIError('aborted')
      const transcript = await copilotMessages(messages, material)
      const result = await sendWorkerText(route, [{ role: 'system', content: system }, ...transcript], Math.min(8192, prepared.maxTokens ?? 8192), signal, { tools: calls < MAX_TOOL_CALLS ? definitions : [], ...(material.attachments.length ? {attachments:material.attachments} : {}) })
      const usage = result.inputTokens !== null && result.outputTokens !== null ? { input: result.inputTokens, output: result.outputTokens, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 } : null
      const turn: Turn = { kind: 'chat', parts: [{ type: 'text', text: result.text }], stop: result.calls?.length ? 'tool_calls' : 'end', usage, served: result.model, streamedChars: result.text.length }
      const entry = call.response(neutralResponse(turn, { price: null, promptChars: system.length + JSON.stringify(messages).length + JSON.stringify(definitions).length }))
      if (entry) { spent += entry.usd ?? 0; used.push(entry.usage); hooks.usage(entry.usage, entry) }
      if (result.text) hooks.text(result.text)
      hooks.textDone(result.calls?.length ? 'note' : 'answer')
      messages.push({ role: 'assistant', content: [...(result.text ? [{ type: 'text' as const, text: result.text }] : []), ...(result.calls ?? []).map(c => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.arguments }))] })
      if (!result.calls?.length) return calls >= MAX_TOOL_CALLS ? 'limit' as const : 'done' as const
      if (used.length) {
        const verdict = await beforeRound({ prepared, spent, last: used[used.length - 1]!, steps: used, pending: { low: 0, high: 0 }, mcpIterations: 0, cold: true, history: () => messages, thinks: () => false, mcpAttached: false })
        if ('stop' in verdict || 'halt' in verdict) { if ('stop' in verdict) hooks.held?.(verdict); return 'held' as const }
      }
      const results = []
      for (const c of result.calls) {
        if (signal.aborted) throw new AIError('aborted')
        const key = JSON.stringify([c.name, c.arguments]), n = (repeated.get(key) ?? 0) + 1
        repeated.set(key, n)
        if (++calls > MAX_TOOL_CALLS || n > 3 || n > 1 && (tools.find(t => t.name === c.name)?.write || isWorkerMcpFunction(c.name))) { hooks.limit(); return 'limit' as const }
        let content: string, failed = false
        const tool = tools.find(t => t.name === c.name)
        if (tool) {
          const start = performance.now()
          const id = hooks.toolStart(tool.name, argLabel(tool.name, c.arguments, stage))
          try {
            const out = await withShape(shape, () => withToolScope(seen, () => withReadLimit(opts.readLimit ?? null, () => tool.run(c.arguments, stage))))
            hooks.toolEnd(id, { state: out.state, summary: out.summary, changeId: out.changeId, ms: performance.now() - start })
            content = clipResult(out.content, RESULT_CHARS + 2000)
          } catch (e) { failed = true; content = e instanceof Error ? e.message : 'Tool failed.'; hooks.toolEnd(id, { state: 'err', summary: '', ms: performance.now() - start }) }
        } else if (remote && isWorkerMcpFunction(c.name)) {
          try { const raw = await remote(c.name, c.arguments, c.id);failed=JSON.parse(raw).isError===true;content = clipResult(raw, RESULT_CHARS + 2000) }
          catch { failed=true;content='MCP discovery/call failed. Check the exact selected tool, its arguments and connection.' }
        } else throw new AIError('capability', 'Unknown Copilot function.')
        results.push({ type: 'tool_result' as const, tool_use_id: c.id, content, ...(failed ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
    }
    hooks.limit()
    return 'limit' as const
  }
  try { return await run() } finally { hooks.history(messages) }
}
