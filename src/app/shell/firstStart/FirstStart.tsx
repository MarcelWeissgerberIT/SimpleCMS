import {useState} from 'react'
import {ArrowRight,Check,Copy,Play,Settings2} from 'lucide-react'
import {useCloud} from '../../cloud'
import {useWorkspace} from '../../store/store'
import {useUI} from '../../store/ui'
import {useLang} from '../../i18n'
import {openPage} from '../../lib/router'
import type {Page} from '../../store/types'
import {Screws} from '../../ui/controls'
import {useWorkerModels,workerModelRows,refreshWorkerModels} from '../../features/ai/core/workerModels'
import {sharedModels} from '../../features/ai/core/sharedModels'
import {SHARED_PREFIX} from '@/shared/ai/shared-model'
import {openAgent,useAgent} from '../../features/ai/agent/state'
import {useCoding} from '../../features/coding/state'
import {readServers} from '../../features/ai/mcp-servers/config'
import {AtlasWelcome} from '../cloud/Welcome'
import {allowedFor} from '@/shared/ai/policy'
import {firstStart,atlasStartPrompt} from './model'
import './firstStart.css'

export function FirstStartEntry(){
 const active=useCloud(s=>s.active),name=useCloud(s=>s.user?.name),pages=useWorkspace(s=>s.pages),lang=useLang()
 const guide=Object.values(pages).find(p=>!p.trashed&&!p.databaseId&&firstStart(p))
 if(active.kind!=='cloud'||!guide)return null
 return <section className="first-start-entry screw-plate" data-testid="first-start-entry"><Screws seed="first-start-entry"/><span className="label">01 · {lang==='de'?'DEIN ERSTSTART':'YOUR FIRST START'}</span><h2>{lang==='de'?`Willkommen${name?', '+name:''}`:`Welcome${name?', '+name:''}`}</h2><p>{lang==='de'?'Dein eigener Zugang, ein klarer Schritt nach dem anderen. Mit Bildern, fertigen Testprompts und Hilfe genau an der richtigen Stelle.':'Your own account, one clear step at a time. With pictures, ready-to-use test prompts and help where you need it.'}</p><button className="btn btn--primary" onClick={()=>openPage(guide.id)}>{lang==='de'?'Schritt für Schritt starten':'Start step by step'}<ArrowRight size={16}/></button></section>
}

