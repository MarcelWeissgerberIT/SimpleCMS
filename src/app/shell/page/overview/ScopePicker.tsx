import {useEffect,useState} from 'react'
import type {Page} from '../../../store/types'
import {holdOverviewPages} from './sources'

export function ScopePicker({children,selected,onChange,disabled,de}:{children:Page[];selected:string[];onChange:(ids:string[])=>void;disabled:boolean;de:boolean}){
 const [enabled,setEnabled]=useState(selected.length>0)
 useEffect(()=>{if(selected.length)setEnabled(true)},[selected.join('\0')])
 const missing=selected.some(id=>!children.some(p=>p.id===id))
 return <div className="overview-source-picker">
  <label><input type="checkbox" checked={enabled} disabled={disabled} onChange={e=>{setEnabled(e.target.checked);onChange(e.target.checked?children.map(p=>p.id):[])}}/>{de?'Unterseiten einbeziehen':'Include subpages'}</label>
  {enabled&&<>
   <p className="overview-meta">{de?`${selected.length} Unterseiten ausgewählt · Die aktuelle Seite gehört immer dazu. Bis zu 30 Unterseiten pro Überblick.`:`${selected.length} subpages selected · The current page is always included. Up to 30 subpages per overview.`}</p>
   <div className="overview-source-options">{children.map(p=><label key={p.id}><input type="checkbox" disabled={disabled} checked={selected.includes(p.id)} onChange={e=>onChange(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/><span>{p.title|| (de?'Ohne Titel':'Untitled')}</span></label>)}</div>
   {!children.length&&<p>{de?'Keine passenden Unterseiten vorhanden.':'No eligible subpages available.'}</p>}
   <p className="overview-meta">{de?'Es werden nur ausgewählte Textseiten im gleichen Sichtbarkeitsbereich gelesen, einschließlich tieferer Unterseiten. Datenbanken und ihre Einträge bleiben außen vor.':'Only selected document pages in the same visibility scope are read, including nested subpages. Databases and their rows are excluded.'}</p>
  </>}
  {(selected.length>30||missing)&&<p className="overview-warning" role="alert">{missing?(de?'Eine ausgewählte Unterseite ist nicht mehr verfügbar. Wähle die Unterseiten erneut aus.':'A selected subpage is no longer available. Select the subpages again.'):(de?'Bitte wähle höchstens 30 Unterseiten aus.':'Select no more than 30 subpages.')}</p>}
 </div>
}

/** Subscribe to the saved scope while the overview is mounted, including remote edits. */
export function useOverviewSources(ids:readonly string[]){
 const key=ids.join('\0'),[loaded,setLoaded]=useState(''),[error,setError]=useState('')
 useEffect(()=>{
  const controller=new AbortController();let release:(()=>void)|undefined
  setError('');setLoaded('')
  holdOverviewPages(ids,controller.signal).then(done=>{if(controller.signal.aborted)done();else{release=done;setLoaded(key)}}).catch(()=>{if(!controller.signal.aborted)setError(key)})
  return()=>{controller.abort();release?.()}
 },[key])
 return {ready:!key||loaded===key,failed:!!key&&error===key}
}
