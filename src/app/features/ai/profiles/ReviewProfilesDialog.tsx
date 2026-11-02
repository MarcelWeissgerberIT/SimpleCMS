import {useEffect,useState} from 'react'
import {REVIEW_DIMENSIONS,blankReviewProfile,reviewProfileSpec,type ReviewDimension,type ReviewProfile,type ReviewProfileSpec} from '@/shared/quandprofile/review-profile'
import {Modal} from '../../../ui/Modal'
import {useT} from '../../../i18n'
import {useRoute} from '../../../lib/router'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud/state'
import {reviewProfiles,saveReviewProfile,selectReviewProfile,profileScope} from './storage'
import {closeReviewProfiles} from './dialog'
import {QuantumCube,type CubeReference} from '../mcp-servers/QuantumCube'
import {CompilationFlow} from './CompilationFlow'
import '../mcp-servers/quantum-inspector.css'
import '../programs/programs.css'
import './profiles.css'
const checks:[string,ReviewDimension[]][]=[['task_scope_current',['freshness']],['task_provider_checked',['privacy']],['task_action_allowed',['permission']],['task_search_before_question',['provenance','interpretation']],['task_decisions_resolved',['interpretation']],['task_sources_observed',['provenance']],['task_observed_claims',['data']],['task_result_shape',['outcome']],['task_human_acceptance',['outcome','interpretation']],['profile_one_sources',['provenance']],['profile_atlas_sources',['provenance']],['profile_write_target',['permission']],['profile_read_only',['permission']]]
const split=(v:string)=>v.split(/[\n,;]+/u).map(s=>s.trim()).filter(Boolean)
export default function ReviewProfilesDialog(){
 const t=useT(),route=useRoute(),epoch=useWorkspace(s=>s.epoch),actor=useCloud(s=>s.user?.id),workspace=useCloud(s=>s.active.kind==='cloud'?s.active.id:'local')
 const [pinned]=useState(profileScope),[rows,setRows]=useState<ReviewProfile[]>([]),[active,setActive]=useState<{id:string;version:number}|null>(null),[selected,setSelected]=useState<ReviewProfile|null>(null),[spec,setSpec]=useState<ReviewProfileSpec>(blankReviewProfile),[dimension,setDimension]=useState<ReviewDimension>('provenance'),[pages,setPages]=useState(''),[refs,setRefs]=useState(''),[targets,setTargets]=useState(''),[terms,setTerms]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{if(profileScope()!==pinned)closeReviewProfiles()},[epoch,actor,workspace,pinned])
 const pick=(p:ReviewProfile|null)=>{setSelected(p);const s=p?.spec??blankReviewProfile();setSpec(s);setPages(s.onePages.join('\n'));setRefs(s.atlasRefs.join('\n'));setTargets(s.atlasWriteRefs.join('\n'));setTerms(s.requiredTerms.join('\n'));setError('');setNotice('')}
 useEffect(()=>{let live=true;void reviewProfiles().then(v=>{if(live&&profileScope()===pinned){setRows(v.rows);setActive(v.active);const p=v.rows.find(p=>p.id===v.active?.id&&p.version===v.active?.version);if(p)pick(p);setLoaded(true)}}).catch(e=>live&&setError(String(e)));return()=>{live=false}},[pinned])
 const change=<K extends keyof ReviewProfileSpec>(key:K,value:ReviewProfileSpec[K])=>{setSpec(s=>({...s,[key]:value}));setNotice('')}
 const refresh=async()=>{const v=await reviewProfiles();if(profileScope()!==pinned)return;setRows(v.rows);setActive(v.active)}
 const save=async(activate:boolean)=>{setBusy(true);setError('');try{const next=await saveReviewProfile(reviewProfileSpec({...spec,onePages:split(pages),atlasRefs:split(refs).map(Number),atlasWriteRefs:split(targets).map(Number),requiredTerms:terms.split('\n').map(s=>s.trim()).filter(Boolean)}),selected,activate);await refresh();pick(next);setNotice(t('features.ai.cube.saved'))}catch(e){setError(String(e))}finally{setBusy(false)}}
 const activate=async(p:ReviewProfile|null)=>{setBusy(true);setError('');try{await selectReviewProfile(p);await refresh();setNotice(t('features.ai.cube.nextRun'))}catch(e){setError(String(e))}finally{setBusy(false)}}
 const template=(kind:'ba'|'review')=>{pick(null);setSpec({...blankReviewProfile(),name:t('features.ai.cube.template.'+kind),readOnly:kind==='ba',requireOne:true,requireAtlas:kind==='review',guidance:{interpretation:t('features.ai.cube.templateGuidance')}});if(route.name==='page')setPages(route.id)}
 const references:CubeReference[]=[...checks.map(([key,dimensions])=>({key,label:t('features.ai.task.finding.'+key),dimensions,status:'open' as const})),...REVIEW_DIMENSIONS.filter(d=>spec.guidance[d]?.trim()).map(d=>({key:'profile_guidance_'+d,label:t('features.ai.cube.guidance'),dimensions:[d],status:'open' as const}))]
 const toggle=(key:'readOnly'|'requireOne'|'requireAtlas'|'beforeEffects',label:string)=><label className="cube-profiles__toggle"><input type="checkbox" checked={spec[key]} onChange={e=>change(key,e.target.checked)}/><span>{t('features.ai.cube.'+label)}</span></label>
 return <Modal open onClose={closeReviewProfiles} title={t('features.ai.cube.title')} label="§ CUBE · PROFILE" width={1120} className="cube-profiles-modal"><div className="programs cube-profiles" onKeyDown={e=>e.stopPropagation()}>
 <p className="programs__intro">{t('features.ai.cube.intro')}</p><p className="cube-profiles__scope">{t('features.ai.cube.scope')}</p>
 <CompilationFlow/>
 {error&&<p role="alert" className="programs__error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="programs__layout"><aside><div className="programs__actions"><button className="btn" disabled={!loaded||busy} onClick={()=>pick(null)}>{t('features.ai.cube.new')}</button><button className="btn" disabled={!loaded||busy||!active} onClick={()=>void activate(null)}>{t('features.ai.cube.base')}</button></div><p>{t(active?'features.ai.cube.active':'features.ai.cube.baseActive')} {active&&rows.find(p=>p.id===active.id&&p.version===active.version)?.spec.name} {active&&' · V'+active.version}</p>
 {(['ba','review'] as const).map(k=><button key={k} className="programs__version" disabled={!loaded||busy} onClick={()=>template(k)}><strong>{t('features.ai.cube.template.'+k)}</strong><small>{t('features.ai.cube.templateHint')}</small></button>)}
 {rows.map(p=><button className="programs__version" key={p.id+p.version} disabled={busy} aria-pressed={selected?.id===p.id&&selected.version===p.version} onClick={()=>pick(p)}><strong>{p.spec.name}</strong><span>V{p.version} · {p.hash.slice(0,12)}{active?.id===p.id&&active.version===p.version?' · '+t('features.ai.cube.active'):''}</span></button>)}</aside>
 <main><label className="programs__field">{t('features.ai.cube.name')}<input maxLength={120} value={spec.name} onChange={e=>change('name',e.target.value)}/></label>
 {selected&&<div className="cube-profiles__version"><code>{selected.hash}</code><span>V{selected.version} · {t('features.ai.cube.immutable')}</span></div>}
 <div className="cube-profiles__preview"><span className="label">{t('features.ai.cube.preview')}</span><QuantumCube dimensions={[...REVIEW_DIMENSIONS]} selected={dimension} onSelect={d=>setDimension(d as ReviewDimension)} label={t('features.ai.cube.preview')} references={references}/></div>
 <section className="cube-profiles__dimension"><h3>{t('features.ai.quantum.dimension.'+dimension)}</h3><p>{t('features.ai.cube.dimensionHelp.'+dimension)}</p>
 {dimension==='permission'&&<>{toggle('readOnly','readOnly')}<label className="programs__field">{t('features.ai.cube.writeRefs')}<textarea aria-label={t('features.ai.cube.writeRefs')} rows={3} value={targets} onChange={e=>setTargets(e.target.value)}/><small>{t('features.ai.cube.writeRefsHelp')}</small></label></>}
 {dimension==='provenance'&&<>{toggle('requireOne','requireOne')}{toggle('requireAtlas','requireAtlas')}{toggle('beforeEffects','beforeEffects')}
 <label className="programs__field">{t('features.ai.cube.onePages')}<textarea aria-label={t('features.ai.cube.onePages')} rows={3} value={pages} onChange={e=>setPages(e.target.value)}/><small>{t('features.ai.cube.sourceHint')}</small></label>{route.name==='page'&&<button className="btn btn--sm" onClick={()=>setPages(v=>[...new Set([...split(v),route.id])].join('\n'))}>{t('features.ai.cube.currentPage')}</button>}
 <label className="programs__field">{t('features.ai.cube.atlasRefs')}<textarea aria-label={t('features.ai.cube.atlasRefs')} rows={3} value={refs} onChange={e=>setRefs(e.target.value)}/><small>{t('features.ai.cube.sourceHint')}</small></label></>}
 {dimension==='outcome'&&<><label className="programs__field">{t('features.ai.cube.output')}<select value={spec.output} onChange={e=>change('output',e.target.value as 'json'|'inherit')}><option value="inherit">{t('features.ai.cube.outputInherit')}</option><option value="json">JSON</option></select></label><label className="programs__field">{t('features.ai.cube.requiredTerms')}<textarea aria-label={t('features.ai.cube.requiredTerms')} rows={3} value={terms} onChange={e=>setTerms(e.target.value)}/><small>{t('features.ai.cube.termsHint')}</small></label></>}
 <label className="programs__field">{t('features.ai.cube.guidance')}<textarea aria-label={t('features.ai.cube.guidance')} rows={4} maxLength={1200} value={spec.guidance[dimension]??''} onChange={e=>change('guidance',{...spec.guidance,[dimension]:e.target.value})}/><small>{t('features.ai.cube.guidanceHelp')}</small></label></section>
 <div className="programs__actions"><button className="btn btn--primary" disabled={!loaded||busy||!spec.name.trim()} onClick={()=>void save(true)}>{t('features.ai.cube.saveActivate')}</button><button className="btn" disabled={!loaded||busy||!spec.name.trim()} onClick={()=>void save(false)}>{t('features.ai.cube.save')}</button>{selected&&<button className="btn" disabled={busy} onClick={()=>void activate(selected)}>{t('features.ai.cube.activateSaved')}</button>}</div>
 <p>{t('features.ai.cube.nextRun')}</p><p>{t('features.ai.cube.boundaries')}</p>
 </main></div></div></Modal>
}
