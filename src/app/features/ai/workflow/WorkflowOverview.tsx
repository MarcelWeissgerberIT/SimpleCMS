import {useCodeDrafts,codeDraftScope,downloadCodeDraft,forgetCodeDraft} from '../../index'
import {BudgetOverview} from './BudgetOverview'
import {WorkJourney} from './WorkJourney'
import {useWorkOverviewView} from './viewState'
import {openBlockLocation,type BlockLocation} from '../../../lib/blockLocation'
import {WorkSummary} from './WorkSummary'
import {SourceConnections} from './SourceConnections'
import {GuidedStart} from './GuidedStart'
import {QualityChecks} from './QualityChecks'
import {useEffect,useMemo,useState} from 'react'
import {Modal} from '../../../ui/Modal'
import {useLang,useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud'
import {isEffectivelyTrashed,inTemplate} from '../../../store/selectors'
import {navigate} from '../../../lib/router'
import {useAgent,closeAgent,openAgent} from '../agent/state'
import {SavedWork} from '../agent/SavedWork'
import {TERMINAL_TOOLS} from '../agent/tools'
import {changeTarget} from '../agent/session'
import {inventory,type WorkKind,type WorkItem} from './inventory'
import {analysisRecipe} from './recipe'
import {openPrograms} from '../programs/dialog'
import {CodeEvidence,codeAccessScope} from '../../code-evidence'
import {loadTasks,useCodingLocal,taskLocal} from '../../coding/local'
import {useOneAnalysis,oneJobKey} from '../../coding/oneAnalysis'
import {taskContext} from '../../coding/tasks'
import {workflowRepair} from '@/shared/ai/workflowRepair'
import './workflow.css'

export default function WorkflowOverview({onClose}:{onClose:()=>void}){
 const t=useT(),de=useLang()==='de',say=(a:string,b:string)=>de?a:b
 const pages=useWorkspace(s=>s.pages),epoch=useWorkspace(s=>s.epoch),active=useCloud(s=>s.active),actor=useCloud(s=>s.user?.id)
 const settings=useWorkspace(s=>s.settings),policy=useWorkspace(s=>s.ai),integrations=useWorkspace(s=>s.integrations)
 const changes=useAgent(s=>s.changes),turns=useAgent(s=>s.turns),tasks=useCodingLocal(s=>s.tasks),jobs=useOneAnalysis(s=>s.jobs)
 const [pinned]=useState(codeAccessScope)
 const {root,view,view:{tab,query,filter,limit},setResults,setTab,setQuery,setFilter,showMore,reset}=useWorkOverviewView(pinned)
 const visible=useMemo(()=>Object.values(pages).filter(p=>!isEffectivelyTrashed(pages,p.id)&&!inTemplate(pages,p.id)),[pages])
 const data=useMemo(()=>inventory(visible,de),[visible,de])
 useEffect(()=>{if(codeAccessScope()!==pinned)onClose()},[epoch,active,actor,settings,policy,integrations,pinned,onClose])
 useEffect(()=>{void loadTasks(visible.filter(p=>p.databaseId&&taskContext(p.id)).map(p=>p.id))},[visible])
 const pipeline=useMemo<WorkItem[]>(()=>visible.flatMap(p=>{
  const c=taskContext(p.id);if(!c)return[]
  const l=taskLocal(p.id),gate=c.stage?.kind==='gate'
  return ['failed','stopped','question'].includes(l.state)||l.state==='running'&&!jobs[oneJobKey(p.id)]||gate?[{id:'task:'+p.id,page:p.id,block:undefined as string|undefined,kind:(gate||l.state==='question'?'review':'failed') as WorkKind,title:p.title,detail:l.error||l.question||(l.state==='running'?say('Kein aktiver Lauf in diesem Tab. Arbeitsstand und andere Tabs prüfen.','No active run in this tab. Check the checkpoint and other tabs.'):c.stage?.name)||''}]:[]
 }),[visible,tasks,jobs])
 const rows=[...pipeline,...data.work].filter(r=>(filter==='all'||r.kind===filter)&&(r.title+' '+r.detail+' '+pages[r.page]?.title).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 const label=(kind:string)=>({review:say('Freigabe','Review'),note:say('Mock-Notiz','Mock note'),markdown:say('Designsystem-MD','Design system MD'),failed:say('Unterbrochen / Fehler','Interrupted / failed'),finding:'Finding',stale:say('Quellenstand prüfen','Recheck sources')}[kind]??kind)
 const go=(page:string,block?:string,location?:BlockLocation)=>{onClose();closeAgent();openBlockLocation(page,block,location)}
 const review=(id:string)=>{onClose();openAgent({target:'review',changeId:id})}
 const drafts=useCodeDrafts(s=>s.entries),draftScope=useCodeDrafts(s=>s.scope)
 const localDrafts=draftScope===codeDraftScope()?Object.values(drafts).filter(d=>visible.some(p=>p.id===d.page)):[]
 const pending=changes.filter(c=>['pending','failed'].includes(c.status))
 const visiblePending=filter==='all'||filter==='review'?pending.filter(c=>((pages[changeTarget(c)??'']?.title??'')+' '+JSON.stringify(c)).toLocaleLowerCase().includes(query.toLocaleLowerCase())):[]
 const runningTasks=visible.flatMap(p=>{const job=jobs[oneJobKey(p.id)];return job?[{page:p.id,title:p.title,detail:job.activity}]:[]})
 const completed=[...data.completed].sort((a,b)=>(pages[b.page]?.updatedAt??0)-(pages[a.page]?.updatedAt??0))
 const costs=[...turns].filter(t=>t.cost).sort((a,b)=>(b.cost?.usd??0)-(a.cost?.usd??0))
 if(codeAccessScope()!==pinned)return null
 return <Modal open onClose={onClose} title={say('Arbeitsübersicht','Work overview')} width={1100} className="workflow-modal"><div ref={root} className="workflow-overview">
  <p>{say('Offene Arbeiten im aktuellen Workspace. Lokale Laufstände gelten für dieses Gerät.','Open work in the current workspace. Local run checkpoints belong to this device.')}</p>
  <nav aria-label={say('Arbeitsbereiche','Work areas')}>{[['open',say('Offene Arbeiten','Open work')],['journey',t('workflow.journey')],['sources',say('Belegketten','Evidence links')],['cost',say('Läufe & Kosten','Runs & cost')],['recipes',say('Wiederverwenden','Reuse')],['start',say('Neue Aufgabe','New task')]].map(([id,title])=><button key={id} className="btn" aria-pressed={tab===id} onClick={()=>setTab(id)}>{title}</button>)}</nav>
  {data.limited&&<p role="status">{say('Großer Workspace: Die Übersicht zeigt nur den ersten Teil. Öffne weitere Seiten gezielt.','Large workspace: this overview shows only the first part. Open other pages directly.')}</p>}
  {tab==='open'&&<>
   <WorkSummary resultView={view} setResults={setResults} de={de} pages={pages} work={[...pipeline,...data.work]} completed={completed} onClose={onClose} onFilter={setFilter} go={go} runningTasks={runningTasks}/>
   <div className="workflow-filters"><input className="input" type="search" aria-label={say('Arbeiten suchen','Search work')} placeholder={say('Suchen …','Search …')} value={query} onChange={e=>setQuery(e.target.value)}/><select className="input" aria-label={say('Art der Arbeit','Work type')} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{say('Alle Arten','All types')}</option>{['review','note','markdown','failed','finding','stale'].map(k=><option key={k} value={k}>{label(k)}</option>)}</select>{(query||filter!=='all')&&<button className="btn btn--sm" onClick={reset}>{t('workflow.resetFilters')}</button>}</div>
   {visiblePending.length>0&&<section><h3>{say('Änderungen im KI-Terminal','Changes in the AI terminal')}</h3><p>{say('Jeden Unterschied einzeln prüfen, annehmen oder verwerfen.','Review, accept or reject each change individually.')}</p>{visiblePending.map(c=><article key={c.id}><strong>{pages[changeTarget(c)??'']?.title||say('Vorgeschlagene Änderung','Proposed change')}</strong><button className="btn btn--sm" onClick={()=>review(c.id)}>{say('Unterschied prüfen','Review difference')}</button></article>)}</section>}
   {!rows.length&&!visiblePending.length&&!localDrafts.length&&<p>{say('Keine offenen Arbeiten gefunden.','No open work found.')}</p>}
   {rows.slice(0,limit).map(r=><article key={r.id}><span className="label">{label(r.kind)}</span><h3>{r.title}</h3><p>{pages[r.page]?.title} · {r.detail}</p>{r.kind==='failed'&&<p>{workflowRepair(r.detail,de).text}</p>}<button className="btn btn--sm" onClick={()=>go(r.page,r.block,r.location)}>{say('An der Stelle öffnen','Open at source')}</button></article>)}
   {rows.length>limit&&<button className="btn" onClick={showMore}>{say('Weitere Arbeiten anzeigen','Show more work')} ({rows.length-limit})</button>}
   {!!localDrafts.length&&<section aria-label={t('codeChange.localDraft')}><h3>{t('codeChange.localDraft')}</h3><p>{t('codeChange.draftKept')}</p>{localDrafts.map(d=><article key={d.key}><h3>{d.title}</h3><p>{pages[d.page]?.title}</p><button className="btn btn--sm" onClick={()=>go(d.page,d.block)}>{say('Arbeitsstand öffnen','Open working copy')}</button><button className="btn btn--sm" onClick={()=>downloadCodeDraft(d)}>{t('codeChange.downloadDraft')}</button><button className="btn btn--sm" onClick={()=>forgetCodeDraft(d.key)}>{t('codeChange.discardDraft')}</button></article>)}</section>}
   <SavedWork expanded onResume={onClose}/>
  </>}
  {tab==='sources'&&<><SourceConnections state={{query:view.sourceQuery,limit:view.sourceLimit,changedOnly:view.sourceChanged}} onState={v=>setResults({sourceQuery:v.query??view.sourceQuery,sourceLimit:v.limit??view.sourceLimit,sourceChanged:v.changedOnly??view.sourceChanged})} pages={pages} traces={data.traces} de={de} go={go}/><p>{say('Gespeicherte Beziehungen: Finding → Beleg → Anforderung. Gemeinsame Belege zeigen die Verbindung; fehlende Zuordnungen bleiben offen. Mock-Quellen stehen am jeweiligen Mock.','Saved relationships: finding → evidence → requirement. Shared evidence shows the connection; missing links remain open. Mock sources are listed with their mock.')}</p><p>{say('Historische Belege bestätigen keinen aktuellen Branch-Stand. „Code laden“ prüft den gespeicherten Snapshot erneut. Dabei entstehen keine Unterseiten.','Historical evidence does not confirm the current branch. “Load code” rechecks the saved snapshot. No subpages are created.')}</p>{!data.traces.length&&<p>{say('Noch keine Belegketten vorhanden.','No evidence links yet.')}</p>}{data.traces.slice(0,limit).map(r=><article key={r.id}><h3>{r.title}</h3><p className="workflow-lines">{r.detail}</p>{r.gap&&<p className="workflow-gap">{r.gap}</p>}{r.checkedAt&&<small>{say('Historisch geprüft: ','Previously checked: ')}{new Date(r.checkedAt).toLocaleString()}</small>}<button className="btn btn--sm" onClick={()=>go(r.page,r.block,r.location)}>{pages[r.page]?.title} ↗</button>{r.references.slice(0,8).map((ref,i)=><CodeEvidence key={i} raw={JSON.stringify(ref)} editable={false} canRead onSave={()=>{}}/>) }{r.references.length>8&&<p>{say('Weitere Belege an der Originalstelle: ','More evidence at the original location: ')}{r.references.length-8}</p>}</article>)}{data.traces.length>limit&&<button className="btn" onClick={showMore}>{say('Weitere Belegketten anzeigen','Show more evidence links')} ({data.traces.length-limit})</button>}</>}
  {tab==='journey'&&<WorkJourney state={{query:view.journeyQuery,limit:view.journeyLimit}} onState={v=>setResults({journeyQuery:v.query??view.journeyQuery,journeyLimit:v.limit??view.journeyLimit})} pages={pages} work={[...pipeline,...data.work]} completed={completed} traces={data.traces} go={go}/>}
  {tab==='cost'&&<><BudgetOverview/><p>{say('Bekannte Kosten dieser Terminal-Sitzung, teuerste Aufträge zuerst. Schätzungen und unvollständige Preise sind gekennzeichnet.','Known costs in this terminal session, most expensive tasks first. Estimates and incomplete prices are labelled.')}</p>{!costs.length&&<p>{say('Noch keine Kosten in dieser Sitzung.','No costs in this session yet.')}</p>}{costs.map(t=><article key={t.n}><strong>{t.task}</strong><p>{t.cost!.partial?'≈ ':''}${t.cost!.usd.toFixed(4)} · {t.cost!.requests} {say('Modellantworten','model responses')}{t.cost!.partial?' · '+say('geschätzt / unvollständig','estimated / incomplete'):''}</p></article>)}<button className="btn" onClick={()=>{onClose();closeAgent();navigate({name:'regler'})}}>{say('Verbrauch & Budgets öffnen','Open usage & budgets')}</button><SavedWork/>{visible.filter(p=>taskLocal(p.id).stageRuns?.length||taskLocal(p.id).analysisCheckpoint).map(p=><article key={p.id}><h3>{p.title}</h3>{taskLocal(p.id).analysisCheckpoint&&<p>{say('Offene Stufe · bisher bekannt: ','Open stage · known so far: ')}${taskLocal(p.id).analysisCheckpoint!.cost.toFixed(4)}</p>}{[...(taskLocal(p.id).stageRuns??[])].sort((a,b)=>(b.receipt.costUsd??0)-(a.receipt.costUsd??0)).map(r=><p key={r.run}>{r.stage} · {r.status} · ${r.receipt.costUsd?.toFixed(4)??'—'} · {r.receipt.turns??0} {say('Antworten','responses')}</p>)}<button className="btn btn--sm" onClick={()=>go(p.id)}>{say('Lauf öffnen','Open run')}</button></article>)}</>}
  {tab==='start'&&<GuidedStart pages={visible} de={de} onClose={onClose}/>}
  {tab==='recipes'&&<><QualityChecks pages={visible} de={de} onClose={onClose}/><p>{say('Aus einer abgeschlossenen Analyse einen privaten Ablauf vorbereiten: Quellen sind beim nächsten Start austauschbar, das Ergebnis wird neu erzeugt und geprüft. Speichern führt nichts aus.','Prepare a private workflow from a completed analysis: sources can be changed before the next start, and the result is generated and reviewed afresh. Saving does not execute anything.')}</p>{data.recipes.map(r=><article key={r.page+':'+r.analysis.id}><h3>{r.analysis.question}</h3><p>{say('Dokumentanalyse aus gespeichertem Bericht; keine erneute Live-Codeanalyse.','Document analysis from the saved report; not a fresh live code analysis.')}</p><button className="btn" onClick={()=>{onClose();openPrograms(analysisRecipe(r.analysis.question,[r.page],TERMINAL_TOOLS.find(t=>t.name==='read_page')!.input_schema))}}>{say('Als Ablauf vorbereiten','Prepare workflow')}</button></article>)}{turns.filter(t=>t.status==='done'&&t.contract?.evidence.one_pages?.some(id=>!!pages[id])).map(t=><article key={t.n}><h3>{t.task}</h3><button className="btn" onClick={()=>{onClose();openPrograms(analysisRecipe(t.task,t.contract!.evidence.one_pages!.filter(id=>!!pages[id]),TERMINAL_TOOLS.find(t=>t.name==='read_page')!.input_schema))}}>{say('Als Ablauf vorbereiten','Prepare workflow')}</button></article>)}<button className="btn" onClick={()=>{onClose();openPrograms()}}>{say('Gespeicherte Abläufe öffnen','Open saved workflows')}</button></>}
 </div></Modal>
}
