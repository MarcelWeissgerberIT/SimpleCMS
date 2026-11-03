import {useState} from 'react'
import type {ProgramRunPreview} from '@/shared/quandprofile/program-run-summary'
import {useT} from '../../../i18n'
import {HistoricalChecks} from './ProgramInspectionView'
import {useRunDetail} from './useRunDetail'
import {ProgramRunResult} from './ProgramRunResult'
export function ProgramHistoryEntry({run,name}:{run:ProgramRunPreview;name:string}){
 const t=useT(),[open,setOpen]=useState(false)
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary><strong>{name}</strong><span>V{run.version} · {run.hash.slice(0,12)} · {t('features.ai.program.status.'+run.status)} · {new Date(run.startedAt).toLocaleString()}</span></summary>{open&&<RunBody preview={run}/>}</details>
}
function RunBody({preview}:{preview:ProgramRunPreview}){
 const t=useT(),{run,loading,error,retry}=useRunDetail(preview)
 return error?<p role="alert">{t('features.ai.program.inspection.loadFailed')} <button type="button" className="btn" onClick={retry}>{t('features.ai.program.refresh')}</button></p>:loading?<p role="status">{t('features.ai.program.inspection.loading')}</p>:run?<><ProgramRunResult run={run}/>{run.inspection&&<HistoricalChecks raw={run.inspection} model={run.route.model} at={run.finishedAt}/>}<details><summary>{t('features.ai.program.inspection.receipt')}</summary><pre className="programs__run-json">{JSON.stringify(run,null,2)}</pre></details></>:null
}
