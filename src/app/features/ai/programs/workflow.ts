/** Fresh domain analysis: reuse the recipe, never its old sources, decisions, drafts or side effects. */
import {captureProgramInspection} from '@/shared/quandprofile/program-inspection'
import {readProgram,workflowStep,workflowTarget,bindInputs,programDigest,type SavedProgram,type ProgramRun} from '@/shared/quandprofile/program'
import {runAgent} from '../agent/run'
import {programScope,saveProgramRun} from './storage'
import {useWorkspace} from '../../../store/store'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {t} from '../../../i18n'
import type {ProgramInvocation} from './runner'
export async function runSavedWorkflow(o:Parameters<typeof runAgent>[0],inv:ProgramInvocation,saved:SavedProgram){
 const p=readProgram(saved.compiled),step=workflowStep(p)!,target=workflowTarget(p,inv.inputs)
 if(!inv.effectsConfirmed)throw Error(t('features.ai.program.workflowConfirm'))
 const check=()=>{o.signal.throwIfAborted();if(programScope().key!==inv.scope.key)throw Error(t('features.ai.task.stale'))}
 const receipt:ProgramRun={id:crypto.randomUUID(),programId:saved.id,version:saved.version,hash:saved.compiled.hash,inputHash:programDigest(bindInputs(p,inv.inputs)),route:{provider:o.route?.p??'',model:o.route?.m??''},startedAt:Date.now(),finishedAt:0,status:'failed',steps:[]}
 let answer=''
 const proof:ProgramRun['steps'][number]={id:step.id,inputHash:receipt.inputHash,at:Date.now(),status:'failed'};receipt.steps.push(proof)
 const hooks:typeof o.hooks={...o.hooks,text(text){answer+=text;o.hooks.text(text)},contract(report){try{receipt.inspection=captureProgramInspection(report)}catch{ /* A bounded receipt is optional; the task gate remains authoritative. */ }proof.contractHash=report.compiled.contract_hash;o.hooks.contract?.({...report,program:{id:saved.id,version:saved.version,hash:saved.compiled.hash,runId:receipt.id}})}}
 hooks.note(t('features.ai.program.runBinding',{version:saved.version,hash:saved.compiled.hash.slice(0,12),run:receipt.id.slice(0,8)}))
 hooks.note(t('features.ai.program.workflowHelp'))
 try{
 check()
 if(target){const pages=useWorkspace.getState().pages;if(!pages[target]||isEffectivelyTrashed(pages,target))throw Error(t('features.ai.program.sourceMissing'))}
 for(const c of step.connections){const matches=o.mcp?.worker?.filter(s=>s.name===c.name&&s.url===c.endpoint)??[];if(matches.length!==1)throw Error(t('features.ai.program.connectionMissing',{name:c.name}))}
  const end=await runAgent({...o,targetPage:target,typed:p.goal,user:{role:'user',content:p.goal},history:[],hooks})
  check();receipt.status=end==='done'?'done':'failed';receipt.answer=answer.slice(0,100000)
  if(end==='done'){proof.status='done';proof.outputHash=programDigest(answer)}
  if(end!=='done')receipt.error=t('features.ai.program.workflowIncomplete')
  return end
 }catch(e){receipt.status=o.signal.aborted?'stopped':'failed';receipt.error=(e instanceof Error?e.message:String(e)).slice(0,4000);throw e}
 finally{receipt.finishedAt=Date.now();try{await saveProgramRun(receipt,inv.scope);hooks.note(t('features.ai.program.receiptSaved'))}catch{hooks.note(t('features.ai.program.receiptFailed'))}}
}
