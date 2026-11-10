import {useState,type ReactNode} from 'react'
import type {OverviewItem,PageOverview} from './model'
import {templateIds,templates,type OverviewTemplate} from './templates'
import './templates.css'
export function TemplatePicker({value,onChange,disabled,de}:{value:OverviewTemplate|null;onChange:(value:OverviewTemplate|null)=>void;disabled:boolean;de:boolean}){
 return <div className="overview-template-picker" role="group" aria-label={de?'Vorlage wählen':'Choose template'}>
  <div className="overview-template-heading"><div><span className="label">{de?'DEIN INHALT. EIN KLARER AUFBAU.':'YOUR CONTENT. A CLEAR STRUCTURE.'}</span><h3>{de?'Womit möchtest du arbeiten?':'What are you working on?'}</h3></div><button className="btn btn--sm btn--ghost" disabled={disabled} aria-pressed={!value} onClick={()=>onChange(null)}>{de?'Freier Überblick':'Free overview'}</button></div>
  <div className="overview-template-choices">{templateIds.map((id,i)=>{const t=templates[id];return <button key={id} className="overview-template-choice" disabled={disabled} aria-pressed={value===id} onClick={()=>onChange(id)}><span className="overview-template-sketch" data-layout={id} aria-hidden="true"><i/><i/><i/><i/></span><span className="overview-template-number">0{i+1} {value===id?'✓':''}</span><strong>{de?t.de:t.en}</strong><span>{de?t.descriptionDe:t.descriptionEn}</span></button>})}</div>
 </div>
}
export function TemplateView({overview,template,de,renderItem}:{overview?:PageOverview;template:OverviewTemplate;de:boolean;renderItem:(item:OverviewItem)=>ReactNode}){
 const t=templates[template],items=overview?.items??[]
 const sections=[...t.sections].sort((a,b)=>Number(items.some(i=>i.section===b.id))-Number(items.some(i=>i.section===a.id)))
 const [active,setActive]=useState<string|null>(null)
 return <div className="overview-template-board" data-template={template}>
  <header className="overview-template-lead"><span className="label">{de?t.de:t.en}</span><h2>{de?t.questionDe:t.questionEn}</h2>{items.filter(i=>i.kind==='summary').map(i=><div key={i.id}>{renderItem(i)}</div>)}{!items.length&&<p>{de?'Füge deine Seiten hinzu. Die KI füllt diese Bereiche mit belegten Aussagen; du prüfst den Entwurf vor dem Übernehmen.':'Add your pages. AI fills these sections with sourced statements; you review the draft before adopting it.'}</p>}</header>
  <nav className="overview-template-index" aria-label={de?'Bereiche':'Sections'}>{t.sections.map(s=><button key={s.id} aria-pressed={active===s.id} onClick={()=>setActive(active===s.id?null:s.id)}><strong>{items.filter(i=>i.section===s.id).length}</strong><span>{de?s.de:s.en}</span></button>)}</nav>
  <p className="overview-meta">{de?'Anzahl aufbereiteter Aussagen je Bereich · keine Projektkennzahlen':'Prepared statements per section · not project metrics'}</p>
  <div className="overview-template-lanes">{sections.filter(s=>!active||active===s.id).map((s)=>{const cards=items.filter(i=>i.section===s.id);return <section className="overview-template-lane" data-lane={s.id} key={s.id}><h3><span>{String(t.sections.indexOf(s)+1).padStart(2,'0')}</span>{de?s.de:s.en}<small>{cards.length}</small></h3>{cards.map(item=><details className="overview-template-item" key={item.id}><summary><strong>{item.title}</strong><span>{item.detail}</span><small>{item.sourcePageTitle|| (de?'Quelle öffnen':'Open source')} · {de?'Details & Aktionen':'Details & actions'} ↗</small></summary>{renderItem(item)}</details>)}{!cards.length&&<p className="overview-template-gap">{overview?(de?'Noch keine belegte Aussage zugeordnet.':'No sourced statement assigned yet.'):(de?'Hier erscheinen passende Aussagen aus deinen Quellen.':'Matching statements from your sources appear here.')}</p>}</section>})}</div>
 </div>
}
