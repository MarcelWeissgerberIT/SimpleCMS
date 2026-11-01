import {TaskSession} from '@/shared/quandprofile/task-session'
import {taskBoundaries,type TaskReport} from '@/shared/quandprofile/task'
import {stateHash} from '@/shared/quandprofile/runtime'
import type {WorkerFunction} from '@/shared/ai/worker'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud/state'
import {compileTask} from './quandprofile'
import {assertPreparedFlow,taskInputOf,type Prepared} from './gate'
const sessions=new Map<string,TaskSession>()
export const answerTaskDecision=(id:string,question:string,answer:string)=>{try{return sessions.get(id)?.answer(question,answer)??false}catch{return false}}
export const acceptTaskResult=(id:string)=>{try{return sessions.get(id)?.accept()??false}catch{return false}}
export const TASK_QUESTION:WorkerFunction={name:'one_task_question',description:'After inspecting available ONE and Atlas sources, ask a precise unresolved prerequisite question in the decision cube. The human answers. Dependent effects pause; do not invent decisions or approval. Not for routine reads.',parameters:{type:'object',properties:{question:{type:'string',maxLength:2000},needed_for:{type:'string',maxLength:1000},options:{type:'array',maxItems:3,items:{type:'object',properties:{label:{type:'string'},effect:{type:'string'}},required:['label','effect'],additionalProperties:false}}},required:['question','needed_for'],additionalProperties:false}}
export function createTaskContract(o:{prepared:Prepared;goal:string;instructions?:string;input?:unknown;tools:string[];one:boolean;atlas:boolean;signal?:AbortSignal;output?:'text'|'json';onReport?:(report:TaskReport)=>void;interactive?:boolean}){
 let currentPrepared=o.prepared
 const signature=()=>{const s=useWorkspace.getState(),c=useCloud.getState();return stateHash([s.epoch,c.active,c.user?.id,s.ai,s.settings.mcpServers,currentPrepared.route])}
 const input=taskInputOf(o.prepared),bounds=taskBoundaries(input.typed),id=crypto.randomUUID()
 const task=new TaskSession({id,revision:1,goal:o.goal||o.prepared.purpose,instruction_context:o.instructions??'',input_hash:stateHash(o.input??o.goal),scope_hash:signature(),source_pointers:input.sources.slice(0,100).map(r=>JSON.stringify(r)),allowed_tools:[...o.tools,TASK_QUESTION.name],read_only:bounds.readOnly,external_write:bounds.externalWrite,execute:bounds.execute,requires_sources:o.atlas&&/\batlas\b/iu.test(o.goal),search_one:o.one,search_atlas:o.atlas,output:o.output??'text',required_literals:[],decisions:[]},{compile:compileTask,signature,check:()=>assertPreparedFlow(currentPrepared),signal:o.signal,interactive:o.interactive,report:o.onReport})
 sessions.set(id,task)
 return Object.assign(task,{rebindPrepared:(next:Prepared)=>{currentPrepared=next;task.rebindHost()},release:()=>{if(task.report().phase!=='ready'){task.close();sessions.delete(id)}else{setTimeout(()=>sessions.delete(id),3600000)}}})
}
/** Known ONE tools only. Suggestions are staged; no model can opt into direct store mutation. */
export const oneTaskEffect=(name:string,write:boolean)=>write?'stage' as const:['agent_state_set','notify_me'].includes(name)?'local_state' as const:['search_pages','read_page','list_databases','query_database','get_current_page','read_tables','recall','run_query','list_pipelines','list_tasks','read_task','agent_state_get','list_work_items','check_finding'].includes(name)?'read' as const:'forbidden' as const
