import { useId, useMemo, useState } from 'react'
import { mockBlockData, mockBlockTask, mockSourceUrl, type MockBlockData } from '@/shared/ai/mockBlock'
import { useAgent, openAgent } from './state'
import { useWorkspace } from '../../../store/store'
import { useT } from '../../../i18n'
/** Explicit hand-off to the normal /mock flow. Mounting/reading a block never starts a model. */
export function MockBlockComposer({value,onChange}:{value:MockBlockData;onChange:(value:MockBlockData)=>void}) {
 const id=useId()
 const t=useT(),turns=useAgent(s=>s.turns),running=useAgent(s=>s.status==='running'),epoch=useWorkspace(s=>s.epoch)
 const candidates=useMemo(()=>turns.filter(turn=>turn.mockWorkspaceEpoch===(epoch??'local')).flatMap(turn=>turn.mocks??[]).slice().reverse(),[turns,epoch])
 const [selected,setSelected]=useState('')
 const patch=(part:Partial<MockBlockData>)=>onChange({...value,...part})
 const task=mockBlockTask(value)
 const importPreview=()=>{
  if(epoch!==useWorkspace.getState().epoch)return
  const artifact=candidates.find(a=>a.id===selected)
  if(!artifact)return
  const next=mockBlockData({...value,source:value.source||artifact.sources.find(s=>s.id===artifact.draft.design.source)?.url||'',requirement:value.requirement||(artifact.target?.url??''),request:value.request||artifact.title,preview:{title:artifact.title,document:artifact.document,width:artifact.width,height:artifact.height,createdAt:artifact.createdAt,htmlHash:artifact.htmlHash,targetUrl:(artifact.atlasSaved?.url??artifact.atlasDestination?.url??artifact.target?.url??'')}})
  if(next.preview)onChange(next)
 }
 return <div className="mock-block__composer">
  <div className="mock-block__field"><label htmlFor={id+'-source'}>{t('editor.mock.source')}</label><input id={id+'-source'} type="url" maxLength={2000} defaultValue={value.source} key={value.source} placeholder="https://aj-atlas.com/r/… (Design-Epic oder MD-Record)" onBlur={e=>patch({source:mockSourceUrl(e.target.value)})}/></div>
  <div className="mock-block__field"><label htmlFor={id+'-requirement'}>{t('editor.mock.requirement')}</label><input id={id+'-requirement'} value={value.requirement} maxLength={2000} placeholder="#32155" onChange={e=>patch({requirement:e.target.value})}/></div>
  <div className="mock-block__field"><label htmlFor={id+'-request'}>{t('editor.mock.request')}</label><textarea id={id+'-request'} value={value.request} maxLength={8000} rows={3} placeholder={t('editor.mock.requestHint')} onChange={e=>patch({request:e.target.value})}/></div>
  <label><input type="checkbox" checked={!!value.saveToEpic} onChange={e=>patch({saveToEpic:e.target.checked})}/>{useWorkspace.getState().settings.language==='de'?' Mock automatisch als neuen Record im Design-Epic speichern':' Automatically save mock as a new record in the design epic'}</label>
  <div className="mock-block__actions"><button type="button" className="btn btn--primary btn--sm" disabled={!task||running} onClick={()=>{if(task&&epoch===useWorkspace.getState().epoch)openAgent({task,run:false})}}>{t('editor.mock.prepare')}</button></div>
  <p className="faint">{t(running?'editor.mock.running':'editor.mock.handoff')}</p>
  {candidates.length>0&&<div className="mock-block__import"><div className="mock-block__field"><label htmlFor={id+'-result'}>{t('editor.mock.result')}</label><select id={id+'-result'} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{t('editor.mock.choose')}</option>{candidates.map(a=><option value={a.id} key={a.id}>{a.title}{a.target?' · #'+a.target.ref:''}</option>)}</select></div><button type="button" className="btn btn--sm" disabled={!selected} onClick={importPreview}>{t('editor.mock.import')}</button></div>}
 </div>
}
