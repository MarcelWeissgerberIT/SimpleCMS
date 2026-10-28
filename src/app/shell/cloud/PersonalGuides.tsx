import { useEffect, useState } from 'react'
import { useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { firstStart } from '../firstStart/model'
import { isTestAccess } from '../../cloud/testScope'
import { cloudApi } from './api'
import { Modal } from '../../ui/Modal'
import { Screws } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useWorkspaceTitle } from './state'
import { navigate } from '../../lib/router'
import { openAgent } from '../../features/ai/agent/state'
import type { PersonalGuide } from '@/shared/personal-guides'
import './personal-guides.css'

/** A stable destination, even if Home redirects to a workspace's configured start page. */
export function PersonalGuidesPage({ guideId }: { guideId?: string }) {
 const t=useT(),lang=useLang(),workspace=useWorkspaceTitle(),email=useCloud(s=>s.user?.email),inCloud=useCloud(s=>s.active.kind==='cloud')
 const setup=useWorkspace(s=>Object.values(s.pages).find(p=>!p.trashed&&!p.databaseId&&firstStart(p))?.id)
 return <div className="personal-guides-page"><span className="label">§ GUIDE · {lang==='de'?'NUR FÜR DEIN KONTO':'YOUR ACCOUNT ONLY'}</span><h1>{t('shell.nav.personalGuides')}</h1><p className="personal-guides-page__identity">{workspace}<br/>{email}</p>{inCloud&&setup&&!isTestAccess()&&<div className="personal-guides__card"><Screws seed="personal-setup-entry"/><h2>{lang==='de'?'Worker, Copilot und Atlas einrichten':'Set up worker, Copilot and Atlas'}</h2><p>{lang==='de'?'Ein Schritt nach dem anderen – mit echten Screenshots und einer Prüfung, was noch fehlt.':'One step at a time – with real screenshots and checks for missing prerequisites.'}</p><button className="btn btn--primary" onClick={()=>navigate({name:'page',id:setup})}>{lang==='de'?'Schritt für Schritt einrichten':'Set up step by step'} →</button></div>}<PersonalGuides page guideId={guideId}/></div>
}

