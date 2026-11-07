import {useEffect,useState} from 'react'
import {useWorkspace} from '../../../store/store'
import {oneActivity} from '../workflow/activity'
import {useLang} from '../../../i18n'
import {useAgent} from './state'
import {mcpActivityText} from '@/shared/mcp/activityDisplay'
import {atlasTransferOriginal} from '@/shared/quandprofile/atlas-transfer'

/** A stable task anchor outside the history. Only reports observed execution. */
export function CurrentActivity({following,unread,onTask,onLatest,onResult}: {
 following:boolean;unread:boolean;onTask:()=>void;onLatest:()=>void;onResult:()=>void
}){
 const lang=useLang(),de=lang==='de',status=useAgent(s=>s.status),turns=useAgent(s=>s.turns),steps=useAgent(s=>s.steps),live=useAgent(s=>s.live)
 const pages=useWorkspace(s=>s.pages),halt=useAgent(s=>s.halt),[now,setNow]=useState(Date.now())
 useEffect(()=>{if(status!=='running')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[status])
 const turn=turns.at(-1)
 if(!turn)return null
 const running=status==='running',waiting=running&&(!!halt||turn.contract?.phase==='decision')
 const active=steps.filter(s=>s.turn===turn.n&&s.state==='run'),shown=active.slice(-2)
 const label=waiting?(de?'Deine Entscheidung':'Your decision'):running?(de?'Läuft':'Running'):turn.status==='done'?(de?'Abgeschlossen':'Completed'):turn.status==='error'?(de?'Fehlgeschlagen':'Failed'):turn.status==='limit'?(de?'Aufruflimit erreicht':'Call limit reached'):(de?'Angehalten':'Stopped')
 const fallback=halt?(de?'Wartet am Budgetlimit auf deine Entscheidung':'Waiting for your budget decision'):turn.contract?.phase==='decision'?(de?'Wartet auf deine Entscheidung':'Waiting for your decision'):live?(de?'Antwort wird geschrieben':'Writing the response'):(de?'Wartet auf die nächste Modellantwort':'Waiting for the next model response')
 return <section className="term-activity" aria-label={de?'Aktueller Auftrag':'Current task'} data-running={running||undefined}>
  <div className="term-activity__main">
   <div className="term-activity__heading"><span className="term-activity__label">{de?'Auftrag':'Task'} {String(turn.n).padStart(2,'0')}</span><span role="status" aria-live="polite">{label}</span>{turn.context?.page&&<span className="term-activity__context" title={turn.context.page}>{turn.context.page}</span>}</div>
   <button type="button" className="term-activity__task" onClick={onTask} title={atlasTransferOriginal(turn.task)}>{atlasTransferOriginal(turn.task)}</button>
   {running&&<div className="term-activity__execution"><div role="status" aria-live="polite">{!waiting&&shown.length?shown.map(s=>{const x=s.mcp?mcpActivityText(s.mcp.tool,s.mcp.display,s.arg,lang):oneActivity(s.tool??'',s.arg,pages,de);return <div key={s.id}><strong>{x.action}</strong>{x.detail&&<span> · {x.detail}</span>}</div>}):fallback}{active.length>2&&!waiting&&<small> +{active.length-2} {de?'weitere Aufrufe':'more calls'}</small>}</div>{!waiting&&shown.length>0&&<small className="term-activity__elapsed">{Math.max(0,Math.floor((now-shown[0].startedAt)/1000))} s{now-shown[0].startedAt>30000?(de?' · Antwort steht noch aus':' · awaiting response'):''}</small>}</div>}
  </div>
  <div className="term-activity__actions">
   <button type="button" className="btn btn--sm" onClick={onLatest} aria-pressed={following}>{waiting?(de?'Zur Entscheidung':'Go to decision'):unread?(de?'Neue Aktivität ↓':'New activity ↓'):following?(de?'Folgt aktueller Arbeit':'Following current work'):(de?'Zur aktuellen Arbeit ↓':'Go to current work ↓')}</button>
   {!!turn.answer&&<button type="button" className="btn btn--sm" onClick={onResult}>{de?'Ergebnis ansehen':'View result'}</button>}
  </div>
 </section>
}
