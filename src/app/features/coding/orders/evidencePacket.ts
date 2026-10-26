import type {JSONContent} from '@tiptap/core'
import {useWorkspace} from '../../../store/store'
import {withWriter} from '../../../store/writer'
import {useCloud,flushPageContent} from '../../../cloud'
import {scrubSecrets} from '@/shared/ai/keys'
import {readCopilotReceipt} from '@/shared/copilot'
import {writeOrderBlock} from './summary'
import type {AtlasHandoff} from '@/shared/coding/evidence'
import {readHostExecution,readChallenge,readStageRun,evidenceMarker} from '@/shared/coding/evidence'
import {taskLocal} from '../local'
import {orderScope} from './records'
import {acceptanceSnapshot,type AcceptanceSnapshot} from './guidedAcceptance'
import type {OrderRecord} from './types'
import {t} from '../../../i18n'
const G='features.coding.guide'
const packetIdOf=(run:string,hash:string,accepted=true)=>`ev_${hash.slice(0,40)}_${run.slice(0,12)}_${accepted?'a':'p'}`
export interface EvidencePacket {schema:1;kind:'one-evidence-packet';snapshot:string;marker:string;run:string;at:number;title:string;accepted:boolean;limitations:string;report:string;steps:Array<Record<string,unknown>>;atlas:OrderRecord['handoff']|null}
/** Explicit allow-list: no prompts, file contents, raw CLI events, auth or worker configuration. */
export function makeEvidencePacket(rowId:string,rec:OrderRecord,snapshot:AcceptanceSnapshot):EvidencePacket{
 const ws=useWorkspace.getState(),row=ws.pages[rowId]
 const clean=(s:string)=>scrubSecrets(s).slice(0,50000)
 return {schema:1,kind:'one-evidence-packet',snapshot:snapshot.hash,marker:evidenceMarker(snapshot.hash),run:rec.chain!.run,at:Date.now(),title:clean(row?.title??''),accepted:snapshot.accepted,limitations:t(`${G}.packetLimit`),report:clean(snapshot.report),atlas:rec.handoff?.evidence===snapshot.hash?rec.handoff:null,steps:rec.chain!.steps.map(st=>{const local=taskLocal(st.id),ex=readHostExecution(local.test?.execution)
  const challenge=readChallenge(local.test?.challenge)
  const runs=(local.stageRuns??[]).slice(-40).flatMap(r=>{const receipt=readStageRun(r.receipt);return receipt?[{phase:clean(r.stage),status:clean(r.status),receipt:{...receipt,requestedModel:receipt.requestedModel?clean(receipt.requestedModel):null}}]:[]})
  return {id:st.id,kind:st.kind,title:clean(ws.pages[st.id]?.title??st.title??''),branch:clean(local.deliveryQa?.branch??local.git?.branch??''),runs,recordedCostUsd:typeof local.spentUsd==='number'&&Number.isFinite(local.spentUsd)?local.spentUsd:null,test:local.test?{ok:local.test.ok,code:local.test.code,skipped:!!local.test.skipped,ms:local.test.ms,...(ex?{execution:{...ex,command:ex.command.map(clean)}}:{execution:null}),challenge:challenge?{...challenge,execution:challenge.execution?{...challenge.execution,command:challenge.execution.command.map(clean)}:null}:null}:null,copilot:(local.copilotRuns??[]).slice(-8).flatMap(r=>{const receipt=readCopilotReceipt(r.receipt);return receipt?[{phase:r.stage,status:r.status,receipt}]:[]})}
 })}
}
function publicTarget(id:string):boolean{
 const pages=useWorkspace.getState().pages,seen=new Set<string>();let page=pages[id]
 if(!page||page.kind!=='page'||page.databaseId)return false
 while(page){if(page.private||page.trashed||page.settings?.locked||seen.has(page.id))return false;seen.add(page.id);if(!page.parentId)return true;page=pages[page.parentId]}
 return false
}
export async function publishEvidencePacket(rowId:string,rec:OrderRecord,snapshot:AcceptanceSnapshot,parentId:string):Promise<string|null>{
 const scope=orderScope(),target=useWorkspace.getState().pages[parentId]
 if(!target||target.private||target.trashed||target.kind!=='page'||target.databaseId||useCloud.getState().readOnly)return null
 let parent=target;const seen=new Set<string>();while(parent){if(parent.private||parent.trashed||parent.settings?.locked||seen.has(parent.id))return null;seen.add(parent.id);if(!parent.parentId)break;parent=useWorkspace.getState().pages[parent.parentId]!;if(!parent)return null}
 const checked=await acceptanceSnapshot(rowId,rec)
 if(!checked||checked.hash!==snapshot.hash||scope!==orderScope()||useCloud.getState().readOnly||!publicTarget(parentId)||useWorkspace.getState().pages[parentId]!==target)return null
 const packet=makeEvidencePacket(rowId,rec,checked),id=packetIdOf(rec.chain!.run,snapshot.hash,checked.accepted)
 const old=useWorkspace.getState().pages[id]
 // A same snapshot is idempotent; never replace a page changed by someone else.
 if(old)return old.trashed||old.private||!JSON.stringify(old.content).includes(evidenceMarker(snapshot.hash))?null:id
 const para=(text:string):JSONContent=>({type:'paragraph',content:text?[{type:'text',text}]:[]})
 const content:JSONContent={type:'doc',content:[para(t(`${G}.packetLimit`)),...checked.report.split('\n').map(para),{type:'details',attrs:{open:false},content:[{type:'detailsSummary',content:[{type:'text',text:t(`${G}.packetJson`)}]},{type:'detailsContent',content:[{type:'codeBlock',attrs:{language:'json'},content:[{type:'text',text:JSON.stringify(packet,null,2)}]}]}]}]}
 withWriter({kind:'you',via:'ui'},()=>useWorkspace.getState().createPage({id,parentId,title:`${t(`${G}.packetTitle`)} · ${packet.title}`,icon:{type:'lucide',value:'ClipboardCheck'},content,contentOrigin:'evidence'}))
 if(rec.handoff?.state==='confirmed'&&rec.handoff.evidence===snapshot.hash)appendPacketHandoff(rec,rec.handoff)
 if(useCloud.getState().active.kind==='cloud')flushPageContent(id)
 return id
}
export function downloadEvidencePacket(packet:EvidencePacket):void{
 const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`one-evidence-${packet.snapshot.slice(0,12)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

/** A confirmed readback is appended visibly to an already shared packet; the original snapshot stays unchanged. */
export function appendPacketHandoff(rec:OrderRecord,handoff:AtlasHandoff):void{
 const id=packetIdOf(rec.chain!.run,handoff.evidence),page=useWorkspace.getState().pages[id]
 if(!page||page.private||page.trashed||!JSON.stringify(page.content).includes(evidenceMarker(handoff.evidence)))return
 writeOrderBlock(id,{type:'callout',attrs:{id:`atlas-proof-${handoff.evidence.slice(0,24)}`,icon:'asset:check',color:'green'},content:[{type:'paragraph',content:[{type:'text',text:t(`${G}.handoffVerified`)}]},{type:'paragraph',content:[{type:'text',text:`${handoff.project} · #${handoff.ref} · ${new Date(handoff.at).toISOString()}`}]},{type:'paragraph',content:[{type:'text',text:handoff.url!,marks:[{type:'link',attrs:{href:handoff.url,target:'_blank'}}]}]}]})
}
