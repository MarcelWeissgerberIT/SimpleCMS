import {HelpLink} from '../../../help'
import {useEffect,useState} from 'react'
import {useCloud,cloudRequest} from '../../../cloud'
import {useT} from '../../../i18n'
import {useCoding,configureModelShare,modelShareStatus} from '../../coding'
import {workerModelRows} from '../core/workerModels'
import {useSharedModels,sharedModels,sharedProgress,refreshSharedModels} from '../core/sharedModels'
import {SHARED_PREFIX} from '@/shared/ai/shared-model'
import './shared-model.css'

export function SharedModelSettings(){
  const t=useT();useSharedModels()
  const active=useCloud(s=>s.active),readOnly=useCloud(s=>s.readOnly)
  const worker=useCoding(s=>s.worker),can=useCoding(s=>s.conn==='connected'&&s.worker?.via==='cloud'&&!!s.can?.includes('shared-models'))
  const [model,setModel]=useState(''),[label,setLabel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const choices=workerModelRows().filter(r=>r.route.p==='local'&&!r.route.m.startsWith(SHARED_PREFIX)),shares=sharedModels(),mine=shares.find(r=>r.mine),progress=sharedProgress()
  useEffect(()=>{if(can)void modelShareStatus().then(raw=>{const s=raw as {choice?:{model:string;label:string}};if(s.choice){setModel(s.choice.model);setLabel(s.choice.label)}}).catch(()=>{})},[can,worker])
  if(active.kind!=='cloud'||readOnly)return null
  const current=useCloud.getState().workspaces.find(w=>w.id===active.id)
  const configure=async(enabled:boolean)=>{
    setBusy(true);setError('')
    try{await configureModelShare({model:model||choices[0]?.route.m||mine?.model||'',label:label.trim()||t('features.ai.prov.share.defaultName'),enabled});await refreshSharedModels()}
    catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <section className="model-share" data-testid="shared-model-settings">
    <header><span>§ SH · {t('features.ai.prov.share.plate')}</span><h4>{t('features.ai.prov.share.title')} <HelpLink id="coding-harness" /></h4><p>{t('features.ai.prov.share.detail')}</p></header>
    <div className="model-share__body">
      <p><strong>{t('features.ai.prov.share.workspace')}</strong> {current?.name??active.id}</p>
      <p>{t('features.ai.prov.share.privacy')}</p>
      {can?<>
        <label className="field"><span className="label">{t('features.ai.prov.share.model')}</span><select className="input" value={model||choices[0]?.route.m||''} onChange={e=>setModel(e.target.value)}>{choices.map(m=><option key={m.route.m} value={m.route.m}>{m.label}</option>)}</select></label>
        <label className="field"><span className="label">{t('features.ai.prov.share.name')}</span><input className="input" maxLength={80} value={label} placeholder={t('features.ai.prov.share.defaultName')} onChange={e=>setLabel(e.target.value)}/></label>
        <button className="btn btn--primary" disabled={busy||!choices.length} onClick={()=>void configure(true)}>{t('features.ai.prov.share.enable')}</button>
      </>:<p>{t('features.ai.prov.share.needsWorker')}</p>}
      {shares.map(s=><div className="model-share__row" key={s.id}>
        <div><strong>{s.label}</strong><span>{s.model} · {s.owner}</span></div>
        <span className="model-share__status" data-online={s.online}>{t(s.online?'features.ai.prov.share.online':'features.ai.prov.share.offline')} · {t('features.ai.prov.share.queue',{n:s.queued})}{s.running?' · '+t('features.ai.prov.share.running'):''}</span>
        {s.mine&&s.enabled&&<button className="btn btn--sm" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await cloudRequest('DELETE',`api/workspaces/${active.id}/model-shares/${s.id}`);if(can)await configureModelShare({model:s.model,label:s.label,enabled:false});await refreshSharedModels()}catch(e){setError(String(e))}finally{setBusy(false)}}}>{t('features.ai.prov.share.disable')}</button>}
      </div>)}
      {!shares.length&&<p>{t('features.ai.prov.share.empty')}</p>}
      {progress&&<p role="status">{t(progress.state==='queued'?'features.ai.prov.share.waiting':'features.ai.prov.share.running',{n:progress.position})}</p>}
      {error&&<p role="alert">{error}</p>}
    </div>
  </section>
}
