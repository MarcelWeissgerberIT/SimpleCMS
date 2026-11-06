import {currentSetup,attachMcp} from '../mcp-servers/config'
import {workerMcpSession} from '../core/workerMcp'
import {loadQuandProfile} from '../core/quandprofile'
import {sourceScope} from '../../io/import/sourceAtlas'
import {atlasData} from '@/shared/mcp/facts'
import {validateValue} from '@/shared/quandprofile/program'
import {sha256Hex} from '@/shared/mcp/sha256'
import {mockSourceState,type DesignMock} from '@/shared/ai/designMock'
import type {MockMarkdownChange} from '@/shared/ai/mockReview'
export async function mockAtlasSession(sources:DesignMock['sources'],signal:AbortSignal,write=false){
 const scope=sourceScope(),check=()=>{signal.throwIfAborted();if(scope!==sourceScope())throw Error('Workspace oder Atlas-Zugang wurde gewechselt.')}
 const origin=sources[0],setup=currentSetup(),server=setup.servers.find(s=>s.name===origin?.server&&new URL(s.url).origin===new URL(origin.url).origin)
 if(!server||sources.some(s=>s.server!==server.name||new URL(s.url).origin!==new URL(server.url).origin))throw Error('Die ursprüngliche Atlas-Verbindung ist nicht verfügbar.')
 const names=write?['atlas_get','atlas_constraints','atlas_update']:['atlas_get']
 const attached=await attachMcp({...setup,servers:[server]},'fixed',{forced:[server.name],allow:{[server.name]:names}});check()
 if(!attached?.worker?.length)throw Error('Bitte die persönliche Atlas-Verbindung einrichten.')
 await loadQuandProfile();check()
 const remote=workerMcpSession(attached.worker,signal,()=>{},30000)
 for(const name of names){await remote('one_mcp_search',{query:name},crypto.randomUUID());if(!remote.schema(server.name,name))throw Error('Atlas-Werkzeug nicht verfügbar: '+name)}
 const call=async(name:string,args:Record<string,unknown>)=>{check();validateValue(args,remote.schema(server.name,name)!.inputSchema,name);const raw=remote.materializeResult(await remote('one_mcp_call',{server:server.name,name,arguments:args,fresh:true},crypto.randomUUID()));check();const data=atlasData(raw);if(!data||data.ok===false||data.error||JSON.parse(raw).isError)throw Error('Atlas hat die Anfrage nicht bestätigt.');return data}
 const read=async(ref:number)=>{const data=await call('atlas_get',{ref,parts:['body'],includeConstraints:'none'}),item=data.item??data.record??data;if(item.ref!==ref||typeof item.body!=='string'||item.archived)throw Error('Atlas-Quelle ist nicht vollständig lesbar: #'+ref);return item}
 return {check,read,call,schema:(name:string)=>remote.schema(server.name,name)!.inputSchema}
}
export async function checkMockSources(sources:DesignMock['sources'],signal:AbortSignal){
 const session=await mockAtlasSession(sources,signal),results:Array<{ref:number;url:string;title:string;changed:boolean;at:string}>=[]
 for(const s of sources){const item=await session.read(s.ref);results.push({ref:s.ref,url:s.url,title:s.title,changed:sha256Hex(item.body)!==s.hash||mockSourceState(item)!==s.stateHash,at:new Date().toISOString()})}
 return results
}
/** An uncertain write is only read back, never automatically sent twice. */
export async function applyMockMarkdown(sources:DesignMock['sources'],change:MockMarkdownChange,signal:AbortSignal,checkpoint:(change:MockMarkdownChange)=>void){
 if(!sources.some(s=>s.ref===change.ref&&s.url===change.url)||sha256Hex(change.before)!==change.beforeHash)throw Error('MD-Ziel oder Ausgangsstand passt nicht zur gespeicherten Quelle.')
 const session=await mockAtlasSession(sources,signal,change.state==='draft'),current=await session.read(change.ref)
 if(current.body===change.after){const next={...change,state:'verified' as const,verifiedAt:new Date().toISOString()};checkpoint(next);return next}
 if(change.state!=='draft')throw Error('Übertragung nicht bestätigt. Der aktuelle Atlas-Inhalt weicht ab; vor einem erneuten Schreiben neu vorbereiten.')
 if(current.body!==change.before)throw Error('Die Atlas-MD wurde inzwischen geändert. Bitte die Änderung erneut vorbereiten.')
 await session.call('atlas_constraints',{project:current.project,kind:current.kind})
 const schema=session.schema('atlas_update') as any
 if(!schema?.properties?.replaceBody)throw Error('Atlas bietet keine passende Body-Aktualisierung an.')
 const args:Record<string,unknown>={ref:change.ref,replaceBody:change.after}
 if(schema.properties.expectedBodyHash)args.expectedBodyHash=change.beforeHash
 validateValue(args,schema,'atlas_update')
 if((await session.read(change.ref)).body!==change.before)throw Error('Die Atlas-MD wurde inzwischen geändert. Bitte neu vorbereiten.')
 checkpoint({...change,state:'uncertain'});session.check()
 await session.call('atlas_update',args)
 const saved=await session.read(change.ref)
 if(saved.body!==change.after)throw Error('Der gespeicherte MD-Inhalt wurde nicht vollständig bestätigt. Bitte nur erneut prüfen.')
 const next={...change,state:'verified' as const,verifiedAt:new Date().toISOString()};checkpoint(next);return next
}
