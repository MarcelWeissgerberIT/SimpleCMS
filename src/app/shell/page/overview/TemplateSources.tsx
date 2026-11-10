import {useState} from 'react'
import type {Page} from '../../../store/types'
import {overviewSources} from './model'
const MIME='application/x-one-template-page'
export function TemplateSources({root,pages,selected,onChange,disabled,de}:{root:Page;pages:Page[];selected:string[];onChange:(ids:string[])=>void;disabled:boolean;de:boolean}){
 const [query,setQuery]=useState(''),[over,setOver]=useState(false),[error,setError]=useState('')
 const add=(id:string)=>{if(disabled||id===root.id||selected.includes(id))return;if(!pages.some(p=>p.id===id)){setError(de?'Diese Seite ist hier nicht als Quelle verfügbar.':'This page is not available as a source here.');return}if(selected.length>=30){setError(de?'Höchstens 30 weitere Seiten.':'At most 30 additional pages.');return}setError('');onChange([...selected,id])}
 const available=pages.filter(p=>!selected.includes(p.id)&&p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 const volume=(p:Page)=>{const blocks=overviewSources(p);const words=blocks.reduce((n,b)=>n+b.text.split(/\s+/u).filter(Boolean).length,0);return p.content?`${blocks.length} ${de?'Textblöcke':'text blocks'} · ${words} ${de?'Wörter':'words'}`:(de?'Inhalt wird vor der KI-Anfrage geladen':'Content is loaded before the AI request')}
 return <section className="overview-template-sources" aria-label={de?'Quellen auswählen':'Select sources'}>
  <div className="overview-template-source-head"><h3>{de?'Deine Quellen':'Your sources'}</h3><span>{selected.length+1} {de?'Seiten':'pages'}</span></div>
  <div className="overview-template-drop" data-over={over||undefined} onDragOver={e=>{if(!disabled&&e.dataTransfer.types.includes(MIME)){e.preventDefault();e.dataTransfer.dropEffect='copy';setOver(true)}}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);add(e.dataTransfer.getData(MIME))}}>
   <span className="overview-template-source-chip"><strong>{root.title}</strong><small>{de?'Aktuelle Seite':'Current page'} · {volume(root)}</small></span>
   {selected.map(id=>{const p=pages.find(p=>p.id===id);return <span key={id} className="overview-template-source-chip"><strong>{p?.title??(de?'Quelle nicht verfügbar':'Source unavailable')}</strong><small>{p?volume(p):''}</small><button disabled={disabled} aria-label={(de?'Quelle entfernen: ':'Remove source: ')+(p?.title??id)} onClick={()=>onChange(selected.filter(x=>x!==id))}>×</button></span>})}
   <p>{de?'Seiten aus der Liste hierher ziehen oder mit + hinzufügen.':'Drag pages from the list here or add them with +.'}</p>
  </div>
  <details><summary>{de?'Weitere Seiten hinzufügen':'Add more pages'}</summary><label className="overview-template-search">{de?'Seite suchen':'Search pages'}<input disabled={disabled} value={query} onChange={e=>setQuery(e.target.value)} placeholder={de?'Titel eingeben …':'Enter a title …'}/></label><div className="overview-template-source-results">{available.slice(0,20).map(p=><div className="overview-template-source-result" key={p.id} draggable={!disabled} onDragStart={e=>{e.dataTransfer.setData(MIME,p.id);e.dataTransfer.effectAllowed='copy'}}><span aria-hidden="true">⠿</span><div><strong>{p.title}</strong><small>{volume(p)}</small></div><button className="btn btn--sm" disabled={disabled||selected.length>=30} aria-label={(de?'Quelle hinzufügen: ':'Add source: ')+p.title} onClick={()=>add(p.id)}>+</button></div>)}</div>{!available.length&&<p>{de?'Keine weiteren passenden Seiten.':'No more matching pages.'}</p>}{available.length>20&&<p>{de?'Suche verfeinern, um weitere Seiten zu finden.':'Refine your search to find more pages.'}</p>}</details>
  <p className="overview-meta">{de?'Gelesen wird der vollständige Seitentext deiner Auswahl. Anhänge und externe Links werden nicht zusätzlich geöffnet.':'The full text of your selected pages is read. Attachments and external links are not opened additionally.'}</p>
  {error&&<p role="alert">{error}</p>}
 </section>
}
