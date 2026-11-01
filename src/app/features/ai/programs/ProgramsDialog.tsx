import {useEffect,useState} from 'react'
import {bindInputs,compileProgram,readProgram,type ProgramSpec,type SavedProgram,type ProgramRun} from '@/shared/quandprofile/program'
import {Modal} from '../../../ui/Modal'
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
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
 const t=useT(),scope=programScope(),epoch=useWorkspace(s=>s.epoch),actor=useCloud(s=>s.user?.id),busyRun=useAgent(s=>s.status==='running')
 const [rows,setRows]=useState<SavedProgram[]>([]),[runs,setRuns]=useState<ProgramRun[]>([]),[selected,setSelected]=useState<SavedProgram|null>(null),[editing,setEditing]=useState(!!draft),[name,setName]=useState(draft?.goal.slice(0,100)??''),[text,setText]=useState(JSON.stringify(draft??template(),null,2)),[values,setValues]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[tab,setTab]=useState<'library'|'history'>('library')
 const [pinned]=useState(scope.key)
 useEffect(()=>{if(programScope().key!==pinned)closePrograms()},[epoch,actor,pinned])
 const load=async()=>{const [p,r]=await Promise.all([listPrograms(),listProgramRuns()]);if(programScope().key===pinned){setRows(p);setRuns(r)}}
 useEffect(()=>{let live=true;void Promise.all([listPrograms(),listProgramRuns()]).then(([p,r])=>{if(live&&programScope().key===pinned){setRows(p);setRuns(r)}}).catch(e=>live&&setError(String(e)));return()=>{live=false}},[pinned])
 let spec:ProgramSpec|null=null,hash='',invalid=''
 try{const c=editing?compileProgram(JSON.parse(text)):selected?.compiled;if(c){spec=readProgram(c);hash=c.hash}}catch(e){invalid=String(e)}
 const pick=(row:SavedProgram)=>{const p=readProgram(row.compiled);setSelected(row);setEditing(false);setName(row.name);setText(JSON.stringify(p,null,2));setValues(Object.fromEntries(Object.entries(p.parameters).map(([key,p])=>[key,Object.hasOwn(p,'default')?JSON.stringify(p.default,null,2):''])));setConfirmed(false);setError('');requestAnimationFrame(()=>document.querySelector('.programs-modal .modal__body')?.scrollTo({top:0}))}
 const save=async()=>{setBusy(true);setError('');try{const next=await saveProgram(name,JSON.parse(text),selected??undefined);await load();pick(next)}catch(e){setError(String(e))}finally{setBusy(false)}}
 const start=()=>{if(!selected||!spec||busyRun)return;try{const inputs=Object.fromEntries(Object.keys(spec.parameters).filter(k=>values[k]?.trim()).map(k=>[k,JSON.parse(values[k]!)]));bindInputs(spec,inputs);if(spec.steps.some(s=>s.kind==='tool'&&s.effect!=='read')&&!confirmed)throw Error(t('features.ai.program.confirm'));if(programScope().key!==pinned)throw Error(t('features.ai.task.stale'));const inv={saved:selected,inputs,effectsConfirmed:confirmed,scope:programScope()};closePrograms();openAgent();void runTask(spec.goal,{program:inv,noMemory:true})}catch(e){setError(String(e))}}
 const newProgram=()=>{setSelected(null);setName('');setText(JSON.stringify(template(),null,2));setEditing(true);setError('');setConfirmed(false)}
 const effects=spec?.steps.filter(s=>s.kind==='tool'&&s.effect!=='read')??[]
 return <Modal open onClose={closePrograms} title={t('features.ai.program.title')} label="§ IR · V1" width={1040} className="programs-modal">
 <div className="programs" onKeyDown={e=>e.stopPropagation()}>
  <p className="programs__intro">{t('features.ai.program.intro')}</p>
  <nav className="programs__tabs"><button className="btn" aria-pressed={tab==='library'} onClick={()=>setTab('library')}>{t('features.ai.program.library')}</button><button className="btn" aria-pressed={tab==='history'} onClick={()=>{setTab('history');void load().catch(e=>setError(String(e)))}}>{t('features.ai.program.history')}</button></nav>
  {error&&<p role="alert" className="programs__error">{error}</p>}
  {tab==='history'?<div className="programs__history">{!runs.length&&<p>{t('features.ai.program.noRuns')}</p>}{runs.map(r=><details key={r.id}><summary><strong>{rows.find(p=>p.id===r.programId&&p.version===r.version)?.name??r.programId}</strong><span>V{r.version} · {r.hash.slice(0,12)} · {t('features.ai.program.status.'+r.status)} · {new Date(r.startedAt).toLocaleString()}</span></summary><p>{r.answer??r.error}</p><pre>{JSON.stringify(r,null,2)}</pre></details>)}</div>:<div className="programs__layout">
  <aside><button className="btn btn--primary" onClick={newProgram}>{t('features.ai.program.new')}</button>{!rows.length&&<p>{t('features.ai.program.empty')}</p>}{rows.map(row=><button key={row.id+row.version} className="programs__version" aria-pressed={selected?.id===row.id&&selected.version===row.version} onClick={()=>pick(row)}><strong>{row.name}</strong><span>V{row.version} · {row.compiled.hash.slice(0,12)}</span><small>{new Date(row.createdAt).toLocaleString()}</small></button>)}</aside>
  <main>
   {(!selected&&!editing)?<p>{t('features.ai.program.choose')}</p>:<>
   <div className="programs__plate"><span className="label">{t('features.ai.program.artifact')} · {selected?'V'+selected.version:t('features.ai.program.draft')}</span><h3>{name||t('features.ai.program.new')}</h3><code>{hash||'—'}</code><p>{spec?.goal}</p></div>
   {editing?<><label className="programs__field">{t('features.ai.program.name')}<input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label><p>{t('features.ai.program.editHelp')}</p><label className="programs__field">{t('features.ai.program.definition')}<textarea className="programs__source" value={text} onChange={e=>setText(e.target.value)} spellCheck={false} rows={18}/></label>{invalid&&<p role="alert" className="programs__error">{invalid}</p>}<button className="btn btn--primary" disabled={busy||!!invalid||!name.trim()} onClick={()=>void save()}>{t(selected?'features.ai.program.saveVersion':'features.ai.program.save')}</button></>:<>
   <ol className="programs__steps">{spec?.steps.map(s=><li key={s.id}><span>{s.id}</span><strong>{s.kind==='tool'?(s.server?s.server+' · ':'ONE · ')+s.tool:s.kind==='decision'?s.question:t('features.ai.program.generate')}</strong><small>{s.kind==='tool'?t('features.ai.program.effect.'+s.effect):s.kind==='generate'?t('features.ai.program.noTools'):t('features.ai.program.freshDecision')}</small></li>)}</ol>
   <h4>{t('features.ai.program.inputs')}</h4>{Object.entries(spec?.parameters??{}).map(([key,d])=><label className="programs__field" key={key}><strong>{key}</strong><small>{Object.hasOwn(d,'default')?t('features.ai.program.defaultHint'):t('features.ai.program.requiredHint')}</small><textarea aria-label={key} value={values[key]??''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} rows={Math.min(8,Math.max(2,(values[key]??'').split('\n').length))} spellCheck={false}/></label>)}
   {!!effects.length&&<label className="programs__confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{t('features.ai.program.confirm')}<br/>{effects.map(s=>s.kind==='tool'?s.tool+' ('+s.effect+')':'').join(' · ')}</span></label>}
   <div className="programs__actions"><button className="btn btn--primary" disabled={busyRun||!!effects.length&&!confirmed} onClick={start}>{t('features.ai.program.start')}</button><button className="btn" onClick={()=>{setEditing(true);setConfirmed(false)}}>{t('features.ai.program.editVersion')}</button></div>
   <p>{t('features.ai.program.runHelp')}</p><details><summary>{t('features.ai.program.definition')}</summary><pre>{text}</pre></details>
   </>}
   </>}
  </main>
 </div>}
 </div></Modal>
}
