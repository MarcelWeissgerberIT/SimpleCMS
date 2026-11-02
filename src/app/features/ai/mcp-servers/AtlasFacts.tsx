import {lazy,Suspense,useState} from 'react'
import type {AtlasReceipt} from '@/shared/mcp/facts'
import {useT} from '../../../i18n'
const QuantumInspector=lazy(()=>import('./QuantumInspector'))
/** Closed by default. These fields come from protocol metadata, never model prose. */
export function AtlasFactsView({receipt}:{receipt:AtlasReceipt}){
  const t=useT(),[inspect,setInspect]=useState(false)
  return <details className="atlas-facts" data-outcome={receipt.outcome}>
    <summary>{t('features.ai.facts.receipt')} · {t('features.ai.facts.'+(receipt.outcome==='error'?'error':receipt.effect))}{receipt.verification==='read_back_differs'&&<> · {t('features.ai.facts.read_back_differs')}</>}</summary>
    <div>{receipt.tool} · {t('features.ai.facts.'+receipt.outcome)}</div>
    {receipt.person&&<div>{receipt.person}</div>}
    {receipt.counts.length>0&&<div>{receipt.counts.map(c=>`${t('features.ai.facts.unit.'+c.unit)}: ${c.value}${c.scope?' ('+t('features.ai.facts.'+c.scope)+')':''}`).join(' · ')}</div>}
    {receipt.refs.length>0&&<div>Ref: {receipt.refs.join(', ')}</div>}
    {receipt.ids.length>0&&<div>ID: {receipt.ids.join(', ')}</div>}
    {receipt.status&&<div>Status: {receipt.status}</div>}
    {receipt.verification&&<div>{t('features.ai.facts.'+receipt.verification)}</div>}
    {receipt.quantum&&<><button type="button" className="btn btn--sm" onClick={()=>setInspect(true)} aria-haspopup="dialog">{t('features.ai.quantum.receipt')} · {receipt.quantum.profileHash.slice(0,12)}</button>{inspect&&<Suspense fallback={<span role="status">{t('features.ai.quantum.loading')}</span>}><QuantumInspector receipt={receipt} onClose={()=>setInspect(false)}/></Suspense>}</>}
  </details>
}
