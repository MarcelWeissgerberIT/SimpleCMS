/** Evidence snapshots are device observations, never an automatic domain decision or a credential container. */
export type AtlasHandoff = { run:string; evidence:string; state:'prepared'|'transferred'|'confirmed'; at:number; server:string; project?:string; ref?:number; url?:string }
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function readHandoff(v:unknown):AtlasHandoff|null{
 if(!obj(v)||!['prepared','transferred','confirmed'].includes(v.state)||!Number.isSafeInteger(v.at)||v.at<0||typeof v.run!=='string'||!/^[\w-]{1,64}$/.test(v.run)||(typeof v.server!=='string'||!/^\w[\w-]{0,31}$/.test(v.server))||!/^([a-f0-9]{64})$/.test(v.evidence))return null
 if(v.state!=='prepared'&&(typeof v.project!=='string'||!/^[a-z0-9_-]{1,100}$/.test(v.project)||!Number.isSafeInteger(v.ref)||v.ref<1))return null
 let url:string|undefined
 if(v.url!==undefined){try{const u=new URL(v.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!['aj-atlas.com','eh-atlas.com','eu-atlas.com'].includes(u.hostname)||u.pathname!==`/r/${v.ref}`)return null;url=u.href}catch{return null}}
 return {run:v.run,evidence:v.evidence,state:v.state,at:v.at,server:v.server,...(v.project?{project:v.project}:{}),...(v.ref?{ref:v.ref}:{}),...(url?{url}:{})}
}
export const evidenceMarker=(hash:string)=>`ONE-EVIDENCE ${hash}`
/** Only an actual atlas_get result, for the exact record + project and marker in record body, confirms a handoff. */
export function atlasEvidenceProof(raw:unknown,expected:{ref:number;project:string;evidence:string}):boolean{
 let v=raw
 try{for(let i=0;i<5;i++){
  if(typeof v==='string'){if(v.length>500000)return false;v=JSON.parse(v);continue}
  if(Array.isArray(v)){v=v.filter(b=>b?.type==='text').map(b=>b.text).join('');continue}
  if(!obj(v)||v.isError||v.is_error||v.error)return false
  if(obj(v.item))break
  v=v.structuredContent??v.content??v.result
 }}catch{return false}
 if(!obj(v)||!obj(v.item)||Number(v.item.ref)!==expected.ref||v.item.project!==expected.project)return false
 const item=v.item,body=[item.content,item.body,item.description].filter(x=>typeof x==='string').join('\n')
 return /^[a-f0-9]{64}$/.test(expected.evidence)&&body.includes(evidenceMarker(expected.evidence))
}

export interface CandidateEvidence { schema:1; before:string|null; after:string|null; files:number; node:string; worker:string }
export interface ChallengeEvidence { state:'not_configured'|'passed'|'failed'|'unavailable'; code:number|null; ms:number; execution:HostExecution|null }
export interface StageRunEvidence { executor:string; requestedModel:string|null; startedAt:number; finishedAt:number; turns:number|null; costUsd:number|null }
export function readStageRun(v:unknown):StageRunEvidence|null{
 if(!obj(v)||!['host','claude','codex','copilot','local','ollama','minimax'].includes(v.executor)||v.requestedModel!==null&&(typeof v.requestedModel!=='string'||v.requestedModel.length>200)||!Number.isSafeInteger(v.startedAt)||!Number.isSafeInteger(v.finishedAt)||v.startedAt<0||v.finishedAt<v.startedAt||v.turns!==null&&(!Number.isSafeInteger(v.turns)||v.turns<0||v.turns>10000)||v.costUsd!==null&&(typeof v.costUsd!=='number'||!Number.isFinite(v.costUsd)||v.costUsd<0))return null
 return {executor:v.executor,requestedModel:v.requestedModel,startedAt:v.startedAt,finishedAt:v.finishedAt,turns:v.turns,costUsd:v.costUsd}
}
export interface HostExecution { command:string[]; commit:string|null; dirty:boolean; changedDuring:boolean; platform:string; startedAt:number; finishedAt:number; candidate?:CandidateEvidence }
export function readHostExecution(v:unknown):HostExecution|null{
 if(!obj(v)||!Array.isArray(v.command)||!v.command.length||v.command.length>50||!v.command.every((s:unknown)=>typeof s==='string'&&s.length<=1000)||v.commit!==null&&(typeof v.commit!=='string'||!/^[a-f0-9]{40,64}$/.test(v.commit))||typeof v.dirty!=='boolean'||typeof v.changedDuring!=='boolean'||typeof v.platform!=='string'||!['win32','darwin','linux','freebsd','openbsd','aix','sunos','android'].includes(v.platform)||!Number.isSafeInteger(v.startedAt)||!Number.isSafeInteger(v.finishedAt)||v.startedAt<0||v.finishedAt<v.startedAt)return null
 let candidate:CandidateEvidence|undefined
 if(v.candidate!==undefined){const c=v.candidate,hash=(x:unknown)=>x===null||typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)
  if(!obj(c)||c.schema!==1||!hash(c.before)||!hash(c.after)||!Number.isSafeInteger(c.files)||c.files<0||c.files>25000||typeof c.node!=='string'||!/^v\d+\.\d+\.\d+$/.test(c.node)||typeof c.worker!=='string'||!/^(dev|\d+\.\d+\.\d+)$/.test(c.worker))return null
  candidate={schema:1,before:c.before,after:c.after,files:c.files,node:c.node,worker:c.worker}
 }
 return {command:[...v.command],commit:v.commit,dirty:v.dirty,changedDuring:v.changedDuring,platform:v.platform,startedAt:v.startedAt,finishedAt:v.finishedAt,...(candidate?{candidate}:{})}
}

/** Required for new delivery acceptance. Legacy receipts remain readable, but cannot prove the candidate. */
export function stableCandidate(execution:unknown):boolean{
 const ex=readHostExecution(execution),c=ex?.candidate
 return !!ex&&!ex.changedDuring&&!!c?.before&&c.before===c.after
}
export function readChallenge(v:unknown):ChallengeEvidence|null{
 if(!obj(v)||!['not_configured','passed','failed','unavailable'].includes(v.state)||v.code!==null&&(!Number.isSafeInteger(v.code)||Math.abs(v.code)>2147483647)||typeof v.ms!=='number'||!Number.isFinite(v.ms)||v.ms<0)return null
 const execution=v.execution===null?null:readHostExecution(v.execution)
 if(v.execution!==null&&!execution)return null
 if(v.state==='passed'&&(v.code!==0||!execution||!stableCandidate(execution)))return null
 return {state:v.state,code:v.code,ms:v.ms,execution}
}
