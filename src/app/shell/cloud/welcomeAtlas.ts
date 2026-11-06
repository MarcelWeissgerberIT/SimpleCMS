/** Personal onboarding only: the recipient's own protected grant, never a shared token. */
import { atlasLinkToken } from '@/shared/welcome'
import type { WorkerMcpTool } from '@/shared/ai/worker'
import { useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { setDeviceAI, setDeviceRule } from '../../store/aiRules'
import { flushSecretWrites, getMcpToken } from '../../store/secrets'
import { withWriter } from '../../store/writer'
import { requestWorkerMcp, workerOnline } from '../../features/coding'
import { assertMcpFlow, assertModelFlow } from '../../features/ai/core/dataFlow'
import { readServers, writeServers, clearRefused, MAX_SERVERS } from '../../features/ai/mcp-servers/config'
import { refreshWorkerModels, workerModelRows } from '../../features/ai/core/workerModels'

export interface WelcomeAtlasEntry { id: string; name: string; atlasLink: string; atlasToken: string }
export function welcomeAtlasCredential(entry: WelcomeAtlasEntry) {
  const link = new URL(entry.atlasLink)
  if (link.protocol !== 'https:' || link.username || link.password || !['eh-atlas.com','aj-atlas.com'].includes(link.hostname)) throw Error('address')
  const token = entry.atlasToken.trim() || atlasLinkToken(entry.atlasLink)
  if (!token || /\s/.test(token)) throw Error('token')
  return {url:link.origin+'/api/atlas/mcp',token,linkBase:link.origin+'/'}
}
/** Repair only connections this onboarding created; unrelated Atlas instances stay intact. */
export function repairWelcomeAtlasEndpoints(): number {
  let changed=0
  const next=readServers().map(s=>{
    if(!s.id.startsWith('welcome-atlas-')||s.linkBase!=='https://eh-atlas.com/'||s.url!=='https://aj-atlas.com/api/atlas/mcp')return s
    changed++
    return {...s,url:'https://eh-atlas.com/api/atlas/mcp',checkedAt:undefined,checkError:undefined,checkAuth:undefined}
  })
  if(changed)withWriter({kind:'system',why:'repair'},()=>writeServers(next))
  return changed
}
/** One explicit press grants MCP to the chosen provider; testing needs no AI key or model call. */
export async function activateWelcomeAtlas(entry: WelcomeAtlasEntry, provider: 'copilot' | 'local', workspace: string, user: string): Promise<{membershipMissing:boolean}> {
  const epoch = useWorkspace.getState().epoch
  const assertScope = () => {
    const c=useCloud.getState()
    if(c.active.kind!=='cloud'||c.active.id!==workspace||c.user?.id!==user||c.readOnly||useWorkspace.getState().epoch!==epoch)throw Error('scope')
  }
  const permitted = () => {
    assertScope()
    assertModelFlow(provider)
    if(useWorkspace.getState().ai?.policy?.providers?.[provider]?.forbid?.includes('mcp'))throw Error('policy')
  }
  permitted()
  const credential=welcomeAtlasCredential(entry)
  assertMcpFlow([credential.url])
  if(!workerOnline())throw Error('worker')
  const id='welcome-atlas-'+entry.id
  if(!readServers().some(s=>s.id===id)&&readServers().length>=MAX_SERVERS)throw Error('full')
  const current=readServers().find(s=>s.id===id), names=readServers().filter(s=>s.id!==id).map(s=>s.name)
  let name=current?.name??'atlas-workshop'
  for(let n=2;names.includes(name);n++)name='atlas-workshop-'+n
  // Only metadata and identity are read during setup. Credentials never enter model context.
  const server={name,url:credential.url,token:credential.token,allow:['atlas_whoami'],deny:[]}
  const listed=await requestWorkerMcp({action:'list',servers:[server]}) as {tools:WorkerMcpTool[]}
  permitted();assertMcpFlow([credential.url])
  if(!Array.isArray(listed?.tools)||!listed.tools.some(t=>t.tool==='atlas_whoami'))throw Error('tools')
  const got=await requestWorkerMcp({action:'call',servers:[server],server:name,name:'atlas_whoami',arguments:{}}) as {result:string}
  permitted();assertMcpFlow([credential.url])
  const receipt=JSON.parse(got.result)
  if(receipt.isError)throw Error('identity')
  const identity=JSON.parse(receipt.content?.find((c:{type:string})=>c.type==='text')?.text??'null')
  const normalize=(v:string)=>v.toLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')
  if(typeof identity?.person!=='string'||normalize(identity.person)!==normalize(entry.name))throw Error('identity')
  await refreshWorkerModels()
  permitted()
  // Retire a manual connection to the wrong Atlas instance only when it holds
  // this exact personal credential. Other users' or instances' tokens are untouched.
  const wrongInstance=new Set<string>()
  if(credential.url==='https://eh-atlas.com/api/atlas/mcp'){
    for(const s of readServers().filter(s=>s.id!==id&&s.url==='https://aj-atlas.com/api/atlas/mcp')){
      if(await getMcpToken(s)===credential.token)wrongInstance.add(s.id)
    }
  }
  permitted()
  const model=workerModelRows().find(m=>m.route.p===provider&&m.caps.mcp)
  withWriter({kind:'you',via:'setup',ref:'welcome-atlas'},()=>{
    const device=useWorkspace.getState().settings.ai,allow=device?.allow??{},narrow=device?.narrow??{}
    // This explicit setup press also removes a previous device-only MCP restriction.
    // Other classes/providers and workspace forbids remain unchanged.
    if(!setDeviceAI({allow:{...allow,[provider]:[...new Set([...(allow[provider]??[]),'mcp' as const])]},narrow:{...narrow,[provider]:(narrow[provider]??[]).filter(c=>c!=='mcp')}}))throw Error('policy')
    if(model)setDeviceRule('mcp-setup',[model.route])
    writeServers([...readServers().filter(s=>s.id!==id).map(s=>wrongInstance.has(s.id)?{...s,enabled:false}:s),{id,name,url:credential.url,token:credential.token,enabled:true,scope:'all',linkBase:credential.linkBase,prompt:'Use this personal Atlas connection for the workshop. Verify identity and tenant with atlas_whoami; use actual Atlas sources. Do not change the selected tenant or make decisions for the team.',promptSource:'edited',tools:['atlas_whoami'],checkedAt:Date.now()}])
  })
  await flushSecretWrites()
  assertScope()
  clearRefused(name)
  return {membershipMissing:Array.isArray(identity.effectiveTenantScope)&&identity.effectiveTenantScope.length===0}
}
