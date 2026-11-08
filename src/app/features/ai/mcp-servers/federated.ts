import {attachMcp,currentSetup,mcpAccessIdentity} from './config'
import {requestWorkerMcp} from '../../coding'
import {useCloud} from '../../../cloud'
import {useWorkspace} from '../../../store/store'
import type {DiscoveredMcpTool} from '@/shared/mcp/bindings'
import {mcpTaskEffect} from '@/shared/mcp/facts'
export interface SearchSource {source:string;tool?:string;text:string;error?:boolean}
/** Explicit user queries only. No model, no workspace/page text, and no write-capable tools. */
export async function searchConnected(query:string,names:string[],signal:AbortSignal,onSource:(r:SearchSource)=>void){
 if(!names.length)return
 const signature=()=>JSON.stringify([useCloud.getState().active,useCloud.getState().user?.id,useWorkspace.getState().epoch,currentSetup().servers.map(mcpAccessIdentity),useWorkspace.getState().integrations,useWorkspace.getState().ai?.dataFlow]),pinned=signature()
 const setup=currentSetup();setup.servers=setup.servers.filter(s=>names.includes(s.name))
 const attached=await attachMcp(setup,'fixed',{forced:names,addressed:false})
 for(const server of attached?.worker??[]){
  if(signal.aborted||signature()!==pinned)return
  try{
   const found=await requestWorkerMcp({action:'search',servers:[server],query:'search'},signal) as {tools?:DiscoveredMcpTool[]}
   const tool=found.tools?.find(t=>/search/i.test(t.name)&&t.readOnly===true&&!server.deny.includes(t.name)&&(server.allow===null||server.allow.includes(t.name))&&mcpTaskEffect(t.name,{},t)==='read'&&['query','q','search','text'].some(k=>t.inputSchema.properties?.[k]?.type==='string')&&(t.inputSchema.required??[]).every((k:string)=>['query','q','search','text','limit','maxResults'].includes(k)))
   if(!tool)throw Error('No compatible read-only search tool is available on this connection.')
   const args:Record<string,unknown>={},props=tool.inputSchema.properties??{}
   const q=['query','q','search','text'].find(k=>props[k]?.type==='string')!;args[q]=query.slice(0,300)
   for(const k of ['limit','maxResults'])if(props[k]?.type==='integer'||props[k]?.type==='number')args[k]=Math.max(props[k].minimum??1,Math.min(20,props[k].maximum??20))
   if(signal.aborted||signature()!==pinned)return
   const answer=await requestWorkerMcp({action:'call',servers:[{...server,allow:[tool.name]}],server:server.name,name:tool.name,arguments:args},signal) as {result?:string}
   if(signal.aborted||signature()!==pinned)return
   onSource({source:server.name,tool:tool.name,text:String(answer.result??JSON.stringify(answer)).slice(0,40000)})
  }catch(e){if(!signal.aborted&&signature()===pinned)onSource({source:server.name,text:String(e),error:true})}
 }
 if(!attached?.worker?.length&&!signal.aborted)onSource({source:'MCP',text:'No selected connection is ready. Check its sign-in and permissions.',error:true})
}
