import {useEffect,useMemo,useRef,useState} from 'react'
import type {Page} from '../../../store/types'
import {useLang} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {RouteChip} from '../../../features/ai/routing/RouteChip'
import type {Route} from '@/shared/ai/types'
import {pageRef} from '../../../features/ai/core/refs'
import {overviewSignature,kinds,type OverviewItem,type OverviewReview} from './model'
import {generateOverview,reviewOverview,adoptOverviewAction} from './run'
import './overview.css'
export function Overview({page,readOnly,onDocument,onGenerated}:{page:Page;readOnly:boolean;onDocument:(item?:OverviewItem)=>void;onGenerated:()=>void}){
 const de=useLang()==='de',labels=de?{summary:'Darum geht es',finding:'Wichtigste Erkenntnisse',decision:'Zu entscheiden',action:'Nächste Schritte',question:'Offene Fragen'}:{summary:'What this is about',finding:'Key findings',decision:'Decisions to make',action:'Next steps',question:'Open questions'}
 const [route,setRoute]=useState<Route|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[role,setRole]=useState(''),[focus,setFocus]=useState('all')
 const abort=useRef<AbortController|null>(null),mounted=useRef(true),sources=useMemo(()=>pageRef(page.id),[page.id])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort()}},[page.id])
 const saved=page.overview,signature=useMemo(()=>overviewSignature(page),[page.title,page.content]),stale=!!saved&&saved.signature!==signature
 const roles=[...new Set(saved?.items.map(i=>i.role).filter(Boolean)??[])]
 useEffect(()=>{setRole('');setFocus('all')},[saved?.at])
 const archived=Object.values(page.overviewReviews??{}).filter(r=>!saved?.items.some(i=>i.id===r.item.id))
 const generate=async()=>{
  if(busy)return;const c=new AbortController();abort.current=c;setBusy(true);setError('')
  try{await generateOverview(page.id,de?'de':'en',route,c.signal);if(mounted.current)onGenerated()}catch(e){if(mounted.current&&!c.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(mounted.current)setBusy(false)}
 }
 const action=(fn:()=>unknown)=>{try{fn();setError('')}catch(e){setError(e instanceof Error?e.message:String(e))}}
 const generation=<div className="overview-generation">
   {!readOnly&&<details className="overview-settings" open={saved?undefined:true}><summary>{de?'Modell und Datengrundlage':'Model and source scope'}</summary><RouteChip purpose="page.overview" chip={route} onChip={setRoute} sources={sources} reads={de?'Inhalt dieser Seite':'Content of this page'} disabled={busy}/><p className="overview-scope">{de?'Grundlage: Text dieser Seite. Verlinkte Seiten, Atlas-Quellen und Anhänge werden nicht neu gelesen.':'Source: text on this page. Linked pages, Atlas sources and attachments are not read again.'}</p></details>}
   <div className="overview-actions">
    {!readOnly&&<button className="btn" disabled={busy} onClick={()=>void generate()}>{saved?(de?'Überblick aktualisieren':'Update overview'):(de?'Überblick erstellen':'Create overview')}</button>}
    {busy&&<button className="btn btn--ghost" onClick={()=>abort.current?.abort()}>{de?'Abbrechen':'Cancel'}</button>}
    <button className="btn btn--ghost" onClick={()=>onDocument()}>{de?'Dokument öffnen':'Open document'}</button>
   </div>
   {readOnly&&<p className="overview-scope">{de?'Grundlage: Text dieser Seite; verlinkte Quellen wurden nicht neu gelesen.':'Source: text on this page; linked sources were not read again.'}</p>}
   {saved&&<p className="overview-date">{de?'Erstellt am ':'Created on '}{new Date(saved.at).toLocaleString(de?'de-DE':'en-GB')} · {saved.language==='de'?'Deutsch':'English'}</p>}
  </div>
 return <section className="page-overview" aria-label={de?'Seitenüberblick':'Page overview'}>
  {!saved&&<div className="overview-intro"><span className="label">{de?'VERSTEHEN · ENTSCHEIDEN · HANDELN':'UNDERSTAND · DECIDE · ACT'}</span><h2>{de?'Das Wesentliche. Der nächste Schritt.':'What matters. What comes next.'}</h2><p>{de?'Ein kurzer Einstieg mit direkten Verweisen ins Dokument. Entscheidungen und Schritte bleiben Vorschläge, bis du sie übernimmst.':'A short introduction with direct links into the document. Decisions and actions remain proposals until you adopt them.'}</p></div>}
  {!saved&&generation}
  {saved&&<p className="overview-meta">{de?'KI-Entwurf · Entscheidungen bleiben beim Team':'AI draft · Decisions remain with the team'}</p>}
  {busy&&<p role="status">{de?'Überblick wird erstellt und mit den Quellenstellen abgeglichen …':'Creating the overview and checking its source passages …'}</p>}
  {error&&<p className="overview-warning" role="alert">{error}</p>}
  {stale&&<p className="overview-warning" role="status">{de?'Die Seite wurde geändert. Dieser Überblick zeigt einen älteren Stand. Aktualisiere ihn, bevor du Entscheidungen oder Schritte übernimmst.':'The page changed. This overview shows an older version. Update it before adopting decisions or actions.'}</p>}
  {!saved&&!busy&&<div className="overview-empty"><h3>{de?'Die Details bekommen einen verständlichen Einstieg.':'Give the details a clear introduction.'}</h3><p>{de?'One fasst zusammen, zeigt offene Entscheidungen und schlägt nächste Schritte vor. Du bestimmst, was daraus wird. Der Dokumenttext bleibt erhalten.':'One summarizes, surfaces open decisions and suggests next steps. You decide what to adopt. The document text is preserved.'}</p>{readOnly&&<p>{de?'Eine Person mit Bearbeitungsrechten kann den Überblick erstellen.':'An editor can create this overview.'}</p>}</div>}
  {saved&&<>
   <details className="overview-filter-menu"><summary>{de?'Ansicht filtern':'Filter view'}</summary><div className="overview-filters"><label>{de?'Anzeigen':'Show'}<select value={focus} onChange={e=>setFocus(e.target.value)}><option value="all">{de?'Alles':'Everything'}</option>{kinds.filter(k=>saved.items.some(i=>i.kind===k)).map(k=><option key={k} value={k}>{labels[k]} ({saved.items.filter(i=>i.kind===k).length})</option>)}</select></label>{roles.length>0&&<label>{de?'Verantwortungsbereich':'Area of responsibility'}<select value={role} onChange={e=>setRole(e.target.value)}><option value="">{de?'Alle Rollen':'All roles'}</option>{roles.map(r=><option key={r}>{r}</option>)}</select></label>}</div></details>
   {kinds.map(kind=>{const items=saved.items.filter(i=>i.kind===kind&&(focus==='all'||focus===kind)&&(!role||i.kind==='summary'||i.role===role));return items.length?<section className="overview-section" key={kind}><h3>{labels[kind]} <span>{items.length}</span></h3>{items.map(item=><OverviewCard key={item.id} item={item} review={page.overviewReviews?.[item.id]} signature={signature} readOnly={readOnly||stale} onSource={()=>onDocument(item)} onReview={(state,note,owner)=>action(()=>reviewOverview(page.id,item,state,note,owner))} onAdopt={()=>action(()=>adoptOverviewAction(page.id,item))}/>)}</section>:null})}
   {archived.length>0&&<section className="overview-section"><h3>{de?'Festgehaltene Punkte aus früheren Überblicken':'Recorded items from earlier overviews'}</h3><p>{de?'Diese Einträge bleiben erhalten und sollten mit dem aktuellen Dokument abgeglichen werden.':'These entries are retained and should be checked against the current document.'}</p>{archived.map(r=><OverviewCard key={r.item.id} item={r.item} review={r} signature={signature} readOnly onSource={()=>onDocument(r.item)} onReview={()=>{}} onAdopt={()=>{}}/>)}</section>}
   {generation}
  </>}
 </section>
}
function OverviewCard({item,review,signature,readOnly,onSource,onReview,onAdopt}:{item:OverviewItem;review?:OverviewReview;signature:string;readOnly:boolean;onSource:()=>void;onReview:(state:OverviewReview['state'],note:string,owner:string)=>void;onAdopt:()=>void}){
 const de=useLang()==='de',[open,setOpen]=useState(false),[editingAt,setEditingAt]=useState(review?.at),[note,setNote]=useState(review?.note??''),[owner,setOwner]=useState(review?.owner??'')
 const task=useWorkspace(s=>review?.taskId?s.pages[review.taskId]:undefined),reviewOld=review&&(review.signature!==signature||JSON.stringify(review.item)!==JSON.stringify(item))
 const conflict=open&&editingAt!==review?.at
 useEffect(()=>{if(!open){setNote(review?.note??'');setOwner(review?.owner??'');setEditingAt(review?.at)}},[review?.at,open])
 return <article className="overview-card" data-kind={item.kind}>
  <div className="overview-card-head"><h4>{item.title}</h4>{review&&<span className="overview-status">{review.state==='confirmed'?(de?'Festgehalten':'Recorded'):review.state==='deferred'?(de?'Zurückgestellt':'Deferred'):(de?'Rückfrage':'Question')}</span>}</div>
  <p>{item.detail}</p>
  {!!item.role&&<p className="overview-meta">{de?'Vorgeschlagener Verantwortungsbereich: ':'Suggested area of responsibility: '}{item.role}</p>}
  {item.options.length>0&&<ul>{item.options.map((option,i)=><li key={i}>{option}</li>)}</ul>}
  {item.doneWhen&&<p><strong>{de?'Erledigt, wenn: ':'Done when: '}</strong>{item.doneWhen}</p>}
  {review&&<div className="overview-record"><p>{review.note|| (review.state==='confirmed'?(de?'Übernommen.':'Adopted.'):review.state==='deferred'?(de?'Zurückgestellt.':'Deferred.'):(de?'Klärung offen.':'Clarification pending.'))}</p><p className="overview-meta">{review.by} · {new Date(review.at).toLocaleString(de?'de-DE':'en-GB')}</p>{review.owner&&<p>{de?'Verantwortlich: ':'Responsible: '}{review.owner}</p>}{reviewOld&&<p className="overview-warning">{de?'Erneute Prüfung nötig: Die Grundlage oder der Vorschlag hat sich geändert.':'Review needed: the source or proposal has changed.'}</p>}</div>}
  <details><summary>{de?'Quellenstelle':'Source passage'}</summary><blockquote>{item.quote}</blockquote><button className="btn btn--sm" onClick={onSource}>{de?'Stelle im Dokument zeigen':'Show passage in document'}</button></details>
  {task&&<a className="btn btn--sm" href={'#/p/'+task.id}>{task.trashed?(de?'Aufgabe im Papierkorb öffnen':'Open task in trash'):(de?'Übernommene Aufgabe öffnen':'Open adopted task')}</a>}
  {!readOnly&&['decision','action','question'].includes(item.kind)&&<div className="overview-actions"><button className="btn btn--sm" aria-expanded={open} onClick={()=>{setEditingAt(review?.at);setOpen(!open)}}>{de?'Prüfen und festhalten':'Review and record'}</button>{item.kind==='action'&&!task&&<button className="btn btn--sm" onClick={onAdopt}>{de?'Als Aufgabe übernehmen':'Adopt as task'}</button>}</div>}
  {open&&!readOnly&&<div className="overview-review">{conflict&&<p className="overview-warning" role="alert">{de?'Dieser Punkt wurde inzwischen geändert. Deine Eingabe bleibt hier erhalten. Schließe die Bearbeitung und öffne sie erneut, um den gespeicherten Stand zu laden.':'This item changed while you were editing. Your input is kept here. Close and reopen the editor to load the saved version.'}</p>}<label>{de?'Entscheidung oder Rückmeldung':'Decision or feedback'}<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder={de?'Was wurde entschieden oder muss geklärt werden?':'What was decided or needs clarification?'}/></label><label>{de?'Verantwortlich (optional)':'Responsible (optional)'}<input maxLength={200} value={owner} onChange={e=>setOwner(e.target.value)}/></label><div className="overview-actions">{(['confirmed','deferred','question'] as const).map(state=><button key={state} className="btn btn--sm" disabled={conflict||state==='confirmed'&&item.kind==='decision'&&!note.trim()} onClick={()=>{onReview(state,note,owner);setOpen(false)}}>{state==='confirmed'?(de?'Bestätigen':'Confirm'):state==='deferred'?(de?'Zurückstellen':'Defer'):(de?'Rückfrage festhalten':'Record question')}</button>)}</div><p className="overview-meta">{de?'Wird auf dieser Seite festgehalten. Es wird keine Nachricht versendet.':'Recorded on this page. No message is sent.'}</p></div>}
 </article>
}
