import {useSyncExternalStore} from 'react'
import {Modal} from '../../../ui/Modal'
import {useT} from '../../../i18n'
import type {AtlasTransferMode} from '@/shared/quandprofile/atlas-transfer'
import './atlas-transfer.css'
type Pending={task:string;kind:'delivery'|'closure';resolve:(mode:AtlasTransferMode|'questions'|'record'|null)=>void}
let pending:Pending|null=null
const listeners=new Set<()=>void>(),publish=()=>listeners.forEach(f=>f()),subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},snapshot=()=>pending
export function cancelAtlasTransferChoice(){const old=pending;pending=null;publish();old?.resolve(null)}
export function requestAtlasTransferChoice(task:string):Promise<AtlasTransferMode|null>{
 cancelAtlasTransferChoice()
 return new Promise(resolve=>{pending={task,kind:'delivery',resolve:mode=>resolve(mode as AtlasTransferMode|null)};publish()})
}
export function requestAtlasClosureChoice(task:string):Promise<'questions'|'record'|null>{cancelAtlasTransferChoice();return new Promise(resolve=>{pending={task,kind:'closure',resolve:mode=>resolve(mode as 'questions'|'record'|null)};publish()})}
export function AtlasTransferChoiceHost(){
 const current=useSyncExternalStore(subscribe,snapshot,snapshot),t=useT()
 if(!current)return null
 const select=(mode:AtlasTransferMode|'questions'|'record')=>{if(pending!==current)return;pending=null;publish();current.resolve(mode)}
 const prefix=current.kind==='closure'?'features.ai.closure.':'features.ai.transfer.'
 return <Modal open title={t(prefix+'title')} label={t(prefix+'label')} width={640} onClose={cancelAtlasTransferChoice} footer={<button className="btn" onClick={cancelAtlasTransferChoice}>{t('common.cancel')}</button>}>
  <p>{t(prefix+'intro')}</p><blockquote className="atlas-transfer__request">{current.task}</blockquote>
  <div className="atlas-transfer__choices">{(current.kind==='closure'?['questions','record'] as const:['create','update','comment'] as const).map(mode=><button className="btn atlas-transfer__choice" key={mode} onClick={()=>select(mode)}><strong>{t(prefix+mode)}</strong><span>{t(prefix+mode+'Help')}</span></button>)}</div>
  <p className="atlas-transfer__note">{t('features.ai.transfer.before')}</p>
 </Modal>
}
