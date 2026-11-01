import wasmUrl from '@/shared/quandprofile/quandprofile.wasm?url'
import {QuandRuntime,stateHash,providerSnapshot,type QuantumProof,type QuantumRequest} from '@/shared/quandprofile/runtime'
import {OWNER} from '@/shared/ai/owner'
import {workspaceDeviceAI} from '../../../store/ai'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud/state'
import {AIError} from './errors'
let runtime:QuandRuntime|null=null,loading:Promise<void>|null=null
/** Bundled and precached with the app. Failure disables AI actions, not document editing. */
export function loadQuandProfile():Promise<void>{return loading??=fetch(wasmUrl).then(async r=>{if(!r.ok)throw Error('Compiler asset unavailable');const {instance}=await WebAssembly.instantiate(await r.arrayBuffer(),{});runtime=new QuandRuntime(instance)}).catch(e=>{loading=null;throw e})}
export function quantumScope(target:string,operation:unknown,snapshot:unknown){
 const s=useWorkspace.getState(),c=useCloud.getState()
 return {workspace:c.active.kind==='cloud'?c.active.id:s.epoch||'local',actor:c.user?.id??'local-device',target,
  state_revision:stateHash([s.epoch,c.user?.id,snapshot]),operation_digest:stateHash(operation)}
}
export function checkQuantum(gate:QuantumRequest['gate'],target:string,operation:unknown,snapshot:Record<string,unknown>):QuantumProof{
 try{if(!runtime)throw Error('Compiler unavailable');return runtime.check({gate,scope:quantumScope(target,operation,snapshot),snapshot})}
 catch{throw new AIError('policy','features.ai.quantum.blocked')}
}
export function checkProviderQuantum(provider:string,model:string,classes:readonly string[],purpose:string):QuantumProof{
 const s=useWorkspace.getState(),device=workspaceDeviceAI(s)
 const snapshot=providerSnapshot(provider,classes,s.ai,device,OWNER.memberClassesOwnedByMember)
 return checkQuantum('one_provider',provider+':'+model,{provider,model,classes,purpose},snapshot)
}
