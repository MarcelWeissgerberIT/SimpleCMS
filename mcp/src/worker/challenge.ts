/** No new model call: the owner's optional challenge runs once, after review, against the same bytes. */
import { stableCandidate } from '../../../src/shared/coding/evidence.ts'
import type { TestResult } from '../../../src/app/features/coding/protocol.ts'
import type { RepoConfig } from './config.ts'
import { candidateSnapshot } from './candidate.ts'
import { runTests } from './testrun.ts'

export async function challengeCandidate(repo:RepoConfig,cwd:string,signal:AbortSignal,test:TestResult,scrub:(s:string)=>string):Promise<{test:TestResult;error?:string}> {
  const expected=test.execution?.candidate?.after
  if(!test.ok||!stableCandidate(test.execution)||!expected)return {test:{...test,ok:false},error:'Delivery QA checks unavailable: no stable host candidate fingerprint. Rerun with the current worker.'}
  const current=await candidateSnapshot(cwd,signal)
  if(current.hash!==expected)return {test:{...test,ok:false,execution:{...test.execution!,changedDuring:true}},error:'Delivery QA checks unavailable: candidate changed after tests or could not be observed. Rerun final QA.'}
  if(!repo.challengeCommand?.length)return {test:{...test,challenge:{state:'not_configured',code:null,ms:0,execution:null},output:(test.output+'\nCounterexample challenge: not configured; no independent counterexample coverage claimed.').slice(-20000)}}
  const checked=await runTests({...repo,testCommand:repo.challengeCommand},cwd,signal,undefined,scrub)
  const unchanged=stableCandidate(checked.execution)&&checked.execution?.candidate?.before===expected
  const unavailable=!!checked.notStarted||!!checked.skipped||!unchanged
  const passed=!unavailable&&checked.ok&&checked.code===0
  const output=scrub(`\nCounterexample challenge: ${unavailable?'UNAVAILABLE':passed?'PASS':'FAIL'}\n${checked.output}`).slice(-10000)
  return {test:{...test,ok:passed,challenge:{state:unavailable?'unavailable':passed?'passed':'failed',code:checked.code,ms:checked.ms,execution:checked.execution??null},output:(test.output+output).slice(-20000)},...(!passed?{error:`Delivery QA checks ${unavailable?'unavailable':'failed'}: counterexample challenge. ${output}`}:{})}
}
