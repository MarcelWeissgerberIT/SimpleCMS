import {useEffect,useState} from 'react'
import {useT} from '../../i18n'
import {teamRequest,useCloud} from '../../cloud'
import {team} from './api'
import './team-hub.css'
interface Provider {id:string;label:string;calendar:string|null;linked?:boolean;calendarConnected?:boolean}
interface Setup {providers:Provider[];scim:boolean}
const start=(p:Provider,intent:string)=>`/api/company/${encodeURIComponent(p.id)}/start?intent=${intent}`
export function CompanySignIn(){
 const t=useT(),[list,setList]=useState<Provider[]>([])
 useEffect(()=>{let live=true;void teamRequest<Provider[]>('GET','api/company/providers').then(v=>{if(live)setList(v)}).catch(()=>{});return()=>{live=false}},[])
 return <>{list.map(p=><a className="btn" key={p.id} href={start(p,'signin')}>{t('team.signInWith')} {p.label}</a>)}</>
}
export function Identity({ws}:{ws:string}){
 const t=useT(),canProvision=useCloud(s=>s.role==='owner'&&!s.readOnly),[setup,setSetup]=useState<Setup|null>(null),[error,setError]=useState(''),[token,setToken]=useState<{token:string;url:string}|null>(null),[busy,setBusy]=useState(false)
 useEffect(()=>{let live=true;setSetup(null);setToken(null);void team<Setup>(ws,'company').then(v=>{if(live)setSetup(v)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[ws])
 async function issue(p:Provider){setBusy(true);setError('');try{setToken(await team(ws,'company/scim-token','POST',{provider:p.id}));setSetup(s=>s?{...s,scim:true}:s)}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function revoke(){setBusy(true);try{await team(ws,'company/scim-token','DELETE');setToken(null);setSetup(s=>s?{...s,scim:false}:s)}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section><p>{t('team.identityHint')}</p>{setup&&!setup.providers.length&&<p>{t('team.companySetup')}</p>}{setup?.providers.map(p=><article key={p.id}><strong>{p.label}</strong><span>{t(p.linked?'team.linked':'team.notLinked')}</span>{!p.linked&&<a className="btn" href={start(p,'link')}>{t('team.linkIdentity')}</a>}{canProvision&&<button className="btn" disabled={busy} onClick={()=>void issue(p)}>{t(setup.scim?'team.rotateScim':'team.createScim')}</button>}</article>)}{canProvision&&setup?.scim&&<button className="btn" disabled={busy} onClick={()=>void revoke()}>{t('team.revokeScim')}</button>}{token&&<div><p>{t('team.tokenOnce')}</p><input className="input" aria-label="SCIM URL" readOnly value={token.url} onFocus={e=>e.target.select()}/><input className="input" aria-label="SCIM token" readOnly type="password" value={token.token} onFocus={e=>e.target.select()}/><button className="btn" onClick={()=>void navigator.clipboard.writeText(token.token).catch(e=>setError(String(e)))}>{t('team.copyToken')}</button></div>}{error&&<p role="alert">{error}</p>}</section>
}
interface Event {id:string;title:string;start:string;end:string;allDay:boolean;url:string|null;meeting:string|null}
interface Events {events:Event[];truncated:boolean;readAt:number}
export function ConnectedCalendars(){const cloud=useCloud(),t=useT();if(cloud.active.kind!=='cloud')return null;return <details className="team-hub"><summary>{t('team.externalCalendar')}</summary><Calendar ws={cloud.active.id}/></details>}
export function Calendar({ws}:{ws:string}){
 const t=useT(),[setup,setSetup]=useState<Setup|null>(null),[data,setData]=useState<Record<string,Events>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{let live=true;setData({});setSetup(null);void team<Setup>(ws,'company').then(v=>{if(live)setSetup(v)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[ws])
 async function load(p:Provider){setBusy(true);setError('');try{const r=await team<Events>(ws,`company/${p.id}/calendar`);if(useCloud.getState().active.id===ws)setData(v=>({...v,[p.id]:r}))}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function disconnect(p:Provider){setBusy(true);try{await team(ws,`company/${p.id}/calendar`,'DELETE');setData(v=>{const n={...v};delete n[p.id];return n});setSetup(s=>s?{...s,providers:s.providers.map(x=>x.id===p.id?{...x,calendarConnected:false}:x)}:s)}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section><p>{t('team.calendarHint')}</p>{setup&&!setup.providers.some(p=>p.calendar)&&<p>{t('team.companySetup')}</p>}{setup?.providers.filter(p=>p.calendar).map(p=><div key={p.id}><article><strong>{p.label}</strong><a className="btn" href={start(p,'calendar')}>{t(p.calendarConnected?'team.reconnect':'team.connect')}</a>{p.calendarConnected&&<><button className="btn" disabled={busy} onClick={()=>void load(p)}>{t('team.loadEvents')}</button><button className="btn" disabled={busy} onClick={()=>void disconnect(p)}>{t('team.disconnect')}</button></>}</article>{data[p.id]&&<><p>{t('team.readAt')} {new Date(data[p.id].readAt).toLocaleString()}{data[p.id].truncated?' · '+t('team.truncated'):''}</p>{!data[p.id].events.length&&<p>{t('team.noEvents')}</p>}{data[p.id].events.map(e=><article key={e.id}><span>{e.allDay?e.start.slice(0,10):new Date(e.start).toLocaleString()}</span><strong>{e.title||t('common.untitled')}</strong>{e.url&&<a href={e.url} target="_blank" rel="noreferrer">{t('team.openEvent')}</a>}{e.meeting&&<a href={e.meeting} target="_blank" rel="noreferrer">{t('team.joinMeeting')}</a>}</article>)}</>}</div>)}{error&&<p role="alert">{error}</p>}</section>
}
