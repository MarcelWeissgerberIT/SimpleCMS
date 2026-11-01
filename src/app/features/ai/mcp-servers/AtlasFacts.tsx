import type {AtlasReceipt} from '@/shared/mcp/facts'
import {useT} from '../../../i18n'
/** Closed by default. These fields come from protocol metadata, never model prose. */
export function AtlasFactsView({receipt}:{receipt:AtlasReceipt}){
  const t=useT()
  return <details className="atlas-facts" data-outcome={receipt.outcome}>
    <summary>{t('features.ai.facts.receipt')} · {t('features.ai.facts.'+(receipt.outcome==='error'?'error':receipt.effect))}</summary>
    <div>{receipt.tool} · {t('features.ai.facts.'+receipt.outcome)}</div>
    {receipt.person&&<div>{receipt.person}</div>}
    {receipt.counts.length>0&&<div>{receipt.counts.map(c=>`${t('features.ai.facts.unit.'+c.unit)}: ${c.value}`).join(' · ')}</div>}
    {receipt.refs.length>0&&<div>Ref: {receipt.refs.join(', ')}</div>}
    {receipt.ids.length>0&&<div>ID: {receipt.ids.join(', ')}</div>}
    {receipt.status&&<div>Status: {receipt.status}</div>}
    {receipt.verification&&<div>{t('features.ai.facts.'+receipt.verification)}</div>}
  </details>
}
