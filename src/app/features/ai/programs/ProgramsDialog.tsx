import {TypedSelection} from '../profiles/TypedSelection'
import '../profiles/profiles.css'
import {useEffect,useState} from 'react'
import {bindInputs,compileProgram,readProgram,workflowStep,workflowTarget,type ProgramSpec,type SavedProgram,type ProgramRun} from '@/shared/quandprofile/program'
import {Modal} from '../../../ui/Modal'
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {inTemplate,isEffectivelyTrashed} from '../../../store/selectors'
import {useCloud} from '../../../cloud/state'
import {listPrograms,listProgramRuns,saveProgram,programScope} from './storage'
import {closePrograms} from './dialog'
import {runTask} from '../agent/session'
import {openAgent,useAgent} from '../agent/state'
import {TERMINAL_TOOLS} from '../agent/tools'
import './programs.css'
function template():ProgramSpec{
 const read=TERMINAL_TOOLS.find(t=>t.name==='read_page')!
 return {protocol:'one.program.v1',goal:'Read the selected ONE page and provide a short source-based briefing. Do not change anything.',parameters:{page_id:{schema:{type:'string',minLength:1}}},steps:[{id:'page',kind:'tool',tool:'read_page',schema:read.input_schema,effect:'read',args:{object:{id:{input:'page_id'}}}},{id:'brief',kind:'generate',instruction:'Summarize only the fresh page. Cite its actual page reference. List missing information as open, not as facts.',context:{result:'page',path:[]}}],output:{result:'brief',path:[]}}
}
export default function ProgramsDialog({draft}:{draft?:ProgramSpec}){
 const t=useT()
 return <Modal open onClose={closePrograms} title={t('features.ai.program.title')} label="§ IR · V1" width={1100} className="programs-modal"><ProgramsDatabase draft={draft}/></Modal>
}
export function ProgramsPage(){
 const t=useT(),epoch=useWorkspace(s=>s.epoch),actor=useCloud(s=>s.user?.id),active=useCloud(s=>s.active)
 return <section className="programs-page"><header><span className="label">{t('features.ai.program.private')}</span><h1 className="display">{t('features.ai.program.database')}</h1></header><ProgramsDatabase key={JSON.stringify([epoch,actor,active])}/></section>
}
export function ProgramsDatabase({draft}:{draft?:ProgramSpec}){
 const t=useT(),scope=programScope(),epoch=useWorkspace(s=>s.epoch),pages=useWorkspace(s=>s.pages),active=useCloud(s=>s.active),actor=useCloud(s=>s.user?.id),busyRun=useAgent(s=>s.status==='running')
 const [rows,setRows]=useState<SavedProgram[]>([]),[runs,setRuns]=useState<ProgramRun[]>([]),[selected,setSelected]=useState<SavedProgram|null>(null),[editing,setEditing]=useState(!!draft),[name,setName]=useState(draft?.goal.slice(0,100)??''),[text,setText]=useState(JSON.stringify(draft??template(),null,2)),[values,setValues]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[tab,setTab]=useState<'library'|'history'>('library')
 const [pinned]=useState(scope.key),[query,setQuery]=useState(''),[allVersions,setAllVersions]=useState(false)
 useEffect(()=>{if(programScope().key!==pinned)closePrograms()},[epoch,actor,active,pinned])
 const load=async()=>{const [p,r]=await Promise.all([listPrograms(),listProgramRuns()]);if(programScope().key===pinned){setRows(p);setRuns(r)}}
 useEffect(()=>{let live=true;void Promise.all([listPrograms(),listProgramRuns()]).then(([p,r])=>{if(live&&programScope().key===pinned){setRows(p);setRuns(r)}}).catch(e=>live&&setError(String(e)));return()=>{live=false}},[pinned])
 let spec:ProgramSpec|null=null,hash='',invalid=''
 try{const c=editing?compileProgram(JSON.parse(text)):selected?.compiled;if(c){spec=readProgram(c);hash=c.hash}}catch(e){invalid=String(e)}
 const pick=(row:SavedProgram)=>{const p=readProgram(row.compiled);setSelected(row);setEditing(false);setName(row.name);setText(JSON.stringify(p,null,2));setValues(Object.fromEntries(Object.entries(p.parameters).map(([key,p])=>[key,Object.hasOwn(p,'default')?JSON.stringify(p.default,null,2):''])));setConfirmed(false);setError('');requestAnimationFrame(()=>document.querySelector('.programs-modal .modal__body')?.scrollTo({top:0}))}
 const save=async()=>{setBusy(true);setError('');try{const next=await saveProgram(name,JSON.parse(text),selected??undefined);await load();pick(next)}catch(e){setError(String(e))}finally{setBusy(false)}}
 const start=()=>{if(!selected||!spec||busyRun)return;try{const inputs=Object.fromEntries(Object.keys(spec.parameters).filter(k=>values[k]?.trim()).map(k=>[k,JSON.parse(values[k]!)]));bindInputs(spec,inputs);workflowTarget(spec,inputs);if(spec.steps.some(s=>s.kind==='workflow'||s.kind==='tool'&&s.effect!=='read')&&!confirmed)throw Error(t('features.ai.program.confirm'));if(programScope().key!==pinned)throw Error(t('features.ai.task.stale'));const inv={saved:selected,inputs,effectsConfirmed:confirmed,scope:programScope()};closePrograms();openAgent();void runTask(spec.goal,{program:inv,noMemory:true})}catch(e){setError(String(e))}}
 const newProgram=()=>{setSelected(null);setName('');setText(JSON.stringify(template(),null,2));setEditing(true);setError('');setConfirmed(false)}
 const effects=spec?.steps.filter(s=>s.kind==='tool'&&s.effect!=='read')??[],workflow=spec?workflowStep(spec):undefined
 const latest=new Map<string,number>();for(const row of rows)latest.set(row.id,Math.max(latest.get(row.id)??0,row.version))
 const visible=rows.filter(row=>(allVersions||latest.get(row.id)===row.version)&&(row.name+' '+row.compiled.hash).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 const mode=(row:SavedProgram)=>workflowStep(readProgram(row.compiled))?.mode.toUpperCase()??t('features.ai.program.fixed')
 if(scope.key!==pinned)return null
 return <div className="programs" onKeyDown={e=>e.stopPropagation()}>
  <p className="programs__intro">{t('features.ai.program.intro')}</p>
  <nav className="programs__tabs"><button className="btn" aria-pressed={tab==='library'} onClick={()=>setTab('library')}>{t('features.ai.program.library')}</button><button className="btn" aria-pressed={tab==='history'} onClick={()=>{setTab('history');void load().catch(e=>setError(String(e)))}}>{t('features.ai.program.history')}</button></nav>
  {error&&<p role="alert" className="programs__error">{error}</p>}
  {tab==='history'?<div className="programs__history">{!runs.length&&<p>{t('features.ai.program.noRuns')}</p>}{runs.map(r=><details key={r.id}><summary><strong>{rows.find(p=>p.id===r.programId&&p.version===r.version)?.name??r.programId}</strong><span>V{r.version} · {r.hash.slice(0,12)} · {t('features.ai.program.status.'+r.status)} · {new Date(r.startedAt).toLocaleString()}</span></summary><p>{r.answer??r.error}</p><pre>{JSON.stringify(r,null,2)}</pre></details>)}</div>:<div className="programs__layout">
  <div className="programs__database" role="region" aria-label={t('features.ai.program.database')}>
   <div className="programs__toolbar"><label className="programs__search">{t('features.ai.program.search')}<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label><label><input type="checkbox" checked={allVersions} onChange={e=>setAllVersions(e.target.checked)}/> {t('features.ai.program.allVersions')}</label><button className="btn" onClick={()=>void load().catch(e=>setError(String(e)))}>{t('features.ai.program.refresh')}</button><button className="btn btn--primary" onClick={newProgram}>{t('features.ai.program.new')}</button></div>
   <div className="programs__table-scroll"><table><caption className="visually-hidden">{t('features.ai.program.private')}</caption><thead><tr>{['name','kind','version','savedAt','lastRun'].map(key=><th key={key}>{t('features.ai.program.'+key)}</th>)}</tr></thead><tbody>{visible.map(row=>{const last=runs.find(r=>r.programId===row.id&&r.version===row.version);return <tr key={row.id+row.version} aria-selected={selected?.id===row.id&&selected.version===row.version}><td><button className="programs__name" onClick={()=>pick(row)}>{row.name}</button><small>{row.compiled.hash.slice(0,12)}</small></td><td>{mode(row)}</td><td>V{row.version}</td><td>{new Date(row.createdAt).toLocaleString()}</td><td>{last?<><span>{t('features.ai.program.status.'+last.status)}</span><small>{new Date(last.finishedAt).toLocaleString()}</small></>:t('features.ai.program.notRun')}</td></tr>})}</tbody></table></div>
   {!visible.length&&<p>{t(rows.length?'features.ai.program.noMatches':'features.ai.program.empty')}</p>}
  </div>
  <div className="programs__details">
   {(!selected&&!editing)?<p>{t('features.ai.program.choose')}</p>:<>
   <div className="programs__plate"><span className="label">{t('features.ai.program.artifact')} · {selected?'V'+selected.version:t('features.ai.program.draft')}</span><h3>{name||t('features.ai.program.new')}</h3><code>{hash||'—'}</code><p>{spec?.goal}</p></div>
   {spec?.profile?.spec.typedAI&&<TypedSelection value={spec.profile.spec.typedAI}/>}
   {editing?<><label className="programs__field">{t('features.ai.program.name')}<input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label><p>{t('features.ai.program.editHelp')}</p><label className="programs__field">{t('features.ai.program.definition')}<textarea className="programs__source" value={text} onChange={e=>setText(e.target.value)} spellCheck={false} rows={18}/></label>{invalid&&<p role="alert" className="programs__error">{invalid}</p>}<button className="btn btn--primary" disabled={busy||!!invalid||!name.trim()} onClick={()=>void save()}>{t(selected?'features.ai.program.saveVersion':'features.ai.program.save')}</button></>:<>
   <ol className="programs__steps">{spec?.steps.map(s=><li key={s.id}><span>{s.id}</span><strong>{s.kind==='tool'?(s.server?s.server+' · ':'ONE · ')+s.tool:s.kind==='decision'?s.question:s.kind==='workflow'?s.mode.toUpperCase()+' · '+t('features.ai.program.freshWorkflow'):t('features.ai.program.generate')}</strong><small>{s.kind==='tool'?t('features.ai.program.effect.'+s.effect):s.kind==='generate'?t('features.ai.program.noTools'):s.kind==='workflow'?t('features.ai.program.workflowHelp'):t('features.ai.program.freshDecision')}</small></li>)}</ol>
   <h4>{t(workflow?'features.ai.program.workflowInputs':'features.ai.program.inputs')}</h4>{Object.entries(spec?.parameters??{}).map(([key,d])=>workflow&&key==='page_id'?<label className="programs__field" key={key}>{t('features.ai.program.sourcePage')}<select aria-label={t('features.ai.program.sourcePage')} value={(()=>{try{return JSON.parse(values[key]??'null')??''}catch{return ''}})()} onChange={e=>setValues(v=>({...v,[key]:JSON.stringify(e.target.value||null)}))}><option value="">{t('features.ai.program.noPage')}</option>{Object.values(pages).filter(p=>!isEffectivelyTrashed(pages,p.id)&&!inTemplate(pages,p.id)).map(p=><option key={p.id} value={p.id}>{p.title||t('common.untitled')}</option>)}</select></label>:<label className="programs__field" key={key}><strong>{key}</strong><small>{Object.hasOwn(d,'default')?t('features.ai.program.defaultHint'):t('features.ai.program.requiredHint')}</small><textarea aria-label={key} value={values[key]??''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} rows={Math.min(8,Math.max(2,(values[key]??'').split('\n').length))} spellCheck={false}/></label>)}
   {workflow?.connections.map(c=><p key={c.name}><strong>{c.name}</strong> · {c.endpoint}</p>)}
   {(!!effects.length||!!workflow)&&<label className="programs__confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{t(workflow?'features.ai.program.workflowConfirm':'features.ai.program.confirm')}<br/>{effects.map(s=>s.kind==='tool'?s.tool+' ('+s.effect+')':'').join(' · ')}</span></label>}
   <div className="programs__actions"><button className="btn btn--primary" disabled={busyRun||(!!effects.length||!!workflow)&&!confirmed} onClick={start}>{t('features.ai.program.start')}</button><button className="btn" onClick={()=>{setEditing(true);setConfirmed(false)}}>{t('features.ai.program.editVersion')}</button></div>
   <p>{t('features.ai.program.runHelp')}</p><details><summary>{t('features.ai.program.definition')}</summary><pre>{text}</pre></details>
   </>}
   </>}
  </div>
 </div>}
 </div>
}
