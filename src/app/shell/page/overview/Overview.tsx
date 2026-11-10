import {TemplatePicker,TemplateView} from './TemplateView'
import {TemplateSources} from './TemplateSources'
import {type OverviewTemplate} from './templates'
import {overviewEligible} from './model'
import {adoptOverviewDraft,type OverviewDraft} from './run'
import {createOverviewDesk} from './templateDesk'
import {DeskEntry} from '../../../features'
import {MiniCards} from './MiniCards'
import {ScopePicker,useOverviewSources} from './ScopePicker'
import {trackingId,trackedRow,trackOverviewItems} from './tracking'
import {useEffect,useMemo,useRef,useState} from 'react'
import type {Page} from '../../../store/types'
import {useLang} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {RouteChip} from '../../../features/ai/routing/RouteChip'
import type {Route} from '@/shared/ai/types'
import {pageRef} from '../../../features/ai/core/refs'
import {currentOverviewSignature,overviewChildren,kinds,type OverviewItem,type OverviewReview} from './model'
import {generateOverview,reviewOverview,adoptOverviewAction,type OverviewProgress} from './run'
import './overview.css'
export function Overview({page,readOnly,onDocument,presentation='overview',preferenceKey}:{page:Page;readOnly:boolean;onDocument:(item?:OverviewItem)=>void;presentation?:'overview'|'mini';preferenceKey:string}){
 const de=useLang()==='de',labels=de?{summary:'Darum geht es',finding:'Wichtigste Erkenntnisse',decision:'Zu entscheiden',action:'Nächste Schritte',question:'Offene Fragen'}:{summary:'What this is about',finding:'Key findings',decision:'Decisions to make',action:'Next steps',question:'Open questions'}
 const [template,setTemplate]=useState<OverviewTemplate|null>(page.overview?.template??null),[draft,setDraft]=useState<OverviewDraft|null>(null),[adopting,setAdopting]=useState(false)
 const [route,setRoute]=useState<Route|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[role,setRole]=useState(''),[focus,setFocus]=useState('all')
 const pages=useWorkspace(s=>s.pages)
 const [selectedPages,setSelectedPages]=useState<string[]>(()=>page.overview?.sourcePages?.filter(p=>p.id!==page.id).map(p=>p.id)??[])
 const [marked,setMarked]=useState<string[]>([]),[notice,setNotice]=useState('')
 const eligible=useMemo(()=>overviewEligible(page,pages),[page,pages])
 const childPages=useMemo(()=>overviewChildren(page,pages),[page,pages])
 const scopeState=useOverviewSources(page.overview?.sourcePages?.filter(p=>p.id!==page.id).map(p=>p.id)??[])
 const followUp=pages[trackingId(page.id)],hasFollowUp=followUp?.overviewFollowUp?.pageId===page.id
 const [progress,setProgress]=useState<OverviewProgress>({phase:'preparing',items:[]})
 const abort=useRef<AbortController|null>(null),mounted=useRef(true),sources=useMemo(()=>[page.id,...selectedPages].flatMap(id=>pageRef(id)),[page.id,selectedPages])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort()}},[page.id])
 const saved=page.overview,signature=useMemo(()=>currentOverviewSignature(page,pages),[page,pages]),stale=!!saved&&saved.signature!==signature
 const roles=[...new Set(saved?.items.map(i=>i.role).filter(Boolean)??[])]
 useEffect(()=>{setRole('');setFocus('all');setMarked([])},[saved?.at,signature])
 useEffect(()=>{setSelectedPages(saved?.sourcePages?.filter(p=>p.id!==page.id).map(p=>p.id)??[])},[page.id,saved?.at])
 useEffect(()=>{setTemplate(saved?.template??null);setDraft(null)},[page.id,saved?.at])
 useEffect(()=>{if(readOnly)abort.current?.abort()},[readOnly])
 const archived=Object.values(page.overviewReviews??{}).filter(r=>!saved?.items.some(i=>i.id===r.item.id))
 const generate=async()=>{
  if(busy)return;const c=new AbortController();abort.current=c;setBusy(true);setDraft(null);setError('');setNotice('');setProgress({phase:'preparing',items:[]})
  try{const next=await generateOverview(page.id,de?'de':'en',route,c.signal,p=>{if(mounted.current&&!c.signal.aborted)setProgress(p)},selectedPages,template??undefined);if(mounted.current&&!c.signal.aborted&&next)setDraft(next)}catch(e){if(mounted.current&&!c.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(mounted.current)setBusy(false)}
 }
 const action=(fn:()=>unknown)=>{try{fn();setError('')}catch(e){setError(e instanceof Error?e.message:String(e))}}
 const adopt=async()=>{if(!draft)return;const c=new AbortController();abort.current=c;setAdopting(true);setError('');try{await adoptOverviewDraft(page.id,draft,c.signal);if(mounted.current)setDraft(null)}catch(e){if(mounted.current&&!c.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(mounted.current)setAdopting(false)}}
 const handoff=async(present:boolean)=>{const c=new AbortController();abort.current=c;setAdopting(true);setError('');try{const id=await createOverviewDesk(page.id,present,c.signal);window.location.hash='#/p/'+encodeURIComponent(id)+(present?'?desk=present':'')}catch(e){if(mounted.current&&!c.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(mounted.current)setAdopting(false)}}
 const mini=presentation==='mini'
 const renderItem=(item:OverviewItem)=><OverviewCard key={item.id} deskPageId={page.id} item={item} review={page.overviewReviews?.[item.id]} signature={signature} readOnly={readOnly||stale||busy||!scopeState.ready} selected={marked.includes(item.id)} onSelect={checked=>{setNotice('');setMarked(current=>checked?[...new Set([...current,item.id])]:current.filter(id=>id!==item.id))}} tracked={trackedRow(pages,page.id,item.id)} onSource={()=>onDocument(item)} onReview={(state,note,owner)=>action(()=>reviewOverview(page.id,item,state,note,owner))} onAdopt={()=>action(()=>adoptOverviewAction(page.id,item))}/>
 const generation=<div className="overview-generation">
   {!readOnly&&!template&&<ScopePicker children={childPages} selected={selectedPages} onChange={setSelectedPages} disabled={busy} de={de}/>}
   {!readOnly&&<details className="overview-settings" open={saved?undefined:true}><summary>{de?'Modell und Datengrundlage':'Model and source scope'}</summary><RouteChip purpose="page.overview" chip={route} onChip={setRoute} sources={sources} reads={de?`${selectedPages.length+1} ausgewählte Seiten`:`${selectedPages.length+1} selected pages`} disabled={busy}/><p className="overview-scope">{de?'Grundlage: Text dieser Seite und der ausgewählten Quellseiten. Weitere verlinkte Seiten, Atlas-Quellen und Anhänge werden nicht neu gelesen.':'Source: text on this page and the selected source pages. Other linked pages, Atlas sources and attachments are not read again.'}</p></details>}
   <div className="overview-actions">
    {!readOnly&&<button className="btn" disabled={busy||adopting||!!draft||selectedPages.length>30} onClick={()=>void generate()}>{template?(de?'Mit KI aufbereiten':'Prepare with AI'):saved?(de?'Überblick aktualisieren':'Update overview'):(de?'Überblick erstellen':'Create overview')}</button>}
    <button className="btn btn--ghost" onClick={()=>onDocument()}>{de?'Dokument öffnen':'Open document'}</button>
   </div>
   {readOnly&&<p className="overview-scope">{de?'Grundlage: die gespeicherte Seitenauswahl; externe Quellen wurden nicht neu gelesen.':'Source: the saved page selection; external sources were not read again.'}</p>}
   {saved&&<p className="overview-date">{de?'Erstellt am ':'Created on '}{new Date(saved.at).toLocaleString(de?'de-DE':'en-GB')} · {saved.language==='de'?'Deutsch':'English'}</p>}
  </div>
 return <section className="page-overview" data-templated={!!saved?.template||undefined} aria-label={mini?'Mini Cards':de?'Seitenüberblick':'Page overview'}>
  {!readOnly&&<details className="overview-template-config" open={saved?undefined:true}><summary>{de?'Vorlagen & Quellen':'Templates & sources'}</summary>
   <TemplatePicker value={template} disabled={busy||adopting} de={de} onChange={value=>{setTemplate(value);setDraft(null);setError('');if(!value)setSelectedPages(ids=>ids.filter(id=>childPages.some(p=>p.id===id)))}}/>
   {template&&<><TemplateSources root={page} pages={eligible} selected={selectedPages} onChange={ids=>{setSelectedPages(ids);setDraft(null)}} disabled={busy||adopting} de={de}/>{generation}</>}
  </details>}
  {template&&!saved&&!draft&&!busy&&<TemplateView template={template} de={de} renderItem={()=>null}/>}
  {draft&&<section className="overview-template-draft" aria-label={de?'Vorlagenvorschau':'Template preview'}><h3>{de?'Dein Entwurf ist bereit':'Your draft is ready'}</h3><p className="overview-meta">{de?'Noch nicht gespeichert. Prüfe Aussagen und Quellen; dein bisheriger Überblick bleibt bis zur Übernahme erhalten.':'Not saved yet. Review the statements and sources; your previous overview stays until you adopt this draft.'}</p><div className="overview-actions"><button className="btn" disabled={adopting||readOnly} onClick={()=>void adopt()}>{de?'Vorlage übernehmen':'Adopt template'}</button><button className="btn btn--ghost" disabled={adopting} onClick={()=>setDraft(null)}>{de?'Entwurf verwerfen':'Discard draft'}</button></div><TemplateView template={draft.overview.template!} overview={draft.overview} de={de} renderItem={item=><OverviewCard item={item} signature={signature} readOnly onSource={()=>onDocument(item)} onReview={()=>{}} onAdopt={()=>{}}/>}/></section>}
  {mini&&!saved&&<p className="overview-meta">{de?'Mini Cards verdichtet den Überblick dieser Seite. Erstelle einmal den Überblick; danach kannst du die Kartengröße ohne neue KI-Anfrage wechseln.':'Mini Cards condenses this page’s overview. Create the overview once; resizing cards needs no new AI request.'}</p>}
  {!saved&&!busy&&!template&&<div className="overview-intro"><span className="label">{de?'VERSTEHEN · ENTSCHEIDEN · HANDELN':'UNDERSTAND · DECIDE · ACT'}</span><h2>{de?'Das Wesentliche. Der nächste Schritt.':'What matters. What comes next.'}</h2><p>{de?'Ein kurzer Einstieg mit direkten Verweisen ins Dokument. Entscheidungen und Schritte bleiben Vorschläge, bis du sie übernimmst.':'A short introduction with direct links into the document. Decisions and actions remain proposals until you adopt them.'}</p></div>}
  {!saved&&!busy&&!template&&generation}
  {saved&&<p className="overview-meta">{de?'KI-Entwurf · Entscheidungen bleiben beim Team':'AI draft · Decisions remain with the team'}</p>}
  {busy&&<>
   <GenerationProgress progress={progress} de={de} previewOnly={!!template} onCancel={()=>abort.current?.abort()} onDocument={()=>onDocument()}/>
   {progress.items.length>0&&<section className="overview-preview" aria-label={de?'Erste Ergebnisse':'First results'}>
    <h3>{de?'Schon lesbar':'Ready to read'}</h3><p className="overview-meta">{de?'Vorläufiger Entwurf · Quellenstellen passen zum gelesenen Seitenstand. Die Gesamtprüfung und Speicherung stehen noch aus.':'Provisional draft · Source passages match the page snapshot. Final checks and saving are still pending.'}</p>
    {progress.items.map(item=><OverviewCard key={item.id} item={item} signature={signature} readOnly onReview={()=>{}} onAdopt={()=>{}}/>)}
   </section>}
   {saved&&<h3>{de?'Bisher gespeicherter Überblick':'Previously saved overview'}</h3>}
  </>}
  {saved?.sourcePages&&<details className="overview-source-list"><summary>{de?`Grundlage: ${saved.sourcePages.length} Seiten`:`Sources: ${saved.sourcePages.length} pages`}</summary><ul>{saved.sourcePages.map(p=><li key={p.id}><a href={'#/p/'+encodeURIComponent(p.id)}>{p.title}</a></li>)}</ul></details>}
  {saved&&!scopeState.ready&&<p className="overview-warning" role="status">{scopeState.failed?(de?'Die Quellseiten konnten nicht geladen werden. Bitte Verbindung prüfen und die Seite erneut öffnen.':'The source pages could not be loaded. Check the connection and reopen the page.'):(de?'Der aktuelle Stand der Quellseiten wird geladen …':'Loading the current source pages …')}</p>}
  {error&&<p className="overview-warning" role="alert">{error}</p>}
  {stale&&<p className="overview-warning" role="status">{de?'Die Seite wurde geändert. Dieser Überblick zeigt einen älteren Stand. Aktualisiere ihn, bevor du Entscheidungen oder Schritte übernimmst.':'The page changed. This overview shows an older version. Update it before adopting decisions or actions.'}</p>}
  {!saved&&!busy&&!template&&<div className="overview-empty"><h3>{de?'Die Details bekommen einen verständlichen Einstieg.':'Give the details a clear introduction.'}</h3><p>{de?'One fasst zusammen, zeigt offene Entscheidungen und schlägt nächste Schritte vor. Du bestimmst, was daraus wird. Der Dokumenttext bleibt erhalten.':'One summarizes, surfaces open decisions and suggests next steps. You decide what to adopt. The document text is preserved.'}</p>{readOnly&&<p>{de?'Eine Person mit Bearbeitungsrechten kann den Überblick erstellen.':'An editor can create this overview.'}</p>}</div>}
  {saved&&!draft&&<>
   <div className="overview-tools">
   <details className="overview-tracking-intro">
    <summary>{de?'Punkte nachverfolgen':'Track items'}</summary>
    <p className="overview-meta">{hasFollowUp?(de?'Deine gesammelten Punkte liegen in der Unterseite „Nachverfolgung“. Dort pflegst du Status, Verantwortliche und Fälligkeit.':'Your collected items are in the “Follow-up” subpage, with status, owners and due dates.'):(de?'Markiere Karten und klicke auf „Auswahl nachverfolgen“. Damit legst du die Unterseite „Nachverfolgung“ mit deinen Punkten an.':'Select cards, then click “Track selected” to create the “Follow-up” subpage with your items.')}</p>
   </details>
   <details className="overview-filter-menu"><summary>{de?'Ansicht filtern':'Filter view'}</summary><div className="overview-filters"><label>{de?'Anzeigen':'Show'}<select value={focus} onChange={e=>setFocus(e.target.value)}><option value="all">{de?'Alles':'Everything'}</option>{kinds.filter(k=>saved.items.some(i=>i.kind===k)).map(k=><option key={k} value={k}>{labels[k]} ({saved.items.filter(i=>i.kind===k).length})</option>)}</select></label>{roles.length>0&&<label>{de?'Verantwortungsbereich':'Area of responsibility'}<select value={role} onChange={e=>setRole(e.target.value)}><option value="">{de?'Alle Rollen':'All roles'}</option>{roles.map(r=><option key={r}>{r}</option>)}</select></label>}</div></details>
   </div>
   {marked.length>0&&<div className="overview-tracking" role="region" aria-label={de?'Nachverfolgung':'Follow-up'}>
    <div className="overview-tracking-state">
     <span>{de?`${marked.length} ausgewählt · noch nicht hinzugefügt`:`${marked.length} selected · not added yet`}</span>
     {notice&&<span className="overview-notice" role="status">{notice}</span>}
    </div>
    <div className="overview-actions">{!readOnly&&<button className="btn btn--sm" disabled={!marked.length||stale||busy||!scopeState.ready} onClick={()=>action(()=>{trackOverviewItems(page.id,marked);setNotice(de?`${marked.length} Punkte hinzugefügt.`:`${marked.length} items added.`);setMarked([])})}>{de?`Auswahl nachverfolgen (${marked.length})`:`Track selected (${marked.length})`}</button>}{hasFollowUp&&<a className="btn btn--sm" href={'#/p/'+followUp.id}>{de?'Nachverfolgung öffnen':'Open follow-up'}</a>}</div>
   </div>}
   {notice&&marked.length===0&&<p className="overview-notice" role="status">{notice} {hasFollowUp&&<a href={'#/p/'+followUp.id}>{de?'Nachverfolgung öffnen':'Open follow-up'}</a>}</p>}
   {saved.template&&<><TemplateView overview={{...saved,items:saved.items.filter(i=>(focus==='all'||focus===i.kind)&&(!role||i.kind==='summary'||i.role===role))}} template={saved.template} de={de} renderItem={renderItem}/><div className="overview-template-handoff"><span className="overview-meta">{de?'Mit diesen Inhalten weiterarbeiten':'Continue with these contents'}</span><button className="btn btn--sm" disabled={readOnly||stale||busy||adopting||!scopeState.ready} onClick={()=>void handoff(false)}>{de?'Als Denkraum öffnen':'Open as thinking desk'}</button><button className="btn btn--sm" disabled={readOnly||stale||busy||adopting||!scopeState.ready} onClick={()=>void handoff(true)}>{de?'Als Präsentation öffnen':'Open as presentation'}</button></div></>}
   {saved.template?(mini?<details><summary>{de?'Mini-Cards öffnen':'Open mini cards'}</summary><MiniCards items={saved.items} labels={labels} pageId={page.id} preferenceKey={preferenceKey} reviews={page.overviewReviews} isTracked={item=>!!trackedRow(pages,page.id,item.id)} renderItem={renderItem}/></details>:null):mini?<MiniCards items={saved.items.filter(i=>(focus==='all'||focus===i.kind)&&(!role||i.kind==='summary'||i.role===role))} labels={labels} pageId={page.id} preferenceKey={preferenceKey} reviews={page.overviewReviews} isTracked={item=>!!trackedRow(pages,page.id,item.id)} renderItem={renderItem}/>:kinds.map(kind=>{const items=saved.items.filter(i=>i.kind===kind&&(focus==='all'||focus===kind)&&(!role||i.kind==='summary'||i.role===role));return items.length?<section className="overview-section" data-section={kind} key={kind}><h3>{labels[kind]} <span>{String(items.length).padStart(2,'0')}</span></h3><div className="overview-entries">{items.map(renderItem)}</div></section>:null})}
   {archived.length>0&&<section className="overview-section"><h3>{de?'Festgehaltene Punkte aus früheren Überblicken':'Recorded items from earlier overviews'}</h3><p>{de?'Diese Einträge bleiben erhalten und sollten mit dem aktuellen Dokument abgeglichen werden.':'These entries are retained and should be checked against the current document.'}</p>{archived.map(r=><OverviewCard key={r.item.id} item={r.item} review={r} signature={signature} readOnly onSource={()=>onDocument(r.item)} onReview={()=>{}} onAdopt={()=>{}}/>)}</section>}
   {!busy&&!template&&generation}
  </>}
 </section>
}
function OverviewCard({item,deskPageId,review,signature,readOnly,onSource,onReview,onAdopt,selected,onSelect,tracked}:{item:OverviewItem;deskPageId?:string;review?:OverviewReview;signature:string;readOnly:boolean;onSource?:()=>void;onReview:(state:OverviewReview['state'],note:string,owner:string)=>void;onAdopt:()=>void;selected?:boolean;onSelect?:(checked:boolean)=>void;tracked?:Page}){
 const de=useLang()==='de',[open,setOpen]=useState(false),[editingAt,setEditingAt]=useState(review?.at),[note,setNote]=useState(review?.note??''),[owner,setOwner]=useState(review?.owner??'')
 const task=useWorkspace(s=>review?.taskId?s.pages[review.taskId]:undefined),reviewOld=review&&(review.signature!==signature||JSON.stringify(review.item)!==JSON.stringify(item))
 const conflict=open&&editingAt!==review?.at
 useEffect(()=>{if(!open){setNote(review?.note??'');setOwner(review?.owner??'');setEditingAt(review?.at)}},[review?.at,open])
 return <article className="overview-card" data-kind={item.kind} data-selected={!!selected}>
  <div className="overview-card-head">
   <h4>{item.title}</h4>
   <div className="overview-card-controls">
    {review&&<span className="overview-status">{review.state==='confirmed'?(de?'Festgehalten':'Recorded'):review.state==='deferred'?(de?'Zurückgestellt':'Deferred'):(de?'Rückfrage':'Question')}</span>}
    {onSelect&&!readOnly&&!tracked&&<label className="overview-pick" title={de?'Für Nachverfolgung auswählen':'Select for follow-up'}><input type="checkbox" aria-label={de?`${selected?'Ausgewählt':'Merken'} – Für Nachverfolgung auswählen`:`${selected?'Selected':'Track'} – Select for follow-up`} checked={!!selected} onChange={e=>onSelect(e.target.checked)}/><span>{selected?(de?'Ausgewählt':'Selected'):(de?'Merken':'Track')}</span></label>}
    {tracked&&<a className="overview-tracked" href={'#/p/'+tracked.id} aria-label={tracked.trashed?(de?'Nachverfolgten Punkt im Papierkorb öffnen':'Open tracked item in trash'):(de?'In Nachverfolgung öffnen':'Open tracked item')}>{tracked.trashed?(de?'Im Papierkorb ↗':'In trash ↗'):(de?'Nachverfolgung ↗':'Tracked ↗')}</a>}
   </div>
  </div>
  <p>{item.detail}</p>
  {deskPageId&&!readOnly&&<DeskEntry pageId={deskPageId} item={item}/>}
  {!!item.role&&<p className="overview-meta">{de?'Vorgeschlagener Verantwortungsbereich: ':'Suggested area of responsibility: '}{item.role}</p>}
  {item.options.length>0&&<ul>{item.options.map((option,i)=><li key={i}>{option}</li>)}</ul>}
  {item.doneWhen&&<p><strong>{de?'Erledigt, wenn: ':'Done when: '}</strong>{item.doneWhen}</p>}
  {review&&<div className="overview-record"><p>{review.note|| (review.state==='confirmed'?(de?'Übernommen.':'Adopted.'):review.state==='deferred'?(de?'Zurückgestellt.':'Deferred.'):(de?'Klärung offen.':'Clarification pending.'))}</p><p className="overview-meta">{review.by} · {new Date(review.at).toLocaleString(de?'de-DE':'en-GB')}</p>{review.owner&&<p>{de?'Verantwortlich: ':'Responsible: '}{review.owner}</p>}{reviewOld&&<p className="overview-warning">{de?'Erneute Prüfung nötig: Die Grundlage oder der Vorschlag hat sich geändert.':'Review needed: the source or proposal has changed.'}</p>}</div>}
  <div className="overview-evidence"><details><summary>{de?'Quellenstelle':'Source passage'}</summary>{item.sourcePageTitle&&<p className="overview-meta">{item.sourcePageTitle}</p>}<blockquote>{item.quote}</blockquote></details>{onSource&&<button className="btn btn--sm btn--ghost overview-source-link" onClick={onSource} aria-label={de?'Stelle im Dokument zeigen':'Show passage in document'}>{de?'Im Dokument zeigen ↗':'Show in document ↗'}</button>}</div>
  {task&&<a className="btn btn--sm" href={'#/p/'+task.id}>{task.trashed?(de?'Aufgabe im Papierkorb öffnen':'Open task in trash'):(de?'Übernommene Aufgabe öffnen':'Open adopted task')}</a>}
  {!readOnly&&['decision','action','question'].includes(item.kind)&&<div className="overview-actions"><button className="btn btn--sm" aria-expanded={open} onClick={()=>{setEditingAt(review?.at);setOpen(!open)}}>{de?'Prüfen und festhalten':'Review and record'}</button>{item.kind==='action'&&!task&&<button className="btn btn--sm" onClick={onAdopt}>{de?'Als Aufgabe übernehmen':'Adopt as task'}</button>}</div>}
  {open&&!readOnly&&<div className="overview-review">{conflict&&<p className="overview-warning" role="alert">{de?'Dieser Punkt wurde inzwischen geändert. Deine Eingabe bleibt hier erhalten. Schließe die Bearbeitung und öffne sie erneut, um den gespeicherten Stand zu laden.':'This item changed while you were editing. Your input is kept here. Close and reopen the editor to load the saved version.'}</p>}<label>{de?'Entscheidung oder Rückmeldung':'Decision or feedback'}<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder={de?'Was wurde entschieden oder muss geklärt werden?':'What was decided or needs clarification?'}/></label><label>{de?'Verantwortlich (optional)':'Responsible (optional)'}<input maxLength={200} value={owner} onChange={e=>setOwner(e.target.value)}/></label><div className="overview-actions">{(['confirmed','deferred','question'] as const).map(state=><button key={state} className="btn btn--sm" disabled={conflict||state==='confirmed'&&item.kind==='decision'&&!note.trim()} onClick={()=>{onReview(state,note,owner);setOpen(false)}}>{state==='confirmed'?(de?'Bestätigen':'Confirm'):state==='deferred'?(de?'Zurückstellen':'Defer'):(de?'Rückfrage festhalten':'Record question')}</button>)}</div><p className="overview-meta">{de?'Wird auf dieser Seite festgehalten. Es wird keine Nachricht versendet.':'Recorded on this page. No message is sent.'}</p></div>}
 </article>
}

function GenerationProgress({progress,de,onCancel,onDocument,previewOnly=false}:{progress:OverviewProgress;de:boolean;previewOnly?:boolean;onCancel:()=>void;onDocument:()=>void}){
 const [started]=useState(()=>Date.now()),[now,setNow]=useState(()=>Date.now())
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
 const seconds=Math.max(0,Math.floor((now-started)/1000)),elapsed=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`
 const steps=de?['Seite vorbereiten','Auf Modellantwort warten','Karten entstehen',previewOnly?'Entwurf prüfen':'Gesamtprüfung und Speichern']:['Prepare page','Wait for model response','Build cards',previewOnly?'Check draft':'Final checks and save']
 const stage=['preparing','waiting','receiving','checking'].indexOf(progress.phase)
 return <div className="overview-progress">
  <div className="overview-progress-head"><strong role="status">{steps[stage]}{progress.items.length>0?` · ${progress.items.length} ${de?(progress.items.length===1?'Karte lesbar':'Karten lesbar'):(progress.items.length===1?'card ready':'cards ready')}`:''}</strong><span role="timer" aria-live="off">{elapsed}</span></div>
  <ol aria-label={de?'Fortschritt':'Progress'}>{steps.map((step,i)=><li key={step} aria-current={i===stage?'step':undefined} data-complete={i<stage}>{i<stage?'✓':i+1} · {step}</li>)}</ol>
  <p className="overview-meta">{progress.phase==='waiting'?(seconds>=30?(de?'Das Modell hat noch keinen Antworttext geliefert. Sobald eine vollständige Karte vorliegt, erscheint sie hier.':'The model has not returned answer text yet. Each complete card will appear here as it arrives.'):(de?'Die Anfrage läuft. Die erste vollständige Karte erscheint sofort hier.':'The request is running. The first complete card will appear here immediately.')):progress.phase==='receiving'?(progress.items.length?(de?'Du kannst die ersten Karten bereits lesen; weitere folgen.':'You can read the first cards while more follow.'):(de?'Die Antwort trifft ein. Die erste vollständige Karte wird vorbereitet.':'The answer is arriving. Preparing the first complete card.')):progress.phase==='preparing'?(de?'Der aktuelle Seitenstand wird geladen und für den Überblick vorbereitet.':'Loading the current page snapshot for the overview.'):(previewOnly?(de?'Der Entwurf wird geprüft. Danach kannst du ihn übernehmen.':'Checking the draft. You can adopt it afterwards.'):(de?'Der vollständige Entwurf wird geprüft und gespeichert.':'Checking and saving the complete draft.'))}</p>
  <div className="overview-actions"><button className="btn btn--sm" onClick={onDocument}>{de?'Währenddessen Dokument lesen':'Read document while waiting'}</button><button className="btn btn--sm btn--ghost" onClick={onCancel}>{de?'Erstellung abbrechen':'Cancel generation'}</button></div>
 </div>
}
