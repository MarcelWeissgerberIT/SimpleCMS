import {useState} from 'react'
import {Download} from 'lucide-react'
import type {AtlasReceipt} from '@/shared/mcp/facts'
import {inspectQuantumProof,legacyQuantumDimensions} from '@/shared/quandprofile/inspection'
import {Modal} from '../../../ui/Modal'
import {useLang,useT} from '../../../i18n'
import {QuantumCube} from './QuantumCube'
import './quantum-inspector.css'

/** This inspector reads the host receipt only. Opening, rotating and exporting never invoke a model or MCP. */
export default function QuantumInspector({receipt,onClose}:{receipt:AtlasReceipt;onClose:()=>void}){
  const t=useT(),lang=useLang(),proof=receipt.quantum!,view=inspectQuantumProof(proof),inspection=view.inspection
  const [index,setIndex]=useState(0),[selected,setSelected]=useState('')
  const quantum=inspection?.result.quanta[index],quantumId=proof.quantumIds[index]
  const dimensions=quantum?.dimensions??[...new Set(proof.checks.flatMap(check=>legacyQuantumDimensions[check]??[]))]
  const dimension=dimensions.includes(selected)?selected:dimensions[0]??''
  const evaluation=inspection?.result.evaluation.dimensions.find(d=>d.dimension_id===dimension)
  const obligations=inspection?.result.profile.obligations.filter(o=>evaluation?.obligation_ids.includes(o.id))??[]
  const json=JSON.stringify(proof,null,2)
  const download=()=>{
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download=`one-quantum-${proof.profileHash.slice(0,12)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const hashes=[['profile',proof.profileHash],['request',proof.requestHash],['state',proof.stateHash],['operation',proof.operationHash]]
  return <Modal open onClose={onClose} width={840} title={t('features.ai.quantum.title')} label="QUANDPROFILE" className="quantum-inspector" footer={<button type="button" className="btn" onClick={download}><Download size={16}/>{t('features.ai.quantum.download')}</button>}>
    <section className="quantum-inspector__status" aria-label={t('features.ai.quantum.recorded')}>
      <strong>{t(view.kind==='mismatch'?'features.ai.quantum.unconfirmed':'features.ai.quantum.recorded')}</strong>
      <span>{inspection?new Date(inspection.checkedAt).toLocaleString(lang==='de'?'de-DE':'en-GB'):t('features.ai.quantum.noTime')}</span>
      <p>{t('features.ai.quantum.summary')}</p>
    </section>
    <dl className="quantum-inspector__facts"><div><dt>{t('features.ai.quantum.tool')}</dt><dd>{receipt.server?receipt.server+' · ':''}{receipt.tool}</dd></div><div><dt>{t('features.ai.quantum.actionResult')}</dt><dd>{t('features.ai.facts.'+(receipt.outcome==='error'?'error':receipt.effect))} · {t('features.ai.facts.'+receipt.outcome)}{receipt.verification&&<> · {t('features.ai.facts.'+receipt.verification)}</>}</dd></div></dl>
    {view.kind==='mismatch'?<p role="alert">{t('features.ai.quantum.mismatch')}</p>:<>
      {view.kind==='legacy'&&<p className="quantum-inspector__notice">{t('features.ai.quantum.legacy')}</p>}
      {proof.quantumIds.length>1&&<label className="quantum-inspector__picker">{t('features.ai.quantum.evidence')}<select value={index} onChange={e=>{setIndex(Number(e.target.value));setSelected('')}}>{proof.quantumIds.map((id,i)=><option key={id} value={i}>{id.slice(0,12)}</option>)}</select></label>}
      <QuantumCube references={inspection?.result.quanta.map(q=>({key:q.obligation_id,id:q.id,label:q.verifier,dimensions:q.dimensions,status:q.result,detail:q.detail,verifier:q.verifier,dependencies:q.dependencies}))??[]} coreId={proof.profileHash} emptyLabel={inspection?undefined:t('features.ai.quantum.catalogueOnly')} dimensions={dimensions} selected={dimension} onSelect={setSelected} label={t('features.ai.quantum.cubeLabel')+' · '+(quantumId??proof.profileHash)}/>
      <dl className="quantum-inspector__facts"><div><dt>{t('features.ai.quantum.quantumId')}</dt><dd><code>{quantumId??'—'}</code></dd></div></dl>
      {dimension&&<section className="quantum-inspector__dimension" aria-live="polite">
        <header><strong>{t('features.ai.quantum.dimension.'+dimension)}</strong><span className="label">{evaluation?t('features.ai.quantum.status.'+evaluation.status):t('features.ai.quantum.catalogueOnly')}</span></header>
        <p>{t('features.ai.quantum.description.'+proof.gate+'.'+dimension)}</p>
        {obligations.map(o=><dl className="quantum-inspector__facts" key={o.id}><div><dt>{t('features.ai.quantum.rule')}</dt><dd><code>{o.id}</code></dd></div><div><dt>{t('features.ai.quantum.claim')}</dt><dd><code>{o.claim}</code></dd></div></dl>)}
      </section>}
      <dl className="quantum-inspector__facts"><div><dt>{t('features.ai.quantum.verifier')}</dt><dd>{quantum?`${quantum.verifier} · ${quantum.verifier_version}`:proof.checks.join(', ')}</dd></div>{quantum&&<><div><dt>{t('features.ai.quantum.finding')}</dt><dd>{quantum.detail}</dd></div><div><dt>{t('features.ai.quantum.definition')}</dt><dd>{quantum.quantum_binding?.definition_id} · {quantum.quantum_binding?.definition_version}</dd></div></>}</dl>
      {inspection&&<details className="quantum-inspector__bindings"><summary>{t('features.ai.quantum.bindings')}</summary><dl className="quantum-inspector__facts">{Object.entries(inspection.request.scope).map(([key,value])=><div key={key}><dt>{key}</dt><dd><code>{value}</code></dd></div>)}{Object.entries(inspection.request.snapshot).map(([key,value])=><div key={key}><dt>{key}</dt><dd><code>{JSON.stringify(value)}</code></dd></div>)}{quantum&&Object.entries(quantum.dependencies).map(([key,value])=><div key={'dep-'+key}><dt>{key}</dt><dd><code>{value}</code></dd></div>)}</dl></details>}
    </>}
    <details className="quantum-inspector__hashes"><summary>{t('features.ai.quantum.hashes')}</summary><p>{t('features.ai.quantum.limit')}</p><dl className="quantum-inspector__facts">{hashes.map(([label,value])=><div key={label}><dt>{t('features.ai.quantum.hash.'+label)}</dt><dd><code>{value}</code></dd></div>)}</dl></details>
    <details className="quantum-inspector__raw"><summary>{t('features.ai.quantum.raw')}</summary><pre>{json}</pre></details>
  </Modal>
}
