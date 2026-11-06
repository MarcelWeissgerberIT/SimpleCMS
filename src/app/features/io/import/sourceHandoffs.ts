import {createStore,get,update} from 'idb-keyval'
import {useCloud} from '../../../cloud'
import {sha256Hex} from '@/shared/mcp/sha256'

export interface SourceHandoffAttempt {
  v:1
  id:string
  hash:string
  startedAt:number
  state:'pending'|'accepted'|'unknown'|'cleared'
  finishedAt?:number
  ref?:number
  verification?:string
}
const store=createStore('one-source-handoffs','attempts')
const digest=/^[a-f0-9]{64}$/
const valid=(v:unknown):v is SourceHandoffAttempt=>{
  const x=v as SourceHandoffAttempt|undefined
  return !!x&&x.v===1&&typeof x.id==='string'&&x.id.length<100&&digest.test(x.hash)&&Number.isFinite(x.startedAt)&&x.startedAt>0&&['pending','accepted','unknown','cleared'].includes(x.state)&&(x.ref===undefined||Number.isSafeInteger(x.ref)&&x.ref>0)
}
/** Personal local ledger: hashes and returned refs only. Never source text, account token or model content. */
export function sourceHandoffKey(pageId:string,server:string,endpoint:string,hash:string):string {
  const c=useCloud.getState()
  return sha256Hex(JSON.stringify([c.active.kind,c.active.id,c.user?.id??'local',pageId,server,endpoint,hash]))
}
export async function readSourceHandoff(key:string):Promise<SourceHandoffAttempt|null>{
  const value=await get(key,store)
  return valid(value)&&value.state!=='cleared'?value:null
}
/** IndexedDB read-modify-write is atomic across tabs. A pending or accepted effect cannot be claimed twice. */
export async function claimSourceHandoff(key:string,hash:string):Promise<SourceHandoffAttempt|null>{
  const next:SourceHandoffAttempt={v:1,id:crypto.randomUUID(),hash,startedAt:Date.now(),state:'pending'}
  let claimed=false
  await update(key,prior=>{if(valid(prior)&&prior.state!=='cleared')return prior;claimed=true;return next},store)
  return claimed?next:null
}
export async function finishSourceHandoff(key:string,attempt:SourceHandoffAttempt,patch:{state:'accepted'|'unknown'|'cleared';ref?:number;verification?:string}):Promise<boolean>{
  let saved=false
  await update(key,prior=>{if(!valid(prior)||prior.id!==attempt.id||prior.state!=='pending')return prior;saved=true;return {...prior,...patch,finishedAt:Date.now()}},store)
  return saved
}
/** Explicit UI acknowledgement after the person inspected Atlas; never called by an inference tool. */
export async function clearSourceHandoff(key:string,id:string):Promise<boolean>{
  let cleared=false
  await update(key,prior=>{if(!valid(prior)||prior.id!==id||!['pending','unknown'].includes(prior.state))return prior;cleared=true;return {...prior,state:'cleared',finishedAt:Date.now()}},store)
  return cleared
}
export const SOURCE_ATLAS_TEXT_MAX=18_000
export const SOURCE_ATLAS_ARGS_MAX=20_000
