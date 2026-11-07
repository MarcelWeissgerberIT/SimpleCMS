import {WorkflowRepair} from '../workflow/WorkflowRepair'
import {useEffect,useState} from 'react'
import {useT} from '../../../i18n'
import {useCloud} from '../../../cloud/state'
import {useWorkspace} from '../../../store/store'
import {mcpWorkScope,listMcpWork,deleteMcpWork,clearMcpWork} from '../core/localMcpWork'
import {validTaskRecovery,type TaskRecovery} from '@/shared/ai/taskRecovery'
import {activeRecoveryKey,resumeSavedWork} from './session'
import {useAgent} from './state'
/** A quiet, collapsed recovery shelf. No model call, page mutation or external replay on mount. */
export function SavedWork(){
 const t=useT(),de=useWorkspace(s=>s.settings.language==='de'),active=useCloud(s=>s.active),user=useCloud(s=>s.user?.id),settings=useWorkspace(s=>s.settings),epoch=useWorkspace(s=>s.epoch),policy=useWorkspace(s=>s.ai),integrations=useWorkspace(s=>s.integrations),running=useAgent(s=>s.status==='running')
 const [rows,setRows]=useState<Array<{key:string;value:TaskRecovery}>>([]),[error,setError]=useState(''),[loadedScope,setLoadedScope]=useState('')
 const scope=mcpWorkScope()
 useEffect(()=>{let alive=true
  const load=()=>void listMcpWork<TaskRecovery>(scope,'terminal-recovery:').then(rows=>{if(alive&&scope===mcpWorkScope()){setRows(rows.filter(r=>validTaskRecovery(r.value)).slice(0,8));setLoadedScope(scope);setError('')}}).catch(()=>{if(alive){setRows([]);setLoadedScope(scope);setError(t('features.agent.recovery.loadFailed'))}})
  load();window.addEventListener('one-mcp-work-changed',load)
  return()=>{alive=false;window.removeEventListener('one-mcp-work-changed',load)}
 },[scope,active,user,settings,epoch,policy,integrations,t])
 if(loadedScope!==scope||!rows.length&&!error)return null
 const action=async(run:()=>Promise<unknown>)=>{try{await run();window.dispatchEvent(new Event('one-mcp-work-changed'));setError('')}catch{setError(t('features.agent.recovery.loadFailed'))}}
 return <details className="term-saved-work"><summary>{t('features.agent.recovery.title')} · {rows.length}</summary><p>{t('features.agent.recovery.hint')}</p>{error&&<p role="status">{error}</p>}
  {rows.map(row=><div key={row.key}><strong>{row.value.task.slice(0,160)}</strong><p>{new Date(row.value.at).toLocaleString()}{row.value.status==='running'&&row.key!==activeRecoveryKey()?' · '+t('features.agent.recovery.running'):''}</p>{row.value.progress&&<p>{row.value.progress.completed} {de?'Schritte abgeschlossen':'steps completed'} · {row.value.progress.pending} {de?'offene Änderungen':'pending changes'} · {row.value.progress.partial?'≈ ':''}${row.value.progress.usd.toFixed(4)} · {row.value.progress.requests} {de?'Modellantworten':'model responses'}</p>}{row.value.progress?.error&&<><p>{row.value.progress.error}</p><WorkflowRepair message={row.value.progress.error}/></>} {row.key===activeRecoveryKey()?<span>{t('features.agent.recovery.saved')}</span>:<button type="button" className="btn btn--sm" disabled={running} onClick={()=>void action(()=>resumeSavedWork(scope,row.key))}>{t('features.agent.recovery.resume')}</button>}{' '}<button type="button" className="btn btn--sm" disabled={running} onClick={()=>void action(()=>deleteMcpWork(scope,row.key))}>{t('features.agent.recovery.remove')}</button></div>)}
  <button type="button" className="btn btn--ghost btn--sm" disabled={running} onClick={()=>void action(()=>clearMcpWork(scope))}>{t('features.agent.recovery.clear')}</button>
 </details>
}
