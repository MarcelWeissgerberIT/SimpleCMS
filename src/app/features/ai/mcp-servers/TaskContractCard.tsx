import {pmBriefPlan} from '@/shared/ai/pmBrief'
import {mockIntent} from '@/shared/ai/designMock'
import {analysisIntent} from '@/shared/ai/analysis'
import {taskProgramDraft} from '../core/taskContract'
import {openPrograms} from '../programs/dialog'
import {useState} from 'react'
import type {TaskReport} from '@/shared/quandprofile/task'
import {answerTaskDecision,acceptTaskResult} from '../core/taskContract'
import {QuantumCube} from './QuantumCube'
import {useT} from '../../../i18n'
import './quantum-inspector.css'
import './task-contract.css'
/** Only the person's UI calls the decision resolver; no answer/approval function is offered to models. */
export function TaskContractCard({report,historical=false}:{report:TaskReport;historical?:boolean}){
 const t=useT(),[selected,setDimension]=useState('interpretation'),[answer,setAnswer]=useState(''),[error,setError]=useState(false),[saveError,setSaveError]=useState('')
 const question=report.questions.find(q=>q.state==='open'),c=report.compiled
 const dimensions=[...new Set(c.findings.flatMap(f=>f.dimensions))],dimension=dimensions.includes(selected)?selected:dimensions[0]??''
 const references=c.findings.map(f=>({key:f.id,id:c.quanta.find(q=>q.obligation_id===f.id)?.id,label:t('features.ai.task.finding.'+f.id),dimensions:f.dimensions,status:f.status}))
 const submit=(value:string)=>{const ok=!!question&&answerTaskDecision(report.id,question.id,value);setError(!ok);if(ok)setAnswer('')}
 return <section className="task-contract" data-phase={report.phase} aria-label={t('features.ai.task.title')}>
  <details open={report.questions.length>0?true:undefined}>
   <summary><span className="label">{t('features.ai.task.title')} · {c.contract_hash.slice(0,12)} · R{c.contract.revision}</span><strong>{t('features.ai.task.phase.'+report.phase)}</strong></summary>
   <div className="task-contract__body">
    <p>{c.contract.goal}</p>
    {report.program&&<p className="label">IR · V{report.program.version} · {report.program.hash.slice(0,12)} · {report.program.runId.slice(0,8)}</p>}
    {report.program&&<button className="btn btn--sm" onClick={()=>openPrograms()}>{t('features.ai.program.history')}</button>}
    {question&&historical&&<p><strong>{question.question}</strong><br/>{question.neededFor}</p>}
    {question&&!historical&&<form className="task-contract__decision" onKeyDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();submit(answer)}}>
      <h4>{t('features.ai.task.decision')}</h4><p><strong>{question.question}</strong></p><p>{t('features.ai.task.depends')} {question.neededFor}</p>
      <p>{t('features.ai.task.sources')} ONE: {question.sourceChecks.one?'✓':'—'} · Atlas: {question.sourceChecks.atlas?'✓':'—'}</p>
      {question.options.map((o,i)=><button type="button" className="btn task-contract__option" key={i} onClick={()=>submit(o.label+' — '+o.effect)}><strong>{o.label}</strong><span>{o.effect}</span></button>)}
      <label>{t('features.ai.task.answer')}<textarea value={answer} maxLength={4000} onChange={e=>setAnswer(e.target.value)} rows={3}/></label><button className="btn btn--primary" disabled={!answer.trim()}>{t('features.ai.task.resume')}</button>
      {error&&<p role="alert">{t('features.ai.task.stale')}</p>}
    </form>}
    {report.questions.filter(q=>q.state==='answered').map(q=><p key={q.id}><strong>{q.question}</strong><br/>{q.answer}</p>)}
    <details><summary>{t('features.ai.task.cube')}</summary>
    <QuantumCube dimensions={dimensions} references={references} coreId={c.contract_hash} selected={dimension} onSelect={setDimension} label={t('features.ai.task.cube')}/>
    </details>
    {report.observations.length>0&&<details><summary>{t('features.ai.task.sources')}</summary><ul>{report.observations.map((o,i)=><li key={i}>{o.area.toUpperCase()} · {o.tool} · {t(o.success?'features.ai.quantum.status.verified':'features.ai.quantum.status.violated')}</li>)}</ul></details>}
    <p className="task-contract__note">{t('features.ai.task.limit')}</p>
    {report.phase==='ready'&&!historical&&<button className="btn btn--sm" onClick={()=>{setError(!acceptTaskResult(report.id))}}>{t('features.ai.task.accept')}</button>}
    {!c.contract.authenticate&&!pmBriefPlan(c.contract.goal)&&!analysisIntent(c.contract.goal)&&!mockIntent(c.contract.goal)&&!report.observations.some(o=>o.tool==='create_design_mock')&&!report.program&&!historical&&['ready','accepted'].includes(report.phase)&&<button className="btn btn--sm" onClick={()=>{try{openPrograms(taskProgramDraft(report.id))}catch(e){setSaveError(String(e))}}}>{t('features.ai.program.capture')}</button>}
    {saveError&&<p role="alert">{saveError}</p>}
    {error&&!question&&<p role="alert">{t('features.ai.task.stale')}</p>}
    <details><summary>{t('features.ai.task.packet')}</summary><pre>{JSON.stringify(c.model_context,null,2)}</pre></details>
    <details><summary>{t('features.ai.task.receipt')}</summary><pre>{JSON.stringify(report,null,2)}</pre></details>
   </div>
  </details>
 </section>
}
