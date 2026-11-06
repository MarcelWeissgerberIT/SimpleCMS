/** Personal setup checks. No model call, no credential in progress or receipts. */
import {canonicalJson} from '../../features/coding/protocol'
import {withWriter} from '../../store/writer'
import {useCloud} from '../../cloud'
import {useWorkspace} from '../../store/store'
import {useCoding} from '../../features/coding/state'
import {requestWorkerMcp} from '../../features/coding/service'
import {readServers,patchServer,clearRefused} from '../../features/ai/mcp-servers/config'
import {tokenFor} from '../../features/ai/mcp-servers/oauth'
import {assertMcpFlow,assertModelFlow} from '../../features/ai/core/dataFlow'
import {allowedFor} from '@/shared/ai/policy'
import {createProject,savePipeline,readPipeline,kindOfDb} from '../../features/coding/schema'
import {createTask,moveTask,setTaskApprovals,taskContext,runTaskNow} from '../../features/coding/tasks'
import {selectTaskAtlas} from '../../features/secrets/deviceTask'
import {codingAgentOf} from '../../features/coding/agent'
import {taskLocal} from '../../features/coding/local'
import {optionName} from '../../features/coding/schema'
import type {FirstStart} from './model'

let receiverGeneration=0
useCoding.subscribe((s,p)=>{if(s.conn!==p.conn||s.relay?.token!==p.relay?.token||s.worker?.name!==p.worker?.name)receiverGeneration++})
export const setupScope=()=>{const c=useCloud.getState();return JSON.stringify([c.user?.id,c.active.kind,c.active.id,useWorkspace.getState().epoch])}
export function assertSetupScope(scope:string){if(scope!==setupScope()||useCloud.getState().readOnly||useCloud.getState().active.kind!=='cloud'||useCoding.getState().conn!=='connected')throw Error('scope')}
export function setupAtlasServers(){return readServers().filter(s=>s.enabled&&!s.checkAuth&&/^https:\/\/(?:eh-atlas\.com|aj-atlas\.com)\/api\/atlas\/mcp\/?$/.test(s.url))}
// A new worker, edited connection, changed policy or workspace invalidates the read proof.
export function setupProofKey(serverId:string,c:FirstStart){const w=useCoding.getState(),s=useWorkspace.getState(),server=readServers().find(s=>s.id===serverId);return canonicalJson([setupScope(),receiverGeneration,w.conn,w.worker?.name,w.worker?.worker,w.relay?.token,server,s.ai,allowedFor('copilot','mcp',s.ai,s.settings.ai),s.settings.ai?.restricted??[],c.project,c.record])}
function resultJSON(value:unknown){const envelope=JSON.parse((value as {result:string}).result);if(envelope.isError)throw Error('tools');const text=envelope.content?.find((c:{type:string})=>c.type==='text')?.text;if(typeof text!=='string')throw Error('tools');return JSON.parse(text)}
export interface AtlasProof {key:string;server:string;person:string;title:string;at:number}
export async function checkSetupAtlas(serverId:string,c:FirstStart):Promise<AtlasProof>{
 const scope=setupScope();assertSetupScope(scope)
 const server=setupAtlasServers().find(s=>s.id===serverId);if(!server)throw Error('tools')
 const policy=()=>{assertSetupScope(scope);const s=useWorkspace.getState();assertModelFlow('copilot');assertMcpFlow([server.url]);if(!allowedFor('copilot','mcp',s.ai,s.settings.ai))throw Error('policy')}
 policy();const before=setupProofKey(serverId,c),token=await tokenFor(server);policy()
 if(!token||setupProofKey(serverId,c)!==before)throw Error('scope')
 const body={servers:[{name:server.name,url:server.url,token,allow:['atlas_whoami','atlas_get'],deny:[]}]}
 const identity=resultJSON(await requestWorkerMcp({...body,action:'call',server:server.name,name:'atlas_whoami',arguments:{}}));policy()
 if(typeof identity.person!=='string'||!identity.person.trim())throw Error('identity')
 const got=resultJSON(await requestWorkerMcp({...body,action:'call',server:server.name,name:'atlas_get',arguments:{ref:c.record}}));policy()
 const item=got.item??got.record??got
 if(Number(item.ref??item.id)!==c.record||typeof item.title!=='string'||!item.title.trim()||typeof item.project==='string'&&item.project!==c.project)throw Error('record')
 if(setupProofKey(serverId,c)!==before)throw Error('scope')
 withWriter({kind:'you',via:'setup',ref:'first-start-atlas'},()=>patchServer(serverId,{checkedAt:Date.now(),checkAuth:undefined,checkError:undefined}));clearRefused(server.name)
 return {key:setupProofKey(serverId,c),server:serverId,person:identity.person.slice(0,160),title:item.title.slice(0,240),at:Date.now()}
}
export function baSuggestion(repo:string,c:FirstStart,lang:'de'|'en'){
 return lang==='de'?{
  title:`Erster BA-Check · ${repo}`,
  goal:`Analysiere das ausgewählte Repository ausschließlich lesend. Prüfe mit meinem persönlichen Atlas MCP zuerst atlas_whoami und lies Record ${c.record} im Projekt ${c.project}. Lies im Repository zuerst AGENTS.md, README und vorhandene Requirements/API-Dokumentation. Beschreibe einen kleinen nachvollziehbaren Anwendungsfall. Stelle dessen belegte Anforderungen dem vorhandenen Code gegenüber. Nenne höchstens drei Widersprüche oder offene Spezifikationsfragen, jeweils mit zwei Quellen bzw. einer ausdrücklich fehlenden Quelle. Schlage eine kleine nächste Aufgabe und überprüfbare Abnahmekriterien vor. Trenne Fakten, Unsicherheit und Empfehlung. Keine Entscheidungen für das Team, keine erfundenen Anforderungen, kein Internet. Keine Dateien ändern, keine Befehle, Builds oder Tests ausführen, keine Commits, kein Push und keine Atlas-Schreiboperationen. Ergebnis nur als Bericht auf dieser ONE-Aufgabenseite. Bei fehlendem Zugriff genau den Blocker berichten.`,
  criteria:['Atlas-Identität und tatsächlicher Record mit Referenz genannt.','Repository-Belege mit Datei und Zeile; unbelegte Punkte ausdrücklich offen.','Ein kleiner Aufgabenvorschlag mit prüfbaren Kriterien; das Team entscheidet.','Keine Änderungen im Repository oder Atlas; nicht ausgeführte Tests so benennen.']
 }:{title:`First BA check · ${repo}`,goal:`Analyze the selected repository read-only. Use my personal Atlas MCP: first atlas_whoami, then read record ${c.record} in project ${c.project}. Read AGENTS.md, README and existing requirements/API documentation first. Describe one small traceable use case. Compare its sourced requirements with existing code. List at most three contradictions or specification questions, with two sources or an explicitly missing source. Suggest one small next task and verifiable acceptance criteria. Separate facts, uncertainty and recommendations. No decisions for the team, invented requirements or Internet. Do not edit files, run commands, builds or tests, commit, push or write to Atlas. Only report on this ONE task page. Report the precise blocker if access is missing.`,criteria:['Actual Atlas identity and record reference.','Repository evidence with file and line; unsupported points remain open.','One small suggested task and verifiable criteria; the team decides.','No repository or Atlas changes; label tests not run.']}
}
/** Isolated private BA project: one manual read stage, a mandatory human gate, no implementation/follow-ups. */
export async function prepareSetupBA(repo:string,model:string,c:FirstStart,proof:AtlasProof,lang:'de'|'en'){
 const scope=setupScope(),valid=()=>{assertSetupScope(scope);if(Date.now()-proof.at>=15*60*1000||proof.key!==setupProofKey(proof.server,c)||!useCoding.getState().worker?.personalSecrets||!useCoding.getState().worker?.repos.some(r=>r.name===repo))throw Error('scope')}
 valid();const suggestion=baSuggestion(repo,c,lang)
 const dbId=withWriter({kind:'you',via:'setup',ref:'first-start'},()=>createProject('spec',lang==='de'?'Mein Erststart · BA-Test':'My first start · BA test','spec',{show:false}))
 // The cloud binding marks newly created private pages in its queued reflection.
 await new Promise<void>(resolve=>queueMicrotask(resolve));valid()
 if(kindOfDb(dbId)!=='spec'||!useWorkspace.getState().pages[dbId]?.private)throw Error('private')
 const stages=[{option:{id:'setup-read',name:lang==='de'?'BA · Nur lesen':'BA · Read only',color:'blue' as const},stage:{id:'setup-read',kind:'doc' as const,auto:false,permissionMode:'default' as const,maxTurns:12,instructions:suggestion.goal}},{option:{id:'setup-review',name:lang==='de'?'Bericht prüfen':'Review report',color:'orange' as const},stage:{id:'setup-review',kind:'gate' as const,auto:false,hold:true}},{option:{id:'setup-done',name:lang==='de'?'Abgenommen':'Accepted',color:'green' as const},stage:{id:'setup-done',kind:'done' as const,auto:false}}]
 if(!withWriter({kind:'you',via:'setup',ref:'first-start'},()=>savePipeline(dbId,stages))||readPipeline(useWorkspace.getState().databases[dbId]).length!==3)throw Error('pipeline')
 const id=await createTask({dbId,kind:'spec',title:suggestion.title,repo,goal:suggestion.goal,criteria:suggestion.criteria,priority:'low',branch:'',start:false,agent:'copilot',copilotRole:{model},followUps:[]})
 valid();await setTaskApprovals(id,'all');valid();withWriter({kind:'you',via:'setup',ref:'first-start'},()=>moveTask(id,'setup-read'));selectTaskAtlas(id,proof.server)
 return id
}

