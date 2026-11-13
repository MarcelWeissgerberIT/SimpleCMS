import {hasEvidenceGaps} from '@/shared/ai/evidenceGaps'
import {useWorkspace} from '../../../store/store'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {openPage} from '../../../lib/router'
import {mcpActivityText} from '@/shared/mcp/activityDisplay'
import {oneActivity} from '../workflow/activity'
import {useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {useLang,useT} from '../../../i18n'
import {closeAgent,openAgent,useAgent} from './state'
import {atlasTransferOriginal} from '@/shared/quandprofile/atlas-transfer'
import './active-work.css'

/** Keeps the running task identifiable while editing a different page. No polling or model calls. */
export function ActiveWorkDock(){
 const t=useT(),lang=useLang(),de=lang==='de',pages=useWorkspace(s=>s.pages),turn=useAgent(s=>s.turns.at(-1)),status=useAgent(s=>s.status),halt=useAgent(s=>s.halt)
 const pending=useAgent(s=>s.changes.filter(c=>['pending','failed'].includes(c.status)).length)
 const step=useAgent(s=>s.steps.findLast(step=>step.turn===s.turns.at(-1)?.n&&step.state==='run'))
 const writing=useAgent(s=>!!s.live)
 const [host]=useState(()=>document.querySelector('.app-main')),[dismissed,setDismissed]=useState('')
 const dockRef=useRef<HTMLElement>(null)
 const key=turn?`${turn.n}:${turn.startedAt}`:'',running=status==='running'
 const visible=!!turn&&!!host&&(running||dismissed!==key)
 useLayoutEffect(()=>{
  const element=dockRef.current
  if(!visible||!element)return
  const root=document.documentElement
  const publish=()=>root.style.setProperty('--active-work-dock',`${element.getBoundingClientRect().height}px`)
  publish();const observer=new ResizeObserver(publish);observer.observe(element)
  return()=>{observer.disconnect();root.style.removeProperty('--active-work-dock')}
 },[visible,host])
 if(!visible||!turn||!host)return null
 const waiting=running&&(!!halt||turn.contract?.phase==='decision')
 const display=step?.kind==='mcp'?mcpActivityText(step.mcp?.tool??'',step.mcp?.display,step.arg,lang):step?.tool?oneActivity(step.tool,step.arg,pages,de):null
 const activity=waiting?t('workflow.waitingDecision'):display?[display.action,display.detail].filter(Boolean).join(' · '):t(writing?'workflow.writing':'workflow.processing')
 const source=turn.context?.pageId,sourceAvailable=!!source&&!!pages[source]&&!isEffectivelyTrashed(pages,source)
 const label=waiting?(de?'Deine Entscheidung':'Your decision'):running?(de?'KI arbeitet':'AI working'):turn.status==='done'&&hasEvidenceGaps(turn)?(de?'Teilstand · Quellenprüfung offen':'Partial result · evidence review open'):turn.status==='done'?(de?'Ergebnis bereit':'Result ready'):turn.status==='error'?(de?'Fehlgeschlagen':'Failed'):turn.status==='limit'?(de?'Aufruflimit erreicht':'Call limit reached'):(de?'Angehalten':'Stopped')
 return createPortal(<section ref={dockRef} className="active-work-dock" aria-label={de?'KI-Auftrag im Hintergrund':'Background AI task'}>
  <button type="button" className="active-work-dock__open" onClick={()=>openAgent({target:'resume'})} aria-label={de?'Zurück zum Auftrag':'Return to task'}>
   <span className="active-work-dock__status" role="status">{label}</span>
   <span className="active-work-dock__task" title={atlasTransferOriginal(turn.task)}>{atlasTransferOriginal(turn.task)}{turn.context?.page&&<small>{de?'Auftragskontext: ':'Task context: '}{turn.context.page}</small>}{running&&<small className="active-work-dock__activity" role="status" title={activity}>{activity}</small>}</span>
   <span className="active-work-dock__return" aria-hidden="true">{de?'Weiterlesen':'Resume reading'} ↗</span>
  </button>
  <div className="active-work-dock__actions">
   {source&&<button type="button" className="btn btn--sm" disabled={!sourceAvailable} title={sourceAvailable?pages[source].title:t('workflow.sourceUnavailable')} onClick={()=>{closeAgent();openPage(source)}}>{t('workflow.openTaskSource')}</button>}
   {waiting?<button type="button" className="btn btn--sm" onClick={()=>openAgent({target:'decision'})}>{de?'Rückfrage beantworten':'Answer question'}</button>
    :running?<button type="button" className="btn btn--sm" onClick={()=>openAgent({target:'latest'})}>{de?'Aktuelle Arbeit':'Current work'}</button>
    :<>
      {pending>0&&<button type="button" className="btn btn--sm" onClick={()=>openAgent({target:'review'})}>{de?'Änderungen prüfen':'Review changes'} ({pending})</button>}
      {!!turn.answer&&<button type="button" className="btn btn--sm" onClick={()=>openAgent({target:'result'})}>{de?'Ergebnis ansehen':'View result'}</button>}
      {!pending&&!turn.answer&&<button type="button" className="btn btn--sm" onClick={()=>openAgent({target:'latest'})}>{de?'Details ansehen':'View details'}</button>}
    </>}
  </div>
  {!running&&<button type="button" className="active-work-dock__dismiss" aria-label={de?'Auftragsleiste ausblenden':'Dismiss task bar'} onClick={()=>setDismissed(key)}>×</button>}
 </section>,host)
}
