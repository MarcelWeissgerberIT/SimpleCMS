import {useState} from 'react'
import {QUALITY_CHECKS,qualityRecipe} from './recipe'
import {TERMINAL_TOOLS} from '../agent/tools'
import {openPrograms} from '../programs/dialog'
export function QualityChecks({pages,de,onClose}:{pages:Array<{id:string;title:string}>;de:boolean;onClose:()=>void}){
 const [kind,setKind]=useState('design'),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState('')
 const current=selected.filter(id=>pages.some(p=>p.id===id))
 return <section className="quality-checks"><h3>{de?'Wiederverwendbare Qualitätsprüfung':'Reusable quality check'}</h3>
 <label>{de?'Prüfung':'Check'} <select className="input" aria-label={de?'Qualitätsprüfung':'Quality check'} value={kind} onChange={e=>setKind(e.target.value)}>{QUALITY_CHECKS.map(c=><option key={c.id} value={c.id}>{de?c.de:c.en}</option>)}</select></label>
 <p>{de?'Bis zu 20 Quellseiten auswählen, z. B. Mock und Designregeln oder Anforderungen und Code-Bericht. Der Ablauf liest sie beim Start neu, fragt den Umfang ab und erstellt eine Prüfung mit Belegen und offenen Punkten. Er führt keinen Code aus und ersetzt keine Live-Prüfung.':'Select up to 20 source pages, e.g. mock and design rules or requirements and code report. The workflow reads them afresh at start, confirms scope, and creates a review with evidence and open issues. It does not execute code or replace live verification.'}</p>
 <input className="input" type="search" aria-label={de?'Prüfquellen suchen':'Search check sources'} value={search} onChange={e=>setSearch(e.target.value)}/>
 <div className="quality-checks__sources">{pages.filter(p=>current.includes(p.id)||p.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>Number(current.includes(b.id))-Number(current.includes(a.id))).slice(0,40).map(p=><label key={p.id}><input type="checkbox" disabled={!current.includes(p.id)&&current.length>=20} checked={current.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...current,p.id]:current.filter(id=>id!==p.id))}/>{p.title}</label>)}</div>
 <p>{current.length} / 20 {de?'Quellen ausgewählt':'sources selected'}</p><button type="button" className="btn" disabled={!current.length} onClick={()=>{const recipe=qualityRecipe(kind,current,TERMINAL_TOOLS.find(t=>t.name==='read_page')!.input_schema);onClose();openPrograms(recipe)}}>{de?'Qualitätsprüfung vorbereiten':'Prepare quality check'}</button>
 </section>
}
