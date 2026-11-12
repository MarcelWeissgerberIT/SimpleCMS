import {savedPersonalAtlas,rememberPersonalAtlas,reusePersonalAtlas,forgetPersonalAtlas} from './personalAtlas'
import {useEffect,useRef,useState} from 'react'
import {CheckCircle2,KeyRound,Play,RefreshCw} from 'lucide-react'
import {useWorkspace} from '../../store/store'
import {useCloud,cloudRequest} from '../../cloud'
import {readServers,writeServers} from '../../features/ai/mcp-servers/config'
import {flushSecretWrites,getMcpToken} from '../../store/secrets'
import {useAgent,openAgent} from '../../features/ai/agent/state'
import {useSharedModels,sharedModels} from '../../features/ai/core/sharedModels'
import {atlasLinkToken} from '@/shared/welcome'
import {useLang,useT} from '../../i18n'
import {AINeedsSetup,useAIStatus} from '../../features/ai/setup/AINeedsSetup'
import {labelFor} from '../../features/ai/core/registry'
import './atlasStart.css'

/** No inherited credentials, worker, video or provider setup before the first cloud Atlas task. */
export function AtlasStart({pageId,readOnly,connectionOnly=false}:{pageId:string;readOnly:boolean;connectionOnly?:boolean}){
 const t=useT(),pending=useRef<AbortController|null>(null)
 const setup=useWorkspace(s=>s.ai?.onboarding),epoch=useWorkspace(s=>s.epoch),raw=useWorkspace(s=>s.settings.workspaceMcpServers)
 const cloud=useCloud(s=>s.active),user=useCloud(s=>s.user),lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 const [saved,setSaved]=useState<{person:string}|null>(null),[remember,setRemember]=useState(true)
 const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[editing,setEditing]=useState(false)
 useSharedModels()
 const server=setup?raw?.find(s=>s.name===setup.mcpName&&s.url===setup.mcpUrl):undefined,ready=!!server?.enabled&&!!server.token&&!!server.checkedAt&&!server.checkError&&!server.checkAuth
 const status=useAIStatus('terminal.task'),pin=useWorkspace(s=>s.ai?.routes?.['*']?.[0]),shared=pin?.p==='local'&&pin.m.startsWith('one-shared/'),model=pin?(shared?'Atlas Flow · Frankfurt':labelFor(pin)):tr('Gewähltes Modell','Selected model')
 const online=shared?sharedModels().some(s=>s.enabled&&s.online&&pin!.m==='one-shared/'+s.id):status.ready
 useEffect(()=>{pending.current?.abort();pending.current=null;setBusy(false);setToken('');setMessage('');setEditing(false);setSaved(null);let stopped=false;if(user&&setup)void savedPersonalAtlas(user.id,setup.mcpUrl).then(s=>{if(!stopped)setSaved(s)}).catch(()=>{});return()=>{stopped=true;pending.current?.abort();pending.current=null}},[epoch,cloud.kind,cloud.kind==='cloud'?cloud.id:null,user?.id,setup?.mcpUrl,setup?.mcpName])
 if(!setup||setup.startPageId!==pageId||cloud.kind!=='cloud'||!user)return null
 const connect=async(reuse:'saved'|'current'|false=false)=>{
  if(pending.current)return
  const ctrl=new AbortController();pending.current=ctrl
  const timer=window.setTimeout(()=>ctrl.abort(),30_000)
  setBusy(true);setMessage('')
  const ws=cloud.id,owner=user.id,startEpoch=epoch
  const current=()=>{const c=useCloud.getState();return c.active.kind==='cloud'&&c.active.id===ws&&c.user?.id===owner&&useWorkspace.getState().epoch===startEpoch&&useWorkspace.getState().ai?.onboarding?.mcpUrl===setup.mcpUrl&&useWorkspace.getState().ai?.onboarding?.mcpName===setup.mcpName}
  try{
   if(setup.mcpUrl!=='https://aj-atlas.com/api/atlas/mcp')throw Error(t('shell.cloud.atlas.wrongEndpoint'))
   let key=reuse==='saved'?await reusePersonalAtlas(owner,setup.mcpUrl):reuse==='current'?(await getMcpToken(server!))??'':token.trim()
   if(key.startsWith('https://')){const link=new URL(key);if(link.origin!=='https://aj-atlas.com')throw Error(tr('Bitte den persönlichen AJ-Atlas-Token oder einen AJ-Atlas-Link verwenden.','Use your personal AJ-Atlas token or an AJ-Atlas link.'));key=atlasLinkToken(key)??''}
   if(!key||/\s/.test(key))throw Error(tr('Bitte einen gültigen persönlichen Atlas-Token eingeben.','Enter a valid personal Atlas token.'))
   if(!current()||ctrl.signal.aborted)return
   const reply=await cloudRequest<{result:string}>('POST',`api/workspaces/${ws}/atlas-mcp`,{action:'call',servers:[{name:setup.mcpName,url:setup.mcpUrl,token:key,allow:['atlas_whoami'],deny:[]}],server:setup.mcpName,name:'atlas_whoami',arguments:{}},{signal:ctrl.signal})
   if(!current()||ctrl.signal.aborted)return
   const receipt=JSON.parse(reply.result);if(receipt.isError)throw Error(tr('Atlas hat die Identitätsprüfung abgelehnt. Token und Rechte prüfen.','Atlas rejected the identity check. Check your token and permissions.'))
   const identity=JSON.parse(receipt.content?.find((c:{type:string})=>c.type==='text')?.text??'null')
   if(typeof identity?.person!=='string'||!identity.person.trim())throw Error(tr('Atlas hat keine prüfbare persönliche Identität geliefert.','Atlas returned no verifiable personal identity.'))
   const person=identity.person
   const s=useWorkspace.getState(),existing=readServers().find(v=>v.name===setup.mcpName&&v.url===setup.mcpUrl),id=existing?.id??'workspace-atlas-'+ws
   // Only this workspace's private device overlay changes. Global preferences and connections stay intact.
   writeServers([...readServers().filter(s=>s.id!==id&&s.name!==setup.mcpName),{...existing,id,name:setup.mcpName,url:setup.mcpUrl,token:key,enabled:true,oauth:undefined,checkError:undefined,checkAuth:undefined,scope:existing?existing.scope:'all',linkBase:'https://aj-atlas.com/',codeword:'atlas',checkedAt:Date.now(),tools:[...new Set([...(existing?.tools??[]),'atlas_whoami'])],promptSource:existing?.promptSource??'edited',prompt:existing?.prompt||`Use the requesting person's AJ-Atlas identity for ${setup.project}. Verify identity, accessible tenant and project before writes. Discover the active project constraints from real Atlas sources. Cite sources; do not invent records or make domain decisions for the team.`}])
   const pin=s.ai?.routes?.['*'],routes=Object.fromEntries(Object.entries(s.ai?.routes??{}).filter(([k])=>k!=='*'))
   const provider=pin?.[0]?.p
   s.updateSettings({workspaceAI:{...s.settings.workspaceAI,gen:6,default:pin,routes,...(provider?{allow:{...s.settings.workspaceAI?.allow,[provider]:[...new Set([...(s.settings.workspaceAI?.allow?.[provider]??[]),'mcp' as const])]}}:{})}})
   await flushSecretWrites();if(!current())return
   let remembered=true
   if(remember||reuse==='current'){try{await rememberPersonalAtlas(owner,setup.mcpUrl,key,person);if(!current())return;setSaved({person})}catch{if(!current())return;remembered=false}}
   setToken('');setEditing(false)
   setMessage(tr(`Verbunden als ${String(person)}.`,`Connected as ${String(person)}.`)+(remembered?'':' '+t('shell.cloud.atlas.rememberFailed')))
  }catch(e){if(current())setMessage(ctrl.signal.aborted?t('shell.cloud.atlas.checkTimeout'):e instanceof Error?e.message:tr('Verbindung fehlgeschlagen. Bitte Token prüfen.','Connection failed. Check your token.'))}
  finally{window.clearTimeout(timer);if(pending.current===ctrl){pending.current=null;if(current())setBusy(false)}}
 }
 const start=()=>{
  const route=useWorkspace.getState().ai?.routes?.['*']?.[0]
  if(!route||!ready||!online||useAgent.getState().status==='running')return
  useAgent.setState({route,refs:[],mentions:[],pageOff:pageId})
  openAgent({task:`Nutze ausschließlich die persönliche Verbindung ${setup.mcpName}. Rufe zuerst atlas_whoami auf und nenne meine tatsächliche Atlas-Identität und die zugänglichen Tenants. Suche danach in den freigegebenen AJ-Atlas-Quellen nach passenden Projekten zu ${setup.project}. Zeige ein kurzes, quellenbelegtes Briefing: Was ist bekannt, was ist offen, welche kleine erste Aufgabe bietet sich an? Bei mehreren möglichen Projekten zeige die Auswahl statt eines zu erfinden. Nur lesen; nichts anlegen oder ändern und keine fachlichen Entscheidungen treffen.`,run:true})
 }
 return <section className="atlas-start screw-plate" data-testid="atlas-team-start">
  <header><span className="label">§ AJ · {setup.project}</span><strong>{connectionOnly?tr('Dein Atlas-Zugang für diesen Workspace','Your Atlas access for this workspace'):tr('Dein Einstieg · ONE + Atlas','Your start · ONE + Atlas')}</strong>{!connectionOnly&&<span className="atlas-start__model" data-online={online}>{model} · {online?tr('bereit','ready'):tr('Einrichtung prüfen','check setup')}</span>}</header>
  {readOnly?<p>{tr('Dieser Zugang ist lesend. Für KI-Aufgaben brauchst du eine Team-Mitgliedschaft.','This access is read only. AI tasks require team membership.')}</p>:<>
   {(!ready||editing)?<><p>{connectionOnly?tr('Verbinde deinen persönlichen AJ-Atlas-Zugang mit diesem Workspace. Ein gespeicherter Zugang kann hier erneut geprüft werden.', 'Connect your personal AJ-Atlas access to this workspace. You can recheck a saved access here.'):tr(`${model} ist vorausgewählt. Verbinde deinen persönlichen AJ-Atlas-Zugang. ONE prüft deine Identität; deine Modellanmeldung muss auf diesem Gerät bereit sein.`,`${model} is selected. Connect your personal AJ-Atlas access. ONE checks your identity; your model access must be ready on this device.`)}</p>
    {saved&&<div className="atlas-start__reuse"><p>{tr(`Dein persönlicher AJ-Atlas-Zugang als ${saved.person} ist auf diesem Gerät vorhanden.`, `Your personal AJ-Atlas access as ${saved.person} is available on this device.`)}</p><button className="btn btn--primary" disabled={busy} onClick={()=>void connect('saved')}>{tr('Vorhandenen Zugang hier verbinden und prüfen','Connect and check existing access here')}</button><p className="atlas-start__privacy">{tr('ONE prüft ihn für diesen Workspace neu. Projekt, Modell und Datenregeln dieses Workspaces gelten weiter; es werden keine Berechtigungen übertragen.','ONE checks it again for this workspace. This workspace’s project, model and data rules still apply; no permissions are transferred.')}</p></div>}
    <label className="atlas-start__field"><span><KeyRound size={15}/> {tr('Dein persönlicher Atlas-Token','Your personal Atlas token')}</span><input className="input" type="password" value={token} readOnly={busy} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder={tr('Token oder persönlicher AJ-Atlas-Link','Token or personal AJ-Atlas link')}/></label>
    <p className="atlas-start__privacy">{t('shell.cloud.atlas.privacy')}</p>
    <label className="atlas-start__privacy"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>{tr('Meinen AJ-Atlas-Zugang auf diesem Gerät auch in meinen anderen AJ-Workspaces anbieten.','Offer my AJ-Atlas access on this device in my other AJ workspaces too.')}</label>
    <button className="btn btn--primary" disabled={busy||!token.trim()} onClick={()=>void connect()}>{busy?<RefreshCw size={15}/>:<KeyRound size={15}/>} {busy?tr('Atlas wird geprüft …','Checking Atlas …'):tr('Atlas verbinden und prüfen','Connect and check Atlas')}</button>
   </>:<><p className="atlas-start__ready"><CheckCircle2 size={17}/> {t('shell.cloud.atlas.verified')}</p>{!connectionOnly&&!online&&<><p>{t('shell.cloud.atlas.modelPending')}</p><AINeedsSetup purpose="terminal.task" variant="line"/></>}<div className="atlas-start__actions">{!connectionOnly&&<button className="btn btn--primary" disabled={!online||busy} onClick={start}><Play size={15}/>{tr('Erste Atlas-Aufgabe starten','Start first Atlas task')}</button>}<button className="btn btn--ghost" disabled={busy} onClick={()=>setEditing(true)}>{tr('Token wechseln','Change token')}</button></div></>}
  </>}
  {ready&&!saved&&!readOnly&&<button className="btn btn--ghost btn--sm" disabled={busy} onClick={()=>void connect('current')}>{tr('Diesen Zugang auch für meine anderen AJ-Workspaces merken','Remember this access for my other AJ workspaces')}</button>}
  {saved&&!readOnly&&<button className="btn btn--ghost btn--sm" disabled={busy} onClick={()=>{void forgetPersonalAtlas(user.id,setup.mcpUrl).then(()=>setSaved(null)).catch(()=>setMessage(tr('Gespeicherter Zugang konnte nicht entfernt werden.','Could not remove saved access.')))}}>{tr('Gespeicherten AJ-Zugang für weitere Workspaces vergessen','Forget saved AJ access for other workspaces')}</button>}
  {message&&<p role="status">{message}</p>}
 </section>
}
