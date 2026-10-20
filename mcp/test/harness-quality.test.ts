import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFiles } from '../src/worker/local-files.ts'
import { LocalMemory } from '../src/worker/local-memory.ts'
import { taskPacket } from '../src/worker/local-packet.ts'
import { skillCatalog, readSkill } from '../src/worker/local-skills.ts'
import { checkManifest, checksUnchanged, qaFeedback, readRepairJournal, writeRepairJournal } from '../src/worker/qa-repair.ts'
import { evaluateHarness, evaluationCases } from '../src/worker/harness-eval.ts'
import { sanitizeTask } from '../src/worker/worker.ts'
import { task } from './worker-helpers.ts'
const temp=async()=>realpath(await mkdtemp(join(tmpdir(),'one-harness-test-')))
const signal=()=>new AbortController().signal

test('bounded source map ranks relevant interfaces, excludes credentials and never grants write snapshots',async()=>{
 const root=await temp();try{
  await mkdir(join(root,'src'));await mkdir(join(root,'node_modules'))
  await writeFile(join(root,'src','adapter.ts'),'export interface Adapter { value: string }\nexport function normalizeAdapter() {}')
  await writeFile(join(root,'src','use.ts'),"import {normalizeAdapter} from './adapter'\nexport function load() {}")
  await writeFile(join(root,'.env'),'SECRET=hidden');await writeFile(join(root,'node_modules','private.ts'),'secret')
  const files=new LocalFiles(root);const packet=await taskPacket(files,'Implement the adapter API contract',false,35000)
  assert.equal(packet.sourceMap.entries[0]?.path,'src/adapter.ts');assert.ok(packet.methods.some(s=>s.id==='contract'))
  assert.doesNotMatch(JSON.stringify(packet),/SECRET|private.ts/)
  await assert.rejects(files.edit('src/adapter.ts','value: string','value: null'),/Read/)
  assert.equal(readSkill(skillCatalog()[0]!.id).version,1)
  assert.throws(()=>readSkill('../../evil'))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('memory revisions supersede old excerpts; restored tool observations remain historical, notes never become proof',async()=>{
 const root=await temp();try{
  const m=new LocalMemory(x=>x),opts={directory:root,scope:'one-task',resume:false}
  await m.load(opts)
  const a=m.remember('read_file:src/a.ts','old',{evidence:'tool-result',revision:'a'.repeat(64)})
  m.remember('read_file:src/a.ts','new',{evidence:'tool-result',revision:'b'.repeat(64)})
  m.setCheckpoint({decisions:'We think this is correct.'});await m.flush(opts)
  assert.equal(m.recall(a.id).superseded,true);assert.equal(m.search('old').length,0)
  const n=new LocalMemory(x=>x);await n.load({...opts,resume:true});const hit=n.search('new')[0]!
  assert.equal(hit.historical,true);assert.equal(hit.evidence,'tool-result');assert.equal(n.search('correct')[0]?.evidence,'model-note')
  n.remember('read_file:src/a.ts','old',{evidence:'tool-result',revision:'a'.repeat(64)})
  assert.equal(n.search('old')[0]?.historical,false)
  assert.equal(n.search('new').length,0, 'restoring earlier source content makes that observation current again')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('QA feedback repairs a failed check then runs fresh review, respecting shared budget and write-ahead attempt count',async()=>{
 let reviews=0,repairs=0,saved=0
 const out=await qaFeedback({policy:{attempts:2,agent:'local'},remainingSteps:10,signal:signal(),journal:{attempts:0},packages:['code-1'],save:async j=>{saved=j.attempts},note:()=>{},unchanged:async()=>true,
 review:async()=>++reviews===1?{status:'failed',error:'Delivery QA checks failed: null adapter',turns:1}:{status:'ok',plan:'Verified',turns:1},
 repair:async()=>{assert.equal(saved,1);repairs++;return {status:'ok',summary:'Fixed null handling',turns:2}}})
 assert.equal(out.status,'ok');assert.equal(reviews,2);assert.equal(repairs,1);assert.equal(out.turns,4);assert.equal(out.repairs?.[0]?.packageIds[0],'code-1')
 assert.equal(out.cost,undefined, 'unmetered inference must not be reported as free')
 const declined=await qaFeedback({remainingSteps:10,signal:signal(),journal:{attempts:0},packages:[],save:async()=>{},note:()=>{},unchanged:async()=>true,review:async()=>({status:'failed',error:'Delivery QA checks failed: x'}),repair:async()=>{throw new Error('Must not run')}})
 assert.equal(declined.status,'failed')
})
test('QA stops on identical findings, protected-check changes, exhausted journal and environmental blockers',async()=>{
 for(const scenario of ['same','checks','exhausted','blocked']){
  let calls=0
  const out=await qaFeedback({policy:{attempts:2,agent:'local'},remainingSteps:10,signal:signal(),journal:{attempts:scenario==='exhausted'?2:0},packages:['p'],save:async()=>{},note:()=>{},unchanged:async()=>scenario!=='checks',
   review:async()=>({status:'failed',error:scenario==='blocked'?'blocked: no credentials':'needs_rework: wrong null adapter',turns:1}),repair:async()=>{calls++;return {status:'ok',turns:1}}})
  assert.equal(out.status,'failed');assert.equal(calls,scenario==='exhausted'||scenario==='blocked'?0:1)
 }
})
test('existing tests and config are protected; journal survives restart and rejects malformed policy',async()=>{
 const root=await temp();try{
  await mkdir(join(root,'test'));await writeFile(join(root,'test','a.test.js'),'assert(false)');await writeFile(join(root,'package.json'),'{"scripts":{"test":"node --test"}}')
  const m=await checkManifest(root);assert.equal(await checksUnchanged(root,m),true)
  await writeFile(join(root,'test','a.test.js'),'assert(true)');assert.equal(await checksUnchanged(root,m),false)
  const dir=join(root,'journal');await readRepairJournal(dir,'task');await writeRepairJournal(dir,'task',{attempts:2,fingerprint:'a'.repeat(64)});assert.equal((await readRepairJournal(dir,'task')).attempts,2)
  const quality={review:true,requirements:['R1: bounded'],acceptance:['test passes'],repair:{attempts:99,agent:'local'}}
  assert.equal(sanitizeTask({...task({kind:'doc'}),quality}),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('evaluation acceptance is outside the worktree and catches false completions and out-of-scope writes',async()=>{
 assert.equal(evaluationCases.length,24)
 const report=await evaluateHarness({limit:1,cases:['sum'],runner:async opts=>{
  const entries=await readFile(join(opts.cwd,'solution.mjs'),'utf8');assert.match(entries,/solve/)
  await writeFile(join(opts.cwd,'solution.mjs'),'export function solve(){return 2}')
  return {ok:true,stopped:false,limited:false,text:'Done',steps:1}
 }})
 assert.equal(report.passed,0);assert.equal(report.falseCompletions,1);assert.match(report.suiteHash,/^[a-f0-9]{64}$/)
})
