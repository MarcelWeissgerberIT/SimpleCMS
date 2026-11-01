/** Fixed source -> draft -> minimum checks -> staged edit. The model never chooses the write target or tools. */
import {completeStructured} from '../client'
import {assertPreparedFlow,type Prepared} from '../core/gate'
import {createTaskContract,oneTaskEffect} from '../core/taskContract'
import {tapSignal} from '../core/meter'
import {beginLiveAudit} from '../core/liveAudit'
import {fixedProgramInstructions,validateValue} from '@/shared/quandprofile/program'
import {withShape,shapeOf} from '../core/shape'
import {withToolScope,withReadLimit,ToolInputError} from './tools'
import {agentSystemText,TASK_RULES,type runAgent} from './run'
import {CODING_RULES} from './coding'
import type {groundedTask} from './grounding'
import {completeEarsSentences} from '@/shared/ai/delivery'
import {useWorkspace} from '../../../store/store'
const SCHEMA={type:'object',properties:{markdown:{type:'string',minLength:100,maxLength:24000},source_quotes:{type:'array',minItems:1,maxItems:6,items:{type:'object',properties:{url:{type:'string'},quote:{type:'string',minLength:20,maxLength:1000}},required:['url','quote'],additionalProperties:false}},requirements:{type:'array',minItems:0,maxItems:20,items:{type:'object',properties:{statement:{type:'string',minLength:20,maxLength:1000},target_quote:{type:'string',minLength:16,maxLength:1000},acceptance_check:{type:'string',minLength:15,maxLength:1000}},required:['statement','target_quote','acceptance_check'],additionalProperties:false}}},required:['markdown','source_quotes','requirements'],additionalProperties:false}
type Draft={markdown:string;source_quotes:Array<{url:string;quote:string}>;requirements:Array<{statement:string;target_quote:string;acceptance_check:string}>}

