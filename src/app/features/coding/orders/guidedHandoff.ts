import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud'
import {atlasEvidenceProof} from '@/shared/coding/evidence'
import {onlyServer,attachMcp,readServers} from '../../ai/mcp-servers/config'
import {requestWorkerMcp} from '../service'
import {orderScope,loadOrderRecord,patchOrderRecord} from './records'
import {acceptanceSnapshot} from './guidedAcceptance'
import {appendPacketHandoff} from './evidencePacket'
import {orderRowShared} from './db'
import type {OrderRecord} from './types'
const same=(r:OrderRecord|null|undefined,rec:OrderRecord,hash:string)=>!!r&&r.chain?.run===rec.chain?.run&&r.accepted?.evidence===hash
/** Verify only. External writes still use the existing terminal review and permissions. No model call or URL fetch. */
export async function verifyAtlasHandoff(rowId:string,shown:string,project:string,reference:string,signal:AbortSignal):Promise<boolean>{
 const scope=orderScope(),rec=await loadOrderRecord(rowId,{fresh:true}),cloud=useCloud.getState()
 if(!rec||rec==='unreadable'||!rec.chain||!same(rec,rec,shown)||cloud.readOnly||orderRowShared(rowId)||!rec.handoff||rec.handoff.evidence!==shown)return false
 const name=rec.handoff.server,server=readServers().find(s=>s.name===name&&s.enabled&&s.tools?.includes('atlas_get'))
 if(!server||!/^[a-z0-9_-]{1,100}$/.test(project))return false
 const host=new URL(server.url).hostname
 if(!['aj-atlas.com','eh-atlas.com','eu-atlas.com'].includes(host))return false
 let ref=Number(reference.trim())
 if(!Number.isSafeInteger(ref)||ref<1){try{const u=new URL(reference.trim());if(u.hostname!==host||u.protocol!=='https:'||u.search||u.hash||u.username||u.password)return false;ref=Number(/^\/r\/(\d+)$/.exec(u.pathname)?.[1])}catch{return false}}
 if(!Number.isSafeInteger(ref)||ref<1)return false
 const selected=onlyServer(name,['atlas_get']);if(!selected)return false
 const attachment=await attachMcp(selected.setup,'free',{forced:selected.forced,allow:selected.allow,addressed:false})
 if(!attachment?.worker||signal.aborted||scope!==orderScope())return false
 const result=await requestWorkerMcp({action:'call',servers:attachment.worker,server:name,name:'atlas_get',arguments:{ref}},signal)
 if(signal.aborted||scope!==orderScope()||useCloud.getState().readOnly||!atlasEvidenceProof(result,{ref,project,evidence:shown}))return false
 const checked=await acceptanceSnapshot(rowId,rec)
 if(!checked||checked.hash!==shown||!checked.accepted||scope!==orderScope()||signal.aborted)return false
 const pins=new Map([rowId,...rec.chain.steps.map(s=>s.id),...rec.chain.steps.flatMap(s=>Object.keys(s.refs))].map(id=>[id,useWorkspace.getState().pages[id]]))
 if(!readServers().some(s=>s.id===server.id&&s.enabled&&s.url===server.url&&s.token===server.token))return false
 // Successful readback is actual transfer evidence, not a model's assertion. Persist each state for interrupted tabs.
 for(const state of ['transferred','confirmed'] as const){const out=await patchOrderRecord(rowId,r=>same(r,rec,shown)&&!useCloud.getState().readOnly&&!orderRowShared(rowId)&&scope===orderScope()&&!signal.aborted&&![...pins].some(([id,page])=>useWorkspace.getState().pages[id]!==page)?{...r!,handoff:{run:rec.chain!.run,evidence:shown,state,at:Date.now(),server:name,project,ref,url:`https://${host}/r/${ref}`}}:r);if(out.rec?.handoff?.state!==state)return false;if(state==='confirmed')appendPacketHandoff(rec,out.rec.handoff!)}
 return true
}
