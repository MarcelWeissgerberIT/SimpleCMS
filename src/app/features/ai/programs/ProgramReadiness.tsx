import {useState} from 'react'
import {workflowTarget,type ProgramSpec} from '@/shared/quandprofile/program'
import {useWorkspace} from '../../../store/store'
import {useT} from '../../../i18n'
import {useAgent} from '../agent/state'
import {currentSetup} from '../mcp-servers/config'
import {useWorkerModels} from '../core/workerModels'
import {useCentralAI} from '../core/centralAI'
import {precheck,routeFor} from '../core/gate'
import {AIError,aiErrorText} from '../core/errors'
import {RouteChip} from '../routing/RouteChip'
import {inspectProgramInputs,sourcePageAvailable,sourceParameter} from './inputModel'
/** A local dry check. No model request, source fetch, external action or reusable approval. */
export function ProgramReadiness({spec,values,busy,confirmed,onInspect}:{spec:ProgramSpec;values:Record<string,string>;busy:boolean;confirmed:boolean;onInspect:()=>void}){
 const t=useT(),pages=useWorkspace(s=>s.pages),settings=useWorkspace(s=>s.settings),ai=useWorkspace(s=>s.ai),route=useAgent(s=>s.route)
 const [checked,setChecked]=useState<{signature:string;problems:string[]}|null>(null)
 const inspection=inspectProgramInputs(spec,values)
 useWorkerModels();useCentralAI()
 const preview=routeFor('terminal.task',{route})
 const sources=Object.keys(spec.parameters).filter(key=>sourceParameter(spec,key)).map(key=>{const id=inspection.values[key];return typeof id==='string'?[id,sourcePageAvailable(pages,id),pages[id]?.updatedAt,pages[id]?.contentRev]:[id]})
 const signature=JSON.stringify([spec,values,settings,ai,route,busy,confirmed,sources,preview.route,preview.available])
 const check=()=>{
  onInspect();const problems=inspection.issues.map(issue=>t('features.ai.program.input.'+issue.kind,{field:issue.key}))
  if(inspection.bound){
   try{workflowTarget(spec,inspection.bound)}catch(e){problems.push(e instanceof Error?e.message:String(e))}
   for(const key of Object.keys(spec.parameters).filter(key=>sourceParameter(spec,key))){const id=inspection.bound[key];if(typeof id==='string'&&!sourcePageAvailable(pages,id))problems.push(t('features.ai.program.sourceMissing'))}
  }
  const connections=spec.steps.flatMap(step=>step.kind==='workflow'?step.connections:step.kind==='tool'&&step.server?[{name:step.server,endpoint:step.endpoint}]:[])
  const servers=currentSetup().servers
  for(const connection of connections)if(servers.filter(s=>s.name===connection.name&&s.url===connection.endpoint).length!==1)problems.push(t('features.ai.program.connectionMissing',{name:connection.name}))
  try{precheck({purpose:'terminal.task',route,sources:[{all:true}],typed:[spec.goal,JSON.stringify(inspection.values)].join('\n')})}catch(e){problems.push(e instanceof AIError?aiErrorText(e.code,{model:e.label??'',detail:e.detail,server:e.server}):e instanceof Error?e.message:String(e))}
  if(busy)problems.push(t('features.ai.program.input.busy'))
  if(!confirmed)problems.push(t('features.ai.program.input.confirm'))
  setChecked({signature,problems:[...new Set(problems)]})
 }
 const current=checked?.signature===signature?checked:null
 return <section className="program-readiness" aria-label={t('features.ai.program.input.readiness')}>
  <h4>{t('features.ai.program.input.model')}</h4><RouteChip purpose="terminal.task" chip={route} onChip={route=>useAgent.setState({route})} reads={t('features.ai.program.input.reads')}/>
  <p>{t('features.ai.program.input.dryHelp')}</p>
  <button type="button" className="btn" onClick={check}>{t('features.ai.program.input.check')}</button>
  {current?<div className="program-readiness__result" role="status"><strong>{t(current.problems.length?'features.ai.program.input.notReady':'features.ai.program.input.ready')}</strong>{current.problems.length>0&&<ul>{current.problems.map((problem,index)=><li key={index}>{problem}</li>)}</ul>}</div>:checked?<p>{t('features.ai.program.input.stale')}</p>:inspection.issues.length>0?<p>{t('features.ai.program.input.incomplete',{count:inspection.issues.length})}</p>:null}
 </section>
}
