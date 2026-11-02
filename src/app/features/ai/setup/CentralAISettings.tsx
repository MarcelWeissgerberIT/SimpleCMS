import {useEffect,useRef,useState} from 'react'
import {KeyRound,ShieldCheck,ArrowRight,RefreshCw} from 'lucide-react'
import {useCloud,cloudRequest} from '../../../cloud'
import {useT,useLang} from '../../../i18n'
import {navigate} from '../../../lib/router'
import {useUI} from '../../../store/ui'
import {centralAI,refreshCentralAI,useCentralAI} from '../core/centralAI'
import type {CentralAIRequest,CentralAIStatus} from '@/shared/ai/central'
import './central-ai.css'

const notice=(c:CentralAIStatus)=>c.ready?'features.ai.central.ready':c.id&&!c.configured?(c.manage?'features.ai.central.ownerKeyMissing':'features.ai.central.teamKeyMissing'):c.id&&c.configured&&!c.enabled?'features.ai.central.notActivated':'features.ai.central.inactive'

export function CentralAICard(){
 const t=useT();useCentralAI();const c=centralAI()
 if(!c?.assigned||!c.id)return null
 return <section className="central-ai central-ai--compact" data-testid="central-ai-card">
  <span className="label">{t('features.ai.central.shared')}</span>
  <h4><ShieldCheck size={20} aria-hidden/> {c.label}</h4>
  <p>{t(notice(c))}</p>
  <p className="central-ai__muted">{t('features.ai.central.personalAtlas')}</p>
  <button type="button" className="btn btn--sm" onClick={()=>{useUI.getState().closeModal();navigate({name:'workspace',section:'ai'})}}>{t('features.ai.central.open')} <ArrowRight size={14} aria-hidden/></button>
 </section>
}

