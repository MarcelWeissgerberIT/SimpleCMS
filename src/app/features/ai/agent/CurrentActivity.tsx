import {useEffect,useState} from 'react'
import {useWorkspace} from '../../../store/store'
import {oneActivity} from '../workflow/activity'
import {useLang} from '../../../i18n'
import {useAgent} from './state'
import {mcpActivityText} from '@/shared/mcp/activityDisplay'
/** Visible even while the person scrolls the log. Describes observed execution, not inferred reasoning. */
export function CurrentActivity(){
 const lang=useLang(),de=lang==='de',status=useAgent(s=>s.status),turns=useAgent(s=>s.turns),steps=useAgent(s=>s.steps),live=useAgent(s=>s.live)
 const pages=useWorkspace(s=>s.pages),halt=useAgent(s=>s.halt),[now,setNow]=useState(Date.now())
 useEffect(()=>{if(status!=='running')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[status])
 const turn=turns.at(-1)
 if(status!=='running'||!turn)return null
 const active=steps.filter(s=>s.turn===turn.n&&s.state==='run'),shown=active.slice(-3)
 const fallback=halt?(de?'Wartet am Budgetlimit auf deine Entscheidung':'Waiting for your budget decision'):turn.contract?.phase==='decision'?(de?'Wartet auf deine Entscheidung':'Waiting for your decision'):live?(de?'Antwort wird geschrieben':'Writing the response'):(de?'KI verarbeitet die verfügbaren Ergebnisse':'AI is processing the available results')
 return <div className="term-activity" role="status" aria-live="polite" aria-atomic="true"><span className="term-activity__label">{de?'Gerade aktiv':'Current activity'}</span><div>{!halt&&shown.length?shown.map(s=>{const x=s.mcp?mcpActivityText(s.mcp.tool,s.mcp.display,s.arg,lang):oneActivity(s.tool??'',s.arg,pages,de);return <div key={s.id}><strong>{x.action}</strong>{x.detail&&<span> · {x.detail}</span>}<small> · {Math.max(0,Math.floor((now-s.startedAt)/1000))} s{now-s.startedAt>30000?(de?' · Antwort steht noch aus':' · awaiting response'):''}</small></div>}):fallback}{active.length>3&&<small> +{active.length-3} {de?'weitere Aufrufe':'more calls'}</small>}</div></div>
}
