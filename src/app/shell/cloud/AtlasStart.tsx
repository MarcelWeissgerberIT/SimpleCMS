import {useEffect,useState} from 'react'
import {CheckCircle2,KeyRound,Play,RefreshCw} from 'lucide-react'
import {useWorkspace} from '../../store/store'
import {useCloud,cloudRequest} from '../../cloud'
import {readServers,writeServers} from '../../features/ai/mcp-servers/config'
import {flushSecretWrites} from '../../store/secrets'
import {useAgent,openAgent} from '../../features/ai/agent/state'
import {useSharedModels,sharedModels} from '../../features/ai/core/sharedModels'
import {atlasLinkToken} from '@/shared/welcome'
import {useLang} from '../../i18n'
import './atlasStart.css'

/** No inherited credentials, worker, video or provider setup before the first cloud Atlas task. */
export function AtlasStart({pageId,readOnly}:{pageId:string;readOnly:boolean}){
 const setup=useWorkspace(s=>s.ai?.onboarding),epoch=useWorkspace(s=>s.epoch),raw=useWorkspace(s=>s.settings.workspaceMcpServers)
 const cloud=useCloud(s=>s.active),user=useCloud(s=>s.user),lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[editing,setEditing]=useState(false)
 useSharedModels()
 const server=setup?raw?.find(s=>s.name===setup.mcpName):undefined,ready=!!server?.enabled&&!!server.token&&!!server.checkedAt
 const online=sharedModels().some(s=>s.enabled&&s.online&&useWorkspace.getState().ai?.routes?.['*']?.some(r=>r.m==='one-shared/'+s.id))
 useEffect(()=>{setToken('');setMessage('');setEditing(false)},[epoch])
 if(!setup||setup.startPageId!==pageId||cloud.kind!=='cloud'||!user)return null
 const connect=async()=>{
  setBusy(true);setMessage('')
  const ws=cloud.id,owner=user.id,startEpoch=epoch
  const current=()=>{const c=useCloud.getState();return c.active.kind==='cloud'&&c.active.id===ws&&c.user?.id===owner&&useWorkspace.getState().epoch===startEpoch}
  try{
   let key=token.trim()
   if(key.startsWith('https://')){const link=new URL(key);if(link.origin!=='https://aj-atlas.com')throw Error('Bitte den persönlichen AJ-Atlas-Token oder einen AJ-Atlas-Link verwenden.');key=atlasLinkToken(key)??''}
   if(!key||/\s/.test(key))throw Error(tr('Bitte einen gültigen persönlichen Atlas-Token eingeben.','Enter a valid personal Atlas token.'))
   const reply=await cloudRequest<{result:string}>('POST',`api/workspaces/${ws}/atlas-mcp`,{action:'call',servers:[{name:setup.mcpName,url:setup.mcpUrl,token:key,allow:['atlas_whoami'],deny:[]}],server:setup.mcpName,name:'atlas_whoami',arguments:{}})
   if(!current())return
   const receipt=JSON.parse(reply.result);if(receipt.isError)throw Error(tr('Atlas hat die Identitätsprüfung abgelehnt. Token und Rechte prüfen.','Atlas rejected the identity check. Check your token and permissions.'))
   const s=useWorkspace.getState(),id='workspace-atlas-'+ws
   // Only this workspace's private device overlay changes. Global preferences and connections stay intact.
   writeServers([...readServers().filter(s=>s.id!==id),{id,name:setup.mcpName,url:setup.mcpUrl,token:key,enabled:true,scope:'all',linkBase:'https://aj-atlas.com/',codeword:'atlas',checkedAt:Date.now(),tools:['atlas_whoami'],promptSource:'edited',prompt:`Use the requesting person's AJ-Atlas identity for ${setup.project}. Verify identity, accessible tenant and project before writes. Discover the active project constraints from real Atlas sources. Cite sources; do not invent records or make domain decisions for the team.`}])
   const pin=s.ai?.routes?.['*'],routes=Object.fromEntries(Object.entries(s.ai?.routes??{}).filter(([k])=>k!=='*'))
   s.updateSettings({workspaceAI:{...s.settings.workspaceAI,gen:6,default:pin,routes,allow:{local:['mcp','private','mail','memory']},narrow:{local:[]}}})
   await flushSecretWrites();if(!current())return
   setToken('');setEditing(false)
   let person='';try{person=JSON.parse(receipt.content?.find((c:{type:string})=>c.type==='text')?.text??'{}').person??''}catch{/* A successful real tool result remains valid without a display name. */}
   setMessage(person?tr(`Verbunden als ${String(person)}.`,`Connected as ${String(person)}.`):tr('Persönliche Atlas-Verbindung geprüft.','Personal Atlas connection verified.'))
  }catch(e){if(current())setMessage(e instanceof Error?e.message:tr('Verbindung fehlgeschlagen. Bitte Token prüfen.','Connection failed. Check your token.'))}
  finally{if(current())setBusy(false)}
 }
 const start=()=>{
  const route=useWorkspace.getState().ai?.routes?.['*']?.[0]
  if(!route||!ready||!online||useAgent.getState().status==='running')return
  useAgent.setState({route,refs:[],mentions:[],pageOff:pageId})
  openAgent({task:`Nutze ausschließlich die persönliche Verbindung ${setup.mcpName}. Rufe zuerst atlas_whoami auf und nenne meine tatsächliche Atlas-Identität und die zugänglichen Tenants. Suche danach in den freigegebenen AJ-Atlas-Quellen nach passenden Projekten zu ${setup.project}. Zeige ein kurzes, quellenbelegtes Briefing: Was ist bekannt, was ist offen, welche kleine erste Aufgabe bietet sich an? Bei mehreren möglichen Projekten zeige die Auswahl statt eines zu erfinden. Nur lesen; nichts anlegen oder ändern und keine fachlichen Entscheidungen treffen.`,run:true})
 }
 return <section className="atlas-start screw-plate" data-testid="atlas-team-start">
  <header><span className="label">§ AJ · {setup.project}</span><strong>{tr('Dein Einstieg · ONE + Atlas Flow','Your start · ONE + Atlas Flow')}</strong><span className="atlas-start__model" data-online={online}>{online?tr('Frankfurt · bereit','Frankfurt · ready'):tr('Frankfurt · derzeit offline','Frankfurt · currently offline')}</span></header>
  {readOnly?<p>{tr('Dieser Zugang ist lesend. Für KI-Aufgaben brauchst du eine Team-Mitgliedschaft.','This access is read only. AI tasks require team membership.')}</p>:<>
   {(!ready||editing)?<><p>{tr('Atlas Flow ist bereits ausgewählt. Gib nur deinen persönlichen AJ-Atlas-Token ein. ONE prüft damit deine Identität; du brauchst für den ersten Atlas-Auftrag keinen lokalen Worker.','Atlas Flow is already selected. Enter only your personal AJ-Atlas token. ONE checks your identity; the first Atlas task needs no local worker.')}</p>
    <label className="atlas-start__field"><span><KeyRound size={15}/> {tr('Dein persönlicher Atlas-Token','Your personal Atlas token')}</span><input className="input" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder={tr('Token oder persönlicher AJ-Atlas-Link','Token or personal AJ-Atlas link')}/></label>
    <p className="atlas-start__privacy">{tr('Mit „Verbinden“ erlaubst du Atlas Flow die von dir angeforderten ONE-Inhalte und Atlas-Ergebnisse in diesem Workspace. Deine Atlas-Rechte bleiben maßgeblich. Der Token liegt verschlüsselt auf diesem Gerät und wird für einzelne Aufrufe über den ONE-Teamserver an AJ-Atlas übergeben; der GPU-Modellserver erhält ihn nicht.','Connecting permits Atlas Flow to use ONE content and Atlas results you request in this workspace. Your Atlas permissions remain authoritative. The token is encrypted on this device and passed through the ONE team server to AJ-Atlas for individual calls; it never reaches the GPU model server.')}</p>
    <button className="btn btn--primary" disabled={busy||!token.trim()} onClick={()=>void connect()}>{busy?<RefreshCw size={15}/>:<KeyRound size={15}/>} {busy?tr('Atlas wird geprüft …','Checking Atlas …'):tr('Atlas verbinden und prüfen','Connect and check Atlas')}</button>
   </>:<><p className="atlas-start__ready"><CheckCircle2 size={17}/> {tr('Dein persönlicher Atlas-Zugang ist geprüft. Starte jetzt dein erstes Briefing mit dem Frankfurter Modell.','Your personal Atlas access is verified. Start your first briefing with the Frankfurt model.')}</p><div className="atlas-start__actions"><button className="btn btn--primary" disabled={!online||busy} onClick={start}><Play size={15}/>{tr('Erste Atlas-Aufgabe starten','Start first Atlas task')}</button><button className="btn btn--ghost" onClick={()=>setEditing(true)}>{tr('Token wechseln','Change token')}</button></div></>}
  </>}
  {message&&<p role="status">{message}</p>}
 </section>
}
