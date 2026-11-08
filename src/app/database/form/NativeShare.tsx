import {useEffect,useState} from 'react'
import {useCloud,teamRequest} from '../../cloud'
import {useT} from '../../i18n'
import type {DbModel} from '../hooks'
import {fieldsOf,formConfig} from './fields'
export function NativeShare({m}:{m:DbModel}){
 const t=useT(),cloud=useCloud(),[link,setLink]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[existing,setExisting]=useState<{id:string;submissions:number;revoked_at:number|null}|null>(null)
 const ws=cloud.active.kind==='cloud'?cloud.active.id:null
 useEffect(()=>{setLink('');setExisting(null);if(!ws)return;let live=true;void teamRequest<Array<{id:string;database_id:string;view_id:string;submissions:number;revoked_at:number|null}>>('GET',`api/workspaces/${ws}/public-forms`).then(rows=>{if(live)setExisting(rows.find(r=>r.database_id===m.db.id&&r.view_id===m.view.id)??null)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[ws,m.db.id,m.view.id])
 const role=cloud.workspaces.find(w=>w.id===ws)?.role
 if(!ws||!['owner','admin'].includes(role??''))return null
 async function publish(){setBusy(true);setError('');try{const cfg=formConfig(m.view),fields=fieldsOf(m.db,m.view).map(({prop,...f})=>f);const r=await teamRequest<{id:string;token:string}>('POST',`api/workspaces/${ws}/public-forms`,{database:m.db.id,view:m.view.id,title:cfg.title||m.dbPage.title||t('common.untitled'),description:cfg.description||'',fields,...(cfg.marker?{marker:cfg.marker}:{}),days:30});const u=new URL(location.href);u.search='';u.hash='/f/cloud-'+r.token;setLink(u.href);setExisting({id:r.id,submissions:0,revoked_at:null})}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function revoke(){if(!existing)return;setBusy(true);try{await teamRequest('DELETE',`api/workspaces/${ws}/public-forms/${existing.id}`);setLink('');setExisting({...existing,revoked_at:Date.now()})}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section className="fshare__sec"><h3>{t('team.directForm')}</h3><p>{t('team.directFormHint')}</p><button className="btn btn--primary" disabled={busy} onClick={()=>void publish()}>{t(existing&&!existing.revoked_at?'team.replaceLink':'team.publish')}</button>{existing&&!existing.revoked_at&&<><button className="btn" disabled={busy} onClick={()=>void revoke()}>{t('team.revoke')}</button><p>{t('team.responses')}: {existing.submissions}</p></>}{link&&<><input className="input" readOnly aria-label={t('team.formLink')} value={link} onFocus={e=>e.target.select()}/><a href={link} target="_blank" rel="noreferrer">{t('team.openForm')}</a></>}{error&&<p role="alert">{error}</p>}</section>
}
