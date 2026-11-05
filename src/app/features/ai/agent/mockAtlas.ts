import {ensureMockDestination} from '@/shared/ai/mockDestination'
/** Explicit human attachment action. Bytes bypass inference and are never stored in ONE's file library. */
import {currentSetup,attachMcp} from '../mcp-servers/config'
import {workerMcpSession} from '../core/workerMcp'
import {loadQuandProfile} from '../core/quandprofile'
import {sourceScope} from '../../io/import/sourceAtlas'
import {atlasData} from '@/shared/mcp/facts'
import {sha256Hex} from '@/shared/mcp/sha256'
import {validateValue} from '@/shared/quandprofile/program'
import {cloudAtlasMcpReady} from '../../coding'
import {mockSourceState,type DesignMock} from '@/shared/ai/designMock'
import {beginLiveAudit} from '../core/liveAudit'
import {connectionProblem} from '@/shared/ai/connection-problem'
import {t} from '../../../i18n'
export interface MockFile {filename:string;mime:'text/html'|'image/png'|'application/json';bytes:Uint8Array}
export interface MockAttachment {filename:string;sha256:string;bytes:number;url:string}
export async function attachMockToAtlas(a:DesignMock,files:MockFile[],signal:AbortSignal,progress:(files:MockAttachment[])=>void,targetRef?:number,phase?:(phase:'checking'|'uploading')=>void,onDestination?:(target:{ref:number;url:string})=>void,note?:(text:string)=>void){
 phase?.('checking')
 // Validate the whole package before the first external write.
 if(files.some(file=>file.bytes.byteLength>600000))throw Error('Mock attachment exceeds the 600 KB transfer bound. Download it and attach it directly in Atlas.')
 const scope=sourceScope(),check=()=>{signal.throwIfAborted();if(scope!==sourceScope())throw Error('Account, workspace or Atlas configuration changed. Open the mock in its original workspace.')}
 const origin=a.target??a.sources.find(s=>s.id===a.draft.design.source)
 if(!origin)throw Error('Original design source is unavailable.')
 let destination=targetRef??a.target?.ref??a.atlasSaved?.ref??a.atlasDestination?.ref
 if((destination!==undefined||!a.atlasContext)&&(!Number.isSafeInteger(destination)||Number(destination)<1))throw Error('Choose an existing Atlas record for the attachment.')
 const target={...origin,ref:destination??a.atlasContext!.ref,url:new URL('/r/'+(destination??a.atlasContext!.ref),origin.url).href}
 const setup=currentSetup(),server=setup.servers.find(s=>s.name===origin.server&&new URL(s.url).origin===new URL(origin.url).origin)
 if(!server)throw Error('The original personal Atlas connection is unavailable. Configure it before attaching the mock.')
 const toolNames=['atlas_get','atlas_attach',...(!destination&&a.atlasContext?['atlas_search','atlas_constraints','atlas_create']:[])]
 const attached=await attachMcp({...setup,servers:[server]},'fixed',{forced:[server.name],allow:{[server.name]:toolNames}})
 check();if(!attached?.worker?.length)throw Error('Personal Atlas access is not configured.')
 if(!cloudAtlasMcpReady(attached.worker))throw Error('Direct mock attachments currently require the prepared personal AJ-Atlas cloud connection. The files are not saved in ONE. Download them and attach them to the displayed Atlas record, or use the prepared AJ workspace.')
 await loadQuandProfile();check()
 const audit=a.route?await beginLiveAudit(a.route,'Attach design mock '+a.id+' to '+target.url,'terminal.task'):null
 const uploaded:MockAttachment[]=[]
 try{
 const remote=workerMcpSession(attached.worker,signal,event=>{if(event.id.startsWith('mcp-retry:')&&event.state==='run')note?.(event.arg)},30000,audit??undefined)
 for(const name of toolNames){await remote('one_mcp_search',{query:name},crypto.randomUUID());if(!remote.schema(server.name,name))throw Error('Atlas tool is not permitted: '+name)}
 const destinationData=atlasData(remote.materializeResult(await remote('one_mcp_call',{server:server.name,name:'atlas_get',arguments:{ref:target.ref,parts:[],includeConstraints:'none'}},crypto.randomUUID())))
 const destinationRecord=destinationData?.item??destinationData?.record??destinationData
 if(destinationRecord?.ref!==target.ref)throw Error('The selected Atlas destination was not readable; no files attached.')
 if(a.atlasContext&&a.atlasDestination&&destination===a.atlasDestination.ref&&(destinationRecord.project!==a.atlasContext.project||destinationRecord.parent?.ref!==a.atlasContext.ref||!destinationRecord.tags?.includes(a.atlasContext.tag)||!destinationRecord.tags?.includes('one-ui-mock:'+a.id)))throw Error('Die Zuordnung des begonnenen Mocks hat sich geändert. Bitte den vorhandenen Record prüfen.')
 // Re-read every actual source immediately before the first write. A stale design/requirement is not silently published.
 for(const source of a.sources){check();if(source.server!==target.server||new URL(source.url).origin!==new URL(target.url).origin)throw Error('Cross-server mock sources need separate source checks; recreate the mock using the same personal Atlas connection.');const raw=remote.materializeResult(await remote('one_mcp_call',{server:server.name,name:'atlas_get',arguments:{ref:source.ref,parts:['body'],includeConstraints:'none'}},crypto.randomUUID()));const data=atlasData(raw),item=data?.item??data?.record??data,body=item?.body??item?.markdown??item?.bodyMd;if(item?.ref!==source.ref||typeof body!=='string'||sha256Hex(body)!==source.hash||mockSourceState(item)!==source.stateHash)throw Error('Atlas source changed or is no longer accessible: '+source.title+'. Recreate the mock against the current source before attaching it.')}
 if(!destination&&a.atlasContext){
  const chosen=await ensureMockDestination(a,async(name,args)=>{
   check();validateValue(args,remote.schema(server.name,name)!.inputSchema,name)
   const raw=remote.materializeResult(await remote('one_mcp_call',{server:server.name,name,arguments:args},crypto.randomUUID()))
   const value=atlasData(raw)
   if(!value||value.ok===false||value.error||JSON.parse(raw).isError)throw Error('Atlas konnte den Mock-Kontext nicht speichern. '+String(value?.error??''))
   return value
  })
  destination=chosen.ref;target.ref=chosen.ref;target.url=chosen.url;onDestination?.(chosen)
 }
  phase?.('uploading')
  for(const file of files){check();
   const hash=sha256Hex(file.bytes),args:Record<string,unknown>={ref:target.ref,filename:file.filename,mime:file.mime}
   if(file.mime==='image/png'){let binary='';for(const byte of file.bytes)binary+=String.fromCharCode(byte);args.contentBase64=btoa(binary)}else args.text=new TextDecoder().decode(file.bytes)
   validateValue(args,remote.schema(server.name,'atlas_attach')!.inputSchema,'atlas_attach')
   const send=()=>remote('one_mcp_call',{server:server.name,name:'atlas_attach',arguments:args},crypto.randomUUID())
   const raw=await send()
   const materialized=remote.materializeResult(raw),data=atlasData(materialized),receipt=data?.attachment
   let rejected=data?.ok===false
   try{rejected||=JSON.parse(materialized).isError===true}catch{/* A malformed receipt is handled below. */}
   if(rejected){const problem=connectionProblem(materialized);throw Error(t('features.ai.connection.'+problem+'.title')+' '+t('features.ai.connection.'+problem+'.next'))}
   if(data?.ok!==true||receipt?.sha256!==hash||receipt?.bytes!==file.bytes.length||typeof receipt.url!=='string')throw Error('Atlas did not confirm the exact attachment bytes: '+file.filename+'. The upload may be partial; retry uses the same file name.')
   uploaded.push({filename:file.filename,sha256:hash,bytes:file.bytes.length,url:new URL(receipt.url,target.url).href});progress([...uploaded])
  }
  await audit?.end('done',{target:target.url,attachments:uploaded});return uploaded
 }catch(error){await audit?.end('failed',{target:target.url,attachments:uploaded},error);throw error}
}
