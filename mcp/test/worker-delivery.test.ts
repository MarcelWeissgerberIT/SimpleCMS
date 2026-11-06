import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupAll, makeRepo, repoEntry, sh, startWorker, writeConfig, WS_LOCAL, FakeTab, task } from './worker-helpers.ts'
import { sanitizeTask } from '../src/worker/worker.ts'
import { deliveryReview } from '../src/worker/delivery-review.ts'

after(cleanupAll)
const quality = { review: true, requirements: ['R1: Correct shared source'], acceptance: ['Combined branch passes fixed checks'] }

test('native CLI reviewers need an explicit bounded verdict; narrative success is not a verdict', () => {
  assert.equal(deliveryReview('Everything looks good.'), null)
  assert.equal(deliveryReview('{"status":"completed","summary":"","next":""}'), null)
  assert.equal(deliveryReview('{"status":"completed","summary":"Reviewed","next":"","extra":true}'), null)
  assert.equal(deliveryReview('Review:\n```json\n{"status":"needs_rework","summary":"Missing null check","next":"Repair validation"}\n```')?.status, 'needs_rework')
  assert.equal(deliveryReview('{"status":"completed","summary":"Verified each criterion","next":""}')?.status, 'completed')
})

test('delivery QA refuses malformed acceptance metadata instead of silently dropping it', () => {
  assert.equal(sanitizeTask({ ...task({ kind: 'doc' }), quality: { ...quality, acceptance: [] } }), null)
  assert.deepEqual(sanitizeTask({ ...task({ kind: 'doc' }), quality })?.quality, quality)
})

test('built worker runs final QA checks on the combined branch before read-only model review', async () => {
  const r = makeRepo(); mkdirSync(r.worktrees)
  const dir = join(r.worktrees, 'delivery')
  sh(r.path, 'worktree', 'add', '-b', 'one/delivery', dir)
  let chats = 0
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* consume */ }
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/show') return res.end(JSON.stringify({ system: 'Keep concise.' }))
    chats++
    res.end(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'finish_task', arguments: { status: 'completed', summary: 'Reviewed the combined branch and acceptance.', next: '' } } }] } }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const portProbe = createServer(); await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve))
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>(resolve => portProbe.close(() => resolve()))
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port, pollSec: 2, name: 'delivery-test', repos: [repoEntry(r)] })
  const worker = await startWorker(file, { ONE_CODER_OLLAMA: `http://127.0.0.1:${(upstream.address() as { port: number }).port}` })
  let tab: FakeTab | null = null
  try {
    tab = await FakeTab.connect(port); tab.hello(WS_LOCAL); await tab.next('welcome')
    writeFileSync(join(dir, 'feature.txt'), 'BROKEN')
    const failed = await tab.run(task({ kind: 'doc' }, { id: 'qaFailed', agent: 'local', branch: 'one/delivery', quality }))
    assert.equal(failed.status, 'failed', JSON.stringify(failed))
    assert.equal(failed.test?.ok, false)
    assert.equal(chats, 0, 'No model review may excuse a failed host check')
    writeFileSync(join(dir, 'feature.txt'), 'FIXED')
    const passed = await tab.run(task({ kind: 'doc' }, { id: 'qaPassed', agent: 'local', branch: 'one/delivery', quality }))
    assert.equal(passed.status, 'ok', JSON.stringify(passed))
    assert.equal(passed.test?.ok, true)
    assert.match(passed.test?.execution?.candidate?.before??'',/^[a-f0-9]{64}$/)
    assert.equal(passed.test?.execution?.candidate?.before,passed.test?.execution?.candidate?.after)
    assert.equal(passed.test?.challenge?.state,'not_configured')
    assert.equal(passed.runEvidence?.executor,'local')
    assert.equal(passed.runEvidence?.costUsd,null)
    assert.ok(passed.runEvidence!.finishedAt>=passed.runEvidence!.startedAt)
    assert.equal(passed.branch, 'one/delivery')
    assert.equal(chats, 1)
    assert.match(passed.plan ?? '', /Reviewed the combined branch/)
    const missing = await tab.run(task({ kind: 'doc' }, { id: 'qaNoBranch', agent: 'local', branch: null, quality }))
    assert.equal(missing.status, 'failed')
    assert.match(missing.error ?? '', /combined coding branch/)
    const write = await tab.run(task({ kind: 'implement' }, { id: 'qaCannotWrite', agent: 'local', branch: 'one/delivery', quality }))
    assert.equal(write.status, 'refused')
    const merge = await tab.run(task({ kind: 'git', gitAction: 'merge' }, { id: 'childCannotMerge', branch: 'one/delivery', quality: { ...quality, review: false } }))
    assert.equal(merge.status, 'refused')
    assert.match(merge.error ?? '', /before final QA/)
  } finally { tab?.close(); await worker.stop(); await new Promise<void>(resolve => upstream.close(() => resolve())) }
})

test('opt-in QA repair fixes the approved branch, protects the check entrypoint and runs fresh read-only review', async () => {
  const r=makeRepo();mkdirSync(r.worktrees)
  const dir=join(r.worktrees,'repair');sh(r.path,'worktree','add','-b','one/repair',dir)
  writeFileSync(join(dir,'feature.txt'),'BROKEN')
  let writes=0,reviews=0
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c
    const body=JSON.parse(raw);res.setHeader('Content-Type','application/json')
    if(req.url==='/api/show')return res.end(JSON.stringify({system:'Keep concise.'}))
    const writable=body.tools.some((t:any)=>t.function.name==='edit_file')
    let name='finish_task',args:any={status:'completed',summary:'Verified the fixed combined branch.',next:''}
    if(writable){
      const n=writes++
      if(n===0){name='read_file';args={path:'feature.txt'}}
      if(n===1){name='edit_file';args={path:'feature.txt',old_text:'BROKEN',new_text:'FIXED'}}
    }else reviews++
    res.end(JSON.stringify({message:{role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]}}))
  })
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve))
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as any).port;await new Promise<void>(resolve=>probe.close(()=>resolve()))
  const file=writeConfig(r,{workspace:WS_LOCAL.id,port,pollSec:2,name:'repair-test',repos:[repoEntry(r)]})
  const worker=await startWorker(file,{ONE_CODER_OLLAMA:`http://127.0.0.1:${(upstream.address() as any).port}`})
  let tab:FakeTab|null=null
  try{
    tab=await FakeTab.connect(port);tab.hello(WS_LOCAL);await tab.next('welcome')
    const outcome=await tab.run(task({kind:'doc'},{id:'qaRepair',agent:'local',branch:'one/repair',quality:{...quality,repair:{attempts:2,agent:'local'},packages:[{id:'codeOne',title:'Fix feature',requirements:['R1']}]}}))
    assert.equal(outcome.status,'ok',JSON.stringify(outcome));assert.equal(outcome.test?.ok,true);assert.equal(outcome.repairs?.length,1);assert.deepEqual(outcome.repairs?.[0]?.packageIds,['codeOne']);assert.equal(reviews,1);assert.equal(writes,3)
  }finally{tab?.close();await worker.stop();await new Promise<void>(resolve=>upstream.close(()=>resolve()))}
})
