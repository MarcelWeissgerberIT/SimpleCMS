import {useState} from 'react'
import type {ProgramSpec,ProgramRun} from '@/shared/quandprofile/program'
import {readProgramInspection,type ProgramInspection} from '@/shared/quandprofile/program-inspection'
import {REVIEW_DIMENSIONS} from '@/shared/quandprofile/review-profile'
import {useT} from '../../../i18n'
import {QuantumCube} from '../mcp-servers/QuantumCube'
import {programCheckCatalogue} from './inspectionModel'
import {useRunDetail} from './useRunDetail'
import {ProgramFlow} from './ProgramFlow'
import {ProgramRunResult} from './ProgramRunResult'
import '../mcp-servers/quantum-inspector.css'
export function HistoricalChecks({raw,model,at}:{raw:unknown;model:string;at:number}){
 const t=useT(),[dimension,setDimension]=useState('interpretation')
 let inspection:ProgramInspection
 try{inspection=readProgramInspection(raw)}catch{return <p role="alert">{t('features.ai.program.inspection.invalid')}</p>}
 const c=inspection,references=c.findings.map(f=>{const q=c.quanta.find(q=>q.obligation_id===f.id);return{key:f.id,label:t('features.ai.task.finding.'+f.id),id:q?.id,dimensions:f.dimensions,status:f.status,detail:f.detail,verifier:q?.verifier,dependencies:q?.dependencies}})
 return <section className="program-inspection" aria-label={t('features.ai.program.inspection.recorded')}>
  <p className="program-inspection__notice"><strong>{t('features.ai.program.inspection.recorded')}</strong> · {new Date(at).toLocaleString()} · {model}<br/>{t('features.ai.program.inspection.historical')}</p>
  <QuantumCube dimensions={c.dimensions} references={references} coreId={c.contractHash} selected={dimension} onSelect={setDimension} label={t('features.ai.program.inspection.space')}/>
  <dl className="program-inspection__sources">{Object.entries(c.sources).map(([kind,ids])=><div key={kind}><dt>{kind==='one'?'ONE':kind==='atlas'?'Atlas':t('features.ai.program.inspection.other')}</dt><dd>{ids.length?ids.map(id=><code key={id}>{id}</code>):'—'}</dd></div>)}</dl>
  <details><summary>{t('features.ai.program.inspection.tools')} · {c.observations.length}</summary><ol className="program-inspection__tools">{c.observations.map((o,i)=><li key={i}><strong>{o.area.toUpperCase()} · {o.tool}</strong><span>{t(o.success?'features.ai.program.inspection.observed':'features.ai.program.inspection.failed')} · {new Date(o.at).toLocaleTimeString()}</span></li>)}</ol></details>
  <details><summary>{t('features.ai.task.packet')}</summary><p>{t('features.ai.program.inspection.packetHelp')}</p><code>SHA-256 {c.packetHash}</code>{c.packet?<pre>{JSON.stringify(c.packet,null,2)}</pre>:<p>{t('features.ai.program.inspection.packetOmitted')}</p>}</details>
 </section>
}
export function ProgramInspectionView({spec,runs,view}:{spec:ProgramSpec;runs:ProgramRun[];view:'flow'|'cube'|'proof'}){
 const t=useT(),[runId,setRunId]=useState(runs[0]?.id??''),[dimension,setDimension]=useState('interpretation')
 const preview=runs.find(r=>r.id===runId)??runs[0],{run,loading,error,retry}=useRunDetail(preview)
 return <div className="program-inspection-view">
  {runs.length>0&&<label className="programs__field">{t('features.ai.program.inspection.run')}<select value={preview?.id??''} onChange={e=>setRunId(e.target.value)}>{runs.map(r=><option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString()} · {r.route.model} · {t('features.ai.program.status.'+r.status)}</option>)}</select></label>}
  {error?<p role="alert">{t('features.ai.program.inspection.loadFailed')} <button className="btn" onClick={retry}>{t('features.ai.program.refresh')}</button></p>:loading?<p role="status">{t('features.ai.program.inspection.loading')}</p>:view==='flow'?<ProgramFlow spec={spec} run={run}/>:view==='cube'&&run?.inspection?<HistoricalChecks key={run.id} raw={run.inspection} model={run.route.model} at={run.finishedAt}/>:view==='cube'?<><p className="program-inspection__notice">{t(run?'features.ai.program.inspection.legacy':'features.ai.program.inspection.definition')}</p><QuantumCube dimensions={[...REVIEW_DIMENSIONS]} references={programCheckCatalogue(spec,key=>t('features.ai.task.finding.'+key))} coreId={undefined} selected={dimension} onSelect={setDimension} label={t('features.ai.program.inspection.space')}/></>:run?<><p className="program-inspection__notice">{t('features.ai.program.inspection.historical')}</p><ProgramRunResult run={run}/>{run.inspection&&<HistoricalChecks key={run.id} raw={run.inspection} model={run.route.model} at={run.finishedAt}/>}<details><summary>{t('features.ai.program.inspection.receipt')}</summary><pre>{JSON.stringify(run,null,2)}</pre></details></>:<p>{t('features.ai.program.noRuns')}</p>}
 </div>
}
