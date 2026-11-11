import {useState} from 'react'
import {useLang} from '../../../i18n'
import {suggestTaskPlan,taskPlanSteps,taskPlanPrompt} from '@/shared/ai/taskPlan'
import {useAgent} from './state'
/** A local, editable suggestion. Selecting a step never sends a model request. */
export function TaskPlan({task,recovery=false}:{task:string;recovery?:boolean}){
 const de=useLang()==='de',busy=useAgent(s=>s.status==='running'),[scope,setScope]=useState(''),[prepared,setPrepared]=useState('')
 const draft=useAgent(s=>s.draft)
 const kind=suggestTaskPlan(task)
 if(!kind||busy)return null
 const steps=taskPlanSteps(kind,de)
 const select=(i:number)=>{
  const prompt=taskPlanPrompt(task,kind,i,scope,de)
  useAgent.setState(s=>({draft:prompt,focusTarget:'prompt',focusTick:s.focusTick+1}))
  setPrepared(prompt)
 }
 return <section className="term-task-plan" aria-label={de?'Auftrag aufteilen':'Split task'}>
  <details><summary>{de?(recovery?'Mit einem Teilauftrag fortsetzen · 4 Schritte':'Auftrag in 4 Schritte aufteilen'):(recovery?'Continue with a partial task · 4 stages':'Split request into 4 stages')}</summary>
  <p>{kind==='polarion'?(de?'Polarion → Original-PDF in ONE → auf Wunsch Atlas. Wähle einen Schritt; die nächste Stufe startet nicht automatisch.':'Polarion → original PDF in ONE → Atlas if requested. Select a stage; the next stage does not start automatically.'):de?'Repositorys prüfen, Features zuordnen und Requirements formulieren baut aufeinander auf. Beginne mit einem Überblick und arbeite danach Feature für Feature.':'Repository inspection, feature mapping and requirements writing depend on one another. Start with an overview, then work feature by feature.'}</p>
  <label>{kind==='polarion'?(de?'Polarion-Dokument oder PDF-Anhang':'Polarion document or PDF attachment'):de?'Repository und Feature für die Detailarbeit':'Repository and feature for detailed work'}<input className="input" value={scope} onChange={e=>setScope(e.target.value)} maxLength={300} placeholder={kind==='polarion'?(de?'z. B. Security Configuration · Quellenlink':'e.g. Security Configuration · source link'):de?'z. B. FluX · SOP-Freigabe':'e.g. FluX · SOP release'}/></label>
  <ol>{steps.map((step,i)=><li key={i}><div><strong>{step.title.replace(/^\d\. /,'')}</strong><p>{step.detail}</p></div><button type="button" className="btn btn-secondary" disabled={step.scope&&!scope.trim()} onClick={()=>select(i)}>{de?'Schritt vorbereiten':'Prepare step'} {i+1}</button></li>)}</ol>
  <p>{de?'Die Auswahl setzt einen bearbeitbaren Teilauftrag ins Eingabefeld. Erst „Starten“ führt ihn aus. Du kannst auch deinen ursprünglichen Auftrag starten.':'Selecting a step puts an editable partial task in the prompt. Only “Start” runs it. You can also run your original request.'}</p>
  {prepared&&draft===prepared&&<button className="btn btn-secondary" type="button" onClick={()=>{useAgent.setState({draft:task});setPrepared('')}}>{de?'Ursprünglichen Auftrag wiederherstellen':'Restore original request'}</button>}
  </details>
 </section>
}
/** Keep the original available after preparing a step, without replacing user edits. */
export function DraftTaskPlan(){
 const draft=useAgent(s=>s.draft),busy=useAgent(s=>s.status==='running'),[original,setOriginal]=useState('')
 const task=suggestTaskPlan(draft)?draft:/^(?:Arbeitsabschnitt|Work stage) [1-4]\/4\b/.test(draft)?original:''
 if(busy||!task)return null
 return <div onClickCapture={()=>{if(suggestTaskPlan(draft))setOriginal(draft)}}><TaskPlan key={task} task={task}/></div>
}
