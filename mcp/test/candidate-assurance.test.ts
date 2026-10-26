import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { candidateSnapshot } from '../src/worker/candidate.ts'
import { challengeCandidate } from '../src/worker/challenge.ts'
import type { RepoConfig } from '../src/worker/config.ts'
import { loadConfig } from '../src/worker/config.ts'
import { runTests } from '../src/worker/testrun.ts'
import { stableCandidate, readChallenge } from '../../src/shared/coding/evidence.ts'
import { makeRepo, sh, cleanupAll, tempDir, IS_WIN, writeConfig, repoEntry } from './worker-helpers.ts'
after(cleanupAll)
const signal=()=>new AbortController().signal
test('candidate binds same-length dirty edits, untracked files, deletions and HEAD; ignored output is outside scope',async()=>{
 const r=makeRepo(),path=join(r.path,'candidate.txt')
 writeFileSync(path,'aaa');writeFileSync(join(r.path,'.gitignore'),'ignored/\n');sh(r.path,'add','.');sh(r.path,'commit','-qm','candidate')
 writeFileSync(path,'bbb');const a=await candidateSnapshot(r.path,signal());const status=sh(r.path,'status','--porcelain')
 writeFileSync(path,'ccc');const b=await candidateSnapshot(r.path,signal())
 assert.equal(sh(r.path,'status','--porcelain'),status);assert.ok(a.hash);assert.notEqual(a.hash,b.hash)
 mkdirSync(join(r.path,'ignored'));writeFileSync(join(r.path,'ignored','output'),'not source')
 assert.equal((await candidateSnapshot(r.path,signal())).hash,b.hash)
 writeFileSync(join(r.path,'new.txt'),'new');assert.notEqual((await candidateSnapshot(r.path,signal())).hash,b.hash)
 sh(r.path,'add','.');sh(r.path,'commit','-qm','new version');const c=await candidateSnapshot(r.path,signal());assert.notEqual(c.hash,b.hash)
 sh(r.path,'rm','candidate.txt');assert.notEqual((await candidateSnapshot(r.path,signal())).hash,c.hash)
})
test('test command editing an already dirty file cannot obtain a stable receipt',async()=>{
 const r=makeRepo();writeFileSync(join(r.path,'value.txt'),'aaa');sh(r.path,'add','.');sh(r.path,'commit','-qm','value');writeFileSync(join(r.path,'value.txt'),'bbb')
 const repo={...({testTimeoutSec:20} as RepoConfig),testCommand:[process.execPath,'-e',"require('node:fs').writeFileSync('value.txt','ccc')"]}
 const out=await runTests(repo,r.path,signal());assert.equal(out.code,0);assert.equal(out.execution?.changedDuring,true);assert.equal(stableCandidate(out.execution),false)
 const gate=await challengeCandidate(repo,r.path,signal(),out,x=>x);assert.match(gate.error!,/unavailable/);assert.equal(gate.test.ok,false)
})
test('owner challenge runs after fixed candidate: pass, failure, missing command, changed bytes and unconfigured differ',async()=>{
 const r=makeRepo(),repo={...({testTimeoutSec:20} as RepoConfig),testCommand:[process.execPath,'-e','console.log("base passes")']}
 const base=await runTests(repo,r.path,signal());assert.equal(stableCandidate(base.execution),true)
 const notConfigured=await challengeCandidate(repo,r.path,signal(),base,x=>x);assert.equal(notConfigured.test.challenge?.state,'not_configured');assert.equal(notConfigured.error,undefined)
 for(const [command,state] of [[['-e','process.exit(0)'],'passed'],[['-e','process.exit(1)'],'failed']] as const){
  const out=await challengeCandidate({...repo,challengeCommand:[process.execPath,...command]},r.path,signal(),base,x=>x)
  assert.equal(out.test.challenge?.state,state);assert.equal(out.test.ok,state==='passed');assert.ok(readChallenge(out.test.challenge))
 }
 const missing=await challengeCandidate({...repo,challengeCommand:['one-no-such-challenge']},r.path,signal(),base,x=>x)
 assert.equal(missing.test.challenge?.state,'unavailable');assert.match(missing.error!,/unavailable/)
 const changed=await challengeCandidate({...repo,challengeCommand:[process.execPath,'-e',"require('node:fs').writeFileSync('unexpected.txt','change')"]},r.path,signal(),base,x=>x)
 assert.equal(changed.test.challenge?.state,'unavailable');assert.equal(changed.test.ok,false)
 assert.match((await challengeCandidate(repo,r.path,signal(),base,x=>x)).error!,/changed after tests/)
})
test('out of scope links are not dereferenced and unavailable repositories cannot mint fingerprints',async()=>{
 const r=makeRepo(),outside=tempDir('external-candidate');writeFileSync(join(outside,'private.txt'),'not readable evidence')
 if(!IS_WIN){symlinkSync(join(outside,'private.txt'),join(r.path,'link'));const a=await candidateSnapshot(r.path,signal());assert.ok(a.hash);writeFileSync(join(outside,'private.txt'),'changed secret');assert.equal((await candidateSnapshot(r.path,signal())).hash,a.hash)}
 assert.equal((await candidateSnapshot(outside,signal())).hash,null)
 const ac=new AbortController();ac.abort();await assert.rejects(candidateSnapshot(r.path,ac.signal))
})
test('invalid configured challenge is a visible configuration error, never silently disabled',()=>{
 const r=makeRepo()
 for(const value of ['node test.mjs',[],['node',null],Array(51).fill('arg')]){
  const file=writeConfig(r,{repos:[repoEntry(r,{challengeCommand:value})]})
  const loaded=loadConfig(file);assert.equal(loaded.config.repos.length,0);assert.ok(loaded.problems.some(p=>p.includes('challengeCommand')))
 }
 const file=writeConfig(r,{repos:[repoEntry(r,{challengeCommand:['node','../verification/check.mjs']})]})
 assert.deepEqual(loadConfig(file).config.repos[0]?.challengeCommand,['node','../verification/check.mjs'])
})
