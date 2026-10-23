import { useState } from 'react'
import { readCopilotChoice, type CopilotChoice } from '@/shared/copilot'
import { useLang, useT } from '../../i18n'
import { HelpLink } from '../../help'
import { useWorkerModels, workerModelDetails, workerModelRows, refreshWorkerModels } from '../ai/core/workerModels'
import { loadTask, patchTask, taskLocal, useTaskLocal } from './local'
import { useCoding } from './state'
import { codingReadOnly } from './schema'
import './copilot-options.css'

const C = 'features.coding.copilotOptions'
export function CopilotChoiceFields({ id, value, onChange, disabled=false }: { id:string; value:CopilotChoice; onChange:(choice:CopilotChoice)=>void; disabled?:boolean }) {
  const t = useT()
  useWorkerModels()
  const [loading,setLoading]=useState(false)
  const models = [...new Set(['auto',...workerModelRows().filter(m=>m.route.p==='copilot').map(m=>m.route.m)])]
  const selected = value.model ? workerModelDetails(value.model) : null
  const efforts = selected?.reasoningEfforts ?? []
  const change = (next:CopilotChoice) => { if(!disabled && readCopilotChoice(next))onChange(next) }
  return <fieldset className="copilot-options" disabled={disabled} data-testid={`copilot-options-${id}`}>
    <label htmlFor={`copilot-model-${id}`}>{t(`${C}.model`)}</label>
    <select className="input" id={`copilot-model-${id}`} value={value.model ?? ''} onChange={e=>{ const {model:_,reasoningEffort:__,...rest}=value; change({...rest,...(e.target.value?{model:e.target.value}:{})}) }}>
      <option value="">{t(`${C}.worker`)}</option>
      {value.model && !models.includes(value.model) && <option value={value.model}>{value.model} · {t(`${C}.unverified`)}</option>}
      {models.map(m=><option value={m} key={m}>{m === 'auto' ? t(`${C}.auto`) : m}</option>)}
    </select>
    <button className="btn btn--sm" type="button" disabled={loading} onClick={()=>{setLoading(true);void refreshWorkerModels().finally(()=>setLoading(false))}}>{t(`${C}.refresh`)}</button>
    <label htmlFor={`copilot-effort-${id}`}>{t(`${C}.effort`)}</label>
    <select className="input" id={`copilot-effort-${id}`} value={value.reasoningEffort ?? ''} disabled={!efforts.length && !value.reasoningEffort} onChange={e=>{const {reasoningEffort:_,...rest}=value;change({...rest,...(e.target.value?{reasoningEffort:e.target.value}:{})})}}>
      <option value="">{t(`${C}.modelDefault`)}</option>
      {value.reasoningEffort && !efforts.includes(value.reasoningEffort) && <option value={value.reasoningEffort}>{value.reasoningEffort} · {t(`${C}.unverified`)}</option>}
      {efforts.map(e=><option key={e} value={e}>{e}</option>)}
    </select>
    <label htmlFor={`copilot-context-${id}`}>{t(`${C}.context`)}</label>
    <select className="input" id={`copilot-context-${id}`} value={value.contextTokens ?? ''} onChange={e=>{const {contextTokens:_,...rest}=value;change({...rest,...(e.target.value?{contextTokens:Number(e.target.value)}:{})})}}>
      <option value="">{t(`${C}.contextAuto`)}</option>
      {[...new Set([16384,32768,65536,131072,262144,...(value.contextTokens?[value.contextTokens]:[])])].sort((a,b)=>a-b).map(n=><option value={n} key={n}>{n.toLocaleString()} tokens</option>)}
    </select>
    <p className="ctk-hint">{selected ? t(`${C}.catalogContext`,{tokens:selected.context.toLocaleString()}) : t(`${C}.catalogHint`)}</p>
    <HelpLink id="copilot-coding" />
  </fieldset>
}