/** The wizard's button cannot silently start a task whose provider, repository or pipeline was changed elsewhere. */
export async function startSetupBA(id:string,repo:string,model:string,c:FirstStart,proof:AtlasProof){
 assertSetupScope(setupScope())
 if(Date.now()-proof.at>=15*60*1000||proof.key!==setupProofKey(proof.server,c))throw Error('scope')
 const ctx=taskContext(id),stages=ctx?.pipeline
 if(!ctx||ctx.kind!=='spec'||ctx.stage?.id!=='setup-read'||codingAgentOf(ctx.db,ctx.row)!=='copilot'||taskLocal(id).copilotRole?.model!==model||optionName(ctx.db,ctx.props.repo,ctx.row.properties[ctx.props.repo??''])!==repo||stages?.length!==3||stages[0]?.id!=='setup-read'||stages[0]?.kind!=='doc'||stages[0]?.auto||stages[1]?.kind!=='gate'||!stages[1]?.hold||stages[2]?.kind!=='done'||stages.some(s=>s.auto)||Array.isArray(ctx.row.properties[ctx.props.followUps??''])&&(ctx.row.properties[ctx.props.followUps??''] as unknown[]).length)throw Error('taskchanged')
 selectTaskAtlas(id,proof.server)
 await runTaskNow(id)
}
