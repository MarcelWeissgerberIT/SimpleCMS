import { useState } from 'react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { withWriter } from '../../../store/writer'
import { saveMemory } from '../../ai/memory/save'
import { readMemories } from '../../ai/memory/read'
import { scrubSecrets } from '@/shared/ai/keys'
import { loadOrderRecord, orderScope } from './records'
import { acceptanceSnapshot, type AcceptanceSnapshot } from './guidedAcceptance'
import { orderRowShared } from './db'
const G='features.coding.guide'

/** Human curation, no inference request or automatic rule learning. Source hash is host-selected. */
export default function DeliveryPattern({rowId,snapshot}:{rowId:string;snapshot:AcceptanceSnapshot}) {
 const t=useT(),[title,setTitle]=useState(''),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[saved,setSaved]=useState('')
 const save=async()=>{
  if(busy||!title.trim()||!body.trim())return
  setBusy(true);setNote('');const scope=orderScope()
  try{
   const rec=await loadOrderRecord(rowId,{fresh:true})
   if(!rec||rec==='unreadable')throw new Error('stale')
   const fresh=await acceptanceSnapshot(rowId,rec)
   if(!fresh?.accepted||fresh.hash!==snapshot.hash||scope!==orderScope()||useCloud.getState().readOnly||orderRowShared(rowId))throw new Error('stale')
   const source=`ONE #/p/${rowId} · ONE-EVIDENCE ${snapshot.hash}`
   const existing=readMemories().find(m=>m.source===source&&m.type==='procedure')
   if(existing){setSaved(existing.id);setNote(t(`${G}.patternSaved`));return}
   const result=withWriter({kind:'you',via:'ui'},()=>saveMemory({type:'procedure',text:scrubSecrets(title.trim()).slice(0,300),topics:['Atlas Flow'],source,body:scrubSecrets(body.trim()).slice(0,6000)+'\n\n'+t(`${G}.patternHint`)+'\n\n'+source}))
   setSaved(result.id);setNote(t(`${G}.patternSaved`))
  }catch{setNote(t(`${G}.reload`))}finally{setBusy(false)}
 }
 return <details className="og-pattern" data-testid="delivery-pattern"><summary>{t(`${G}.pattern`)}</summary>
  <p className="og-quiet">{t(`${G}.patternHint`)}</p>
  <p className="og-quiet"><a href={`#/p/${rowId}`}>{useWorkspace.getState().pages[rowId]?.title}</a> · SHA-256 {snapshot.hash.slice(0,16)}…</p>
  {saved?<a href={`#/p/${saved}`}>{useWorkspace.getState().pages[saved]?.title||title}</a>:<>
   <label>{t(`${G}.patternTitle`)}<input className="input" value={title} maxLength={300} onChange={e=>setTitle(e.target.value)} data-testid="pattern-title"/></label>
   <label>{t(`${G}.patternBodyLabel`)}<textarea className="input" value={body} maxLength={6000} rows={5} placeholder={t(`${G}.patternBody`)} onChange={e=>setBody(e.target.value)} data-testid="pattern-body"/></label>
   <button type="button" className="btn btn--sm" disabled={busy||!title.trim()||!body.trim()} onClick={()=>void save()} data-testid="pattern-save">{t(`${G}.patternSave`)}</button>
  </>}{note&&<p role="status" className="og-quiet">{note}</p>}
 </details>
}
