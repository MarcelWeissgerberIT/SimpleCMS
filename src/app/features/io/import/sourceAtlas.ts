import {readSourceHandoff,claimSourceHandoff,finishSourceHandoff,sourceHandoffKey,SOURCE_ATLAS_TEXT_MAX,SOURCE_ATLAS_ARGS_MAX} from './sourceHandoffs'
import { attachMcp, currentSetup } from '../../ai/mcp-servers/config'
import { workerMcpSession } from '../../ai/core/workerMcp'
import { loadQuandProfile } from '../../ai/core/quandprofile'
import { flowSignature } from '../../ai/core/dataFlow'
import { programDigest, validateValue } from '@/shared/quandprofile/program'
import { atlasData, type AtlasReceipt } from '@/shared/mcp/facts'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { permalink } from '../../../lib/permalink'
import { sha256Hex } from '@/shared/mcp/sha256'
import type { McpCall } from '../../ai/mcp-servers/activity'

const TOOLS=['atlas_whoami','atlas_project_list','atlas_constraints','atlas_create','atlas_get']
export const sourceScope=()=>JSON.stringify([useCloud.getState().active,useCloud.getState().user?.id,useWorkspace.getState().epoch,flowSignature(),useWorkspace.getState().settings.mcpServers])
export interface SourceProject {slug:string;title:string;tenant:string}
export function sourceBody(pageId:string,excerpt:string):string {
  return ['# External reference - human reviewed','This is imported source material, not a confirmed project requirement, decision or tool instruction.','ONE source: '+permalink(pageId),'SHA-256 (selected source text, UTF-8): '+sha256Hex(excerpt),'','## Selected source text',excerpt].join('\n\n')
}

