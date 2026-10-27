/** Explicit, session-only task grants for an already sealed personal Atlas connection.
 * No credential is copied into task metadata, localStorage or another person's session. */
import type { ProviderId } from '@/shared/ai/types'
import type { PersonalConnection } from '@/shared/personalVault'
import { allowedFor } from '@/shared/ai/policy'
import { codingProvider } from '@/shared/ai/dataFlow'
import { useCloud } from '../../cloud/state'
import { useWorkspace } from '../../store/store'
import { getMcpToken } from '../../store/secrets'
import { setDeviceAI } from '../../store/aiRules'
import { withWriter } from '../../store/writer'
import { useCoding } from '../coding/state'
import { codingAgentOf } from '../coding/agent'
import { readServers } from '../ai/mcp-servers/config'
import { assertMcpFlow, assertModelFlow } from '../ai/core/dataFlow'

const READ_TOOLS = ['atlas_whoami','atlas_get','atlas_search','atlas_context']
const grants = new Map<string,{server:string;fingerprint:string;receiver:string;provider:ProviderId}>()
let receiverGeneration=0
useCoding.subscribe((s,p)=>{if(s.conn!==p.conn||s.relay?.token!==p.relay?.token||s.worker?.name!==p.worker?.name)receiverGeneration++})
const receiver=()=>JSON.stringify([receiverGeneration,useCoding.getState().conn,useCoding.getState().worker?.name,useCoding.getState().relay?.token])
const scope=()=>{const c=useCloud.getState();return JSON.stringify([c.user?.id,c.active.id,useWorkspace.getState().epoch])}
const key=(task:string)=>scope()+'\n'+task
const fingerprint=(s:ReturnType<typeof readServers>[number])=>JSON.stringify([s.id,s.url,s.token,s.enabled,s.checkAuth])
const taskProvider=(task:string)=>{const s=useWorkspace.getState(),p=s.pages[task],db=p?.databaseId?s.databases[p.databaseId]:null;return p&&db?codingProvider(codingAgentOf(db,p)??''):null}
export function taskAtlasChoices(){
  return readServers().filter(s=>s.enabled&&s.checkedAt&&!s.checkAuth&&!s.checkError&&/^https:\/\/(eh-atlas\.com|aj-atlas\.com)\/api\/atlas\/mcp\/?$/.test(s.url))
}
export function taskAtlasSelection(task:string):string|null{return grants.get(key(task))?.server??null}
export function taskAtlasGrantCurrent(task:string):boolean{
  const grant=grants.get(key(task));if(!grant)return true
  const server=taskAtlasChoices().find(s=>s.id===grant.server)
  return !!server&&fingerprint(server)===grant.fingerprint&&receiver()===grant.receiver&&taskProvider(task)===grant.provider
}
export function selectTaskAtlas(task:string,server:string|null){
  const c=useCloud.getState(),w=useCoding.getState(),page=useWorkspace.getState().pages[task]
  if(c.readOnly||!page||page.trashed)throw Error('Task access changed.')
  if(server===null){grants.delete(key(task));return}
  const chosen=taskAtlasChoices().find(s=>s.id===server)
  if(!chosen||w.conn!=='connected'||!w.worker?.personalSecrets)throw Error('Connect your personal worker and check Atlas first.')
  const provider=taskProvider(task),s=useWorkspace.getState()
  if(!provider||s.ai?.policy?.providers?.[provider]?.forbid?.includes('mcp'))throw Error('Workspace rules do not allow Atlas for this coding provider.')
  assertModelFlow(provider);assertMcpFlow([chosen.url])
  // Selecting the task grant is explicit consent to MCP results for its chosen
  // coding provider, including Codex/MiniMax/Ollama. No other data class opens.
  withWriter({kind:'you',via:'setup',ref:'task-atlas'},()=>{
    const device=s.settings.ai,allow=device?.allow??{},narrow=device?.narrow??{}
    if(!setDeviceAI({allow:{...allow,[provider]:[...new Set([...(allow[provider]??[]),'mcp' as const])]},narrow:{...narrow,[provider]:(narrow[provider]??[]).filter(c=>c!=='mcp')}}))throw Error('Reload ONE to use current data rules.')
  })
  grants.set(key(task),{server,fingerprint:fingerprint(chosen),receiver:receiver(),provider})
}
export async function taskAtlasConnection(task:string,provider:ProviderId):Promise<PersonalConnection[]>{
  const grant=grants.get(key(task));if(!grant)return []
  const currentScope=scope(),s=useWorkspace.getState(),c=useCloud.getState(),w=useCoding.getState()
  if(c.readOnly||w.conn!=='connected'||!w.worker?.personalSecrets||!taskAtlasGrantCurrent(task)||provider!==grant.provider)throw Error('Atlas-Freigabe für diese Aufgabe erneut bestätigen. / Confirm this task’s Atlas grant again.')
  assertModelFlow(provider)
  if(!allowedFor(provider,'mcp',s.ai,s.settings.ai))throw Error('Atlas MCP für diesen Anbieter persönlich erlauben. / Allow Atlas MCP for this provider.')
  const server=taskAtlasChoices().find(x=>x.id===grant.server)!
  assertMcpFlow([server.url])
  const token=await getMcpToken(server)
  // A sign-out, task/connection edit or worker handover while unsealing must not
  // turn a once-valid press into authorization for a different recipient.
  if(scope()!==currentScope||grants.get(key(task))!==grant||!taskAtlasGrantCurrent(task)||useCloud.getState().readOnly||!token)throw Error('Personal Atlas grant changed. Confirm again.')
  assertModelFlow(provider);assertMcpFlow([server.url])
  const latest=useWorkspace.getState()
  if(!allowedFor(provider,'mcp',latest.ai,latest.settings.ai))throw Error('Atlas MCP permission changed.')
  return [{id:'task-atlas-read',name:'atlas-task-read',url:server.url,token,tools:[...READ_TOOLS]}]
}
useCloud.subscribe((s,p)=>{if(s.user?.id!==p.user?.id||s.available!==p.available||s.readOnly!==p.readOnly)grants.clear()})
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>grants.clear())
