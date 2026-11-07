import {useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {useLang} from '../../../i18n'
import {openAgent,useAgent} from './state'
import {atlasTransferOriginal} from '@/shared/quandprofile/atlas-transfer'
import './active-work.css'

/** Keeps the running task identifiable while editing a different page. No polling or model calls. */
export function ActiveWorkDock(){
 const de=useLang()==='de',turn=useAgent(s=>s.turns.at(-1)),status=useAgent(s=>s.status),halt=useAgent(s=>s.halt)
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
 const label=waiting?(de?'Deine Entscheidung':'Your decision'):running?(de?'KI arbeitet':'AI working'):turn.status==='done'?(de?'Ergebnis bereit':'Result ready'):turn.status==='error'?(de?'Fehlgeschlagen':'Failed'):turn.status==='limit'?(de?'Aufruflimit erreicht':'Call limit reached'):(de?'Angehalten':'Stopped')
 return createPortal(<section ref={dockRef} className="active-work-dock" aria-label={de?'KI-Auftrag im Hintergrund':'Background AI task'}>
  <button type="button" className="active-work-dock__open" onClick={()=>openAgent({focusWork:true})} aria-label={de?'Zurück zum Auftrag':'Return to task'}>
   <span className="active-work-dock__status" role="status">{label}</span>
   <span className="active-work-dock__task" title={atlasTransferOriginal(turn.task)}>{atlasTransferOriginal(turn.task)}{turn.context?.page&&<small>{de?'Auftragskontext: ':'Task context: '}{turn.context.page}</small>}</span>
   <span className="active-work-dock__return" aria-hidden="true">{de?'Zum Auftrag':'Open task'} ↗</span>
  </button>
  {!running&&<button type="button" className="active-work-dock__dismiss" aria-label={de?'Auftragsleiste ausblenden':'Dismiss task bar'} onClick={()=>setDismissed(key)}>×</button>}
 </section>,host)
}
