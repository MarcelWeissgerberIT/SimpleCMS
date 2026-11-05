import {useMemo,useState} from 'react'
import {Modal} from '../../../ui/Modal'
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {plainText} from '../../../store/plain'
import {markdownToDoc} from '../../../editor/convert'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {useCloud} from '../../../cloud'
import {openPage} from '../../../lib/router'
import {stage} from './session'
import {useAgent} from './state'
import {TERMINAL_TOOLS} from './tools'
import type {AgentTurn} from './types'

/** A human copies a completed answer into the existing ONE review. No new inference or Atlas effect. */
export function AnswerPageAction({turn,last=false}:{turn:AgentTurn;last?:boolean}) {
  const t=useT(),readOnly=useCloud(s=>s.readOnly),cloud=useCloud(s=>s.active.kind==='cloud')
  const pages=useWorkspace(s=>s.pages),busy=useAgent(s=>s.status==='running'||s.applying)
  const dismissed=useAgent(s=>s.answerPageHintDismissed)
  const change=useAgent(s=>s.changes.find(c=>c.id===turn.answerPageChange))
  const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[destination,setDestination]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const [scope,setScope]=useState('')
  const meaningful=turn.answer.trim().length>=300||(turn.answer.trim().length>=120&&/^(?:#{1,6} |[-*] |\d+\. |\|)/mu.test(turn.answer))
  const mayRemind=last&&meaningful&&!busy&&!readOnly&&!dismissed&&turn.status==='done'&&(!change||change.status==='discarded')
  // Compare complete text only. A matching excerpt is not proof the whole answer was saved.
  const answerText=useMemo(()=>{
    if(!mayRemind)return ''
    try{return plainText(markdownToDoc(turn.answer),Infinity).replace(/\s+/gu,' ').trim()}catch{return ''}
  },[mayRemind,turn.answer])
  const alreadyOnPage=useMemo(()=>answerText.length>=120&&Object.values(pages).some(page=>!isEffectivelyTrashed(pages,page.id)&&page.plain?.replace(/\s+/gu,' ').includes(answerText)),[answerText,pages])
  const currentScope=()=>JSON.stringify([useWorkspace.getState().epoch,useCloud.getState().active,useCloud.getState().user?.id])
  if(turn.status!=='done'||!turn.answer.trim())return null
  const begin=()=>{
    setScope(currentScope());setError('')
    setTitle((/^#\s+(.+)$/mu.exec(turn.answer)?.[1]??turn.task.replace(/^\/\w+\s*/u,'')).slice(0,300))
    setDestination(cloud?'@private':'@workspace');setOpen(true)
  }
  const prepare=async()=>{
    setSaving(true);setError('')
    try {
      const state=useAgent.getState(),live=state.turns.find(x=>x.n===turn.n)
      if(scope!==currentScope()||useCloud.getState().readOnly||state.status==='running'||state.applying||live?.answer!==turn.answer||live.status!=='done')throw Error(t('features.ai.task.stale'))
      if(live.answerPageChange&&state.changes.some(c=>c.id===live.answerPageChange&&c.status!=='discarded')){setOpen(false);return}
      const parent=destination.startsWith('@')?null:useWorkspace.getState().pages[destination]
      if(!destination.startsWith('@')&&(!parent||parent.settings.locked||isEffectivelyTrashed(useWorkspace.getState().pages,destination)))throw Error(t('features.ai.program.sourceMissing'))
      const tool=TERMINAL_TOOLS.find(x=>x.name==='create_page')!
      const before=new Set(state.changes.map(c=>c.id))
      await tool.run({title:title.trim(),markdown:turn.answer+'\n\n---\n\n'+t('features.ai.answerPage.draft'),...(parent?{parent_id:parent.id}:{})},stage)
      const made=stage.list().find(c=>!before.has(c.id)&&c.kind==='create_page')
      if(!made)throw Error(t('features.ai.answerPage.failed'))
      if(destination==='@private')stage.update(made.id,{privateRoot:true})
      useAgent.setState(s=>({turns:s.turns.map(x=>x.n===turn.n?{...x,answerPageChange:made.id}:x)}))
      setOpen(false)
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setSaving(false)}
  }
  const present=change&&change.status!=='discarded'
  return <div className="term-answer-page">
    {mayRemind&&!alreadyOnPage&&<div className="term-answer-page__hint" role="note">
      <span>{t('features.ai.answerPage.hint')}</span>
      <button type="button" className="term-answer-page__dismiss" aria-label={t('features.ai.answerPage.dismissHint')} title={t('features.ai.answerPage.dismissHint')} onClick={()=>useAgent.setState({answerPageHintDismissed:true})}>×</button>
    </div>}
    {present?<p role="status">{t(change.status==='applied'?'features.ai.answerPage.saved':'features.ai.answerPage.staged')}{change.status==='applied'&&pages[change.pageId]&&<button className="btn btn--sm" onClick={()=>openPage(change.pageId)}>{t('features.ai.answerPage.open')}</button>}</p>:<button className="btn btn--sm" disabled={readOnly||busy} onClick={begin}>{t('features.ai.answerPage.action')}</button>}
    {open&&<Modal open title={t('features.ai.answerPage.title')} label="ONE" width={560} onClose={()=>{if(!saving)setOpen(false)}} footer={<><button className="btn" disabled={saving} onClick={()=>setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" disabled={saving||busy||readOnly||!title.trim()} onClick={()=>void prepare()}>{t('features.ai.answerPage.prepare')}</button></>}>
      <p>{t('features.ai.answerPage.intro')}</p>
      <label className="answer-page__field">{t('features.ai.answerPage.name')}<input className="input" value={title} onChange={e=>setTitle(e.target.value)} maxLength={300}/></label>
      <label className="answer-page__field">{t('features.ai.answerPage.destination')}<select className="input" aria-label={t('features.ai.answerPage.destination')} value={destination} onChange={e=>setDestination(e.target.value)}>{cloud&&<option value="@private">{t('features.ai.answerPage.private')}</option>}<option value="@workspace">{t('features.ai.answerPage.workspace')}</option>{Object.values(pages).filter(p=>p.kind==='page'&&!p.settings.locked&&!isEffectivelyTrashed(pages,p.id)).map(p=><option key={p.id} value={p.id}>{p.title||t('common.untitled')}{p.private?' · '+t('features.ai.answerPage.private'):''}</option>)}</select></label>
      <p>{t('features.ai.answerPage.visibility')}</p>
      {error&&<p role="alert">{error}</p>}
    </Modal>}
  </div>
}
