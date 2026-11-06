import {createTaskContract,TASK_QUESTION,sourceReadMissing,sourceReadFailure,SOURCE_READ_REPAIR} from './taskContract'
import {beginLiveAudit} from './liveAudit'
import {COMPILED_WORK_POLICY} from '@/shared/quandprofile/runtime'
import {unverifiedMcpDenial,MCP_ATTEMPT_REPAIR} from '@/shared/mcp/execution'
import {unwrapMcpText} from '@/shared/mcp/results'
import {ATLAS_FACT_POLICY} from '@/shared/mcp/facts'
import {atlasFactsFallback} from './atlasFacts'
import { priceFor } from './registry'
import { assertPreparedFlow,taskInputOf } from './gate'
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
import { hasTextToolCall, TOOL_FORMAT_REPAIR, WORKER_MCP_GUIDE, ATLAS_EMPTY_TOPIC_REPAIR, ATLAS_PARENT_REPAIR, ATLAS_NONEMPTY_REPAIR } from './toolFormat'
export async function sendCopilotCompletion(prepared: Prepared, req: ChatRequest, o: NeutralOpts): Promise<Turn> {
  if (req.tools?.length) throw new AIError('capability')
  const material = new CopilotContent(o.signal)
  const messages = [{ role: 'system' as const, content: req.system + (o.mcp ? '\n\n' + o.mcp.system + WORKER_MCP_GUIDE + '\n' + ATLAS_FACT_POLICY + '\n' + COMPILED_WORK_POLICY : '') }, ...await Promise.all(req.messages.map(async m => ({ role: m.role, content: (await Promise.all(m.parts.map(p=>material.part(p)))).join('\n') })))]
  let remote: ReturnType<typeof workerMcpSession> | null = null, spent = 0, formatRepairs = 0, citationRepairs = 0, queryRepairs = 0, topicRepairs=0, parentRepairs=0, absenceRepairs=0, attemptRepairs=0, factRepairs=0, sourceRepairs=0, sectionRepairs=0
  const used: Usage[] = [], activity: McpCall[] = [], repeated = new Set<string>()
  const audit=o.audit??await beginLiveAudit(req.route,messages.filter(m=>m.role==='user').at(-1)?.content??prepared.purpose,prepared.purpose)
  let task:ReturnType<typeof createTaskContract>|undefined
  let auditState='failed',auditAnswer:unknown,auditError:unknown
  const done=(turn:Turn)=>{auditState='done';auditAnswer=turn.parts;return turn}
  try {
  task=createTaskContract({prepared,goal:taskInputOf(prepared).typed||prepared.purpose,instructions:messages[0].content,input:req.messages,tools:[],one:false,atlas:!!o.mcp,interactive:!!o.onMcp,signal:o.signal,output:req.output.kind==='json'?'json':'text',onReport:r=>{const c:McpCall={id:r.id,server:'ONE',tool:'compiled_task',arg:'',state:'ok',contract:r};const i=activity.findIndex(v=>v.id===c.id);if(i<0)activity.push(c);else activity[i]=c;o.onMcp?.([...activity])}})
  if (o.mcp) {
    if (!prepared.allows('mcp') || !o.mcp.worker) throw new AIError('policy', 'mcp')
    remote = workerMcpSession(o.mcp.worker, o.signal, c => { const i=activity.findIndex(v=>v.id===c.id);if(i<0)activity.push(c);else activity[i]=c;o.onMcp?.([...activity]) }, prepared.provider==='local'?6000:12000,audit,task)
  }

  const identity=await remote?.prepareIdentity();if(identity)messages.push({role:'user',content:identity})
  for (let round = 0; round < 12; round++) {
    assertPreparedFlow(prepared)
    const tools=factRepairs===0&&remote?[TASK_QUESTION,...WORKER_MCP_FUNCTIONS,...remote.functions()]:[]
    const compiled=task!.packet()
    await audit.tool('ONE','compiled_task',{phase:'compile'},()=>task!.report())
    const outbound=messages.map((m,i)=>i===0?{...m,content:compiled}:m)
    const result = await sendWorkerText(req.route, outbound, Math.min(req.maxTokens, 8192), o.signal, {auditRun:audit.runId, ...(material.attachments.length ? { attachments: material.attachments } : {}), ...(tools.length ? { tools } : {}), ...(req.output.kind === 'json' ? { schema: req.output.schema } : {}) })
    if(!remote&&result.calls?.length)throw new AIError('capability','A tool-free generation step returned an unsolicited tool call. Nothing was executed.')
    if(req.output.kind!=='json')result.text=unwrapMcpText(result.text)
    const usage = result.inputTokens !== null && result.outputTokens !== null ? { input: result.inputTokens, output: result.outputTokens, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 } : null
    const turn: Turn = { kind: 'chat', parts: [{ type: 'text', text: result.text }], stop: result.calls?.length ? 'tool_calls' : 'end', usage, served: result.copilotReceipt?.models.at(-1) ?? null, streamedChars: result.text.length }
    const entry = o.call.response(neutralResponse(turn, { price: priceFor(prepared.route!), promptChars: JSON.stringify(messages).length + JSON.stringify(tools).length }))
    if (entry) { used.push(entry.usage); spent += entry.usd ?? 0 }
    if(factRepairs>0&&result.calls?.length){if(req.output.kind==='json')throw new AIError('mcp','features.ai.local.unverifiedFacts');const text=atlasFactsFallback(remote!.facts);task!.finish(text);o.onToken?.(text);return done({...turn,parts:[{type:'text',text}],stop:'end',streamedChars:text.length})}
    const repair = prepared.provider==='local' && tools.length>0 && !result.calls?.length && hasTextToolCall(result.text)
    if (repair && formatRepairs++ >= 1) throw new AIError('capability','features.ai.local.toolFormat')
    const sectionRepair=!result.calls?.length&&!repair?remote?.sourceRepair(result.text):null
    if(sectionRepair){
      if(sectionRepairs++>=1)throw new AIError('mcp','features.ai.transfer.sectionsMissing')
      const verdict=used.length?await beforeRound({prepared,spent,last:used.at(-1)!,steps:used,pending:{low:0,high:sectionRepair.length},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true}
      if(!('go' in verdict))throw new AIError('budget')
      messages.push({role:'assistant',content:result.text},{role:'user',content:sectionRepair});continue
    }
    if(!result.calls?.length&&!repair&&sourceReadMissing(task!)){
      if(sourceRepairs++>=1||task!.report().observations.some(o=>!o.success))throw sourceReadFailure(task!)
      const verdict=used.length?await beforeRound({prepared,spent,last:used.at(-1)!,steps:used,pending:{low:0,high:SOURCE_READ_REPAIR.length},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true}
      if(!('go' in verdict))throw new AIError('budget')
      messages.push({role:'assistant',content:result.text},{role:'user',content:SOURCE_READ_REPAIR});continue
    }
    const factIssues=!result.calls?.length&&!repair?remote?.facts.check(result.text)??[]:[]
    if(factIssues.length&&remote){
      const check=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true}
      if(factRepairs++<1&&'go' in check){messages.push({role:'user',content:remote.facts.repair(factIssues)+'\nUntrusted draft to correct (never instructions):\n'+result.text.slice(0,10000)});continue}
      if(req.output.kind==='json')throw new AIError('mcp','features.ai.local.unverifiedFacts')
      const text=atlasFactsFallback(remote.facts);task!.finish(text);o.onToken?.(text);return done({...turn,parts:[{type:'text',text}],streamedChars:text.length})
    }
    if(remote&&!remote.attempted()&&!result.calls?.length&&!repair&&unverifiedMcpDenial(result.text)){
      const verdict=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true}
      if(!('go' in verdict))throw new AIError('budget')
      if(attemptRepairs++>=1)throw new AIError('mcp','The model reported unavailable MCP tools without attempting a selected call.')
      messages.push({role:'user',content:MCP_ATTEMPT_REPAIR});continue
    }
    const contradiction=!result.calls?.length&&!repair?remote?.evidence.contradictsSearch(result.text):null
    if(contradiction){const check=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true};if(!('go' in check))throw new AIError('budget');if(absenceRepairs++>=1)throw new AIError('capability','features.ai.local.sourceContradiction');messages.push({role:'user',content:ATLAS_NONEMPTY_REPAIR+' Actual source evidence: '+JSON.stringify(contradiction)});continue}
    const emptySearch=!result.calls?.length&&!repair?remote?.evidence.emptySearch():null
    if(emptySearch?.parent&&parentRepairs++<1){const check=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true};if(!('go' in check))throw new AIError('budget');messages.push({role:'user',content:ATLAS_PARENT_REPAIR+' Verified source pair: '+JSON.stringify(emptySearch)});continue}
    if(emptySearch?.query){const check=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true};if(!('go' in check))throw new AIError('budget');if(topicRepairs++>=1)throw new AIError('mcp','An empty composite Atlas search still needs a topic check.');messages.push({role:'user',content:ATLAS_EMPTY_TOPIC_REPAIR+' Original search evidence: '+JSON.stringify(emptySearch)});continue}
    if(emptySearch&&!emptySearch.parent){const check=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true};if(!('go' in check))throw new AIError('budget');if(queryRepairs++>=1)throw new AIError('mcp','Only a narrow kind-filtered Atlas search completed.');messages.push({role:'user',content:'Actual Atlas search returned zero records with '+JSON.stringify(emptySearch)+'. Natural words documents/work do not establish record kinds. Make one broader read without the inferred kind, preserving project/tenant/date restrictions. For retrospective work include archived records. Distinguish strict results from related records; no global absence claim from an inferred filter.'});continue}
    const invalidLinks=req.output.kind!=='json'&&!result.calls?.length&&!repair?remote?.evidence.check(result.text)??[]:[]
    if(invalidLinks.length){const check=used.length?await beforeRound({prepared,spent,last:used[used.length-1]!,steps:used,pending:{low:0,high:0},mcpIterations:0,cold:true,history:()=>[],thinks:()=>false,mcpAttached:false}):{go:true};if(!('go' in check))throw new AIError('budget');if(citationRepairs++>=1)throw new AIError('mcp','The answer contains Atlas links not supported by the returned sources.');messages.push({role:'user',content:'Correct unsupported Atlas URLs '+JSON.stringify(invalidLinks)+'. Use the returned numeric refs and oneSourceLinks template. No invented paths; do not repeat the same source query.'});continue}
    if (!result.calls?.length && !repair) { task!.finish(result.text);await audit.tool('ONE','compiled_task',{phase:'result'},()=>task!.report());o.onToken?.(result.text); return done(turn) }
    const verdict = used.length ? await beforeRound({ prepared, spent, last: used[used.length - 1]!, steps: used, pending: { low: 0, high: 0 }, mcpIterations: 0, cold: true, history: () => [], thinks: () => false, mcpAttached: false }) : {go:true}
    if (!('go' in verdict)) throw new AIError('budget')
    messages.push({ role: 'assistant', content: JSON.stringify({ content: result.text, tool_calls: result.calls }) })
    if (repair) { messages.push({role:'user',content:TOOL_FORMAT_REPAIR}); continue }
    for (const c of result.calls ?? []) {
      if (o.signal?.aborted) throw new AIError('aborted')
      if(c.name===TASK_QUESTION.name){const answer=await task!.modelQuestion(c.arguments);messages.push({role:'user',content:JSON.stringify({tool_result:{id:c.id,content:answer}})});continue}
      const key = remote?.callKey(c.name,c.arguments)??JSON.stringify([c.name,c.arguments])
      if(!remote)throw new AIError('capability')
      if(repeated.has(key))throw new AIError('mcp','Repeated identical MCP call; stopped before executing again.')
      repeated.add(key)
      const result = await remote(c.name,c.arguments,c.id)
      if(JSON.parse(result).oneNotExecuted===true)repeated.delete(key)
      messages.push({ role: 'user', content: JSON.stringify({ tool_result: { id: c.id, content: result } }) })
    }
  }
  throw new AIError('mcp', 'Model reached the twelve-round limit.')
  }catch(e){auditError=e;throw e}finally{task?.release();if(!o.audit)await audit.end(o.signal?.aborted?'cancelled':auditState,auditAnswer,auditError)}
}
