import {RecoveryDetails} from './RecoveryDetails'
import {WorkflowRepair} from '../workflow/WorkflowRepair'
import {useEffect,useRef,useState} from 'react'
import {useT} from '../../../i18n'
import {useCloud} from '../../../cloud/state'
import {useWorkspace} from '../../../store/store'
import {mcpWorkScope,listMcpWork,deleteMcpWork,clearMcpWork} from '../core/localMcpWork'
import {validTaskRecovery,type TaskRecovery} from '@/shared/ai/taskRecovery'
import {activeRecoveryKey,resumeSavedWork} from './session'
import {openPage} from '../../../lib/router'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {useAgent} from './state'
/** A quiet, collapsed recovery shelf. No model call, page mutation or external replay on mount. */
export function SavedWork({expanded=false,onResume}:{expanded?:boolean;onResume?:()=>void}={}){
 const t=useT(),de=useWorkspace(s=>s.settings.language==='de'),active=useCloud(s=>s.active),user=useCloud(s=>s.user?.id),settings=useWorkspace(s=>s.settings),epoch=useWorkspace(s=>s.epoch),policy=useWorkspace(s=>s.ai),integrations=useWorkspace(s=>s.integrations),running=useAgent(s=>s.status==='running')
 const [rows,setRows]=useState<Array<{key:string;value:TaskRecovery}>>([]),[error,setError]=useState(''),[loadedScope,setLoadedScope]=useState('')
 const pending=useRef(false),[busy,setBusy]=useState(false)
 const pages=useWorkspace(s=>s.pages)
 const scope=mcpWorkScope()
 useEffect(()=>{let alive=true;setError('')
  const load=()=>void listMcpWork<TaskRecovery>(scope,'terminal-recovery:').then(rows=>{if(alive&&scope===mcpWorkScope()){setRows(rows.filter(r=>validTaskRecovery(r.value)).slice(0,8));setLoadedScope(scope)}}).catch(()=>{if(alive){setRows([]);setLoadedScope(scope);setError(t('features.agent.recovery.loadFailed'))}})
  const onVisible=()=>{if(document.visibilityState==='visible')load()}
  load();window.addEventListener('one-mcp-work-changed',load);window.addEventListener('focus',load);document.addEventListener('visibilitychange',onVisible)
  return()=>{alive=false;window.removeEventListener('one-mcp-work-changed',load);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',onVisible)}
 },[scope,active,user,settings,epoch,policy,integrations,t])
 if(loadedScope!==scope||!rows.length&&!error)return null
 const action=async(run:()=>Promise<unknown>)=>{
  if(pending.current||scope!==mcpWorkScope())return
  pending.current=true;setBusy(true);setError('')
  try{await run();if(scope===mcpWorkScope())window.dispatchEvent(new Event('one-mcp-work-changed'))}
  catch{if(scope===mcpWorkScope())setError(t('features.agent.recovery.loadFailed'))}
  finally{pending.current=false;setBusy(false)}
 }
 const resume=async(key:string)=>{
  const result=await resumeSavedWork(scope,key,onResume)
  if(result!=='resumed'&&scope===mcpWorkScope())setError(t('features.agent.recovery.'+result))
 }
 return <details className="term-saved-work" open={expanded||undefined}><summary>{t('features.agent.recovery.title')} · {rows.length}</summary><p>{t('features.agent.recovery.hint')}</p>{error&&<p role="alert">{error}</p>}
  {rows.map(row=><div key={row.key}><strong>{row.value.task.slice(0,160)}</strong><p>{new Date(row.value.at).toLocaleString()}{row.value.status==='running'&&row.key!==activeRecoveryKey()?' · '+t('features.agent.recovery.running'):''}</p>{row.value.progress&&<p>{row.value.progress.completed} {de?'Schritte abgeschlossen':'steps completed'} · {row.value.progress.pending} {de?'offene Änderungen':'pending changes'} · {row.value.progress.partial?'≈ ':''}${row.value.progress.usd.toFixed(4)} · {row.value.progress.requests} {de?'Modellantworten':'model responses'}</p>}{row.value.page&&<p>{de?'Ursprüngliche Seite: ':'Original page: '}{pages[row.value.page]&&!isEffectivelyTrashed(pages,row.value.page)?<button type="button" className="btn btn--sm" onClick={()=>{onResume?.();openPage(row.value.page!)}}>{pages[row.value.page].title}</button>:(de?'Nicht mehr verfügbar':'No longer available')}</p>}<p className="recovery-next">{de?'Nächster Schritt: ':'Next step: '}{row.value.progress?.pending?(de?'Offene Vorschläge und bereits ausgeführte Aktionen prüfen; danach offene Analyse fortsetzen.':'Review pending proposals and completed actions, then continue the remaining analysis.'):row.value.status==='done'?(de?'Gesichertes Ergebnis prüfen; bei neuen Fragen die Quellen erneut lesen lassen.':'Review the saved result; re-read sources for new questions.'):(de?'Letzten Arbeitsstand prüfen und ab der offenen Frage fortsetzen.':'Review the last checkpoint and continue from the open question.')}</p><RecoveryDetails saved={row.value} de={de}/>{row.value.progress?.error&&<><p>{row.value.progress.error}</p><WorkflowRepair message={row.value.progress.error}/></>} {row.key===activeRecoveryKey()?<span>{t('features.agent.recovery.saved')}</span>:<button type="button" className="btn btn--sm" disabled={running||busy} onClick={()=>void action(()=>resume(row.key))}>{t(busy?'features.agent.recovery.starting':'features.agent.recovery.resume')}</button>}{' '}<button type="button" className="btn btn--sm" disabled={running||busy} onClick={()=>void action(()=>deleteMcpWork(scope,row.key))}>{t('features.agent.recovery.remove')}</button></div>)}
  <button type="button" className="btn btn--ghost btn--sm" disabled={running||busy} onClick={()=>void action(()=>clearMcpWork(scope))}>{t('features.agent.recovery.clear')}</button>
 </details>
}