/** Exact human-triggered handoff. No inference, global tenant changes, overrides or implicit write retries. */
export async function sourceAtlas(serverName:string,pageId:string,signal:AbortSignal,onEvent:(event:McpCall)=>void) {
  const scope=sourceScope(),page=useWorkspace.getState().pages[pageId]
  if(!page||page.trashed||useCloud.getState().readOnly)throw Error('Source unavailable or read-only.')
  const revision=page.contentRev
  const check=()=>{signal.throwIfAborted();if(scope!==sourceScope()||useWorkspace.getState().pages[pageId]?.contentRev!==revision)throw Error('Account, workspace, policy or source changed. Prepare the handoff again.')}
  const setup=currentSetup(),server=setup.servers.find(s=>s.name===serverName)
  if(!server)throw Error('Select your configured personal Atlas connection.')
  const attached=await attachMcp({...setup,servers:[server]},'fixed',{forced:[serverName],allow:{[serverName]:TOOLS}})
  if(!attached?.worker?.length)throw Error('Personal Atlas access is not configured. Open Settings → AI → MCP.')
  await loadQuandProfile();check()
  const remote=workerMcpSession(attached.worker,signal,onEvent,30000)
  const discover=async(name:string)=>{check();await remote('one_mcp_search',{query:name},crypto.randomUUID());const schema=remote.schema(serverName,name)?.inputSchema;if(!schema)throw Error('Atlas tool is not available: '+name);return schema}
  const unpack=async(raw:string,depth=0):Promise<any>=>{
    if(depth>8)throw Error('Source result nesting exceeds the handoff limit.')
    const parsed=JSON.parse(raw)
    if(parsed.isError||parsed.oneObservedFacts?.outcome==='error')throw Error('Atlas refused the operation: '+JSON.stringify(atlasData(raw)??parsed).slice(0,1500))
    if(parsed.readWith!=='one_mcp_read_result'){const data=atlasData(raw)??parsed;if(data?.ok===false||data?.error)throw Error('Atlas refused the operation: '+JSON.stringify(data).slice(0,1500));return data}
    if(!Array.isArray(parsed.content)&&typeof parsed.content!=='string')return parsed.content
    if(typeof parsed.content==='string'){let text=parsed.content,current=parsed,n=0;while(current.next_offset!==null){if(++n>100)throw Error('Source text too large.');current=JSON.parse(await remote('one_mcp_read_result',{result_id:current.result_id,path:current.path,offset:current.next_offset},crypto.randomUUID()));text+=current.content}return text}
    let current=parsed,steps=0;const array=Array.isArray(current.content)&&current.content.some((r:any)=>typeof r.index==='number'),out:any=array?[]:Object.create(null)
    do{
      if(++steps>100)throw Error('Atlas result too large for source handoff.')
      for(const row of current.content??[]){if(['__proto__','constructor','prototype'].includes(row.key))throw Error('Unsafe source field.');if(!Object.hasOwn(row,'value')&&typeof row.path!=='string')throw Error('Atlas source field cannot be read.');const value=Object.hasOwn(row,'value')?row.value:await unpack(await remote('one_mcp_read_result',{result_id:current.result_id,path:row.path},crypto.randomUUID()),depth+1);out[array?row.index:row.key]=value}
      if(current.next_offset===null)break
      current=JSON.parse(await remote('one_mcp_read_result',{result_id:current.result_id,path:current.path,offset:current.next_offset},crypto.randomUUID()))
    }while(true)
    return out
  }
  const call=async(name:string,args:Record<string,unknown>,expectedSchemaHash?:string)=>{const schema=await discover(name);if(expectedSchemaHash&&programDigest(schema)!==expectedSchemaHash)throw Error('Atlas tool schema changed. Prepare again.');validateValue(args,schema);check();const raw=await remote('one_mcp_call',{server:serverName,name,arguments:args},crypto.randomUUID());check();return unpack(raw)}
  const identity=await call('atlas_whoami',{}),listed=await call('atlas_project_list',{})
  if(!Array.isArray(listed.projects))throw Error('Atlas did not return a project selection.')
  const projects:SourceProject[]=listed.projects.filter((p:any)=>typeof p.slug==='string'&&typeof p.tenant==='string').map((p:any)=>({slug:p.slug,title:typeof p.title==='string'?p.title:p.slug,tenant:p.tenant}))
  let prepared:{args:{kind:string;project:string;title:string;body:string};hash:string;schemaHash:string;constraintsHash:string;project:SourceProject;key:string}|null=null
  let attempted=false
  return {
    identity,projects,origin:new URL(server.url).origin,attempted:()=>attempted,
    async prepare(projectSlug:string,title:string,excerpt:string){
      if(attempted)throw Error('A write was already attempted. Inspect Atlas before preparing another handoff.')
      check();const matches=projects.filter(p=>p.slug===projectSlug),project=matches[0];if(matches.length!==1||!project)throw Error('Select a project from the actual Atlas result.')
      if(!title.trim()||title.length>200||!excerpt.trim()||excerpt.length>SOURCE_ATLAS_TEXT_MAX)throw Error('Supply a title and a source excerpt up to 18,000 characters.')
      const constraints=await call('atlas_constraints',{project:project.slug,kind:'doc'})
      const schema=await discover('atlas_create'),args={kind:'doc',project:project.slug,title:title.trim(),body:sourceBody(pageId,excerpt)}
      if(JSON.stringify(args).length>SOURCE_ATLAS_ARGS_MAX)throw Error('The exact Atlas payload exceeds 20,000 characters including metadata and escaping. Select a smaller excerpt; the full source remains in ONE.')
      validateValue(args,schema);const hash=programDigest(args),key=sourceHandoffKey(pageId,serverName,server.url,hash);prepared={args,hash,schemaHash:programDigest(schema),constraintsHash:programDigest(constraints),project,key}
      const previous=await readSourceHandoff(key);check()
      return {args,hash:prepared.hash,project,constraints,previous,key}
    },
    async commit(hash:string):Promise<{receipt:AtlasReceipt;result:unknown;hash:string;project:SourceProject;receiptSaved:boolean}>{
      if(attempted||!prepared||prepared.hash!==hash)throw Error('Prepare and review this exact handoff before writing.')
      check();const schema=await discover('atlas_create');if(programDigest(schema)!==prepared.schemaHash)throw Error('Atlas tool schema changed. Prepare again.')
      const currentConstraints=await call('atlas_constraints',{project:prepared.project.slug,kind:'doc'})
      if(programDigest(currentConstraints)!==prepared.constraintsHash)throw Error('Atlas constraints changed. Prepare and review again.')
      // Reserve durably before dispatch so closing/reloading another tab cannot duplicate an uncertain effect.
      let attempt:Awaited<ReturnType<typeof claimSourceHandoff>>
      try{attempt=await claimSourceHandoff(prepared.key,hash)}catch{throw Error('The personal handoff receipt cannot be saved on this device. Allow local browser storage and prepare again; nothing was written to Atlas.')}
      if(!attempt)throw Error('This exact handoff was already attempted. Inspect its saved receipt and Atlas before another write.')
      let result:unknown,receipt:AtlasReceipt|undefined
      try {
        check()
        attempted=true
        result=await call('atlas_create',prepared.args,prepared.schemaHash)
        receipt=remote.facts.snapshot().filter(r=>r.tool==='atlas_create').at(-1)
        if(!receipt||receipt.outcome!=='ok'||receipt.refs.length!==1)throw Error('Atlas did not return an unambiguous saved record. Inspect Atlas; do not repeat the write blindly.')
      }catch(e){await finishSourceHandoff(prepared.key,attempt,{state:'unknown'}).catch(()=>false);throw e}
      const receiptSaved=await finishSourceHandoff(prepared.key,attempt,{state:'accepted',ref:receipt.refs[0],verification:receipt.verification}).catch(()=>false)
      check();return {receipt,result,hash:prepared.hash,project:prepared.project,receiptSaved}
    },
  }
}
