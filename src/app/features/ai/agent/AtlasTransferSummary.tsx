import {atlasTransferChoice} from '@/shared/quandprofile/atlas-transfer'
import {useT} from '../../../i18n'
import type {AgentTurn,AgentStep} from './types'
import {useAgent} from './state'
/** Only host receipts count as accepted writes. Model prose cannot turn this card green. */
export function AtlasTransferSummary({turn,steps}:{turn:AgentTurn;steps:AgentStep[]}){
 const t=useT()
 const writes=steps.filter(s=>['atlas_create','atlas_update','atlas_comment'].includes(s.mcp?.tool??''))
 const mode=atlasTransferChoice(turn.task)??({atlas_create:'create',atlas_update:'update',atlas_comment:'comment'} as const)[writes[0]?.mcp?.tool as 'atlas_create']
 if(!mode)return null
 const accepted=writes.filter(s=>s.mcp?.receipt?.effect==='write_accepted'&&s.mcp.receipt.outcome==='ok')
 return <section tabIndex={-1} className="atlas-transfer__summary" aria-label={t('features.ai.transfer.summary')}>
  <strong>{t('features.ai.transfer.summary')} · {t('features.ai.transfer.'+mode)}</strong>
  <p>{t('features.ai.transfer.progress',{accepted:accepted.length,checked:accepted.filter(s=>s.mcp?.receipt?.verification==='read_back_matches').length})}</p>
  {!accepted.length&&<p>{t('features.ai.transfer.none')}</p>}
  <ul>{writes.map(step=>{const r=step.mcp?.receipt;let origin='';try{const url=r?.quantum?.inspection?.request.snapshot.origin;if(typeof url==='string'&&/^https:\/\/(?:aj|eh)-atlas\.com(?:\/|$)/u.test(url))origin=new URL(url).origin}catch{/* keep unknown destinations as plain refs */}return <li key={step.id}>{step.mcp?.tool} · {step.state==='run'?t('features.ai.transfer.running'):step.mcp?.notExecuted?t('features.ai.transfer.notExecuted'):r?.outcome==='ok'&&r.effect==='write_accepted'?t('features.ai.transfer.accepted'):t('features.ai.transfer.unconfirmed')}{r?.refs.map(ref=><span key={ref}> · {origin?<a href={origin+'/r/'+ref} target="_blank" rel="noreferrer">Ref {ref}</a>:'Ref '+ref}</span>)}{r?.verification&&<span> · {t('features.ai.facts.'+r.verification)}</span>}</li>})}</ul>
  {turn.status!=='running'&&<p>{t('features.ai.transfer.checkBeforeRetry')}</p>}
 </section>
}

/** Keep the outcome next to the input even when the tool log and memory suggestions are long. */
export function AtlasTransferDock(){
 const t=useT(),turn=useAgent(s=>s.turns.at(-1)),all=useAgent(s=>s.steps)
 if(!turn)return null
 const writes=all.filter(s=>s.turn===turn.n&&['atlas_create','atlas_update','atlas_comment'].includes(s.mcp?.tool??''))
 if(!atlasTransferChoice(turn.task)&&!writes.length)return null
 const accepted=writes.filter(s=>s.mcp?.receipt?.effect==='write_accepted'&&s.mcp.receipt.outcome==='ok')
 return <div className="atlas-transfer__dock" role="status"><strong>{t('features.ai.transfer.summary')}</strong><span>{t('features.ai.transfer.progress',{accepted:accepted.length,checked:accepted.filter(s=>s.mcp?.receipt?.verification==='read_back_matches').length})}</span><button className="btn btn--sm" onClick={()=>{const target=document.querySelector<HTMLElement>(`.term-turn[data-turn="${turn.n}"] .atlas-transfer__summary`);target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true})}}>{t('features.ai.transfer.openReceipt')}</button></div>
}
