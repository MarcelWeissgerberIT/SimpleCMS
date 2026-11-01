import {TaskContractCard} from '../mcp-servers/TaskContractCard'
import type {TaskReport} from '@/shared/quandprofile/task'
import {useEffect,useState} from 'react'
import {Download,RefreshCw} from 'lucide-react'
import {cloudRequest} from '../../../cloud'
import {useLang} from '../../../i18n'
import {atlasReceipt} from '@/shared/mcp/facts'
import type {QuantumProof} from '@/shared/quandprofile/runtime'
import {AtlasFactsView} from '../mcp-servers/AtlasFacts'

type Value=unknown
type AuditEvent={id:string;type:string;receivedAt:number;clientAt:number;callId?:string;server?:string;name?:string;arguments?:Value;result?:Value;error?:string;state?:string;answer?:Value;source:string}
type Round={auditId:string;requestId?:string;receivedAt:number;processingAt?:number;finishedAt?:number;state:string;status?:number;request:Value;modelInput:Value;response?:string;error?:string;trace?:{job?:string}}
type Row={auditId:string;receivedAt:number;finishedAt?:number;state:string;model:string;prompt:string;events:number}
type Run=Row&{trace:{workspace:string;user:string};request:{model:string;prompt:string;purpose:string};events:AuditEvent[];answer?:Value;error?:string}
type Detail={run:Run;rounds:Round[]}
const pretty=(value:Value)=>typeof value==='string'?value:JSON.stringify(value,null,2)??''
const answerText=(value:Value)=>Array.isArray(value)&&value.every(v=>object(v)?.type==='text')?value.map(v=>String(object(v)?.text??'')).join('\n'):pretty(value)
const object=(value:Value):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
/** Preserve the exact response in raw details; this is only a readable stream preview. */
function modelReply(response=''){
 const messages:Record<string,unknown>[]=[]
 for(const line of response.split('\n')){try{const v=object(JSON.parse(line));const m=object(v?.message);if(m)messages.push(m);else if(v)messages.push(v)}catch{}}
 if(!messages.length)return response
 return messages.map(m=>[typeof m.content==='string'?m.content:'',m.tool_calls?JSON.stringify({tool_calls:m.tool_calls},null,2):''].filter(Boolean).join('\n')).filter(Boolean).join('\n')||response
}
/** MCP often returns JSON inside text fields. Decode objects for reading; exports keep the exact originals. */
function readableResult(value:Value,depth=0):Value{
 if(depth>=8)return value
 if(typeof value==='string'){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object')return readableResult(parsed,depth+1)}catch{}return value}
 if(Array.isArray(value))return value.map(v=>readableResult(v,depth+1))
 const v=object(value);return v?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,readableResult(x,depth+1)])):value
}
function resultFailed(value:Value):boolean{
 const v=object(value);if(!v)return false
 if(v.isError===true||v.oneNotExecuted===true)return true
 if(typeof v.result==='string'){try{return resultFailed(JSON.parse(v.result))}catch{}}
 return false
}
function dispatchReceipt(event:AuditEvent|undefined){
 const wrapper=object(event?.result),proof=object(wrapper?.oneDispatchProof)
 if(!proof||proof.status!=='verified'||typeof proof.profileHash!=='string'||!Array.isArray(proof.checks)||!Array.isArray(proof.quantumIds)||!proof.quantumIds.every(id=>typeof id==='string'))return null
 return {...atlasReceipt(event!.name??'',wrapper?.result),server:event!.server,quantum:proof as QuantumProof}
}
const save=(value:Value,name:string)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