/** Neither the member directory nor the shared workspace contains these recipient-only payloads. */
export function PersonalGuides({ page=false, guideId }: {page?:boolean;guideId?:string}) {
 const active=useCloud(s=>s.active),user=useCloud(s=>s.user?.id),lang=useLang()
 const tr=(de:string,en:string)=>lang==='de'?de:en,ws=active.kind==='cloud'?active.id:null,identity=`${ws}:${user}`
 const [loaded,setLoaded]=useState(''),[guides,setGuides]=useState<PersonalGuide[]>([]),[pickedId,setPickedId]=useState<string|null>(null),[copied,setCopied]=useState<number|null>(null),[error,setError]=useState(false),[refresh,setRefresh]=useState(0)
 useEffect(()=>{
  let live=true,request=0
  setPickedId(null);setGuides([]);setLoaded('');setError(false)
  const load=()=>{
   if(!ws||!user||isTestAccess())return
   const n=++request
   void cloudApi.cloudRequest<PersonalGuide[]>('GET',`api/workspaces/${ws}/personal-guides`).then(v=>{if(live&&n===request){setGuides(v);setLoaded(identity);setError(false)}}).catch(()=>{if(live&&n===request){setGuides([]);setLoaded(identity);setError(true)}})
  }
  const focus=()=>{if(document.visibilityState==='visible')load()}
  load();window.addEventListener('focus',focus)
  return()=>{live=false;window.removeEventListener('focus',focus)}
 },[identity,ws,user,refresh])
 const picked=loaded===identity?guides.find(g=>g.id===(guideId??pickedId)):undefined
 const close=()=>{setPickedId(null);if(guideId)navigate({name:'personal-guides'})}
 if(isTestAccess())return page?<p>{tr('Persönliche Karten sind nur mit dem eigenen Konto sichtbar, nicht in der Testansicht.','Personal guides are available only in your own account, not in a test view.')}</p>:null
 if(!ws)return page?<p>{tr('Öffne zuerst deinen Cloud-Workspace. Persönliche Karten gehören zum jeweiligen Workspace.','Open your cloud workspace first. Personal guides belong to that workspace.')}</p>:null
 if(!page&&(loaded!==identity||(!guides.length&&!error)))return null
 return <section className="personal-guides" aria-label={tr('Deine persönliche Vorbereitung','Your personal preparation')}>
  {page&&<div className="personal-guides__toolbar"><p>{tr('Deine Aufgaben und Vorlagen – nur für dich sichtbar.','Your assignments and templates – visible only to you.')}</p><button className="btn btn--sm" onClick={()=>setRefresh(n=>n+1)}>{tr('Karten neu prüfen','Check guides again')}</button></div>}
  {loaded!==identity&&<p role="status">{tr('Deine Karten werden geladen …','Loading your guides …')}</p>}
  {error&&<div className="personal-guides__card" role="alert"><p>{tr('Deine persönlichen Karten konnten nicht geladen werden. Prüfe die Verbindung und versuche es erneut.','Your personal guides could not be loaded. Check your connection and try again.')}</p><button className="btn" onClick={()=>setRefresh(n=>n+1)}>{tr('Erneut versuchen','Try again')}</button></div>}
  {page&&loaded===identity&&!error&&!guides.length&&<div className="personal-guides__card"><p>{tr('Für dieses Konto sind in diesem Workspace noch keine persönlichen Karten hinterlegt. Prüfe oben E-Mail-Adresse und Workspace.','No personal guides have been assigned to this account in this workspace. Check the email and workspace above.')}</p></div>}
  {page&&guideId&&loaded===identity&&!error&&!guides.some(g=>g.id===guideId)&&<p role="status">{tr('Diese Karte ist für dein angemeldetes Konto hier nicht verfügbar. Unten siehst du deine eigenen Karten.','This guide is unavailable to your signed-in account here. Your own guides are listed below.')}</p>}
  {loaded===identity&&guides.map(g=><div className="personal-guides__card" key={g.id}><Screws seed={g.id}/><span className="label">§ GUIDE · {tr('Nur für dich','Only for you')}</span><h3>{g.title}</h3><button className="btn btn--primary" onClick={()=>{setCopied(null);if(page)navigate({name:'personal-guides',id:g.id});else setPickedId(g.id)}}>{tr('Persönlichen Einstieg öffnen','Open personal guide')} →</button>{!page&&<a className="btn btn--sm" href="#/my-start">{tr('Alle meine Karten','All my guides')} →</a>}</div>)}
  <Modal open={!!picked} onClose={close} title={picked?.title} label={tr('Persönlich · nur dein Konto','Personal · your account only')} width={850}><div className="personal-guides__content">{picked?.sections.map((s,i)=><details key={`${picked.id}:${i}`} className="personal-guides__plate" open={i===0}><summary><span className="label">{String(i+1).padStart(2,'0')}</span> {s.title}</summary><GuideBody body={s.body}/>{s.prompt&&<><pre>{s.prompt}</pre><div className="welcome-actions"><button className="btn btn--sm" onClick={()=>void navigator.clipboard.writeText(s.prompt!).then(()=>setCopied(i))}>{copied===i?tr('Kopiert','Copied'):tr('Prompt kopieren','Copy prompt')}</button><button className="btn btn--sm" onClick={()=>{openAgent({task:s.prompt});close()}}>{tr('Im KI-Terminal vorbereiten','Prepare in AI terminal')} →</button></div></>}</details>)}</div></Modal>
 </section>
}

/** Explicit source links: no external embeds, tracking images or automatic requests. */
function GuideBody({body}:{body:string}) {
 return <p>{body.split(/(https:\/\/[^\s<>"()[\]]+)/g).map((part,i)=>{
   if(!part.startsWith('https://'))return part
   try{const url=new URL(part);if(url.username||url.password)return part;return <a key={i} className="btn btn--sm" href={url.href} target="_blank" rel="noopener noreferrer" title={url.href}>Atlas ↗ <span className="label">{url.pathname.startsWith('/r/')?url.pathname.slice(3):'Quelle / Source'}</span></a>}catch{return part}
 })}</p>
}
