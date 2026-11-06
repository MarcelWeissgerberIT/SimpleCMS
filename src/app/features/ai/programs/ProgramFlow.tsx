import {useState} from 'react'
import type {ProgramSpec,ProgramRun} from '@/shared/quandprofile/program'
import {useT} from '../../../i18n'
import {expressionBindings} from './inspectionModel'
/** The saved IR, not an imagined model thought process. Select a block to inspect its exact bindings. */
export function ProgramFlow({spec,run}:{spec:ProgramSpec;run?:ProgramRun}){
 const t=useT(),[selected,setSelected]=useState(spec.steps[0]!.id),step=spec.steps.find(s=>s.id===selected)??spec.steps[0]!
 const binding=step.kind==='tool'?expressionBindings(step.args):step.kind==='generate'?expressionBindings(step.context):step.kind==='workflow'?expressionBindings(step.target):{inputs:[],results:[]}
 const title=(s:typeof step)=>s.kind==='tool'?(s.server?s.server+' · ':'ONE · ')+s.tool:s.kind==='workflow'?s.mode.toUpperCase()+' · '+t('features.ai.program.freshWorkflow'):s.kind==='decision'?s.question:t('features.ai.program.generate')
 const proof=run?.steps.find(p=>p.id===step.id)
 return <section className="program-flow" aria-label={t('features.ai.program.inspection.flow')}>
  <p>{t('features.ai.program.inspection.flowHelp')}</p>
  <ol>{spec.steps.map((s,index)=>{const result=run?.steps.find(p=>p.id===s.id);return <li key={s.id}><button type="button" aria-pressed={step.id===s.id} onClick={()=>setSelected(s.id)}><span className="program-flow__number">{String(index+1).padStart(2,'0')}</span><span><strong>{title(s)}</strong><small>{s.id} · {t('features.ai.program.inspection.kind.'+s.kind)}</small></span><span className="label">{t(result?'features.ai.program.status.'+(result.status==='done'?'done':'failed'):'features.ai.program.inspection.notRecorded')}</span></button>{index<spec.steps.length-1&&<span className="program-flow__arrow" aria-hidden>↓</span>}</li>})}</ol>
  <section className="program-flow__details" aria-label={t('features.ai.program.inspection.block')}><h4>{title(step)}</h4>
   {step.kind==='workflow'&&<p>{t('features.ai.program.workflowHelp')}</p>}
   {step.kind==='tool'&&<p><strong>{t('features.ai.program.effect.'+step.effect)}</strong>{step.endpoint&&<> · <code>{step.endpoint}</code></>}</p>}
   {step.kind==='generate'&&<p>{step.instruction}</p>}
   {step.kind==='decision'&&<p>{step.neededFor}</p>}
   <div className="program-flow__bindings"><strong>{t('features.ai.program.inspection.inputs')}</strong>{binding.inputs.length?binding.inputs.map(key=><code key={key}>{key}</code>):<span>—</span>}<strong>{t('features.ai.program.inspection.previous')}</strong>{binding.results.length?binding.results.map(id=><button type="button" className="btn btn--sm" key={id} onClick={()=>setSelected(id)}>{id}</button>):<span>—</span>}</div>
   {proof&&<dl>{Object.entries({input:proof.inputHash,output:proof.outputHash,contract:proof.contractHash}).filter(([,value])=>value).map(([key,value])=><div key={key}><dt>{key} · SHA-256</dt><dd><code>{value}</code></dd></div>)}</dl>}
   <details><summary>{t('features.ai.program.inspection.exactBlock')}</summary><pre>{JSON.stringify(step,null,2)}</pre></details>
  </section>
 </section>
}
