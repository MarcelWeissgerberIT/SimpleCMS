import {useEffect,useRef,useState} from 'react'
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {readServers} from '../mcp-servers/config'
import {WorkerConnectionHelp} from '../mcp-servers/WorkerConnectionHelp'
import {atlasSkillVersion} from '@/shared/ai/atlas-skills'
import {SkillError,type AtlasSkillSource,type Skill} from '@/shared/ai/skills'
import {listSkills,importSkillVersion,skillScope} from './storage'
import {findAtlasSkills,readAtlasSkill,type AtlasSkillHit} from './atlas'

type Preview=Awaited<ReturnType<typeof readAtlasSkill>>
export function AtlasSkills({scope,onImported,seed}:{scope:string;seed?:AtlasSkillSource;onImported:(skill:Skill)=>void}){
 const t=useT(),servers=readServers().filter(s=>s.enabled),onboarding=useWorkspace(s=>s.ai?.onboarding)
 const [server,setServer]=useState(()=>seed?(servers.find(s=>s.name===seed.server)?.name??''):(servers.find(s=>s.name===onboarding?.mcpName)?.name??servers[0]?.name??''))
 const [tenant,setTenant]=useState(seed?.tenant??onboarding?.tenant??''),[project,setProject]=useState(seed?.project??''),[query,setQuery]=useState('skill'),[ref,setRef]=useState(seed?String(seed.ref):'')
 const [hits,setHits]=useState<AtlasSkillHit[]>([]),[searched,setSearched]=useState(false),[total,setTotal]=useState<number|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>active.current?.abort(),[])
 const reset=()=>{active.current?.abort();active.current=null;setBusy(false);setPreview(null);setHits([]);setSearched(false);setError(null)}
 const perform=async(action:(signal:AbortSignal)=>Promise<void>)=>{
  active.current?.abort();const ctrl=new AbortController();active.current=ctrl;setBusy(true);setError(null)
  try{if(scope!==skillScope())return;await action(ctrl.signal)}catch(e){if(!ctrl.signal.aborted)setError(e)}finally{if(active.current===ctrl){active.current=null;setBusy(false)}}
 }
 const search=()=>perform(async signal=>{setPreview(null);setHits([]);setSearched(false);const result=await findAtlasSkills(server,tenant,project,query,signal);if(!signal.aborted){setHits(result.hits);setTotal(result.total);setSearched(true)}})
 const read=(value:number)=>perform(async signal=>{setPreview(null);const result=await readAtlasSkill(server,tenant,project,value,signal);if(!signal.aborted)setPreview(result)})
 const take=()=>perform(async signal=>{if(!preview)return;const next=atlasSkillVersion(listSkills(scope),preview.spec,preview.source);const saved=await importSkillVersion(next,scope);if(!signal.aborted&&scope===skillScope())onImported(saved)})
 return <section className="skills__atlas" aria-label={t('features.ai.skills.atlas.title')}>
  <p>{t('features.ai.skills.atlas.intro')}</p>
  <button className="btn btn--sm" onClick={()=>{const id=servers.find(s=>s.name===server)?.id;void import('../../mcp').then(m=>m.openMcpConnections({...(id?{server:id}:{}),focus:'test'}))}}>{t('features.ai.skills.atlas.connections')}</button>
  {!servers.length&&<p role="status">{t('features.ai.skills.atlas.noConnection')}</p>}
  <div className="skills__scope">
   <label className="programs__field">{t('features.ai.skills.atlas.connection')}<select disabled={busy} value={server} onChange={e=>{reset();setServer(e.target.value)}}><option value="">—</option>{servers.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
   <label className="programs__field">{t('features.ai.skills.atlas.tenant')}<input disabled={busy} value={tenant} maxLength={100} onChange={e=>{reset();setTenant(e.target.value)}}/></label>
   <label className="programs__field">{t('features.ai.skills.atlas.project')}<input disabled={busy} value={project} maxLength={100} onChange={e=>{reset();setProject(e.target.value)}}/></label>
  </div>
  <div className="skills__scope">
   <label className="programs__field">{t('features.ai.skills.atlas.query')}<input disabled={busy} value={query} maxLength={200} onChange={e=>{reset();setQuery(e.target.value)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search()}}}/></label>
   <button className="btn" disabled={busy||!server||!tenant.trim()||!query.trim()} onClick={()=>void search()}>{t('features.ai.skills.atlas.search')}</button>
   <label className="programs__field">{t('features.ai.skills.atlas.ref')}<input disabled={busy} inputMode="numeric" value={ref} maxLength={12} onChange={e=>{reset();setRef(e.target.value)}}/></label>
   <button className="btn" disabled={busy||!server||!tenant.trim()||! /^[1-9][0-9]*$/.test(ref)} onClick={()=>void read(Number(ref))}>{t('features.ai.skills.atlas.read')}</button>
  </div>
  {busy&&<p role="status">{t('features.ai.skills.atlas.loading')}</p>}
  {error!==null&&<div role="alert" className="programs__error"><p>{t('features.ai.skills.atlas.failed')}</p>{error instanceof SkillError?<p>{t(error.code==='changed'?'features.ai.skills.atlas.conflict':'features.ai.skills.error.'+error.code)}</p>:<WorkerConnectionHelp error={error} server={server}/>}</div>}
  {searched&&<><p role="status">{t('features.ai.skills.atlas.results',{count:hits.length,total:total??'?'})}</p><p>{t('features.ai.skills.atlas.candidates')}</p></>}
  <div className="skills__hits">{hits.map(hit=><button key={hit.ref} className="skills__row" disabled={busy} onClick={()=>void read(hit.ref)}>{hit.title} · Ref {hit.ref}{hit.project?' · '+hit.project:''}</button>)}</div>
  {preview&&<section className="skills__preview" aria-label={t('features.ai.skills.atlas.preview')}>
   <h3>{preview.spec.name}</h3><p>{preview.spec.description}</p>
   <p><a href={preview.source.origin+'/r/'+preview.source.ref} target="_blank" rel="noreferrer">{preview.source.origin} · Ref {preview.source.ref}</a> · {preview.source.tenant} / {preview.source.project}</p>
   <p className="skills__hash">{t('features.ai.skills.atlas.hash')} · {preview.source.hash}</p>
   <p>{t('features.ai.skills.atlas.snapshot')}</p>
   <button className="btn btn--primary" disabled={busy} onClick={()=>void take()}>{t('features.ai.skills.atlas.take')}</button>
   <pre>{preview.spec.instructions}</pre>
  </section>}
 </section>
}
