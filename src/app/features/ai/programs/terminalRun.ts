import {programDigest,type ProgramRun} from '@/shared/quandprofile/program'
import {captureProgramInspection} from '@/shared/quandprofile/program-inspection'
import {atlasTransferOriginal} from '@/shared/quandprofile/atlas-transfer'
import type {AgentTurn,AgentStep} from '../agent/types'
/** A receipt is historical evidence, never a manufactured executable artifact or approval. */
export function terminalRun(turn:AgentTurn,steps:AgentStep[],route:ProgramRun['route']):ProgramRun{
 const task=atlasTransferOriginal(turn.task).slice(0,16000),id=turn.contract?.id??crypto.randomUUID(),hash=programDigest({task})
 const tools=steps.filter(s=>s.turn===turn.n&&s.kind!=='note').slice(-40).map(s=>({id:s.id,name:s.mcp?.tool??s.tool??'tool',...(s.mcp?{server:s.mcp.server}:{}),status:s.state,at:s.startedAt,...(s.arg?{argument:s.arg.slice(0,1000)}:{}),...(s.mcp?.error?{error:s.mcp.error.slice(0,2000)}:{}),...(s.mcp?.notExecuted?{notExecuted:true}:{}),...(s.mcp?.receipt?{refs:s.mcp.receipt.refs.slice(0,100),...(s.mcp.receipt.verification?{verification:s.mcp.receipt.verification}:{})}:{})}))
 let inspection:ProgramRun['inspection'];try{if(turn.contract)inspection=captureProgramInspection(turn.contract)}catch{/* Preserve the run even when no valid compiler inspection can be attached. */}
 return {id,programId:id,version:1,hash,inputHash:hash,route,startedAt:turn.startedAt,finishedAt:turn.endedAt??Date.now(),status:turn.status==='done'?'done':turn.status==='stopped'?'stopped':'failed',steps:[],terminal:{task,tools},...(turn.answer?{answer:turn.answer.slice(0,100000)}:{}),...(turn.error?{error:turn.error.message.slice(0,4000)}:{}),...(inspection?{inspection}:{})}
}