export function FirstStartTools({page}:{page:Page}) {
 const config=firstStart(page)
 if(!config)return null
 return <StartTools page={page} config={config}/>
}
function StartTools({page,config}:{page:Page;config:NonNullable<ReturnType<typeof firstStart>>}) {
 const lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 const person=useCloud(s=>s.user),readOnly=useCloud(s=>s.readOnly),active=useCloud(s=>s.active)
 const participationUntil=useCloud(s=>s.active.kind==='cloud'?s.workspaces.find(w=>w.id===s.active.id)?.participationUntil:undefined)
 const worker=useCoding(s=>s.conn),running=useAgent(s=>s.status==='running'),draft=useAgent(s=>s.draft)
 const pending=useAgent(s=>s.changes.some(c=>!['applied','discarded','superseded'].includes(c.status)))
 const [notice,setNotice]=useState(''),[copied,setCopied]=useState(false)
 useWorkerModels()
 const personal=useWorkspace(s=>s.settings)
 const workspaceAI=useWorkspace(s=>s.ai)
 const mcpReady=readServers().some(s=>s.enabled&&!!s.checkedAt&&!s.checkAuth)
 const copilotAllowed=allowedFor('copilot','mcp',workspaceAI,personal.ai),flowAllowed=allowedFor('local','mcp',workspaceAI,personal.ai)
 const models=workerModelRows(),copilot=models.find(m=>m.route.p==='copilot'&&m.route.m==='auto')??models.find(m=>m.route.p==='copilot')
 const shares=sharedModels().filter(s=>s.enabled&&s.online&&s.tools)
 const share=shares.length===1?shares[0]:null
 const prompt=atlasStartPrompt(config,lang)
 const prepare=(which:'copilot'|'flow')=>{
  // This only prepares an explicit request. Existing drafts, running work and unreviewed changes are preserved.
  const state=useAgent.getState()
  if(readOnly||active.kind!=='cloud'||state.status==='running'||state.draft.trim()||state.changes.some(c=>!['applied','discarded','superseded'].includes(c.status)))return
  const route=which==='copilot'?copilot?.route:share?{p:'local' as const,m:SHARED_PREFIX+share.id}:null
  if(!route||!mcpReady||(which==='copilot'?!copilotAllowed:!flowAllowed))return
  useAgent.setState({route,refs:[],mentions:[],pageOff:page.id})
  openAgent({task:prompt,run:false})
  setNotice(tr('Prompt und Modell sind im KI-Terminal vorbereitet. Prüfe die Auswahl und drücke STARTEN. Es wurde noch keine Anfrage gesendet.','Prompt and model are ready in the AI terminal. Check the selection and press START. No request has been sent yet.'))
 }
 const occupied=running||!!draft.trim()||pending
 const settings=(tab:'coding'|'ai'|'secrets')=>useUI.getState().openModal({type:'settings',tab})
 return <section className="first-start-tools screw-plate" data-testid="first-start-tools"><Screws seed="first-start-tools"/>
  <div className="first-start-tools__head"><span className="label">§ 01 · {tr('DEIN PERSÖNLICHER EINSTIEG','YOUR PERSONAL START')}</span><strong>{person?.name||person?.email||tr('Dein Konto','Your account')}</strong><span>{readOnly?tr('Gast · nur lesen','Guest · read only'):participationUntil?tr('Gast · befristet mitmachen','Guest · temporary participation'):tr('Team · eigener Zugang','Team · personal access')}</span></div>
  <p>{tr('Lies die bebilderten Schritte unten der Reihe nach. Diese Schaltflächen führen direkt an die benötigte Stelle.','Follow the illustrated steps below in order. These buttons take you straight to the relevant place.')}</p>
  <div className="first-start-tools__actions"><button className="btn" onClick={()=>openPage(config.readinessPage)}>{tr('Unsere Startampel','Our start checklist')}</button>{!readOnly&&<><button className="btn" onClick={()=>settings('coding')}><Settings2 size={14}/>{tr('Worker einrichten','Set up worker')}</button><button className="btn" onClick={()=>settings('ai')}>{tr('Modelle und Atlas MCP','Models and Atlas MCP')}</button><button className="btn" onClick={()=>settings('secrets')}>{tr('Meine Secrets · für Coding','My secrets · for coding')}</button></>}</div>
  <AtlasWelcome setup/>
  {readOnly?<p className="first-start-tools__hint">{tr('Du nutzt den Gastpfad unten: ONE öffnen, deinen persönlichen Atlas-Zugang prüfen und die Ergebnisse mitverfolgen. Worker, Modellaufrufe und Änderungen bleiben für Gäste gesperrt.','Use the guest path below: open ONE, check your personal Atlas access and follow the results. Worker registration, model calls and edits remain unavailable to guests.')}</p>:<>
   <div className="first-start-tests"><div><span className="label">04 · COPILOT</span><p>{copilot?tr('Deine angemeldete Copilot CLI verwenden.','Use your signed-in Copilot CLI.'):tr('Noch kein Copilot-Modell gefunden. Worker verbinden, dann Modelle aktualisieren.','No Copilot model found yet. Connect your worker, then refresh models.')}</p><button className="btn btn--ink" disabled={!copilot||worker!=='connected'||!mcpReady||!copilotAllowed||occupied} onClick={()=>prepare('copilot')}><Play size={14}/>{tr('Copilot-Test vorbereiten','Prepare Copilot test')}</button></div><div><span className="label">05 · ATLAS FLOW</span><p>{share?tr('Geteiltes Workshop-Modell, persönlicher Atlas-Zugang.','Shared workshop model, your own Atlas access.'):shares.length>1?tr('Mehrere geteilte Modelle: bitte im Terminal gezielt wählen.','Several shared models: choose explicitly in the terminal.'):tr('Modellhost gerade nicht verfügbar. Copilot weiter nutzen und Marcel Bescheid geben.','Model host currently unavailable. Continue with Copilot and tell Marcel.')}</p><button className="btn btn--ink" disabled={!share||worker!=='connected'||!mcpReady||!flowAllowed||occupied} onClick={()=>prepare('flow')}><Play size={14}/>{tr('Atlas-Flow-Test vorbereiten','Prepare Atlas Flow test')}</button></div></div>
   {(!mcpReady||!copilotAllowed||!flowAllowed)&&<p className="first-start-tools__hint">{tr('Vor den Modelltests: Atlas MCP mit deinem eigenen Token prüfen und die MCP-Erlaubnis für Copilot sowie Lokal/Ollama ausdrücklich aktivieren. Das geschieht unter „Modelle und Atlas MCP“.','Before the model tests: check Atlas MCP with your own token and explicitly allow MCP for Copilot and Local/Ollama under “Models and Atlas MCP”.')}</p>}
   {occupied&&<p role="status">{tr('Im Terminal läuft etwas, liegt ein Entwurf oder warten Änderungsvorschläge. Schließe diesen Schritt dort ab; deine Arbeit bleibt erhalten.','The terminal has a run, a draft or unreviewed changes. Finish that step there; your work is preserved.')}</p>}
   <details><summary>{tr('Den Testprompt ansehen oder kopieren','View or copy the test prompt')}</summary><pre>{prompt}</pre><button className="btn" onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setCopied(true))}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?tr('Kopiert','Copied'):tr('Prompt kopieren','Copy prompt')}</button></details>
   <p className="first-start-tools__hint">{tr('Beide Tests lesen denselben freigegebenen Demo-Record. Sie ändern nichts in Atlas und senden weder deine Tokens noch die ganze Anleitung an den Modellhost. Die tatsächlichen Werkzeuge siehst du im Terminal.','Both tests read the same approved demo record. They change nothing in Atlas and send neither your tokens nor the full guide to the model host. The terminal shows the actual tool calls.')}</p>
   <button className="btn btn--ghost" onClick={()=>void refreshWorkerModels()}>{tr('Modelle aktualisieren','Refresh models')}</button>
  </>}
  {notice&&<p role="status">{notice}</p>}
 </section>
}