export function CopilotTaskOptions({taskId}:{taskId:string}) {
  const t=useT(),local=useTaskLocal(taskId)
  const busy=useCoding(s=>s.busy.some(b=>b.taskId===taskId))||local.state==='running'
  const capable=useCoding(s=>s.can?.includes('copilot-options')??false)
  const change=async (choice:CopilotChoice|undefined)=>{
    await loadTask(taskId)
    if(codingReadOnly()||taskLocal(taskId).state==='running'||useCoding.getState().busy.some(b=>b.taskId===taskId))return
    await patchTask(taskId,{copilot:choice})
  }
  return <div className="ctk-appr copilot-task" data-testid="copilot-task-model">
    <p className="ctk-hint">{local.copilot ? t(`${C}.taskOverride`) : local.copilotRole ? t(`${C}.roleDefault`) : t(`${C}.workerDefault`)}</p>
    {!capable && <p role="status" className="ctk-hint">{t(`${C}.upgrade`)}</p>}
    <CopilotChoiceFields id={`task-${taskId}`} value={local.copilot ?? local.copilotRole ?? {}} onChange={c=>void change(c)} disabled={busy||!capable} />
    {local.copilot && <button type="button" className="btn btn--sm" disabled={busy} onClick={()=>void change(undefined)}>{t(`${C}.inherit`)}</button>}
  </div>
}

export function CopilotRunHistory({taskId}:{taskId:string}) {
  const t=useT(),lang=useLang(),runs=useTaskLocal(taskId).copilotRuns ?? []
  if(!runs.length)return null
  const unknown=t(`${C}.unknown`)
  const number=(n:number|null)=>n===null?unknown:n.toLocaleString(lang)
  return <details className="copilot-runs" data-testid="copilot-run-history">
    <summary>{t(`${C}.receipts`)} · {runs.length}</summary>
    <p className="ctk-hint">{t(`${C}.receiptHint`)}</p>
    {[...runs].reverse().map((run,i)=>{const r=run.receipt;return <details className="copilot-run" key={`${run.run}-${i}`}>
      <summary><span>GitHub Copilot · {run.stage}</span><span>{r.models.join(', ')||unknown} · {t(`${C}.${run.status==='ok'?'ok':run.status==='stopped'?'stopped':'incomplete'}`)}</span></summary>
      <dl>
        <dt>{t(`${C}.time`)}</dt><dd>{new Date(r.startedAt).toLocaleString(lang)} · {Math.round((r.finishedAt-r.startedAt)/1000)} s</dd>
        <dt>{t(`${C}.requested`)}</dt><dd>{r.requestedModel} · {t(`${C}.source.${r.source}`)}</dd>
        <dt>{t(`${C}.served`)}</dt><dd>{r.models.join(', ')||unknown}</dd>
        <dt>{t(`${C}.effort`)}</dt><dd>{t(`${C}.requested`)}: {r.requestedEffort||t(`${C}.modelDefault`)} · {t(`${C}.served`)}: {r.reasoningEfforts.join(', ')||unknown}</dd>
        <dt>{t(`${C}.context`)}</dt><dd>{number(r.contextTokens)} tokens</dd>
        <dt>{t(`${C}.usage`)}</dt><dd>{number(r.inputTokens)} input · {number(r.outputTokens)} output · {r.rounds} {t(`${C}.rounds`)}</dd>
        <dt>{t(`${C}.credits`)}</dt><dd>{r.nanoAiu===null?unknown:`${(r.nanoAiu/1e9).toLocaleString(lang,{maximumFractionDigits:9})} AIU`}</dd>
        <dt>{t(`${C}.money`)}</dt><dd>{unknown}</dd>
        <dt>{t(`${C}.quota`)}</dt><dd>{r.quotas.length?r.quotas.map(q=>`${q.name}: ${q.remainingPercentage.toLocaleString(lang)} %${q.resetDate?` · ${new Date(q.resetDate).toLocaleString(lang)}`:''}`).join('; '):unknown}</dd>
        {run.branch && <><dt>Branch</dt><dd>{run.branch}</dd></>}
        <dt>{t(`${C}.checks`)}</dt><dd>{!run.test||run.test.skipped?t(`${C}.noChecks`):`${run.test.ok?t(`${C}.ok`):t(`${C}.incomplete`)} · exit ${run.test.code??unknown}`}</dd>
      </dl>
    </details>})}
  </details>
}
