/** Explicit human attachment action. Bytes bypass inference and are never stored in ONE's file library. */
import {currentSetup,attachMcp} from '../mcp-servers/config'
import {workerMcpSession} from '../core/workerMcp'
import {loadQuandProfile} from '../core/quandprofile'
import {sourceScope} from '../../io/import/sourceAtlas'
import {atlasData} from '@/shared/mcp/facts'
import {sha256Hex} from '@/shared/mcp/sha256'
import {validateValue} from '@/shared/quandprofile/program'
import {cloudAtlasMcpReady} from '../../coding'
import type {DesignMock} from '@/shared/ai/designMock'
import {beginLiveAudit} from '../core/liveAudit'
export interface MockFile {filename:string;mime:'text/html'|'image/png'|'application/json';bytes:Uint8Array}
export interface MockAttachment {filename:string;sha256:string;bytes:number;url:string}
export async function attachMockToAtlas(a:DesignMock,files:MockFile[],signal:AbortSignal,progress:(files:MockAttachment[])=>void){
 const scope=sourceScope(),check=()=>{signal.throwIfAborted();if(scope!==sourceScope())throw Error('Account, workspace or Atlas configuration changed. Open the mock in its original workspace.')}
 const setup=currentSetup(),server=setup.servers.find(s=>s.name===a.target.server&&new URL(s.url).origin===new URL(a.target.url).origin)
 if(!server)throw Error('The original personal Atlas connection is unavailable. Configure it before attaching the mock.')
 const attached=await attachMcp({...setup,servers:[server]},'fixed',{forced:[server.name],allow:{[server.name]:['atlas_get','atlas_attach']}})
 check();if(!attached?.worker?.length)throw Error('Personal Atlas access is not configured.')
 if(!cloudAtlasMcpReady(attached.worker))throw Error('Direct mock attachments currently require the prepared personal AJ-Atlas cloud connection. The files are not saved in ONE. Download them and attach them to the displayed Atlas record, or use the prepared AJ workspace.')
 await loadQuandProfile();check()
 const remote=workerMcpSession(attached.worker,signal,()=>{},30000)
 for(const name of ['atlas_get','atlas_attach']){await remote('one_mcp_search',{query:name},crypto.randomUUID());if(!remote.schema(server.name,name))throw Error('Atlas tool is not permitted: '+name)}
 // Re-read every actual source immediately before the first write. A stale design/requirement is not silently published.
 for(const source of a.sources){check();if(source.server!==a.target.server||new URL(source.url).origin!==new URL(a.target.url).origin)throw Error('Cross-server mock sources need separate source checks; recreate the mock using the same personal Atlas connection.');const raw=remote.materializeResult(await remote('one_mcp_call',{server:server.name,name:'atlas_get',arguments:{ref:source.ref,parts:['body'],includeConstraints:'none'}},crypto.randomUUID()));const data=atlasData(raw),item=data?.item??data?.record??data,body=item?.body??item?.markdown??item?.bodyMd;if(item?.ref!==source.ref||typeof body!=='string'||sha256Hex(body)!==source.hash)throw Error('Atlas source changed or is no longer accessible: '+source.title+'. Recreate the mock against the current source before attaching it.')}
 const audit=a.route?await beginLiveAudit(a.route,'Attach design mock '+a.id+' to '+a.target.url,'terminal.task'):null
 const uploaded:MockAttachment[]=[]
 try{
  for(const file of files){check();if(file.bytes.byteLength>600000)throw Error('Mock attachment exceeds the 600 KB transfer bound. Download it and attach it directly in Atlas.')
   const hash=sha256Hex(file.bytes),args:Record<string,unknown>={ref:a.target.ref,filename:file.filename,mime:file.mime}
   if(file.mime==='image/png'){let binary='';for(const byte of file.bytes)binary+=String.fromCharCode(byte);args.contentBase64=btoa(binary)}else args.text=new TextDecoder().decode(file.bytes)
   validateValue(args,remote.schema(server.name,'atlas_attach')!.inputSchema,'atlas_attach')
   const send=()=>remote('one_mcp_call',{server:server.name,name:'atlas_attach',arguments:args},crypto.randomUUID())
   const raw=audit?await audit.tool(server.name,'atlas_attach',{ref:a.target.ref,filename:file.filename,mime:file.mime,bytes:file.bytes.length,sha256:hash},send):await send()
   const data=atlasData(remote.materializeResult(raw)),receipt=data?.attachment
   if(data?.ok!==true||receipt?.sha256!==hash||receipt?.bytes!==file.bytes.length||typeof receipt.url!=='string')throw Error('Atlas did not confirm the exact attachment bytes: '+file.filename+'. The upload may be partial; retry uses the same file name.')
   uploaded.push({filename:file.filename,sha256:hash,bytes:file.bytes.length,url:new URL(receipt.url,a.target.url).href});progress([...uploaded])
  }
  await audit?.end('done',{target:a.target.url,attachments:uploaded});return uploaded
 }catch(error){await audit?.end('failed',{target:a.target.url,attachments:uploaded},error);throw error}
}
