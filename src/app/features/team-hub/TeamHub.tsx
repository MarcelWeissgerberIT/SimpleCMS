import {Identity,Calendar} from './Company'
import Search from './Search'
import {useEffect,useState} from 'react'
import {useT} from '../../i18n'
import {useCloud,switchWorkspace} from '../../cloud'
import {Modal} from '../../ui/Modal'
import {navigate} from '../../lib/router'
import {team,type Review} from './api'
import './team-hub.css'
export default function TeamHub({onClose}:{onClose:()=>void}){
 const t=useT(),cloud=useCloud(),[tab,setTab]=useState('knowledge')
 const ws=cloud.active.kind==='cloud'?cloud.active.id:null
 return <Modal open onClose={onClose} title={t('team.title')} width={920}><div className="team-hub"><nav aria-label={t('team.title')}>{['knowledge','areas','search','calendar','identity'].map(v=><button className={'btn'+(tab===v?' btn--primary':'')} key={v} aria-pressed={tab===v} onClick={()=>setTab(v)}>{t('team.'+v)}</button>)}</nav>{!ws?<p>{t('team.cloudNeeded')}</p>:tab==='knowledge'?<Reviews ws={ws} close={onClose}/>:tab==='areas'?<Areas ws={ws}/>:tab==='search'?<Search close={onClose}/>:tab==='calendar'?<Calendar ws={ws}/>:<Identity ws={ws}/>}</div></Modal>
}
function Reviews({ws,close}:{ws:string;close:()=>void}){
 const t=useT(),[rows,setRows]=useState<Review[]>([]),[error,setError]=useState('')
 useEffect(()=>{let live=true;void team<Review[]>(ws,'knowledge').then(r=>{if(live)setRows(r)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[ws])
 return <section><p>{t('team.knowledgeHint')}</p>{error&&<p role="alert">{error}</p>}{!rows.length&&<p>{t('team.empty')}</p>}{rows.map(r=><article key={r.page_id}><button className="btn" onClick={()=>{close();navigate({name:'page',id:r.page_id})}}>{r.title}</button><span>{t(r.stale?'team.stale':r.expired?'team.expired':r.verified_at?'team.verified':'team.unverified')}{r.due_at?' · '+new Date(r.due_at).toLocaleDateString():''}</span></article>)}</section>
}
type Area={id:string;name:string;visibility:string;role:string|null}
function Areas({ws}:{ws:string}){
 const t=useT(),canCreate=useCloud(s=>(s.role==='owner'||s.role==='admin')&&!s.readOnly),[rows,setRows]=useState<Area[]>([]),[name,setName]=useState(''),[visibility,setVisibility]=useState('closed'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const load=()=>team<Area[]>(ws,'areas').then(setRows)
 useEffect(()=>{void load().catch(e=>setError(String(e)))},[ws])
 async function act(path:string,body?:unknown){setBusy(true);setError('');try{await team(ws,path,'POST',body??{});setName('');await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section><p>{t('team.areaHint')}</p>{canCreate&&<div className="team-hub__actions"><input className="input" aria-label={t('team.name')} placeholder={t('team.name')} value={name} onChange={e=>setName(e.target.value)}/><select className="input" aria-label={t('team.visibility')} value={visibility} onChange={e=>setVisibility(e.target.value)}>{['open','closed','private'].map(v=><option key={v} value={v}>{t('team.'+v)}</option>)}</select><button className="btn" disabled={busy||!name.trim()} onClick={()=>void act('areas',{name,visibility})}>{t('team.create')}</button></div>}{error&&<p role="alert">{error}</p>}{rows.map(a=><article key={a.id}><strong>{a.name}</strong><span>{t('team.'+a.visibility)}</span>{a.role?<button className="btn" onClick={()=>switchWorkspace({kind:'cloud',id:a.id})}>{t('team.enter')}</button>:a.visibility==='open'?<button className="btn" disabled={busy} onClick={()=>void act(`areas/${a.id}/join`)}>{t('team.join')}</button>:<span>{t('team.invitation')}</span>}</article>)}</section>
}
