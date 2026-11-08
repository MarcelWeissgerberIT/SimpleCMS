import {useEffect,useState} from 'react'
import {ShieldCheck} from 'lucide-react'
import {useCloud,listMembers,type Member} from '../../cloud'
import {useWorkspace} from '../../store/store'
import {useT} from '../../i18n'
import {Modal} from '../../ui/Modal'
import {team,type PageReview} from './api'
import './team-hub.css'
export function KnowledgePageControl({pageId}:{pageId:string}){
 const t=useT(),cloud=useCloud(),page=useWorkspace(s=>s.pages[pageId]),[open,setOpen]=useState(false),[r,setR]=useState<PageReview|null>(null)
 const ws=cloud.active.kind==='cloud'?cloud.active.id:null
 useEffect(()=>{setR(null);if(!ws||page?.private)return;let live=true;void team<PageReview>(ws,`knowledge/${pageId}`).then(v=>{if(live)setR(v)}).catch(()=>{});return()=>{live=false}},[ws,pageId,page?.updatedAt,page?.contentRev,page?.private,open])
 if(!ws||page?.private)return null
 return <><button className="btn team-knowledge" onClick={()=>setOpen(true)}><ShieldCheck size={14}/>{t(r?.review?(r.stale?'team.stale':r.expired?'team.expired':r.review.verified_at?'team.verified':'team.unverified'):'team.review')}</button>{open&&<ReviewDialog key={ws+pageId} ws={ws} pageId={pageId} close={()=>setOpen(false)}/>}</>
}
function ReviewDialog({ws,pageId,close}:{ws:string;pageId:string;close:()=>void}){
 const t=useT(),cloud=useCloud(),[r,setR]=useState<PageReview|null>(null),[members,setMembers]=useState<Member[]>([]),[owner,setOwner]=useState(''),[due,setDue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{let live=true;void Promise.all([team<PageReview>(ws,`knowledge/${pageId}`),listMembers(ws)]).then(([v,m])=>{if(!live)return;setR(v);setMembers(m.filter(x=>x.role!=='viewer'));setOwner(v.review?.owner_id??cloud.user?.id??'');setDue(v.review?.due_at?new Date(v.review.due_at).toISOString().slice(0,10):'')}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[ws,pageId,cloud.user?.id])
 const role=cloud.workspaces.find(w=>w.id===ws)?.role,allowed=!cloud.readOnly&&(!r?.review||r.review.owner_id===cloud.user?.id||role==='admin'||role==='owner')
 async function save(verify:boolean){if(!r)return;setBusy(true);setError('');try{await team(ws,`knowledge/${pageId}`,'PUT',{version:r.review?.version??0,owner,due:due?new Date(due+'T23:59:59').getTime():null,hash:r.source.hash,verify});close()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <Modal open onClose={close} title={t('team.review')} width={560}><div className="team-hub"><p>{t('team.reviewHint')}</p><label>{t('team.owner')}<select className="input" value={owner} onChange={e=>setOwner(e.target.value)}>{members.map(m=><option key={m.user.id} value={m.user.id}>{m.user.name||m.user.email}</option>)}</select></label><label>{t('team.due')}<input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="team-hub__actions"><button className="btn" disabled={!r||busy||!allowed} onClick={()=>void save(false)}>{t('team.assign')}</button><button className="btn btn--primary" disabled={!r||busy||!allowed} onClick={()=>void save(true)}>{t('team.verify')}</button></div></div></Modal>
}