export async function runGroundedRewrite(o:Parameters<typeof runAgent>[0],prepared:Prepared,delivery:ReturnType<typeof groundedTask>){
 const {hooks,signal}=o,de=useWorkspace.getState().settings.language==='de'
 const instructions=fixedProgramInstructions(o.system??'',[agentSystemText(true),agentSystemText(false),TASK_RULES,CODING_RULES])+delivery.guide
 const task=createTaskContract({prepared,goal:o.typed??'',instructions,input:delivery.context(),tools:delivery.tools.map(t=>t.name),one:true,atlas:false,sourcesRequired:true,signal,onReport:hooks.contract,interactive:false})
 delivery.bind(task)
 const untap=tapSignal(signal,{onEntry:e=>hooks.usage(e.usage,e)})
 let audit:Awaited<ReturnType<typeof beginLiveAudit>>|undefined
 let state='failed',error:unknown
 try{
  audit=await beginLiveAudit(prepared.route!,o.typed??'',o.purpose)
  await audit.tool('ONE','source_preflight_snapshot',{target:delivery.plan.target,urls:delivery.plan.urls},()=>delivery.context())
  hooks.note(de?'Geführter BA-Entwurf: Originalseite und URL gelesen. Das Modell schreibt nur einen Entwurf; ONE prüft und adressiert die Änderung.':'Guided BA draft: original page and URL read. The model drafts only; ONE checks and targets the change.')
  let repair='',draft:Draft|undefined
  for(let attempt=0;attempt<2;attempt++){
   signal.throwIfAborted();assertPreparedFlow(prepared)
   await audit.tool('ONE','compiled_task',{phase:'compile'},()=>task.report())
   const raw=await audit.tool('MODEL','grounded_rewrite',{attempt:attempt+1},()=>completeStructured({purpose:o.purpose,sources:o.sources,typed:o.typed,route:prepared.route,applied:o.applied,signal,...(o.run?{run:o.run}:{}),ledgerSource:o.run?.source,mcp:false,schema:SCHEMA,system:task.packet()+'\nYou have no tools. Produce the requested replacement as a substantive, source-grounded artifact, not a short description of the topic. Keep ALL existing project facts, ticket references, status qualifications and unrelated sections. The target content defines project facts; the external source defines the requested notation/method. Do not turn method examples into new project requirements. Do not invent history or authority. Clearly label missing specifications and proposals. Use the user language. For EARS, include a usable brief explanation of the applicable patterns, full concrete requirements derived from the target, and boundary/acceptance checks with unknowns explicit. Cite the supplied URL in the Markdown. source_quotes must be exact verbatim quotations from the actual external source, never your own text or a paraphrase. For EARS application also return requirements: each concrete statement must occur verbatim in your Markdown, target_quote must be an exact quotation from the original target page supporting it, and acceptance_check must occur in your Markdown. One trace per proposed requirement; do not use a method example as a project requirement. For other rewrites requirements may be empty. Return JSON only.',prompt:delivery.context()+(repair?'\nHost check of the previous draft: '+repair:'')}))
   assertPreparedFlow(prepared);let issues:string[]=[]
   try{const parsed=JSON.parse(raw);validateValue(parsed,SCHEMA,'grounded_draft');draft=parsed;issues=delivery.draftIssues(draft!.markdown);for(const q of draft!.source_quotes)if(!delivery.quoteValid(q.url,q.quote))issues.push('External quotation does not match the actual read source: use an exact supplied quote and requested_url.');if(delivery.plan.ears&&!draft!.requirements.length)issues.push('Provide source-linked applied requirements, not only examples of the notation.');for(const r of draft!.requirements){if(!delivery.targetQuoteValid(r.target_quote))issues.push('Requirement target_quote must match the actual original page, not the method source.');if(!draft!.markdown.includes(r.statement)||!draft!.markdown.includes(r.acceptance_check))issues.push('The traced requirement and acceptance check must appear verbatim in the proposed Markdown.');if(delivery.plan.ears&&!completeEarsSentences(r.statement).length)issues.push('The traced requirement is not a complete EARS sentence.');}}catch(e){draft=undefined;issues=['Invalid structured draft: '+String(e).slice(0,300)]}
   if(!issues.length&&draft)break
   draft=undefined;repair=issues.join('\n');hooks.note(de?'Entwurf angehalten: Quellen-, Ziel- oder Syntaxprüfung verlangt eine Korrektur.':'Draft held: source, target or syntax checks require a correction.')
  }
  if(!draft)throw new ToolInputError('No draft passed the source/target/syntax minimum checks after one correction. '+repair)
  await audit.tool('ONE','delivery_minimum_checks',{target:delivery.plan.target},()=>({externalQuotesMatched:draft!.source_quotes.length,requirementsWithTargetQuoteAndAcceptanceCheck:draft!.requirements.length,targetPinned:true,semanticEntailment:'not_verified',humanAcceptance:'open'}))
  hooks.note(de?`Vorprüfung: ${draft.source_quotes.length} Quellenzitat(e), ${draft.requirements.length} Anforderung(en) mit Originalbezug und Prüfkriterium. Fachliche Abnahme offen.`:`Minimum checks: ${draft.source_quotes.length} exact source quote(s), ${draft.requirements.length} requirement(s) with target quote and acceptance check. Semantic acceptance open.`)
  const input={id:delivery.plan.target!,edits:[{op:'replace_all',markdown:draft.markdown}]},tool=delivery.tools.find(t=>t.name==='edit_page')!
  assertPreparedFlow(prepared);task.dispatch(tool.name,oneTaskEffect(tool.name,tool.write))
  const id=hooks.toolStart(tool.name,delivery.plan.target!),start=performance.now()
  try{const result=await audit.tool('ONE','edit_page',input,()=>withShape(shapeOf(prepared),()=>withToolScope(shapeOf(prepared)?prepared.visible:null,()=>withReadLimit(o.readLimit??null,()=>tool.run(input,o.stage)))));hooks.toolEnd(id,{state:result.state,summary:result.summary,changeId:result.changeId,ms:performance.now()-start});task.capture({kind:'tool',tool:tool.name,schema:tool.input_schema,args:input,effect:'stage'});task.observe('one',true,false,true,false,'edit_page')}
  catch(e){hooks.toolEnd(id,{state:'err',summary:'Draft not staged.',ms:performance.now()-start});throw e}
  delivery.finish();const answer=de?'Überarbeitung der ursprünglichen Seite zur Prüfung vorgemerkt. URL und Originalseite wurden tatsächlich gelesen; Quellenzitate, Seitenziel und Mindeststruktur wurden geprüft. Fachliche Richtigkeit und Abnahme bleiben offen.':'The original page rewrite is staged for review. URL and original page were actually read; source quotations, page target and minimum structure were checked. Semantic correctness and human acceptance remain open.'
  task.finish(answer);hooks.text(answer);hooks.textDone('answer');hooks.history([...o.history,o.user,{role:'assistant',content:answer}]);state='done'
  await audit.tool('ONE','compiled_task',{phase:'result'},()=>task.report());return 'done' as const
 }catch(e){error=e;task.fail('Source-grounded rewrite did not reach a reviewable result. No semantic approval was recorded.');throw e}finally{untap();task.release();await audit?.end(signal.aborted?'cancelled':state,undefined,error)}
}