/** Only mounted behind the server-verified test-lead permission. No shared page persistence. */
export function LiveAuditRuns({path,scope}:{path:string;scope:string}){
 const lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 const [live,setLive]=useState(true),[revision,setRevision]=useState(0),[selected,setSelected]=useState(''),[rows,setRows]=useState<Row[]>([]),[detail,setDetail]=useState<Detail|null>(null),[cursor,setCursor]=useState<string|null>(null),[before,setBefore]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[updated,setUpdated]=useState<number|null>(null)
 useEffect(()=>{setSelected('');setRows([]);setDetail(null);setBefore('');setCursor(null);setUpdated(null)},[scope])
 useEffect(()=>{
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,first=true
  const load=async()=>{
   if(first)setBusy(true)
   try{
    if(selected){const next=await cloudRequest<Detail>('GET',path+'?run='+encodeURIComponent(selected),undefined,{signal:abort.signal});if(!abort.signal.aborted)setDetail(next)}
    else{const next=await cloudRequest<{entries:Row[];nextCursor?:string|null}>('GET',path+'?runs=1'+(before?'&before='+encodeURIComponent(before):''),undefined,{signal:abort.signal});if(!abort.signal.aborted){setRows(previous=>before?[...new Map([...previous,...next.entries].map(x=>[x.auditId,x])).values()]:next.entries);setCursor(next.nextCursor??null)}}
    if(!abort.signal.aborted){setError('');setUpdated(Date.now())}
   }catch{if(!abort.signal.aborted)setError(tr('Live-Protokoll nicht erreichbar. Angezeigte Daten sind möglicherweise veraltet.','Live log unavailable. Displayed data may be stale.'))}
   finally{if(!abort.signal.aborted){setBusy(false);first=false;if(live)timer=setTimeout(()=>void load(),2000)}}
  }
  void load();return()=>{abort.abort();clearTimeout(timer)}
 },[path,scope,selected,before,revision,live,lang])
 const date=(n?:number|null)=>n?new Date(n).toLocaleString(lang==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'medium'}):'—'
 const state=(s:string)=>({running:tr('Läuft · Abschluss noch nicht belegt','Running · completion not yet recorded'),done:tr('Abgeschlossen','Completed'),failed:tr('Fehlgeschlagen','Failed'),cancelled:tr('Abgebrochen','Cancelled'),held:tr('Pausiert','Paused'),limit:tr('An Grenze gestoppt','Stopped at limit')}[s]??s)
 const run=detail?.run
 const calls=run?.events.filter(e=>['tool-call','tool-blocked'].includes(e.type))??[]
 const timeline=run?[...detail!.rounds.map((round,i)=>({kind:'model' as const,id:round.auditId,time:round.processingAt??round.receivedAt,round,index:i+1})),...calls.map(event=>({kind:'tool' as const,id:event.id,time:event.receivedAt,event}))].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)):[]
 const contents=(label:string,value:Value,open=false)=><details open={open||undefined}><summary>{label}</summary><pre>{pretty(value)}</pre></details>
 return <div className="frankfurt-live" data-testid="frankfurt-live">
  <div className="frankfurt-audit__toolbar">
   <label><input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)}/>{tr('Live verfolgen · alle 2 Sekunden','Follow live · every 2 seconds')}</label>
   <button className="btn btn--sm" disabled={busy} onClick={()=>setRevision(x=>x+1)}><RefreshCw size={14}/>{tr('Jetzt aktualisieren','Refresh now')}</button>
   <small role="status">{busy?tr('Wird geladen …','Loading …'):updated?tr('Stand: ','Updated: ')+date(updated):''}</small>
  </div>
  <p>{tr('Neue Tests werden pro Frage zusammengefasst. Modellrunden kommen direkt vom Frankfurter Gateway; Tool-Aufrufe und Ergebnisse meldet der ausführende ONE-Harness. Eine Modellanforderung allein belegt keine Ausführung.','New tests are grouped per question. Model rounds come directly from the Frankfurt gateway; the executing ONE harness reports tool calls and results. A model request alone does not prove execution.')}</p>
  {error&&<p role="alert">{error}</p>}
  {selected?<>
   <button className="btn btn--sm" onClick={()=>{setSelected('');setDetail(null)}}>{tr('Alle Live-Tests','All live tests')}</button>
   {run&&<>
    <header className="frankfurt-live__heading"><div><span className={'frankfurt-live__state'+(run.state==='running'?' is-running':'')}>{state(run.state)}</span><h4>{date(run.receivedAt)}</h4></div><button className="btn btn--sm" onClick={()=>save(detail,'atlas-flow-test-'+run.auditId+'.json')}><Download size={14}/>{tr('Diesen Test vollständig herunterladen','Download this entire test')}</button></header>
    <p className="frankfurt-audit__ids">{run.auditId}<br/>{run.request.model} · {detail!.rounds.length} {tr('Modellrunden','model rounds')} · {calls.filter(c=>c.name!=='compiled_task').length} {tr('Tool-Aufrufe','tool calls')}<br/>Workspace: {run.trace.workspace} · {tr('Ende','End')}: {date(run.finishedAt)}</p>
    <section className="frankfurt-live__prompt"><strong>{tr('Deine Anfrage','Your request')}</strong><pre>{run.request.prompt}</pre></section>
    {run.error&&<p role="alert">{run.error}</p>}
    {run.answer!==undefined&&<section className="frankfurt-live__answer"><strong>{tr('Von ONE ausgegebene Antwort','Answer displayed by ONE')}</strong><pre>{answerText(run.answer)}</pre></section>}
    <h4>{tr('Verlauf · Anfrage → Modell → Tools → Antwort','Timeline · request → model → tools → answer')}</h4>
    {timeline.map(item=>{
     if(item.kind==='model'){const r=item.round;return <article className="frankfurt-live__event" key={item.id} data-kind="model"><header><strong>{tr('Modellrunde','Model round')} {item.index}</strong><small>{date(item.time)}</small></header><p>{r.state} · HTTP {r.status??'—'} · {tr('Gateway-Beleg','Gateway receipt')}<br/>{tr('Antwort empfangen','Response received')}: {date(r.finishedAt)}</p>{r.error&&<p role="alert">{r.error}</p>}{contents(tr('Modellantwort / angeforderte Tools','Model response / requested tools'),modelReply(r.response),true)}{contents(tr('Vollständige Anfrage am Gateway','Complete request at gateway'),r.request)}{contents(tr('Tatsächlicher Modellkontext','Actual model context'),r.modelInput)}{contents(tr('Unveränderte rohe Antwort','Unmodified raw response'),r.response??'')}<small className="frankfurt-audit__ids">{r.auditId} · ONE job: {r.trace?.job??'—'}</small></article>}
     const e=item.event,returned=e.type==='tool-blocked'?e:run.events.find(r=>r.callId===e.callId&&['tool-result','tool-error'].includes(r.type)),failed=returned&&(['tool-error','tool-blocked'].includes(returned.type)||resultFailed(returned.result)),receipt=dispatchReceipt(returned)
     const task=e.server==='ONE'&&e.name==='compiled_task'&&object(object(returned?.result)?.compiled)?.protocol==='quandprofile.task.v1'?returned!.result as TaskReport:null
     if(task)return <article className="frankfurt-live__event" data-kind="compiler" key={item.id}><header><strong>{tr('Auftragscompiler · Host-Prüfung','Task compiler · host check')}</strong><small>{date(e.receivedAt)}</small></header><TaskContractCard report={task} historical/></article>
     return <article className="frankfurt-live__event" data-kind={failed?'error':'tool'} key={item.id}><header><strong>{e.server} · {e.name}</strong><small>{date(e.receivedAt)}</small></header><p>{returned?failed?tr('Tool-Fehler / blockiert','Tool error / blocked'):tr('Tool-Rückgabe empfangen','Tool result received'):tr('Aufruf begonnen · Rückgabe noch nicht belegt','Call started · result not yet recorded')} · ONE-Harness</p>{contents(tr('Übergebene Argumente','Submitted arguments'),e.arguments,true)}{returned&&contents(tr('Tatsächliche Rückgabe / Fehler','Actual result / error'),returned.error??readableResult(returned.result),true)}{receipt&&<AtlasFactsView receipt={receipt}/>} {returned&&<small>{tr('Rückgabe','Returned')}: {date(returned.receivedAt)} · {tr('JSON-Text zur Lesbarkeit entfaltet; Original im Download.','JSON text expanded for readability; originals in download.')}</small>}</article>
    })}
    {!timeline.length&&<p>{tr('Der Test ist erfasst; noch keine Modellrunde oder Tool-Ausführung angekommen.','Test recorded; no model round or tool execution has arrived yet.')}</p>}
    {run.state==='running'&&<p role="status">{tr('Warte auf weitere Ereignisse. Bei geschlossenem ONE-Tab kann der Abschlussbeleg fehlen.','Waiting for more events. Closing the ONE tab can leave completion unrecorded.')}</p>}
   </>}
  </>:<>
   {!busy&&!rows.length&&<p>{tr('Noch keine zusammengefassten Live-Tests. Starte jetzt eine neue Frage mit Atlas Flow · Frankfurt. Frühere Einzelrunden findest du unter „Modellrunden“.','No grouped live tests yet. Start a new question with Atlas Flow · Frankfurt. Earlier individual rounds remain under “Model rounds”.')}</p>}
   {rows.map(row=><button className="frankfurt-audit__row" key={row.auditId} onClick={()=>{setSelected(row.auditId);setDetail(null)}}><strong>{row.prompt}</strong><span>{state(row.state)} · {date(row.receivedAt)}</span><small>{row.auditId} · {row.events} {tr('Harness-Ereignisse','harness events')}</small></button>)}
   {cursor&&<button className="btn btn--sm" onClick={()=>setBefore(cursor)}>{tr('Ältere Tests laden','Load earlier tests')}</button>}
  </>}
 </div>
}
