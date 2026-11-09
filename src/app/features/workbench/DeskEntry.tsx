import {useState} from 'react'
import './workbench.css'
import {useWorkspace} from '../../store/store'
import {useLang} from '../../i18n'
import {openPage} from '../../lib/router'
import {createDesk,addOverviewCard} from './actions'
import type {OverviewItem} from '../../shell/page/overview/model'
export function DeskEntry({pageId,item}:{pageId:string;item?:OverviewItem}){
 const de=useLang()==='de',pages=useWorkspace(s=>s.pages),[open,setOpen]=useState(false),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const targets=Object.values(pages).filter(p=>p.workbench&&!p.trashed&&!p.hidden&&!!p.private===!!pages[pageId]?.private&&!p.settings.locked)
 const go=async(id?:string)=>{setBusy(true);setError('');try{const target=id??createDesk(pageId,title);if(item)await addOverviewCard(target,pageId,item,new AbortController().signal);openPage(target)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <div className="wb-entry"><button className="btn btn--sm btn--ghost" onClick={()=>setOpen(!open)} aria-expanded={open}>{de?(item?'Auf den Schreibtisch':'Denkraum öffnen'):(item?'Add to desk':'Open thinking desk')}</button>{open&&<div className="wb-entry-picker"><label>{de?'Neuer Denkraum':'New thinking desk'}<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder={de?'Woran arbeitest du?':'What are you working on?'}/></label><button className="btn btn--sm" disabled={busy} onClick={()=>void go()}>{de?'Anlegen und öffnen':'Create and open'}</button>{targets.map(p=><button className="btn btn--sm" key={p.id} disabled={busy} onClick={()=>void go(p.id)}>{p.title}</button>)}{error&&<p role="alert">{error}</p>}</div>}</div>
}
