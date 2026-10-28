import { useEffect, useState } from 'react'
import { useCloud } from '../../cloud'
import { cloudApi } from './api'
import { Modal } from '../../ui/Modal'
import { Screws } from '../../ui/controls'
import { useLang } from '../../i18n'
import { openAgent } from '../../features/ai/agent/state'
import type { PersonalGuide } from '@/shared/personal-guides'
import './personal-guides.css'

/** Neither the member directory nor the shared workspace contains these recipient-only payloads. */
export function PersonalGuides() {
 const active=useCloud(s=>s.active), user=useCloud(s=>s.user?.id), lang=useLang()
 const tr=(de:string,en:string)=>lang==='de'?de:en, ws=active.kind==='cloud'?active.id:null, identity=`${ws}:${user}`
 const [loaded,setLoaded]=useState(''),[guides,setGuides]=useState<PersonalGuide[]>([]),[picked,setPicked]=useState<PersonalGuide|null>(null),[copied,setCopied]=useState<number|null>(null)
 useEffect(()=>{let live=true;setPicked(null);setGuides([]);if(ws&&user)void cloudApi.cloudRequest<PersonalGuide[]>('GET',`api/workspaces/${ws}/personal-guides`).then(v=>{if(live){setGuides(v);setLoaded(identity)}}).catch(()=>{});return()=>{live=false}},[identity,ws,user])
 if(loaded!==identity||!guides.length)return null
 return <section className="personal-guides" aria-label={tr('Deine persönliche Vorbereitung','Your personal preparation')}>{guides.map(g=><div className="personal-guides__card" key={g.id}><Screws seed={g.id}/><span className="label">§ GUIDE · {tr('Nur für dich','Only for you')}</span><h3>{g.title}</h3><button className="btn btn--primary" onClick={()=>{setPicked(g);setCopied(null)}}>{tr('Persönlichen Einstieg öffnen','Open personal guide')} →</button></div>)}
 <Modal open={!!picked} onClose={()=>setPicked(null)} title={picked?.title} label={tr('Persönlich · nur dein Konto','Personal · your account only')} width={850}><div className="personal-guides__content">{picked?.sections.map((s,i)=><details key={i} className="personal-guides__plate" open={i===0}><summary><span className="label">{String(i+1).padStart(2,'0')}</span> {s.title}</summary><GuideBody body={s.body}/>{s.prompt&&<><pre>{s.prompt}</pre><div className="welcome-actions"><button className="btn btn--sm" onClick={()=>void navigator.clipboard.writeText(s.prompt!).then(()=>setCopied(i))}>{copied===i?tr('Kopiert','Copied'):tr('Prompt kopieren','Copy prompt')}</button><button className="btn btn--sm" onClick={()=>{openAgent({task:s.prompt});setPicked(null)}}>{tr('Im KI-Terminal vorbereiten','Prepare in AI terminal')} →</button></div></>}</details>)}</div></Modal></section>
}

/** Explicit source links: no external embeds, tracking images or automatic requests. */
function GuideBody({body}:{body:string}) {
 return <p>{body.split(/(https:\/\/[^\s<>"()[\]]+)/g).map((part,i)=>{
   if(!part.startsWith('https://'))return part
   try{const url=new URL(part);if(url.username||url.password)return part;return <a key={i} className="btn btn--sm" href={url.href} target="_blank" rel="noopener noreferrer" title={url.href}>Atlas ↗ <span className="label">{url.pathname.startsWith('/r/')?url.pathname.slice(3):'Quelle / Source'}</span></a>}catch{return part}
 })}</p>
}
