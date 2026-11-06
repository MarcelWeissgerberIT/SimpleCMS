import {useWorkspace} from '../../../store/store'
import {onlyServer,attachMcp} from '../mcp-servers/config'
import {workerMcpSession} from '../core/workerMcp'
import {readTypedAtlasSource} from '../core/typedSource'
import {atlasData} from '@/shared/mcp/facts'
import {skillFromAtlasBody} from '@/shared/ai/atlas-skills'
import {SkillError,type AtlasSkillSource} from '@/shared/ai/skills'
import {skillScope} from './storage'

const context=()=>JSON.stringify([skillScope(),useWorkspace.getState().settings.mcpServers,useWorkspace.getState().ai?.dataFlow])
export type AtlasSkillHit={ref:number;title:string;project?:string}
export async function findAtlasSkills(server:string,tenant:string,project:string,query:string,signal:AbortSignal){
 if(!tenant.trim()||!query.trim()||query.length>200)throw new SkillError('invalid')
 const pinned=context(),setup=onlyServer(server,['atlas_search'])
 if(!setup)throw new SkillError('connection')
 const attached=await attachMcp(setup.setup,'fixed',{forced:setup.forced,allow:setup.allow}),servers=attached?.worker?.filter(s=>s.name===server)
 if(servers?.length!==1)throw new SkillError('connection')
 const remote=workerMcpSession(servers,signal,()=>{},12000)
 await remote('one_mcp_search',{query:'atlas_search'},crypto.randomUUID())
 const properties=remote.schema(server,'atlas_search')?.inputSchema.properties
 if(!properties?.q||!properties.tenant||project&&!properties.project)throw new SkillError('invalid')
 signal.throwIfAborted();if(pinned!==context())throw new SkillError('scope')
 const args={q:query.trim(),tenant:tenant.trim(),...(project?{project:project.trim()}:{}),...(properties.limit?{limit:20}:{})}
 const data=atlasData(remote.materializeResult(await remote('one_mcp_call',{server,name:'atlas_search',arguments:args},crypto.randomUUID())))
 signal.throwIfAborted();if(pinned!==context())throw new SkillError('scope')
 if(!data||data.error||data.isError||data.truncated)throw new SkillError('invalid')
 const rows=data.items??data.records??data.results
 if(!Array.isArray(rows))throw new SkillError('invalid')
 const hits:AtlasSkillHit[]=rows.filter(r=>r&&Number.isSafeInteger(r.ref)&&r.ref>0&&typeof r.title==='string').slice(0,20).map(r=>({ref:r.ref,title:r.title.slice(0,300),...(typeof r.project==='string'?{project:r.project}:{})}))
 return {hits,total:Number.isSafeInteger(data.total)?data.total as number:null}
}

export async function readAtlasSkill(server:string,tenant:string,project:string,ref:number,signal:AbortSignal){
 const pinned=context()
 let record:Awaited<ReturnType<typeof readTypedAtlasSource>>
 try{record=await readTypedAtlasSource(server,tenant.trim(),ref,signal)}catch(e){if(e instanceof Error&&/Typed AI: (?:no complete|Atlas did not return|Atlas returned another)/u.test(e.message))throw new SkillError('source');throw e}
 signal.throwIfAborted();if(pinned!==context())throw new SkillError('scope')
 if(project&&record.project!==project.trim())throw new SkillError('source')
 const spec=skillFromAtlasBody(record.body),source:AtlasSkillSource={server:record.server,origin:record.origin,tenant:record.tenant,project:record.project,ref:record.ref,hash:record.hash,stateHash:record.stateHash}
 return {spec,source,title:record.title}
}
