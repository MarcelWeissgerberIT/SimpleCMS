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

export interface HostExecution { command:string[]; commit:string|null; dirty:boolean; changedDuring:boolean; platform:string; startedAt:number; finishedAt:number }
export function readHostExecution(v:unknown):HostExecution|null{
 if(!obj(v)||!Array.isArray(v.command)||!v.command.length||v.command.length>50||!v.command.every((s:unknown)=>typeof s==='string'&&s.length<=1000)||v.commit!==null&&(typeof v.commit!=='string'||!/^[a-f0-9]{40,64}$/.test(v.commit))||typeof v.dirty!=='boolean'||typeof v.changedDuring!=='boolean'||typeof v.platform!=='string'||!['win32','darwin','linux','freebsd','openbsd','aix','sunos','android'].includes(v.platform)||!Number.isSafeInteger(v.startedAt)||!Number.isSafeInteger(v.finishedAt)||v.startedAt<0||v.finishedAt<v.startedAt)return null
 return {command:[...v.command],commit:v.commit,dirty:v.dirty,changedDuring:v.changedDuring,platform:v.platform,startedAt:v.startedAt,finishedAt:v.finishedAt}
}
