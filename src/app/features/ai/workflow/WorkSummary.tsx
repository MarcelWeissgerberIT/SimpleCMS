import type {BlockLocation} from '../../../lib/blockLocation'
import {useT} from '../../../i18n'
import {useAgent,openAgent,type TerminalTarget} from '../agent/state'
import {mcpActivityText} from '@/shared/mcp/activityDisplay'
import {oneActivity} from './activity'
import type {WorkItem} from './inventory'
export function WorkSummary({resultView,setResults,de,pages,work,completed,onClose,onFilter,go,runningTasks}:{resultView:{resultQuery:string;resultLimit:number;resultsOpen:boolean};setResults:(v:Partial<{resultQuery:string;resultLimit:number;resultsOpen:boolean}>)=>void;de:boolean;pages:Record<string,{title:string}>;work:WorkItem[];completed:WorkItem[];onClose:()=>void;onFilter:(value:string)=>void;go:(page:string,block?:string,location?:BlockLocation)=>void;runningTasks:Array<{page:string;title:string;detail:string}>}){
 const t=useT(),{resultQuery,resultLimit,resultsOpen}=resultView
 const results=completed.filter(r=>[r.title,pages[r.page]?.title,r.detail].join(' ').toLocaleLowerCase().includes(resultQuery.trim().toLocaleLowerCase()))
 const searchResults=(query:string)=>setResults({resultQuery:query,resultLimit:12})
 const turn=useAgent(s=>s.turns.at(-1)),status=useAgent(s=>s.status),steps=useAgent(s=>s.steps),halt=useAgent(s=>s.halt),changes=useAgent(s=>s.changes)
 const pending=changes.filter(c=>['pending','failed'].includes(c.status)),waiting=status==='running'&&(!!halt||turn?.contract?.phase==='decision')
 const step=steps.filter(s=>s.turn===turn?.n).at(-1),display=step?.kind==='mcp'?mcpActivityText(step.mcp?.tool??'',step.mcp?.display,step.arg,de?'de':'en'):step?.tool?oneActivity(step.tool,step.arg,pages,de):null
 const open=(target:TerminalTarget)=>{onClose();openAgent({target})}
 return <section className="work-summary" aria-label={de?'Dein Arbeitsstand':'Your work at a glance'}>
  <div className="work-summary__counts"><button className="btn" onClick={()=>onFilter('all')}>{de?'Offene Arbeit':'Open work'} · {work.length+pending.length}</button><button className="btn" onClick={()=>onFilter('review')}>{de?'Entscheidungen':'Decisions'} · {work.filter(w=>w.kind==='review').length+pending.length+(waiting?1:0)}</button><button className="btn" onClick={()=>onFilter('stale')}>{de?'Quellen prüfen':'Recheck sources'} · {work.filter(w=>w.kind==='stale').length}</button></div>
  {(turn||runningTasks.length>0)&&<div className="work-summary__card"><h3>{de?'Aktuelle Arbeit':'Current work'}</h3>{turn&&<><strong>{turn.task.slice(0,300)}</strong><p>{turn.context?.page}</p><p role="status">{waiting?(de?'Wartet auf deine Entscheidung':'Waiting for your decision'):status==='running'?(de?'Läuft in diesem Tab':'Running in this tab'):turn.status==='done'?(de?'Antwort vorhanden · Übernahme separat prüfen':'Answer available · check adoption separately'):(de?'Unterbrochen · Arbeitsstand prüfen':'Interrupted · review checkpoint')}</p>{display&&status==='running'&&<p>{display.action} · {display.detail}</p>}<button className="btn btn--sm" onClick={()=>open(waiting?'decision':status==='running'?'latest':pending.length?'review':'result')}>{waiting?(de?'Entscheidung öffnen':'Open decision'):status==='running'?(de?'Aktive Arbeit ansehen':'View active work'):pending.length?(de?'Vorschläge prüfen':'Review proposals'):(de?'Ergebnis ansehen':'View result')}</button></>}{runningTasks.map(t=><div key={t.page}><strong>{t.title}</strong><p>{t.detail}</p><button className="btn btn--sm" onClick={()=>go(t.page)}>{de?'Zur laufenden Stufe':'Open running stage'}</button></div>)}</div>}
  {completed.length>0&&<details className="work-summary__card" open={resultsOpen} onToggle={e=>{if(e.currentTarget.open!==resultsOpen)setResults({resultsOpen:e.currentTarget.open})}}><summary>{de?'Gespeicherte Ergebnisse':'Saved results'} · {completed.length}</summary><p>{de?'Gespeicherte Stände in One. Veröffentlichung und externe Übernahme stehen am jeweiligen Ergebnis.':'Saved states in One. Publication and external adoption are shown with each result.'}</p>
   <div className="workflow-filters"><input className="input" type="search" aria-label={t('workflow.searchResults')} placeholder={t('workflow.searchResults')} value={resultQuery} onChange={e=>searchResults(e.target.value)}/>{resultQuery&&<button className="btn btn--sm" onClick={()=>searchResults('')}>{t('workflow.clearResultSearch')}</button>}</div>
   {!results.length&&<p role="status">{t('workflow.noResults')}</p>}
   {results.slice(0,resultLimit).map(r=><div key={r.id}><strong>{r.title}</strong><p>{pages[r.page]?.title} · {r.detail}</p><button className="btn btn--sm" onClick={()=>go(r.page,r.block,r.location)}>{de?'Ergebnis öffnen':'Open saved result'}</button></div>)}
   {results.length>resultLimit&&<button className="btn btn--sm" onClick={()=>setResults({resultLimit:resultLimit+12})}>{t('workflow.moreResults')} ({results.length-resultLimit})</button>}
  </details>}
 </section>
}
