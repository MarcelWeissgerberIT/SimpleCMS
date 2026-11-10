import {useEffect,useRef,useState} from 'react'
import type {Route} from '@/shared/ai/types'
import {useWorkspace} from '../../store/store'
import {useLang} from '../../i18n'
import {RouteChip} from '../ai/routing/RouteChip'
import {CARD_DRAG} from './drag'
import {headingOnly} from './guidance'
import {sourceHref,sourceState,deskSourceVisible,type Card,type DeskRecords} from './model'
import {wordCount} from './story'
import {workTemplates,recommendedWorkTemplate,type WorkTemplate} from './workTemplates'
import {workOutputs,workReceipt,type WorkItem} from './workPlan'
import {generateWork,adoptWork,type WorkDraft} from './workGenerate'
import './work-organizer.css'

export function WorkOrganizer({active,pageId,cards,records,initialSelected,initialGoal,dimension,readOnly,onCollect}:{active:boolean;pageId:string;cards:Card[];records:DeskRecords;initialSelected:string[];initialGoal:string;dimension:string;readOnly:boolean;onCollect:()=>void}){
 const de=useLang()==='de',pages=useWorkspace(s=>s.pages),databases=useWorkspace(s=>s.databases),templates=workTemplates(de),recommended=recommendedWorkTemplate(dimension)
 const [template,setTemplate]=useState<WorkTemplate>(recommended),[selected,setSelected]=useState(()=>initialSelected.length?initialSelected.slice(0,20):cards.slice(0,20).map(c=>c.id))
 const [goal,setGoal]=useState(initialGoal),[route,setRoute]=useState<Route|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('')
 const [draft,setDraft]=useState<WorkDraft|null>(null),[items,setItems]=useState<WorkItem[]>([]),[included,setIncluded]=useState<string[]>([]),[title,setTitle]=useState(''),[created,setCreated]=useState(''),[over,setOver]=useState<WorkTemplate|null>(null)
 const controller=useRef<AbortController|null>(null),preview=useRef<HTMLDivElement>(null)
 useEffect(()=>()=>controller.current?.abort(),[pageId])
 useEffect(()=>{if(readOnly||!active)controller.current?.abort()},[readOnly,active])
 const availableIds=cards.map(c=>c.id).join('|')
 useEffect(()=>{const valid=new Set(availableIds.split('|'));setSelected(ids=>{const next=ids.filter(id=>valid.has(id));return next.length===ids.length?ids:next})},[availableIds])
 const current=templates.find(t=>t.id===template)!,chosen=cards.filter(c=>selected.includes(c.id)),selectedItems=items.filter(r=>included.includes(r.id))
 const words=chosen.reduce((n,c)=>n+wordCount(c.source.quote),0),outputs=workOutputs(records).filter(r=>deskSourceVisible(pages,pageId,r.pageId))
 const stale=chosen.some(c=>sourceState(c,pages)!=='current'),refs=[{page:pageId},...[...new Set(chosen.map(c=>c.source.pageId))].map(page=>({page}))]
 const carries=[...(chosen.some(c=>c.source.kind==='file')?['files' as const]:[]),...(chosen.some(c=>c.source.kind==='code')?['mcp' as const]:[])]
 const incoming=initialSelected.filter(id=>cards.some(c=>c.id===id)).slice(0,20),hasIncoming=incoming.length>0&&(incoming.length!==chosen.length||incoming.some(id=>!selected.includes(id)))
 const changeFocus=(id:WorkTemplate)=>{setTemplate(id);setCreated('');setError('')}
 const select=(id:string)=>{setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):ids.length<20?[...ids,id]:ids)}
 const run=async(fn:(signal:AbortSignal)=>Promise<void>)=>{
  if(busy||readOnly)return;const c=new AbortController();controller.current=c;setBusy(true);setError('')
  try{await fn(c.signal)}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(controller.current===c)setBusy(false)}
 }
 const generate=()=>void run(async signal=>{
  setCreated('');const next=await generateWork(pageId,chosen.map(c=>c.id),template,goal.trim()||current.goal,route,signal,setProgress)
  if(signal.aborted)return
  setDraft(next);setItems(next.plan.items);setIncluded(next.plan.items.map(r=>r.id));setTitle(next.plan.title)
  requestAnimationFrame(()=>preview.current?.scrollIntoView({block:'start',behavior:'smooth'}))
 })
 const edit=(id:string,patch:Partial<Pick<WorkItem,'title'|'detail'|'criterion'>>)=>setItems(rows=>rows.map(r=>r.id===id?{...r,...patch}:r))
 return <section className="work-organizer" aria-label={de?'Arbeit organisieren':'Organize work'}>
  <header className="work-heading"><div><span className="label">{de?'VOM DENKEN INS TUN':'FROM THINKING TO DOING'}</span><h2>{de?'Was möchtest du voranbringen?':'What do you want to move forward?'}</h2><p>{de?'Setze deinen Fokus. Aus deinen Karten entsteht ein Arbeitsentwurf mit passenden Feldern, Board und Tabelle.':'Choose a focus. Turn your cards into a work draft with useful fields, a board and a table.'}</p></div><span className="work-heading-mark" aria-hidden="true">↗</span></header>
  {!!outputs.length&&<nav className="work-existing" aria-label={de?'Deine Arbeitsansichten':'Your working views'}><span>{de?'DEINE ARBEIT · AKTUELLER STAND':'YOUR WORK · CURRENT STATUS'}</span><div>{outputs.map(r=>{
   const receipt=workReceipt(r.after),t=templates.find(t=>t.id===receipt?.template),status=databases[r.pageId]?.properties.find(p=>p.id==='work-status'&&p.type==='status'),doneIds=status?.options?.filter(o=>o.group==='done').map(o=>o.id)??[]
   const rows=Object.values(pages).filter(p=>p.databaseId===r.pageId&&deskSourceVisible(pages,pageId,p.id)),done=rows.filter(p=>doneIds.includes(String(p.properties['work-status']))).length
   return <a key={r.id} href={'#/p/'+r.pageId} aria-label={(pages[r.pageId].title||receipt?.title)+' ↗'}><span>{t?.name??(de?'Arbeitsansicht':'Working view')} <b aria-hidden="true">↗</b></span><strong>{pages[r.pageId].title||receipt?.title}</strong><small>{rows.length} {de?(rows.length===1?'Eintrag':'Einträge'):(rows.length===1?'item':'items')}{status?` · ${done} ${de?'abgeschlossen':'completed'}`:''}</small>{status&&<progress value={done} max={rows.length||1} aria-label={de?'Abgeschlossene Einträge':'Completed items'}/>}</a>
  })}</div></nav>}
  {created&&deskSourceVisible(pages,pageId,created)&&<div className="work-created" role="status"><div><strong>{de?'Deine Arbeitsansicht ist bereit.':'Your working view is ready.'}</strong><p>{de?'Öffne einen Eintrag für seine Quellen. Status, Verantwortung und Termine kannst du dort weiterführen.':'Open an item to see its sources. Continue with status, ownership and dates there.'}</p></div><a className="btn" href={'#/p/'+created}>{de?'Arbeitsansicht öffnen ↗':'Open working view ↗'}</a></div>}
  {!draft&&<>
   <div className="work-step"><span>01</span><h3>{de?'Fokus wählen':'Choose a focus'}</h3><small>{de?'Klicken oder eine Karte hineinziehen':'Click or drop a card here'}</small></div>
   <div className="work-templates">{templates.map((t,i)=><button key={t.id} className="work-template" aria-pressed={template===t.id} data-drop-active={over===t.id} disabled={busy||readOnly} onClick={()=>changeFocus(t.id)}
    onDragOver={e=>{if(!busy&&!readOnly&&e.dataTransfer.types.includes(CARD_DRAG)){e.preventDefault();e.dataTransfer.dropEffect='copy';setOver(t.id)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOver(null)}} onDrop={e=>{setOver(null);if(busy||readOnly)return;const id=e.dataTransfer.getData(CARD_DRAG);if(!cards.some(c=>c.id===id))return;e.preventDefault();if(!selected.includes(id)&&chosen.length>=20){setError(de?'Wähle höchstens 20 Karten.':'Select up to 20 cards.');return}setSelected(ids=>[...new Set([...ids,id])]);changeFocus(t.id)}}>
    <div className="work-template-top"><span aria-hidden="true">{['↗','?','✓','⇄'][i]}</span>{t.id===recommended&&dimension&&<small>{de?'Passt zum Fokus':'Fits your focus'}</small>}</div>
    <strong>{t.title}</strong><p>{t.hint}</p><div className="work-template-sample" data-view={t.view} aria-hidden="true">{t.statuses.map((status,j)=><div key={status}><span>{status}</span><i/><i data-short={j!==0}/></div>)}</div><small>{t.fields}</small>
   </button>)}</div>
   <div className="work-compose"><div className="work-material">
    <div className="work-step"><span>02</span><h3>{de?'Material auswählen':'Choose material'}</h3><small>{chosen.length}/{cards.length} · {words.toLocaleString()} {de?'Quellwörter':'source words'}</small></div>
    <p className="work-muted">{de?'Die markierten Karten bilden die Grundlage. Bis zu 20 Karten pro Entwurf.':'Checked cards form the basis. Up to 20 cards per draft.'}</p>
    <div className="work-material-actions">{hasIncoming&&<button className="btn btn--sm" disabled={busy||readOnly} onClick={()=>setSelected(incoming)}>{de?`Auswahl aus Denkraum (${incoming.length})`:`Use desk selection (${incoming.length})`}</button>}<button className="btn btn--sm" disabled={busy||readOnly||!cards.length} onClick={()=>setSelected(cards.slice(0,20).map(c=>c.id))}>{de?'Erste 20 auswählen':'Select first 20'}</button><button className="btn btn--sm" disabled={busy||readOnly||!chosen.length} onClick={()=>setSelected([])}>{de?'Auswahl leeren':'Clear selection'}</button>{!readOnly&&<button className="btn btn--sm" disabled={busy} onClick={onCollect}>{de?'Quellen ergänzen':'Add sources'}</button>}</div>
    {!cards.length&&<p>{de?'Sammle zuerst eine Aussage oder schreibe eine eigene Notiz im Denkraum.':'First collect a statement or write your own note in the desk.'}</p>}
    <div className="work-material-list">{cards.map(c=><article key={c.id} data-selected={selected.includes(c.id)} draggable={!busy&&!readOnly} onDragStart={e=>{e.dataTransfer.setData(CARD_DRAG,c.id);e.dataTransfer.effectAllowed='copy'}}>
     <div className="work-material-head"><label><input type="checkbox" checked={selected.includes(c.id)} disabled={busy||readOnly||!selected.includes(c.id)&&chosen.length>=20} onChange={()=>select(c.id)}/><strong>{c.title}</strong></label><button type="button" className="work-drag-handle" draggable={!busy&&!readOnly} disabled={busy||readOnly||!selected.includes(c.id)&&chosen.length>=20} onClick={()=>select(c.id)} aria-pressed={selected.includes(c.id)} aria-label={(de?'Karte zu einem Fokus ziehen: ':'Drag card to a focus: ')+c.title} title={de?'Zu einem Fokus ziehen · Klick wählt die Karte':'Drag to a focus · click to select the card'}>⠿</button></div>
     <small>{c.source.label} · {wordCount(c.source.quote)} {de?'Wörter':'words'}{c.source.kind==='note'?' · '+(de?'Eigene Aussage':'Own statement'):''}</small>
     {headingOnly(c,pages[c.source.pageId])&&<small className="work-attention">{de?'Nur Überschrift – ergänze die zugehörigen Absätze.':'Heading only — add the supporting passages.'}</small>}
     {sourceState(c,pages)!=='current'&&<small className="work-attention">{de?'Quelle geändert oder nicht verfügbar':'Source changed or unavailable'}</small>}
     <details><summary>{de?'Inhalt ansehen':'Inspect content'}</summary><p>{c.detail}</p>{c.detail!==c.source.quote&&<blockquote>{c.source.quote}</blockquote>}<a href={sourceHref(c)}>{de?'Quelle öffnen ↗':'Open source ↗'}</a></details>
    </article>)}</div>
   </div><div className="work-brief">
    <div className="work-step"><span>03</span><h3>{de?'Dein Arbeitsziel':'Your work goal'}</h3></div>
    <label>{de?'Wobei soll dir die Ansicht helfen?':'What should this view help you achieve?'}<textarea value={goal} maxLength={6000} rows={4} placeholder={current.goal} disabled={busy||readOnly} onChange={e=>setGoal(e.target.value)}/></label>
    {initialGoal.trim()&&initialGoal.trim()!==goal.trim()&&<button className="work-goal-suggestion" disabled={busy||readOnly} onClick={()=>{setGoal(initialGoal);if(incoming.length)setSelected(incoming)}}>{de?'Frage und Auswahl aus dem Denkraum übernehmen: ':'Use question and selection from the desk: '}{initialGoal}</button>}
    <button className="work-goal-suggestion" disabled={busy||readOnly} onClick={()=>setGoal(current.goal)}>{de?'Vorschlag übernehmen: ':'Use suggestion: '}{current.goal}</button>
    <div className="work-output-summary"><span className="label">{de?'DEIN ERGEBNIS':'YOUR OUTPUT'}</span><strong>{current.name}</strong><p>{current.fields}</p><small>{de?'Mit Quellen pro Eintrag sowie Board- und Tabellenansicht.':'Sources on each item, plus board and table views.'}</small></div>
    <RouteChip purpose="workbench.analyze" chip={route} onChip={setRoute} sources={refs} carries={carries} reads={de?'Ausgewählte Karten und ihre Quellauszüge':'Selected cards and source excerpts'} disabled={busy||readOnly}/>
    <button className="btn work-primary" disabled={busy||readOnly||!chosen.length||chosen.length>20||stale} onClick={generate}>{busy?(de?'Entwurf entsteht …':'Preparing draft …'):(de?'✦ Arbeitsentwurf erstellen':'✦ Create work draft')}</button>
    <p className="work-muted">{stale?(de?'Prüfe geänderte Quellen zuerst in den Kartendetails.':'Review changed sources in card details first.'):(de?'Du prüfst und bearbeitest den Entwurf, bevor Einträge angelegt werden.':'Review and edit the draft before any items are created.')}</p>
   </div></div>
  </>}
  {busy&&<div className="work-progress" role="status">{progress}<button className="btn btn--sm" onClick={()=>controller.current?.abort()}>{de?'Abbrechen':'Cancel'}</button></div>}
  {error&&<p className="wb-alert" role="alert">{error}</p>}
  {draft&&<div className="work-draft" role="region" ref={preview} aria-label={de?'Arbeitsentwurf prüfen':'Review work draft'}>
   <div className="work-step"><span>04</span><h3>{de?'Prüfen und loslegen':'Review and get started'}</h3><small>{de?'Noch nichts angelegt':'Nothing created yet'}</small></div>
   <label>{de?'Name der Arbeitsansicht':'Working view name'}<input maxLength={160} value={title} disabled={busy||readOnly} onChange={e=>setTitle(e.target.value)}/></label><p>{draft.plan.summary}</p>
   <p className="work-muted">{de?'Entferne unpassende Vorschläge oder bearbeite ihre Texte. Quellen bleiben am Eintrag. Alle Punkte starten offen; Verantwortliche, Termine und Ergebnisse ergänzt du selbst.':'Remove unsuitable suggestions or edit their text. Each item keeps its sources. All items start open; add owners, dates and results as you work.'}</p>
   {!items.length&&<div className="work-empty"><strong>{de?'Für diesen Fokus fehlen passende Inhalte.':'The material does not support this focus yet.'}</strong><p>{de?'Ergänze konkrete Quelltexte oder formuliere dein Ziel anders.':'Add concrete source passages or adjust your goal.'}</p></div>}
   <div className="work-draft-items">{items.map((r,i)=><article key={r.id} data-included={included.includes(r.id)}>
    <label className="work-include"><input type="checkbox" aria-label={(de?'Übernehmen: ':'Include: ')+r.title} disabled={busy||readOnly} checked={included.includes(r.id)} onChange={e=>setIncluded(ids=>e.target.checked?[...ids,r.id]:ids.filter(id=>id!==r.id))}/><span>{String(i+1).padStart(2,'0')}</span><strong>{r.title}</strong></label>
    <div className="work-draft-fields"><label>{de?'Titel':'Title'}<input value={r.title} maxLength={160} disabled={busy||readOnly} onChange={e=>edit(r.id,{title:e.target.value})}/></label><label>{de?'Hintergrund und Vorgehen':'Context and approach'}<textarea rows={3} maxLength={2000} value={r.detail} disabled={busy||readOnly} onChange={e=>edit(r.id,{detail:e.target.value})}/></label><label>{templates.find(t=>t.id===draft.template)!.criterion}<textarea rows={2} maxLength={1000} value={r.criterion} disabled={busy||readOnly} onChange={e=>edit(r.id,{criterion:e.target.value})}/></label></div>
    <details><summary>{de?'Grundlage prüfen':'Review source basis'} · {r.cards.length} {de?'Karten':'cards'}</summary>{r.cards.map(id=>{const c=cards.find(c=>c.id===id);return c?<div key={id}><a href={sourceHref(c)}>{c.source.label} ↗</a>{c.source.kind==='note'&&<small>{de?'Eigene Aussage / Annahme':'Own statement / assumption'}</small>}<blockquote>{c.source.quote}</blockquote></div>:<p key={id}>{de?'Quelle nicht mehr verfügbar':'Source no longer available'}</p>})}</details>
   </article>)}</div>
   <div className="work-adopt"><button className="btn work-primary" disabled={busy||readOnly||!title.trim()||!selectedItems.length||selectedItems.some(r=>!r.title.trim()||!r.detail.trim())} onClick={()=>void run(async signal=>{setProgress(de?'Arbeitsansicht wird angelegt …':'Creating working view …');const id=await adoptWork(pageId,draft,selectedItems,title,signal);setCreated(id);setDraft(null);requestAnimationFrame(()=>document.querySelector('.work-created')?.scrollIntoView({block:'center',behavior:'smooth'}))})}>{de?`${selectedItems.length} ${selectedItems.length===1?"Punkt":"Punkte"} als Arbeitsansicht anlegen`:`Create working view with ${selectedItems.length} ${selectedItems.length===1?"item":"items"}`}</button><button className="btn" disabled={busy} onClick={()=>{setDraft(null);setError('')}}>{de?'Zurück zu Fokus & Material':'Back to focus & material'}</button></div>
  </div>}
 </section>
}
