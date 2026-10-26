import {useWorkspace} from '../../../store/store'
import {hasFlowLimits} from '@/shared/ai/dataFlow'
import {useEffect,useSyncExternalStore} from 'react'
import {useCloud,cloudRequest} from '../../../cloud'
import {SHARED_PREFIX,SHARED_INPUT_MAX,sharedRequestBox,openShared,type SharedModel,type SharedBox} from '@/shared/ai/shared-model'
import type {ModelInfo} from '@/shared/ai/types'
import type {WorkerTextResult} from '@/shared/ai/worker'

let scope='',rows:SharedModel[]=[],revision=0,loading:Promise<void>|null=null
const listeners=new Set<()=>void>()
let subscribers=0
let timer:ReturnType<typeof setInterval>|undefined
const publish=()=>{revision++;for(const fn of listeners)fn()}
export const sharedScope=()=>{const c=useCloud.getState();return c.active.kind==='cloud'&&c.user&&!c.readOnly?c.active.id+':'+c.user.id:''}
export const sharedModels=()=>scope===sharedScope()?rows:[]
export const sharedModelRows=():ModelInfo[]=>sharedModels().filter(r=>r.enabled&&r.online&&r.publicKey).map(r=>({route:{p:'local',m:SHARED_PREFIX+r.id},label:r.label+' · '+r.model,short:r.label.toUpperCase().slice(0,22),vendor:'local',caps:{structured:false,tools:false,vision:false,pdf:false,mcp:false,mcpListing:false,cache:false,effort:false,reasoning:false,web:false,notes:false,refusalFallback:false,context:32768,maxOutput:4096},price:{input:0,output:0,cacheRead:0,cacheWrite:0,source:'table',at:'local'}}))
export async function refreshSharedModels(){
  const want=sharedScope()
  if(scope!==want){scope=want;rows=[];publish()}
  if(!want)return
  if(loading)return loading
  const workspace=useCloud.getState().active.id
  loading=(async()=>{try{const list=await cloudRequest<SharedModel[]>('GET',`api/workspaces/${workspace}/model-shares`);if(want===sharedScope()&&scope===want){rows=Array.isArray(list)?list.filter(r=>r.workspace===workspace&&typeof r.id==='string'&&typeof r.model==='string'&&typeof r.label==='string'):[];publish()}}catch{if(scope===want){rows=[];publish()}}})().finally(()=>{loading=null})
  return loading
}
export function useSharedModels(){
  const active=useCloud(s=>s.active),user=useCloud(s=>s.user),readOnly=useCloud(s=>s.readOnly)
  useEffect(()=>{void refreshSharedModels();subscribers++;if(!timer)timer=setInterval(()=>void refreshSharedModels(),5000);return()=>{subscribers--;if(!subscribers&&timer){clearInterval(timer);timer=undefined}}},[active.kind,active.id,user?.id,readOnly])
  return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision)
}
export type QueueProgress={state:string;position:number;started:number|null}
let progress:QueueProgress|null=null
export const sharedProgress=()=>progress
const setProgress=(p:QueueProgress|null)=>{progress=p;publish()}
const pause=(signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{if(signal?.aborted)return reject(new Error('Request cancelled'));const stop=()=>{clearTimeout(t);reject(new Error('Request cancelled'))};const t=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},1000);signal?.addEventListener('abort',stop,{once:true})})
export async function sendSharedText(model:string,messages:{role:'system'|'user'|'assistant';content:string}[],maxTokens:number,signal?:AbortSignal,onProgress?:(p:QueueProgress)=>void):Promise<WorkerTextResult>{
  const selectedScope=sharedScope(),workspace=useCloud.getState().active.id
  const share=sharedModels().find(r=>SHARED_PREFIX+r.id===model&&r.enabled&&r.online)
  if(!selectedScope||!share?.publicKey)throw new Error('Shared model offline. Refresh the model list.')
  const workspaceState=useWorkspace.getState()
  if((hasFlowLimits(workspaceState.ai?.dataFlow)||workspaceState.ai?.policy?.restricted?.length||workspaceState.settings.ai?.restricted?.length)&&!share.dataFlow)throw new Error('Update the model host worker to use explicit data-route boundaries.')
  signal?.throwIfAborted()
  const id=crypto.randomUUID(),payload={model:share.model,messages,maxTokens:Math.min(maxTokens,4096)}
  if(new TextEncoder().encode(JSON.stringify(payload)).length>SHARED_INPUT_MAX)throw new Error('Shared model: select a smaller passage (22 KB maximum).')
  const {key,box}=await sharedRequestBox(payload,share.publicKey,share.id,id)
  const path=`api/workspaces/${workspace}/model-jobs/${id}`
  let created=false,finished=false
  try{
    signal?.throwIfAborted()
    if(sharedScope()!==selectedScope)throw new Error('Workspace changed; request cancelled.')
    // Cancel by id even when an aborted POST lost its acknowledgement after the relay accepted it.
    created=true
    await cloudRequest('POST',`api/workspaces/${workspace}/model-shares/${share.id}/jobs`,{id,box,keyId:share.publicKey.n},{signal})
    const until=Date.now()+12*60000
    while(Date.now()<until){
      signal?.throwIfAborted()
      if(sharedScope()!==selectedScope)throw new Error('Workspace changed; request cancelled.')
      const state=await cloudRequest<{state:string;position:number;started:number|null;box?:SharedBox}>('GET',path,undefined,{signal})
      signal?.throwIfAborted()
      if(sharedScope()!==selectedScope)throw new Error('Workspace changed; request cancelled.')
      if(onProgress)onProgress(state);else setProgress(state)
      if(state.state==='done'&&state.box){
        const reply=await openShared<{ok:boolean;result:WorkerTextResult}>(state.box,key,share.id,id)
        signal?.throwIfAborted()
        if(sharedScope()!==selectedScope)throw new Error('Workspace changed; request cancelled.')
        if(!reply.ok||reply.result?.model!==share.model||typeof reply.result.text!=='string'||reply.result.calls?.length)throw new Error('Invalid shared model response')
        finished=true;return {...reply.result,usd:0}
      }
      if(['failed','cancelled'].includes(state.state))throw new Error('Shared model request ended without an answer. Check the host, then retry explicitly.')
      await pause(signal)
    }
    throw new Error('Shared model queue timed out.')
  }finally{if(!onProgress)setProgress(null);if(created)void cloudRequest('DELETE',path,undefined,{signal:AbortSignal.timeout(10000)}).catch(()=>{});if(!finished)void refreshSharedModels()}
}
