import {typedSourceState} from '@/shared/quandprofile/typed-ai'
/** User-triggered read-only import. No model request, record creation or saved credential. */
import {onlyServer,attachMcp} from '../mcp-servers/config'
import {workerMcpSession} from './workerMcp'
import {atlasData} from '@/shared/mcp/facts'
import {sha256Hex} from '@/shared/mcp/sha256'
export async function readTypedAtlasSource(server:string,tenant:string,ref:number,signal:AbortSignal){
 if(!tenant.trim()||!Number.isSafeInteger(ref)||ref<1)throw Error('Typed AI: enter tenant and positive global Atlas ref')
 const setup=onlyServer(server,['atlas_get']);if(!setup)throw Error('Typed AI: select an enabled personal Atlas connection')
 const attachment=await attachMcp(setup.setup,'fixed',{forced:setup.forced,allow:setup.allow})
 const selected=attachment?.worker?.filter(s=>s.name===server);if(selected?.length!==1)throw Error('Typed AI: personal Atlas connection unavailable')
 const remote=workerMcpSession(selected,signal,()=>{},12000)
 await remote('one_mcp_search',{query:'atlas_get'},crypto.randomUUID())
 const raw=remote.materializeResult(await remote('one_mcp_call',{server,name:'atlas_get',arguments:{ref,tenant,parts:['body']}},crypto.randomUUID())),data=atlasData(raw),record=data?.item??data?.record??data
 if(!data||data.error||data.isError||data.truncated||!record||record.ref!==ref||record.truncated||record.archived||typeof record.body!=='string'||record.body.length<12||record.body.length>80000)throw Error('Typed AI: no complete, active Atlas body was returned')
 const project=typeof record.project==='string'?record.project:record.project?.slug
 if(!project)throw Error('Typed AI: Atlas did not return a verifiable project scope')
 const returnedTenant=record.tenantSlug??(typeof record.tenant==='string'?record.tenant:record.tenant?.slug)
 if(returnedTenant!==undefined&&returnedTenant!==tenant)throw Error('Typed AI: Atlas returned another tenant')
 return {server,origin:new URL(selected[0]!.url).origin,tenant,project,ref,hash:sha256Hex(record.body),stateHash:typedSourceState(record),body:record.body as string,title:String(record.title??ref)}
}

/** Bounded catalogue search; a hit is a candidate, never an imported or verified definition. */
export async function findTypedAtlasSources(server:string,tenant:string,query:string,signal:AbortSignal){
 if(!tenant.trim()||!query.trim()||query.length>200)throw Error('Typed AI: enter tenant and a bounded search query')
 const setup=onlyServer(server,['atlas_search']);if(!setup)throw Error('Typed AI: select an enabled personal Atlas connection')
 const attachment=await attachMcp(setup.setup,'fixed',{forced:setup.forced,allow:setup.allow}),servers=attachment?.worker?.filter(s=>s.name===server)
 if(servers?.length!==1)throw Error('Typed AI: personal Atlas connection unavailable')
 const remote=workerMcpSession(servers,signal,()=>{},12000)
 await remote('one_mcp_search',{query:'atlas_search'},crypto.randomUUID())
 const schema=remote.schema(server,'atlas_search'),properties=schema?.inputSchema.properties as Record<string,unknown>|undefined
 if(!properties?.q||!properties.tenant)throw Error('Typed AI: selected search schema does not support an explicit tenant and q')
 const args={q:query,tenant,...(properties.limit?{limit:6}:{})}
 const data=atlasData(remote.materializeResult(await remote('one_mcp_call',{server,name:'atlas_search',arguments:args},crypto.randomUUID())))
 if(!data||data.error||data.isError)throw Error('Typed AI: catalogue search failed; no absence claim is possible')
 const rows=data.items??data.records??data.results
 return (Array.isArray(rows)?rows:[]).filter(r=>r&&Number.isSafeInteger(r.ref)&&r.ref>0&&typeof r.title==='string').slice(0,6).map(r=>({ref:r.ref as number,title:r.title as string}))
}
