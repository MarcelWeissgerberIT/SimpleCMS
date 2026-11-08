import {codeData,guardedAtlasCodeCall,readCodeCitation} from '@/shared/mcp/atlasCode'
import {checkedCodeExcerpt,sameCodeCitation,type CodeReference} from '@/shared/mcp/codeReference'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
import {onlyServer,attachMcp,currentSetup,mcpAccessIdentity} from '../ai/mcp-servers/config'
import {flowSignature} from '../ai/core/dataFlow'
import {requestWorkerMcp,cloudAtlasMcpReady} from '../coding'
export const codeConnections=()=>currentSetup().servers.map(s=>({name:s.name,label:s.name}))
export const codeAccessScope=()=>JSON.stringify([useWorkspace.getState().epoch,useCloud.getState().active,useCloud.getState().user?.id,flowSignature(),useWorkspace.getState().ai?.onboarding,currentSetup().servers.map(mcpAccessIdentity),useWorkspace.getState().integrations])
/** Explicit user read only; no model, URL fetching, repository writes or persistent source cache. */
async function evidenceSession(server:string,signal:AbortSignal){
 const scope=codeAccessScope(),reads=['atlas_code_repos','atlas_code_verify','atlas_code_read']
 const guard=()=>{signal.throwIfAborted();if(scope!==codeAccessScope())throw Error('accessChanged')}
 const selected=onlyServer(server,reads);if(!selected)throw Error('connection')
 const attached=await attachMcp(selected.setup,'free',{forced:selected.forced,allow:selected.allow,addressed:false});guard()
 const servers=attached?.worker;if(!servers?.length)throw Error('connection')
 const call=async(name:string,args:Record<string,unknown>)=>{guard();const response=await requestWorkerMcp({action:'call',servers,server,name,arguments:args},signal) as {result:string};guard();return JSON.parse(response.result)}
 const allowed=(name:string)=>servers.every(s=>(s.allow===null||s.allow.includes(name))&&!s.deny.includes(name))
 const invoke=async(name:string,args:Record<string,unknown>)=>{if(!allowed(name))throw Error('connection');const out=await (cloudAtlasMcpReady(servers)?call(name,args):guardedAtlasCodeCall(name,args,call,allowed));guard();return codeData(out)}
 return {invoke,guard,scope}
}
export async function loadCodeEvidence(ref:CodeReference,server:string,context:boolean,signal:AbortSignal,progress:(step:'verify'|'read')=>void){
 const {invoke,guard,scope}=await evidenceSession(server,signal)
 const verified=(data:Record<string,any>|null,citation:CodeReference['citation'])=>{const proof=readCodeCitation(data?.citation);return data?.valid===true&&(!data.citation||!!proof&&sameCodeCitation(proof,citation))}
 progress('verify')
 const verification=await invoke('atlas_code_verify',{citation:ref.citation});if(!verified(verification,ref.citation))throw Error('verification')
 progress('read')
 const c=ref.citation,padding=context?Math.min(30,Math.floor((2000-(c.lines[1]-c.lines[0]+1))/2)):0
 const data=await invoke('atlas_code_read',{repo:c.repo,snapshot:c.snapshot,path:c.path,startLine:Math.max(1,c.lines[0]-padding),endLine:c.lines[1]+padding})
 const excerpt=checkedCodeExcerpt(data,ref,context)
 if(context){progress('verify');const checked=await invoke('atlas_code_verify',{citation:excerpt.citation});if(!verified(checked,excerpt.citation))throw Error('verification')}
 guard();return {...excerpt,checkedAt:Date.now(),scope}
}

/** Compare immutable saved citations with the currently reported Atlas catalogue snapshot.
 * A different snapshot marks investigation needed, never an invalid finding or changed file. */
export async function checkCodeFreshness(evidence:import('@/shared/codeAnalysis/model').Evidence[],server:string,signal:AbortSignal){
 const {invoke,guard}=await evidenceSession(server,signal)
 if(evidence.some(e=>e.reference.server&&e.reference.server!==server))throw Error('Select the original Atlas connection.')
 const wanted=new Set(evidence.map(e=>e.reference.citation.repo)),found=new Map<string,{snapshot:string;commit:string}>(),seen=new Set<number>()
 let offset:number|undefined
 for(let i=0;i<100&&wanted.size;i++){
  const data=await invoke('atlas_code_repos',offset===undefined?{}:{offset})
  if(!data||data.error||!Array.isArray(data.items))throw Error('Repository catalogue could not be checked.')
  for(const repo of data.items){if(!wanted.has(repo?.id))continue
   if(repo.modelProcessing!==true)throw Error('Repository access is unavailable.')
   wanted.delete(repo.id)
   if(typeof repo.newest?.id==='string'&&typeof repo.newest?.commit==='string')found.set(repo.id,{snapshot:repo.newest.id,commit:repo.newest.commit})
  }
  if(!wanted.size||data.next===null)break
  if(!Number.isSafeInteger(data.next)||data.next<0||seen.has(data.next))throw Error('Repository catalogue is incomplete.')
  seen.add(data.next);offset=data.next
 }
 guard()
 return evidence.map(e=>{const c=e.reference.citation,n=found.get(c.repo);return {evidence:e.id,snapshot:n?.snapshot??'',commit:n?.commit??'',state:!n?'unknown' as const:n.snapshot===c.snapshot&&n.commit===c.commit?'current' as const:'different' as const,at:Date.now()}})
}
