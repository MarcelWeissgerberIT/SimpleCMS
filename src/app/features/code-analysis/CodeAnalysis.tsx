import {newChange,type CodeChange} from '@/shared/codeChange/model'
import {useEffect,useMemo,useRef,useState} from 'react'
import {readAnalysis,newAnalysis,newRevision,changes,PHASES,type Analysis,type Revision,type Report} from '@/shared/codeAnalysis/model'
import {useT} from '../../i18n'
import {CodeEvidence} from '../code-evidence'
import {codeConnections,codeAccessScope} from '../code-evidence'
import {runCodeAnalysis} from '../index'
import type {Writer} from '../../store/writer'
import './code-analysis.css'
export function CodeAnalysis({raw,pageId,editable,canRead,onSave,onCurrent,onCreateChange}:{raw:string;pageId:string;editable:boolean;canRead:boolean;onSave:(raw:string,expected:string,writer:Writer)=>boolean;onCurrent:()=>string|null;onCreateChange?:(a:CodeChange)=>void}){
 const t=useT(),key=(k:string)=>t('codeAnalysis.'+k)
 const initial=useRef(newAnalysis(crypto.randomUUID()))
 const parsed=useMemo(()=>{try{return {value:raw==='{}'?initial.current:readAnalysis(raw),error:false}}catch{return {value:null,error:true}}},[raw])
 const a=parsed.value,[tab,setTab]=useState('overview'),[selected,setSelected]=useState(''),[config,setConfig]=useState(raw==='{}'),[settings,setSettings]=useState(a??initial.current)
 const [server,setServer]=useState(''),[busy,setBusy]=useState(false),[activity,setActivity]=useState(''),[error,setError]=useState('')
 const abort=useRef<AbortController|null>(null),rawRef=useRef(raw),current=useRef(onCurrent),saveRef=useRef(onSave)
 rawRef.current=raw;current.current=onCurrent;saveRef.current=onSave
 const scope=codeAccessScope(),connections=codeConnections()
 useEffect(()=>()=>abort.current?.abort(),[scope])
 useEffect(()=>{if(!canRead||!editable)abort.current?.abort()},[canRead,editable])
 useEffect(()=>{if(!server&&connections.length===1)setServer(connections[0].name)},[connections.length,server])
 const revision=a?.revisions.find(r=>r.id===selected)??a?.revisions.find(r=>r.id===a.active)??a?.revisions.at(-1)
 const active=a?.revisions.find(r=>r.id===a.active),report=revision?.report
 const commit=(next:Analysis,expected=rawRef.current,writer:Writer={kind:'you',via:'form'})=>{const value=JSON.stringify(readAnalysis(JSON.stringify(next)));if(!saveRef.current(value,expected,writer))throw Error(key('changed'));rawRef.current=value;return value}
 const persistSettings=()=>{if(!a)return;try{commit({...a,question:settings.question,repository:settings.repository,target:settings.target,extent:settings.extent,budget:settings.budget,maxRounds:settings.maxRounds});setConfig(false);setError('')}catch(e){setError((e as Error).message)}}
 const run=async(fresh:boolean)=>{
  if(!a||busy||!editable||!canRead)return
  if(!server){setError(key('connection'));return}
  if(fresh&&a.revisions.length>=20){setError(key('historyFull'));return}
  let working=structuredClone(a),r=fresh?newRevision(a,crypto.randomUUID()):revision
  if(!r||r.completed.length===4)return
  if(fresh)working.revisions.push(r)
  const id=r.id,control=new AbortController();abort.current=control;setBusy(true);setError('');setSelected(id);setTab('overview')
  let expected=rawRef.current
  try{
   if(!navigator.locks)throw Error(key('locked'))
   await navigator.locks.request('one-code-analysis:'+scope+':'+a.id,{ifAvailable:true},async lock=>{
    if(!lock)throw Error(key('locked'))
    expected=commit(working,expected)
    await runCodeAnalysis({analysis:working,revision:r!,pageId,server,signal:control.signal,valid:()=>current.current()===expected,save:next=>{try{const changed={...working,revisions:working.revisions.map(r=>r.id===id?next:r)};expected=commit(changed,expected,{kind:'ai',run:id,action:'code_analysis'});working=changed;return true}catch{return false}},activity:setActivity})
   })
  }catch(e){setError((e as Error).message)}finally{if(abort.current===control){setBusy(false);setActivity('')}}
 }
 const update=(change:(r:Revision)=>Revision)=>{if(!a||!revision||busy||!editable)return;try{commit({...a,revisions:a.revisions.map(r=>r.id===revision.id?change(r):r)})}catch(e){setError((e as Error).message)}}
 const evidence=(ids:string[],r:Report=report!)=><div className="code-analysis__links">{ids.map(id=>{const e=r.evidence.find(e=>e.id===id);return e?<button key={id} className="btn btn--sm" onClick={()=>{setTab('evidence');requestAnimationFrame(()=>document.getElementById(a!.id+'-'+id)?.scrollIntoView({block:'center'}))}}>{e.reference.citation.path.split('/').at(-1)}:{e.reference.citation.lines.join('–')}</button>:null})}</div>
 const bullets=(xs:string[])=><ul>{xs.map((s,i)=><li key={i}>{s}</li>)}</ul>
 const exportFile=()=>{const url=URL.createObjectURL(new Blob([rawRef.current],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='one-code-analysis.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 if(!a)return <section className="code-analysis"><p role="alert">{key('format')}</p></section>
 return <section className="code-analysis" aria-label={key('title')}>
  <header><strong>{a.question||key('title')}</strong><span className="label">ATLAS · ONE</span></header>
  <div className="code-analysis__actions"><button className="btn btn--sm" disabled={busy||!editable} onClick={()=>{setSettings(a);setConfig(!config)}}>{key(config?'close':'configure')}</button><button className="btn btn--sm" onClick={exportFile}>{key('export')}</button></div>
  {config&&<div className="code-analysis__form">
   <label>{key('question')}<textarea className="input" value={settings.question} maxLength={8000} onChange={e=>setSettings({...settings,question:e.target.value})}/></label>
   <label>{key('repository')}<input className="input" value={settings.repository} maxLength={300} onChange={e=>setSettings({...settings,repository:e.target.value})}/></label>
   <label>{key('target')}<input className="input" value={settings.target} maxLength={300} onChange={e=>setSettings({...settings,target:e.target.value})}/></label>
   <label>{key('extent')}<select className="input" value={settings.extent} onChange={e=>setSettings({...settings,extent:e.target.value as Analysis['extent']})}>{['question','flow','module'].map(k=><option key={k} value={k}>{key('extent.'+k)}</option>)}</select></label>
   <label>{key('budget')}<input className="input" type="number" min="0.1" max="100" step="0.5" value={settings.budget} onChange={e=>setSettings({...settings,budget:Number(e.target.value)})}/></label>
   <label>{key('rounds')}<input className="input" type="number" min="2" max="60" value={settings.maxRounds} onChange={e=>setSettings({...settings,maxRounds:Number(e.target.value)})}/></label>
   <p className="faint">{key('limitHint')}</p><button className="btn btn--primary" disabled={!editable||busy||!settings.question.trim()||!settings.repository.trim()} onClick={persistSettings}>{key('save')}</button>
  </div>}
  <p className="faint">{key('settingsHint')}</p>
  <div className="code-analysis__actions"><label>{key('server')} <select className="input" value={server} disabled={busy} onChange={e=>setServer(e.target.value)}><option value="">—</option>{connections.map(c=><option key={c.name} value={c.name}>{c.label}</option>)}</select></label>
   {!busy&&<button className="btn btn--primary" disabled={!editable||!canRead||!a.question.trim()||!a.repository.trim()||config} onClick={()=>void run(!revision||revision.completed.length===4)}>{key(!revision?'start':revision.completed.length===4?'new':'resume')}</button>}
   {!busy&&revision&&revision.completed.length<4&&<button className="btn btn--sm" disabled={!editable||!canRead||config} onClick={()=>void run(true)}>{key('new')}</button>}
   {busy&&<button className="btn btn--sm" onClick={()=>abort.current?.abort()}>{key('stop')}</button>}
   {revision?.state==='ready'&&<button className="btn btn--primary" disabled={!editable||busy} onClick={()=>{try{commit({...a,active:revision.id,revisions:a.revisions.map(r=>r.id===revision.id?{...r,state:'accepted'}:r)})}catch(e){setError((e as Error).message)}}}>{key('accept')}</button>}
  </div>
  {revision&&<div className="code-analysis__phase"><span className="label">{key(revision.id===a.active?'active':'proposal')} · {key('state.'+revision.state)} · ${revision.cost.toFixed(2)} / ${a.budget.toFixed(2)}</span><ol>{PHASES.map(p=><li key={p} data-done={revision.completed.includes(p)}>{key('phase.'+p)} {revision.completed.includes(p)?'✓':''}</li>)}</ol></div>}
  <p role="status">{activity}</p>{(error||revision?.error)&&<p role="alert">{error||revision?.error}</p>}
  <div className="code-analysis__tabs" role="tablist" aria-label={key('title')}>{['overview','findings','flows','requirements','evidence','questions','versions'].map(k=><button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const all=Array.from(e.currentTarget.parentElement!.querySelectorAll('button'));const next=all[(all.indexOf(e.currentTarget)+(e.key==='ArrowRight'?1:all.length-1))%all.length];next.focus();next.click()}}}>{key(k)}</button>)}</div>
  <div role="tabpanel" aria-label={key(tab)}>
  {!report&&tab!=='versions'&&<p>{key('empty')}</p>}
  {report&&tab==='overview'&&<><p className="code-analysis__prose">{report.summary}</p><h4>{key('scope')}</h4>{bullets(report.scope)}<h4>{key('gaps')}</h4>{bullets(report.gaps)}<details><summary>{key('observed')} · {revision!.observed.length}</summary><ul>{revision!.observed.map((o,i)=><li key={i}>{o.state==='err'?'! ':''}{o.detail}</li>)}</ul></details></>}
  {report&&tab==='findings'&&report.findings.map(f=><article key={f.id}><h3>{f.title}</h3><span className="label">{key('severity.'+f.severity)} · {key('verdict.'+f.verdict)}</span><p>{f.claim}</p><h4>{key('impact')}</h4><p>{f.impact}</p><h4>{key('support')}</h4>{evidence(f.support)}<h4>{key('against')}</h4>{evidence(f.against)}<h4>{key('counter')}</h4><p>{f.countercheck}</p><label>{key('status')} <select className="input" disabled={!editable||busy} value={f.status} onChange={e=>update(r=>({...r,report:{...r.report,findings:r.report.findings.map(x=>x.id===f.id?{...x,status:e.target.value as typeof f.status}:x)}}))}>{['open','reviewed','resolved'].map(s=><option key={s} value={s}>{key('status.'+s)}</option>)}</select></label>{onCreateChange&&<button className="btn btn--sm" disabled={!editable||busy||!f.support.length} onClick={()=>onCreateChange(newChange(crypto.randomUUID(),{analysis:a.id,revision:revision!.id,finding:f.id,title:f.title},report.evidence.filter(e=>f.support.includes(e.id)).map(e=>e.reference)))}>{t('codeChange.create')}</button>}</article>)}
  {report&&tab==='flows'&&report.flows.map(f=><article key={f.id}><h3>{f.title}</h3><ol className="code-analysis__flow">{f.steps.map((s,i)=><li key={i}><strong>{s.label}</strong>{evidence(s.evidence)}{s.uncertainty&&<p>{s.uncertainty}</p>}</li>)}</ol></article>)}
  {report&&tab==='requirements'&&<><p className="faint">{key('interpretation')}</p>{report.requirements.map(r=><article key={r.id}><h3>{r.text}</h3><span>{key('verdict.'+r.verdict)}</span><h4>{key('implementation')}</h4>{evidence(r.implementation)}<h4>{key('tests')}</h4>{evidence(r.tests)}<p>{r.gap}</p></article>)}</>}
  {report&&tab==='evidence'&&<><p className="faint">{key('interpretation')}</p>{!report.evidence.length&&<p>{key('noEvidence')}</p>}{report.evidence.map(e=><div id={a.id+'-'+e.id} key={e.id}><p className="faint">{e.checkedAt?key('authentic')+' '+new Date(e.checkedAt).toLocaleString():key('noEvidence')}</p><CodeEvidence raw={JSON.stringify(e.reference)} editable={false} canRead={canRead} onSave={()=>{}}/></div>)}</>}
  {report&&tab==='questions'&&<>{bullets(report.questions)}<h4>{key('gaps')}</h4>{bullets(report.gaps)}</>}
  {tab==='versions'&&<><div className="code-analysis__actions">{a.revisions.map((r,i)=><button key={r.id} className="btn btn--sm" aria-pressed={revision?.id===r.id} onClick={()=>setSelected(r.id)}>V{i+1} · {r.target||a.repository} · {key(r.id===a.active?'active':'proposal')}</button>)}</div>{revision&&<p>{new Date(revision.createdAt).toLocaleString()} · {key('state.'+revision.state)}</p>}{active&&report&&active.id!==revision?.id&&<><h4>{key('compare')}</h4><ul>{changes(active.report,report).map(c=><li key={c.id}>{key('diff.'+c.kind)} · {c.title}</li>)}</ul></>}</>}
  </div>
 </section>
}
