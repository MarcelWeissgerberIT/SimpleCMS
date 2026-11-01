import type {Route} from '@/shared/ai/types'
import {SHARED_PREFIX} from '@/shared/ai/shared-model'
import {cloudRequest,useCloud,CloudError} from '../../../cloud'

export class LiveAuditError extends Error {}

/** Host instrumentation, not model prose. Enabled only for the designated test lead. */
export async function beginLiveAudit(route:Route,prompt:string,purpose:string){
 const cloud=useCloud.getState(),workspace=cloud.active.id,user=cloud.user?.id
 const path=`api/workspaces/${workspace}/model-audit`
 let runId:string|undefined
 const valid=()=>{const c=useCloud.getState();return c.active.kind==='cloud'&&c.active.id===workspace&&c.user?.id===user}
 if(route.p==='local'&&route.m.startsWith(SHARED_PREFIX)&&cloud.active.kind==='cloud'&&user){
  let enabled=false
  try{enabled=(await cloudRequest<{enabled:boolean}>('GET',path+'?status=1')).enabled}catch(error){if(!(error instanceof CloudError)||error.status!==404)throw new LiveAuditError('Live-Testprotokoll ist nicht erreichbar. Bitte Verbindung prüfen. / Live test log unavailable; check the connection.')}
  if(enabled&&valid())runId=(await cloudRequest<{runId:string}>('POST',path,{action:'start',model:route.m,prompt,purpose})).runId
 }
 const event=async(data:Record<string,unknown>)=>{
  if(!runId||!valid())return
  try{await cloudRequest('POST',path,{action:'event',runId,event:{...data,id:crypto.randomUUID(),clientAt:Date.now()}})}catch{throw new LiveAuditError('Live-Testprotokoll konnte nicht gespeichert werden. Gestoppt; Verlauf ist unvollständig. / Live test log could not be saved; stopped with an incomplete trace.')}
 }
 return {
  runId,
  async tool<T>(server:string,name:string,args:unknown,execute:()=>T|Promise<T>):Promise<T>{
   if(!runId)return execute()
   const callId=crypto.randomUUID();await event({type:'tool-call',callId,server,name,arguments:args})
   let result:T
   try{result=await execute()}catch(error){await event({type:'tool-error',callId,server,name,error:error instanceof Error?error.message:'Tool failed'});throw error}
   await event({type:'tool-result',callId,server,name,result});return result
  },
  async blocked(server:string,name:string,args:unknown,error:string){await event({type:'tool-blocked',callId:crypto.randomUUID(),server,name,arguments:args,error})},
  async end(state:string,answer?:unknown,error?:unknown){await event({type:'run-end',state,...(answer!==undefined?{answer}:{}),...(error?{error:error instanceof Error?error.message:String(error)}:{})})},
 }
}
export type LiveAudit=Awaited<ReturnType<typeof beginLiveAudit>>
