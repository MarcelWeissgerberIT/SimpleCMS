import {skillRequest,skillReceipt,pinSkillRequest,SKILL_POLICY} from '@/shared/ai/skills'
import {AIError} from './errors'
import {typedReceipt} from './typedAI'
import {resolveTypedAI} from '@/shared/quandprofile/typed-ai'
import {readReviewProfile,type ReviewProfile} from '@/shared/quandprofile/review-profile'
import {pmBriefPlan} from '@/shared/ai/pmBrief'
import {mockIntent} from '@/shared/ai/designMock'
import {analysisIntent} from '@/shared/ai/analysis'
import {draftProgram,draftWorkflow} from '@/shared/quandprofile/program'
import {TaskSession} from '@/shared/quandprofile/task-session'
import {taskBoundaries,type TaskReport} from '@/shared/quandprofile/task'
import {stateHash} from '@/shared/quandprofile/runtime'
import type {WorkerFunction} from '@/shared/ai/worker'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud/state'
import {compileTask} from './quandprofile'
import {assertPreparedFlow,taskInputOf,type Prepared} from './gate'
import {codewordsIn} from '../mcp-servers/config'
import {CONTEXT_TOOL_POLICY,requestedWriteKind} from '@/shared/ai/actionIntent'
const sessions=new Map<string,TaskSession>()
export const taskProgramDraft=(id:string)=>{
 const task=sessions.get(id);if(!task||!['ready','accepted'].includes(task.report().phase))throw Error('Run is not ready or is no longer available.')
 const contract=task.report().compiled.contract,goal=pinSkillRequest(contract.goal,task.report().skills??[]),trace=task.captured()
 if(contract.authenticate)throw Error('Personal sign-in must be explicitly requested again, not saved as an executable program.')
 const mode=analysisIntent(goal)?.role??(pmBriefPlan(goal)?'pm':mockIntent(goal)||task.report().observations.some(o=>o.tool==='create_design_mock')?'mock':null)
 if(mode){
  const readTarget=trace.find(s=>s.tool==='read_page')?.args?.id as string|undefined
  const target=(mode==='ba'||mode==='po'?contract.source_pointers.map(p=>{try{return JSON.parse(p)?.page as string|undefined}catch{return undefined}}).find(Boolean):undefined)??readTarget
  const connections=[...new Map(trace.filter(s=>s.server&&s.endpoint).map(s=>[s.server!,{name:s.server!,endpoint:s.endpoint!}])).values()]
  return {...draftWorkflow(goal,mode,target??null,connections),...(contract.review_profile?{profile:contract.review_profile}:{})}
 }
 return {...draftProgram(goal,trace),...(contract.review_profile?{profile:contract.review_profile}:{})}
}
export const taskDecisionActive=(id:string,question:string)=>{try{return sessions.get(id)?.canAnswer(question)??false}catch{return false}}
export const answerTaskDecision=(id:string,question:string,answer:string)=>{try{return sessions.get(id)?.answer(question,answer)??false}catch{return false}}
export const acceptTaskResult=(id:string)=>{try{return sessions.get(id)?.accept()??false}catch{return false}}
export const TASK_QUESTION:WorkerFunction={name:'one_task_question',description:'After inspecting available ONE and Atlas sources, ask a precise unresolved prerequisite question in the decision cube. The human answers. Dependent effects pause; do not invent decisions or approval. Only when the requested next action cannot proceed without a human answer now. When asked to formulate questions, list open questions in the final answer without pausing. Not for routine reads or an analysis that can already be delivered.',parameters:{type:'object',properties:{question:{type:'string',maxLength:2000},needed_for:{type:'string',maxLength:1000},options:{type:'array',maxItems:3,items:{type:'object',properties:{label:{type:'string'},effect:{type:'string'}},required:['label','effect'],additionalProperties:false}}},required:['question','needed_for'],additionalProperties:false}}
export function createTaskContract(o:{reviewProfile?:ReviewProfile|null;prepared:Prepared;goal:string;instructions?:string;input?:unknown;tools:string[];one:boolean;atlas:boolean;signal?:AbortSignal;output?:'text'|'json';onReport?:(report:TaskReport)=>void;interactive?:boolean;sourcesRequired?:boolean;atlasSourcesRequired?:boolean;bounds?:{readOnly:boolean;externalWrite:boolean;execute:boolean;authenticate?:boolean}}){
 let currentPrepared=o.prepared
 const signature=()=>{const s=useWorkspace.getState(),c=useCloud.getState();return stateHash([s.epoch,c.active,c.user?.id,s.ai,s.settings.mcpServers,currentPrepared.route])}
 const input=taskInputOf(o.prepared),skillInput=skillRequest(input.typed).text,skills=o.prepared.skills??[],addressed=o.atlas?codewordsIn(skillInput):null,base=o.bounds??taskBoundaries(addressed?.text??skillInput),id=crypto.randomUUID()
 const profile=o.reviewProfile?readReviewProfile(o.reviewProfile):undefined,p=profile?.spec
 if(p&&((p.requireOne||p.onePages.length)&&!o.one||(p.requireAtlas||p.atlasRefs.length)&&!o.atlas))throw Error('Review profile "'+p.name+'" requires sources unavailable in this task. Choose a compatible profile in Cube profiles before starting.')
 const typed=p?.typedAI?resolveTypedAI(p.typedAI):null
 const receipt=typedReceipt(o.prepared,profile)
 const bounds={...base,readOnly:base.readOnly||!!p?.readOnly||!!typed?.shadow?.readOnly}

 const check=()=>{assertPreparedFlow(currentPrepared);if(p?.typedAI?.sources.length&&!currentPrepared.allows('mcp'))throw new AIError('policy','mcp')}
 const task=new TaskSession({id,revision:1,goal:o.goal||o.prepared.purpose,instruction_context:(o.instructions??'')+(skills.length?'\n'+SKILL_POLICY+'\nSELECTED_SKILLS_SNAPSHOT\n'+JSON.stringify(skills):'')+(o.atlas?'\n'+CONTEXT_TOOL_POLICY:'')+(receipt?.context??''),input_hash:stateHash({input:o.input??o.goal,skills}),scope_hash:signature(),source_pointers:input.sources.slice(0,100).map(r=>JSON.stringify(r)),allowed_tools:[...o.tools,TASK_QUESTION.name],read_only:bounds.readOnly,external_write:bounds.externalWrite,execute:bounds.execute,authenticate:bounds.authenticate??false,requires_sources:!!o.sourcesRequired||o.atlas&&/\batlas\b/iu.test(o.goal),search_one:o.one,search_atlas:o.atlas,...(o.atlasSourcesRequired!==undefined?{requires_atlas_sources:o.atlasSourcesRequired}:{}),output:p?.output==='json'||typed?.shadow?.format==='json'?'json':o.output??'text',required_literals:p?.requiredTerms??[],decisions:[],...(profile?{review_profile:profile}:{})},{compile:compileTask,signature,check,signal:o.signal,interactive:o.interactive,skills:skills.map(skillReceipt),writeIntent:requestedWriteKind(addressed?.text??skillInput),report:o.onReport})
 if(receipt)task.bindTypedEvidence(receipt.keys,receipt.at)
 sessions.set(id,task)
 return Object.assign(task,{rebindPrepared:(next:Prepared)=>{currentPrepared=next;task.rebindHost()},release:()=>{if(task.report().phase!=='ready'){task.close();sessions.delete(id)}else{setTimeout(()=>sessions.delete(id),3600000)}}})
}
/** Known ONE tools only. Suggestions are staged; no model can opt into direct store mutation. */
export const oneTaskEffect=(name:string,write:boolean)=>write?'stage' as const:['agent_state_set','notify_me'].includes(name)?'local_state' as const:['search_pages','read_requested_source','read_page','list_databases','query_database','get_current_page','read_tables','read_page_files','recall','run_query','list_pipelines','list_tasks','read_task','agent_state_get','list_work_items','check_finding','report_evidence_gaps','create_design_mock','read_design_source'].includes(name)?'read' as const:'forbidden' as const

/** A supplied link or discovery result cannot satisfy a current-source read. */
export const sourceReadMissing=(task:{report():TaskReport})=>{
 const r=task.report();return r.compiled.contract.requires_sources&&r.evidence.source_reads===0
}
export const SOURCE_READ_REPAIR='No current source body has been successfully read in this run. Use the selected host tools: discover the actual read schema, then read the specific requested source body and relevant comments before answering. URLs, search snippets, earlier chat answers and discovery are not source reads. Do not write, invent evidence or repeat a failed call. If the source is inaccessible, report the actual limitation.'
export const sourceReadFailure=(task:{fail(reason:string):void})=>{
 task.fail('No successful current source read');return new AIError('bad_request','features.ai.transfer.sourcesMissing')
}
