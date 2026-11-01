import {useEffect,useRef,useState} from 'react'
import {FileText,RefreshCw,Download} from 'lucide-react'
import {cloudRequest,useCloud} from '../../../cloud'
import {useLang} from '../../../i18n'
import './frankfurt-audit.css'
import {LiveAuditRuns} from './LiveAuditRuns'

type Row={auditId:string;requestId:string;trace?:{job?:string;workspace?:string;user?:string};receivedAt:number;queuedAt:number|null;processingAt:number|null;finishedAt:number|null;state:string;status:number|null;model:string;error?:string;responseBytes:number}
type Entry=Row&{request:unknown;modelInput:unknown;response:string}
const pretty=(x:unknown)=>JSON.stringify(x,null,2)
/** Full contents never enter shared pages, the workspace document or local storage. */
export function FrankfurtAudit(){
 const active=useCloud(s=>s.active),user=useCloud(s=>s.user),lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 const [mode,setMode]=useState<'runs'|'rounds'>('runs')
 const [allowed,setAllowed]=useState(false),[allowedScope,setAllowedScope]=useState(''),[open,setOpen]=useState(false),[rows,setRows]=useState<Row[]>([]),[entry,setEntry]=useState<Entry|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cursor,setCursor]=useState<string|null>(null),[before,setBefore]=useState('')
 const scope=active.kind==='cloud'&&user?active.id+':'+user.id:''
 const path=`api/workspaces/${active.id}/model-audit`
 useEffect(()=>{let live=true;setAllowed(false);setAllowedScope('');setOpen(false);setRows([]);setEntry(null);setError('');setBefore('');setCursor(null);if(scope)void cloudRequest<{enabled:boolean}>('GET',path+'?status=1').then(r=>{if(live){setAllowed(r.enabled);setAllowedScope(scope)}}).catch(()=>{});return()=>{live=false}},[scope,path])
 const exportAbort=useRef<AbortController|null>(null),[exportBusy,setExportBusy]=useState(false)
 useEffect(()=>()=>{exportAbort.current?.abort()},[scope])
 const [revision,setRevision]=useState(0),[selected,setSelected]=useState('')
 useEffect(()=>{
  if(!allowed||allowedScope!==scope||!open||mode!=='rounds')return
  const abort=new AbortController();setBusy(true);setError('');setEntry(null)
  void (selected?cloudRequest<Entry>('GET',path+'?entry='+encodeURIComponent(selected),undefined,{signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setEntry(r)}):cloudRequest<{entries:Row[];nextCursor?:string|null}>('GET',path+(before?'?before='+encodeURIComponent(before):''),undefined,{signal:abort.signal}).then(r=>{if(!abort.signal.aborted){setRows(previous=>before?[...new Map([...previous,...r.entries].map(x=>[x.auditId,x])).values()]:r.entries);setCursor(r.nextCursor??null)}})).catch(()=>{if(!abort.signal.aborted)setError(tr('Das Host-Protokoll ist gerade nicht erreichbar. Bitte erneut laden.','The host log is currently unavailable. Please reload.'))}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})
  return()=>abort.abort()
 },[scope,path,allowed,allowedScope,open,selected,revision,lang,before,mode])
 const date=(n:number|null)=>n?new Date(n).toLocaleString(lang==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'medium'}):'—'
 const state=(s:string)=>s==='processed'?tr('Modellantwort empfangen','Model response received'):s==='processing'?tr('An Modell übergeben','Sent to model'):s==='received'?tr('Am Gateway angekommen','Received at gateway'):s==='failed'?tr('Fehlgeschlagen','Failed'):tr('Abgebrochen / Zeitgrenze','Cancelled / timed out')
 const download=()=>{if(!entry)return;const url=URL.createObjectURL(new Blob([pretty(entry)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='atlas-flow-'+entry.auditId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const downloadAll=async()=>{
  const abort=new AbortController();exportAbort.current?.abort();exportAbort.current=abort;setExportBusy(true);setError('')
  try{
   const response=await fetch('/'+path+'?export=1',{credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)])})
   if(!response.ok||!response.headers.get('content-type')?.includes('application/x-ndjson'))throw Error('Export unavailable')
   const blob=await response.blob(),tail=JSON.parse((await blob.slice(-2048).text()).trim().split('\n').at(-1)??'null')
   const current=useCloud.getState();if(abort.signal.aborted||current.active.kind!=='cloud'||current.active.id+':'+current.user?.id!==scope)return
   if(!tail?.exportComplete||!Number.isSafeInteger(tail.records))throw Error('Incomplete export')
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='atlas-flow-frankfurt.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }catch{if(!abort.signal.aborted)setError(tr('Gesamtexport nicht vollständig empfangen. Bitte erneut versuchen.','The entire export was not received. Please retry.'))}finally{if(exportAbort.current===abort){exportAbort.current=null;setExportBusy(false)}}
 }
 if(!allowed||allowedScope!==scope)return null
 return <section className="frankfurt-audit" data-testid="frankfurt-audit">
  <button className="btn btn--sm" onClick={()=>{setOpen(!open);setSelected('')}} aria-expanded={open}><FileText size={15}/>{tr('Mein vollständiges Testprotokoll','My complete test log')}</button>
  {open&&<div className="frankfurt-audit__panel">
   <header><strong>{tr('Frankfurt · Host-Protokoll · nur für dich','Frankfurt · host log · only you')}</strong>{mode==='rounds'&&<button className="btn btn--sm" disabled={busy} onClick={()=>{setBefore('');setRevision(x=>x+1)}}><RefreshCw size={14}/>{tr('Aktualisieren','Refresh')}</button>}</header>
   <button className="btn btn--sm" disabled={exportBusy} onClick={()=>void downloadAll()}><Download size={14}/>{exportBusy?tr('Gesamtexport wird geprüft …','Checking entire export …'):tr('Gesamtes Protokoll herunterladen (.jsonl)','Download entire log (.jsonl)')}</button>
   <p>{tr('Anfragen, tatsächlich übergebener Modellkontext und rohe Antworten ab Aktivierung der Protokollierung. 30 Tage Aufbewahrung, verschlüsselte Ablage. Erkannte Zugangsdaten sind geschwärzt. Eine empfangene Antwort belegt keine fachliche Richtigkeit und keine erfolgreiche Atlas-Änderung.','Requests, actual model context and raw responses since logging was activated. Encrypted storage, 30-day retention. Recognized credentials are redacted. Receiving a response does not prove factual correctness or a successful Atlas change.')}</p>
   {error&&mode==='runs'&&<p role="alert">{error}</p>}
   <div className="frankfurt-audit__toolbar" role="group" aria-label={tr('Protokollansicht','Log view')}><button className="btn btn--sm" aria-pressed={mode==='runs'} onClick={()=>setMode('runs')}>{tr('Live-Tests','Live tests')}</button><button className="btn btn--sm" aria-pressed={mode==='rounds'} onClick={()=>setMode('rounds')}>{tr('Modellrunden','Model rounds')}</button></div>
   {mode==='runs'?<LiveAuditRuns key={scope} path={path} scope={scope}/>:<>
   {error&&<p role="alert">{error}</p>}{busy&&<p role="status">{tr('Protokoll wird geladen …','Loading log …')}</p>}
   {selected?<><button className="btn btn--sm" onClick={()=>setSelected('')}>{tr('Zur Übersicht','Back to overview')}</button>{entry&&<>
    <h5>{state(entry.state)} · HTTP {entry.status??'—'}</h5>
    <dl>{[[tr('ONE eingereiht','Queued in ONE'),entry.queuedAt],[tr('Gateway empfangen','Gateway received'),entry.receivedAt],[tr('Modellaufruf gestartet','Model call started'),entry.processingAt],[tr('Beendet','Finished'),entry.finishedAt]].map(([label,n])=><div key={String(label)}><dt>{label}</dt><dd>{date(n as number|null)}</dd></div>)}</dl>
    <p className="frankfurt-audit__ids">{entry.model??(entry.request as {model?:string})?.model??'—'} · {entry.requestId}<br/>ONE job: {entry.trace?.job??'—'} · Workspace: {entry.trace?.workspace??'—'}</p>
    {entry.error&&<p role="alert">{entry.error}</p>}
    <button className="btn btn--sm" onClick={download}><Download size={14}/>{tr('Vollständigen Eintrag herunterladen','Download complete entry')}</button>
    {[[tr('Originalanfrage am Gateway','Original request at gateway'),pretty(entry.request)],[tr('Tatsächlich an das Modell übergeben','Actually sent to model'),pretty(entry.modelInput)],[tr('Rohe Modellantwort','Raw model response'),entry.response||tr('Keine Antwort empfangen.','No response received.')]].map(([label,content])=><details key={label}><summary>{label}</summary><pre>{content}</pre></details>)}
   </>}</>:!busy&&<>{!rows.length&&<p>{tr('Noch keine protokollierte Anfrage. Starte eine neue Anfrage mit Atlas Flow · Frankfurt und lade danach hier neu. Ältere Volltexte sind nicht nachträglich verfügbar.','No logged requests yet. Start a new request with Atlas Flow · Frankfurt, then refresh here. Earlier full contents cannot be recovered.')}</p>}{rows.map(r=><button className="frankfurt-audit__row" key={r.auditId} onClick={()=>setSelected(r.auditId)}><strong>{state(r.state)}</strong><span>{date(r.receivedAt)} · {r.model} · {r.responseBytes} B</span><small>{r.trace?.job??r.requestId}</small></button>)}{cursor&&<button className="btn btn--sm" onClick={()=>setBefore(cursor)}>{tr('Ältere Anfragen laden','Load earlier requests')}</button>}</>}
  </>}
  </div>}
 </section>
}
