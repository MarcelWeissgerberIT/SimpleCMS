import {useT} from '../../../i18n'
import type {BlockLocation} from '../../../lib/blockLocation'
import type {WorkItem,Trace} from './inventory'
export function WorkJourney({pages,work,completed,traces,go,state,onState}:{state:{query:string;limit:number};onState:(v:Partial<{query:string;limit:number}>)=>void;pages:Record<string,{title:string}>;work:WorkItem[];completed:WorkItem[];traces:Trace[];go:(page:string,block?:string,location?:BlockLocation)=>void}){
 const t=useT(),{query,limit}=state
 const groups=new Map<string,{page:string;block?:string;work:WorkItem[];results:WorkItem[];traces:Trace[]}>()
 for(const [kind,rows] of [['work',work],['results',completed],['traces',traces]] as const)for(const row of rows){const key=JSON.stringify([row.page,row.block]),g=groups.get(key)??{page:row.page,block:row.block,work:[],results:[],traces:[]};(g[kind] as Array<WorkItem|Trace>).push(row);groups.set(key,g)}
 const filtered=[...groups.entries()].filter(([,g])=>[pages[g.page]?.title,...g.work.map(w=>w.title),...g.results.map(w=>w.title),...g.traces.map(w=>w.title)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 return <section><p>{t('workflow.journeyHint')}</p><input className="input" type="search" aria-label={t('workflow.journeySearch')} placeholder={t('workflow.journeySearch')} value={query} onChange={e=>{onState({query:e.target.value,limit:20})}}/>
 {!filtered.length&&<p>{t('workflow.journeyEmpty')}</p>}{filtered.slice(0,limit).map(([id,g])=>{const next=g.work.find(w=>w.kind==='failed')??g.work.find(w=>w.kind==='stale')??g.work.find(w=>w.kind==='review')??g.work[0];return <article key={id}><h3>{pages[g.page]?.title}</h3><p>{g.results[0]?.title??g.work[0]?.title??g.traces[0]?.title}</p>
 <ol className="workflow-journey"><li>{t('workflow.journeySources')} · {g.traces.length}{g.traces.length>0&&<button className="btn btn--sm" onClick={()=>go(g.page,g.block,g.traces[0].location)}>{t('workflow.openSources')}</button>}</li><li>{t('workflow.journeyOpen')} · {g.work.length}</li><li>{t('workflow.journeySaved')} · {g.results.length}{g.results.map(r=><button key={r.id} className="btn btn--sm" onClick={()=>go(r.page,r.block,r.location)}>{t('workflow.openResult')}</button>)}</li></ol>
 <p><strong>{t('workflow.nextStep')}</strong> {next?t('workflow.next.'+next.kind)+' '+next.title:t('workflow.journeyReviewSaved')}</p><button className="btn btn--primary btn--sm" onClick={()=>go(g.page,g.block,next?.location??g.results[0]?.location)}>{t('workflow.continueHere')}</button>
 {g.work.length>1&&<details><summary>{t('workflow.journeyOpen')}</summary>{g.work.map(w=><p key={w.id}><button className="btn btn--sm" onClick={()=>go(w.page,w.block,w.location)}>{w.title}</button> {w.detail}</p>)}</details>}
 </article>})}{filtered.length>limit&&<button className="btn" onClick={()=>onState({limit:limit+20})}>{t('workflow.moreJourneys')}</button>}</section>
}
