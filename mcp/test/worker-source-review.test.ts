import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from '../src/worker/worker.ts'
import { runLocal } from '../src/worker/local-agent.ts'
const a = 'The configured timeout is ten seconds.'
const b = 'The configured timeout is thirty seconds.'
test('native task proxy checks source receipts inside the current worktree and refuses inaccessible sources', async () => {
 const cwd = await mkdtemp(join(tmpdir(), 'one-source-review-'))
 try {
  await writeFile(join(cwd, 'requirement.txt'), a);await writeFile(join(cwd, 'config.txt'), b);await writeFile(join(cwd, '.env'), 'SECRET=never-read')
  const run = { cwd, task: { id:'fixture', repo:'fixture', title:'Compare sources', text:a, stage:{name:'Plan',kind:'plan'}, answers:[] }, scrub:{text:(s:string)=>s} }
  const host = { tokens:new Map([['fixture-token',run]]) }, invoke = (Worker.prototype as any).onTask
  const call = (tool:string,args:object,token='fixture-token')=>invoke.call(host,token,tool,args)
  const first = JSON.parse((await call('one_task_source',{path:'requirement.txt'})).text)
  const second = JSON.parse((await call('one_task_source',{path:'config.txt'})).text)
  assert.equal(first._oneSource.checkWith,'one_task_check_finding')
  const checked = JSON.parse((await call('one_task_check_finding',{classification:'possible_contradiction',sourceA:{receipt:first._oneSource.receipt,quote:a},sourceB:{receipt:second._oneSource.receipt,quote:b}})).text)
  assert.equal(checked.status,'quotations_supported');assert.equal(checked.teamDecision,'open');assert.equal(checked.semanticConflict,'not_verified')
  assert.equal((await call('one_task_source',{path:'../outside'})).ok,false)
  assert.equal((await call('one_task_source',{path:'.env'})).ok,false)
  assert.equal((await call('one_task_source',{path:join(cwd,'config.txt')})).ok,false)
  assert.equal((await call('one_task_source',{path:'config.txt'},'ended-token')).status,403)
  assert.equal((await call('one_task_check_finding',{classification:'information_gap',sourceA:{receipt:first._oneSource.receipt,quote:a},teamDecision:'approved'})).ok,false)
 } finally { await rm(cwd,{recursive:true,force:true}) }
})
test('common local adapter verifies quotations and captures source-backed knowledge without fabricating Atlas sync', async () => {
 const cwd = await mkdtemp(join(tmpdir(), 'one-source-model-'));let step=0,receipt='';const results:any[]=[]
 try {
  await writeFile(join(cwd,'requirement.txt'),a)
  const run = await runLocal({agent:'local',cwd,prompt:'Compare, support, and retain useful knowledge.',readOnly:false,maxSteps:7,taskMcp:null,signal:new AbortController().signal,log:()=>{},memory:{directory:join(cwd,'memory'),scope:'fixture',resume:false},env:{ONE_CODER_MODEL:'fixture'},inference:async request=>{
   const tools = request.messages.filter((m:any)=>m.role==='tool');if(tools.length) { const text=tools.at(-1)!.content;results.push(text);if(step===1)receipt=JSON.parse(String(text).split('\n[Task memory:')[0]!)._oneSource.receipt }
   const call = (name:string,args:object)=>({message:{role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]}})
   switch(step++){
    case 0:return call('read_file',{path:'requirement.txt'})
    case 1:return call('check_finding',{classification:'information_gap',sourceA:{receipt,quote:a}})
    case 2:return call('memory_knowledge',{kind:'constraint',summary:'Timeout requirement: ten seconds.',recallWhen:'When implementing or reviewing timeout behaviour.',sourceA:{receipt,quote:a}})
    default:return call('finish_task',{status:'completed',summary:'Constraint captured with source; no domain decision made.',next:''})
   }
  }})
  assert.equal(run.ok,true,run.error);assert.ok(results.some(s=>s.includes('semanticConflict')&&s.includes('not_verified')))
  assert.ok(results.some(s=>s.includes('candidate_not_a_team_decision')));assert.match(run.text,/ATLAS PENDING/)
 } finally { await rm(cwd,{recursive:true,force:true}) }
})