export function CentralAISettings(){
 const t=useT(),lang=useLang();useCentralAI()
 const c=centralAI(),active=useCloud(s=>s.active),role=useCloud(s=>s.role),workspaces=useCloud(s=>s.workspaces)
 const current=active.kind==='cloud'?active.id:''
 const [label,setLabel]=useState(t('features.ai.central.defaultLabel')),[budget,setBudget]=useState(''),[selected,setSelected]=useState<string[]>([current]),[enabled,setEnabled]=useState(false)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[rows,setRows]=useState<CentralAIRequest[]|null>(null),[detail,setDetail]=useState<unknown>(null)
 const keyInput=useRef<HTMLInputElement>(null)
 const manage=c?.assigned?!!c.manage:role==='owner'||role==='admin'
 const savedVersion=c?.version??0
 useEffect(()=>{setLabel(c?.label??t('features.ai.central.defaultLabel'));setBudget(c?.budgetUsd==null?'':String(c.budgetUsd));setEnabled(!!c?.enabled);setSelected(c?.workspaces?.map(w=>w.id)??[current]);setRows(null);setDetail(null);if(keyInput.current)keyInput.current.value=''},[current,savedVersion])
 const path=`api/workspaces/${current}/central-ai`
 const money=(n:number|undefined)=>new Intl.NumberFormat(lang==='de'?'de-DE':'en-US',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(n??0)
 const run=async(fn:()=>Promise<void>,success:string)=>{
  setBusy(true);setMessage('');setError('')
  try{await fn();await refreshCentralAI();setMessage(t(success))}catch{setError(t('features.ai.central.configFailed'));await refreshCentralAI()}finally{setBusy(false)}
 }
 if(!current)return null
 return <section className="central-ai" aria-labelledby="central-ai-heading" data-testid="central-ai-settings">
  <header className="central-ai__head"><span className="label">{t('features.ai.central.shared')}</span><h3 id="central-ai-heading"><ShieldCheck aria-hidden/> {t('features.ai.central.title')}</h3><p>{t('features.ai.central.intro')}</p></header>
  <div className="central-ai__status" role="status"><span className={`led ${c?.ready?'is-on':''}`} aria-hidden/><strong>{t(c?.assigned&&c.id?notice(c):'features.ai.central.new')}</strong><span>Claude Opus 5.5 · Anthropic API</span></div>
  <p>{t('features.ai.central.personalAtlas')}</p>
  {manage?<>
   <form onSubmit={e=>{e.preventDefault();void run(async()=>{await cloudRequest('PUT',path,{version:savedVersion,label,workspaces:selected,budgetUsd:budget.trim()?Number(budget.replace(',','.')):null,enabled})},'features.ai.central.saved')}}>
    <div className="central-ai__grid">
     <label className="field"><span className="label">{t('features.ai.central.label')}</span><input className="input" value={label} maxLength={80} required disabled={busy} onChange={e=>setLabel(e.target.value)}/></label>
     <label className="field"><span className="label">{t('features.ai.central.budgetLabel')}</span><input className="input" type="number" min="1" max="10000" step="1" value={budget} placeholder="50" disabled={busy} onChange={e=>setBudget(e.target.value)}/></label>
    </div>
    <fieldset disabled={busy} className="central-ai__workspaces"><legend className="label">{t('features.ai.central.workspaces')}</legend>{workspaces.filter(w=>w.role==='owner'||w.role==='admin').map(w=><label key={w.id}><input type="checkbox" checked={selected.includes(w.id)} disabled={w.id===current||w.id===c?.workspaces?.[0]?.id} onChange={e=>{const checked=e.target.checked;setSelected(old=>checked?[...old,w.id]:old.filter(id=>id!==w.id))}}/><span>{w.name}</span></label>)}</fieldset>
    <label className="central-ai__check"><input type="checkbox" checked={enabled} disabled={busy||!c?.configured||!c.verifiedAt||!budget.trim()} onChange={e=>setEnabled(e.target.checked)}/><span>{t('features.ai.central.activate')}</span></label>
    <p className="central-ai__muted">{t('features.ai.central.billing')}</p>
    <button className="btn btn--ink" disabled={busy} type="submit">{t('features.ai.central.save')}</button>
   </form>
   <div className="central-ai__step">
    <h4><KeyRound size={18} aria-hidden/> {t('features.ai.central.keyTitle')}</h4>
    <p>{t('features.ai.central.keyHelp')}</p>
    <form onSubmit={e=>{e.preventDefault();const value=keyInput.current?.value.trim()??'';if(keyInput.current)keyInput.current.value='';if(value)void run(async()=>{await cloudRequest('POST',path+'/key',{version:savedVersion,key:value})},'features.ai.central.keySaved')}}>
     <label className="field"><span className="label">{t('features.ai.central.keyLabel')}</span><input ref={keyInput} type="password" className="input" autoComplete="new-password" autoCapitalize="none" spellCheck={false} name="central-claude-api-key" placeholder="sk-ant-…" required disabled={busy||!c?.id} data-testid="central-key-input"/></label>
     <div className="central-ai__actions"><button type="submit" className="btn" disabled={busy||!c?.id}>{t('features.ai.central.keyCheck')}</button>{c?.configured&&<button type="button" className="btn" disabled={busy} onClick={()=>void run(async()=>{await cloudRequest('DELETE',path+'/key',{version:savedVersion})},'features.ai.central.keyRemoved')}>{t('features.ai.central.remove')}</button>}</div>
    </form>
    <p className="central-ai__muted">{t(c?.configured?'features.ai.central.keyPresent':c?.id?'features.ai.central.ownerKeyMissing':'features.ai.central.keyMissing')}{c?.verifiedAt?` · ${new Date(c.verifiedAt).toLocaleString(lang==='de'?'de-DE':'en-US')}`:''}</p>
    <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer noopener">{t('features.ai.central.console')}</a>
   </div>
   {c?.id&&<div className="central-ai__step"><h4>{t('features.ai.central.defaultTitle')}</h4><p>{t('features.ai.central.defaultHelp')}</p><button type="button" className="btn" disabled={busy} onClick={()=>void run(async()=>{await cloudRequest('POST',path+'/defaults',{version:savedVersion})},'features.ai.central.defaultSaved')}>{t('features.ai.central.defaultButton')}</button></div>}
   {c?.id&&<div className="central-ai__step" id="central-usage"><h4>{t('features.ai.central.usage')}</h4><div className="central-ai__metrics"><span>{t('features.ai.central.spent')}<strong>{money(c.spentUsd)}</strong></span><span>{t('features.ai.central.held')}<strong>{money(c.heldUsd)}</strong></span><span>{t('features.ai.central.cap')}<strong>{c.budgetUsd==null?'—':money(c.budgetUsd)}</strong></span></div><p className="central-ai__muted">{t('features.ai.central.reservation')}</p>
    <button type="button" className="btn" disabled={busy} onClick={()=>void run(async()=>{setRows(await cloudRequest<CentralAIRequest[]>('GET',path+'/requests'))},'features.ai.central.logLoaded')}><RefreshCw size={14} aria-hidden/> {t('features.ai.central.log')}</button>
    {rows&&<><p className="central-ai__muted">{t('features.ai.central.retention')}</p>{rows.length===0?<p>{t('features.ai.central.empty')}</p>:<div className="central-ai__table"><table><thead><tr><th>{t('features.ai.central.date')}</th><th>{t('features.ai.central.state')}</th><th>{t('features.ai.central.cost')}</th><th>{t('features.ai.central.details')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.createdAt).toLocaleString(lang==='de'?'de-DE':'en-US')}<small>{workspaces.find(w=>w.id===r.workspace)?.name??r.workspace}</small></td><td>{t('features.ai.central.state.'+r.state)}</td><td>{money(r.usd)}{r.reservedUsd>0&&<small>{t('features.ai.central.held')}: {money(r.reservedUsd)}</small>}</td><td><button type="button" className="btn btn--sm" disabled={busy} onClick={()=>void run(async()=>{setDetail(await cloudRequest('GET',path+'/requests/'+r.id))},'features.ai.central.logLoaded')}>{t('features.ai.central.show')}</button></td></tr>)}</tbody></table></div>}{detail!=null&&<details open><summary>{t('features.ai.central.details')}</summary><pre className="central-ai__detail">{JSON.stringify(detail,null,2)}</pre></details>}</>}
   </div>}
  </>:<p>{t('features.ai.central.ownerOnly')}</p>}
  {busy&&<p role="status">{t('features.ai.central.working')}</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>
}
