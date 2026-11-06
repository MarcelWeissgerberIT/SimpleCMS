import {useEffect,useState} from 'react'
import {Download,RefreshCw} from 'lucide-react'
import {cloudRequest,useCloud} from '../../../cloud'
import {useLang,useT} from '../../../i18n'

type Allocation={workspace:string|null;rounds:number;failedRounds:number;occupancyMs:number;allocatedMs:number;queueMs:number;computeEUR:number}
type CostReport={schema:'one.host-costs.v1';basis:'estimate';window:{from:number;to:number;kind:string};rate:{currency:'EUR';computePerHour:number;diskPerMonth:number;asOf:string;source:string};totals:{computeEUR:number;diskEUR:number;estimatedEUR:number;allocatedComputeEUR:number;unallocatedComputeEUR:number;busyMs:number;incompleteRounds:number;overlapMs:number;rounds:number};workspaces:Array<Allocation&{tasks:number}>;tasks:Array<Allocation&{task:string;user:string|null}>;excludes:string[];method:string}
/** Lead-only host accounting stays separate from token tariffs and shared documents. */
export function FrankfurtCosts({path,scope}:{path:string;scope:string}){
 const t=useT(),lang=useLang(),workspaces=useCloud(s=>s.workspaces)
 const [report,setReport]=useState<CostReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const abort=new AbortController();setBusy(true);setReport(null);setError(false)
  void cloudRequest<CostReport>('GET',path+'?costs=1',undefined,{signal:abort.signal}).then(r=>{if(r.schema!=='one.host-costs.v1'||r.basis!=='estimate')throw Error('Unsupported cost report');if(!abort.signal.aborted)setReport(r)}).catch(()=>{if(!abort.signal.aborted)setError(true)}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})
  return()=>abort.abort()
 },[path,scope,revision])
 const money=(n:number,digits=4)=>new Intl.NumberFormat(lang==='de'?'de-DE':'en-GB',{style:'currency',currency:'EUR',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n)
 const duration=(ms:number)=>new Intl.NumberFormat(lang==='de'?'de-DE':'en-GB',{maximumFractionDigits:1}).format(ms/1000)+' s'
 const date=(n:number)=>new Date(n).toLocaleString(lang==='de'?'de-DE':'en-GB')
 const workspace=(id:string|null)=>id?workspaces.find(w=>w.id===id)?.name??id:t('features.ai.hostCosts.unassigned')
 const save=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='atlas-flow-costs-'+new Date(report.window.to).toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <section className="frankfurt-costs" data-testid="frankfurt-costs">
  <header><h4>{t('features.ai.hostCosts.title')}</h4><button type="button" className="btn btn--sm" disabled={busy} onClick={()=>setRevision(x=>x+1)}><RefreshCw size={14}/>{t('features.ai.hostCosts.refresh')}</button></header>
  <p>{t('features.ai.hostCosts.intro')}</p>
  {busy&&<p role="status">{t('features.ai.hostCosts.loading')}</p>}{error&&<p role="alert">{t('features.ai.hostCosts.error')}</p>}
  {report&&<>
   <p className="label">{t('features.ai.hostCosts.window')} · {date(report.window.from)} → {date(report.window.to)}</p>
   <dl className="frankfurt-costs__totals">{[
    ['compute',report.totals.computeEUR],['disk',report.totals.diskEUR],['allocated',report.totals.allocatedComputeEUR],['residual',report.totals.unallocatedComputeEUR],
   ].map(([key,value])=><div key={key}><dt>{t('features.ai.hostCosts.'+key)}</dt><dd>≈ {money(value as number)}</dd></div>)}</dl>
   <p><strong>{t('features.ai.hostCosts.total')} ≈ {money(report.totals.estimatedEUR)}</strong></p>
   <h5>{t('features.ai.hostCosts.workspaces')}</h5>
   <div className="frankfurt-costs__table" tabIndex={0} role="region" aria-label={t('features.ai.hostCosts.workspaces')}><table><thead><tr><th>{t('features.ai.hostCosts.workspace')}</th><th>{t('features.ai.hostCosts.rounds')}</th><th>{t('features.ai.hostCosts.occupancy')}</th><th>{t('features.ai.hostCosts.share')}</th></tr></thead><tbody>{report.workspaces.map(w=><tr key={w.workspace??''}><td>{workspace(w.workspace)}</td><td>{w.rounds}</td><td>{duration(w.allocatedMs)}</td><td>≈ {money(w.computeEUR)}</td></tr>)}</tbody></table></div>
   {!report.tasks.length&&<p>{t('features.ai.hostCosts.empty')}</p>}
   <details><summary>{t('features.ai.hostCosts.tasks',{count:report.tasks.length})}</summary><div className="frankfurt-costs__table" tabIndex={0} role="region" aria-label={t('features.ai.hostCosts.tasks',{count:report.tasks.length})}><table><thead><tr><th>{t('features.ai.hostCosts.task')}</th><th>{t('features.ai.hostCosts.workspace')}</th><th>{t('features.ai.hostCosts.rounds')}</th><th>{t('features.ai.hostCosts.queue')}</th><th>{t('features.ai.hostCosts.share')}</th></tr></thead><tbody>{report.tasks.map((r,i)=><tr key={i}><td><code>{r.task}</code>{r.failedRounds>0&&<small>{t('features.ai.hostCosts.failed',{count:r.failedRounds})}</small>}</td><td>{workspace(r.workspace)}</td><td>{r.rounds}</td><td>{duration(r.queueMs)}</td><td>≈ {money(r.computeEUR)}</td></tr>)}</tbody></table></div></details>
   <details><summary>{t('features.ai.hostCosts.rate')}</summary><p>{report.rate.asOf} · {money(report.rate.computePerHour)} / h · {money(report.rate.diskPerMonth,2)} / {t('features.ai.hostCosts.month')}</p><p>{report.rate.source}</p><p>{t('features.ai.hostCosts.method')}</p><p>{t('features.ai.hostCosts.excludes')}</p><p>{t('features.ai.hostCosts.incomplete',{count:report.totals.incompleteRounds,overlap:duration(report.totals.overlapMs)})}</p></details>
   <button type="button" className="btn btn--sm" onClick={save}><Download size={14}/>{t('features.ai.hostCosts.download')}</button>
  </>}
 </section>
}
