/** Text/JSON one-shots with selected remote tools. The browser owns the loop and OUT lock. */
import type { ChatRequest, Turn, Usage } from '@/shared/ai/types'
import { WORKER_MCP_FUNCTIONS, workerMcpSession } from './workerMcp'
import type { Prepared } from './gate'
import { beforeRound } from './gate'
import { AIError } from './errors'
import { CopilotContent } from './copilotContent'
import { sendWorkerText } from './workerModels'
import { neutralResponse } from './meter'
import type { NeutralOpts } from './call'
import type { McpCall } from '../mcp-servers/activity'
export async function sendCopilotCompletion(prepared: Prepared, req: ChatRequest, o: NeutralOpts): Promise<Turn> {
  if (req.tools?.length) throw new AIError('capability')
  const material = new CopilotContent(o.signal)
  const messages = [{ role: 'system' as const, content: req.system + (o.mcp ? '\n\n' + o.mcp.system : '') }, ...await Promise.all(req.messages.map(async m => ({ role: m.role, content: (await Promise.all(m.parts.map(p=>material.part(p)))).join('\n') })))]
  let remote: ReturnType<typeof workerMcpSession> | null = null, spent = 0
  const used: Usage[] = [], activity: McpCall[] = [], repeated = new Set<string>()
  if (o.mcp) {
    if (!prepared.allows('mcp') || !o.mcp.worker) throw new AIError('policy', 'mcp')
    remote = workerMcpSession(o.mcp.worker, o.signal, c => { const i=activity.findIndex(v=>v.id===c.id);if(i<0)activity.push(c);else activity[i]=c;o.onMcp?.([...activity]) })
  }
  const tools = remote ? WORKER_MCP_FUNCTIONS : []
  for (let round = 0; round < 12; round++) {
    const result = await sendWorkerText(req.route, messages, Math.min(req.maxTokens, 8192), o.signal, { ...(material.attachments.length ? { attachments: material.attachments } : {}), ...(tools.length ? { tools } : {}), ...(req.output.kind === 'json' ? { schema: req.output.schema } : {}) })
    const usage = result.inputTokens !== null && result.outputTokens !== null ? { input: result.inputTokens, output: result.outputTokens, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 } : null
    const turn: Turn = { kind: 'chat', parts: [{ type: 'text', text: result.text }], stop: result.calls?.length ? 'tool_calls' : 'end', usage, served: result.copilotReceipt?.models.at(-1) ?? null, streamedChars: result.text.length }
    const entry = o.call.response(neutralResponse(turn, { price: null, promptChars: JSON.stringify(messages).length + JSON.stringify(tools).length }))
    if (entry) { used.push(entry.usage); spent += entry.usd ?? 0 }
    if (!result.calls?.length) { o.onToken?.(result.text); return turn }
    const verdict = await beforeRound({ prepared, spent, last: used[used.length - 1]!, steps: used, pending: { low: 0, high: 0 }, mcpIterations: 0, cold: true, history: () => [], thinks: () => false, mcpAttached: false })
    if (!('go' in verdict)) throw new AIError('budget')
    messages.push({ role: 'assistant', content: JSON.stringify({ content: result.text, tool_calls: result.calls }) })
    for (const c of result.calls) {
      if (o.signal?.aborted) throw new AIError('aborted')
      const key = JSON.stringify([c.name,c.arguments])
      if(!remote)throw new AIError('capability')
      if(repeated.has(key))throw new AIError('mcp','Repeated identical MCP call; stopped before executing again.')
      repeated.add(key)
      const result = await remote(c.name,c.arguments,c.id)
      messages.push({ role: 'user', content: JSON.stringify({ tool_result: { id: c.id, content: result } }) })
    }
  }
  throw new AIError('mcp', 'Copilot reached the twelve-round limit.')
}
