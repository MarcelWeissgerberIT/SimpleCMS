import {useLang} from '../../../i18n'
import {useAgent} from './state'
import {mcpActivityText} from '@/shared/mcp/activityDisplay'
/** Visible even while the person scrolls the log. Describes observed execution, not inferred reasoning. */
export function CurrentActivity(){
 const lang=useLang(),de=lang==='de',status=useAgent(s=>s.status),turns=useAgent(s=>s.turns),steps=useAgent(s=>s.steps),live=useAgent(s=>s.live)
 const turn=turns.at(-1)
 if(status!=='running'||!turn)return null
 const active=steps.filter(s=>s.turn===turn.n&&s.state==='run'),shown=active.slice(-3)
 const fallback=turn.contract?.phase==='decision'?(de?'Wartet auf deine Entscheidung':'Waiting for your decision'):live?(de?'Antwort wird geschrieben':'Writing the response'):(de?'KI verarbeitet die verfügbaren Ergebnisse':'AI is processing the available results')
 return <div className="term-activity" role="status" aria-live="polite" aria-atomic="true"><span className="term-activity__label">{de?'Gerade aktiv':'Current activity'}</span><div>{shown.length?shown.map(s=>{const x=s.mcp?mcpActivityText(s.mcp.tool,s.mcp.display,s.arg,lang):{action:s.tool??'',detail:s.arg??''};return <div key={s.id}><strong>{x.action}</strong>{x.detail&&<span> · {x.detail}</span>}</div>}):fallback}{active.length>3&&<small> +{active.length-3} {de?'weitere Aufrufe':'more calls'}</small>}</div></div>
}
