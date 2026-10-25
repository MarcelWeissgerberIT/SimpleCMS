import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { installManaged, profileDir, updateAddress, shortcutText, importWorkerPreset } from '../src/worker/managed.ts'
import { cleanupAll, makeRepo, repoEntry, writeConfig, presetBundle, spawnWorker, FakeTab, WS_LOCAL, task } from './worker-helpers.ts'
import { waitFor } from './helpers.ts'
import type { WorkerPreset } from '../../src/app/features/coding/protocol.ts'

after(cleanupAll)
const built=readFileSync(new URL('../../public/mcp/one-worker.mjs',import.meta.url),'utf8')
const version=/coding worker (\d+\.\d+\.\d+)/.exec(built)![1]!
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p}
const p=(port:number):WorkerPreset=>({workspace:WS_LOCAL.id,name:'Workshop',origin:'http://127.0.0.1:5173',port,pair:randomBytes(32).toString('base64url'),dev:true})

test('installation preserves config, refuses silent re-pairing and keeps the starter free of secrets',async()=>{
  const r=makeRepo(),config=writeConfig(r,{workspace:WS_LOCAL.id,repos:[repoEntry(r)]}),preset=p(await freePort()),dir=profileDir(config),source=presetBundle({...preset})
  const original=readFileSync(config,'utf8')
  const ctx={dir,config,preset,file:source,version,args:['--no-browser'],desktop:null}
  const start=await installManaged(ctx)
  assert.equal(readFileSync(config,'utf8'),original)
  assert.ok(!readFileSync(start,'utf8').includes(preset.pair))
  assert.equal(JSON.parse(readFileSync(join(dir,'current.json'),'utf8')).previous,null)
  if(process.platform!=='win32'){assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(join(dir,'current.json')).mode&0o777,0o600)}
  const before=readFileSync(join(dir,'current.json'),'utf8'),next={...preset,pair:randomBytes(32).toString('base64url')}
  await assert.rejects(installManaged({...ctx,preset:next,file:presetBundle({...next})}),/another pairing/)
  assert.equal(readFileSync(join(dir,'current.json'),'utf8'),before)
  await installManaged({...ctx,preset:next,file:presetBundle({...next})},true)
  assert.equal(JSON.parse(readFileSync(join(dir,'current.json'),'utf8')).previous,null,'Never roll back to a different account/pairing')
})

test('legacy migration imports the literal preset only, including old semicolon formatting, without executing code',async()=>{
  const r=makeRepo(),old=join(r.dir,'old (1).mjs'),marker=join(r.dir,'must-not-exist'),preset=p(await freePort())
  writeFileSync(old,'#!/usr/bin/env node\nglobalThis.ONE_WORKER_PRESET='+JSON.stringify(preset)+';\n'+`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'bad');`)
  assert.deepEqual(importWorkerPreset(old),preset);assert.equal(existsSync(marker),false)
  writeFileSync(old,'#!/usr/bin/env node\nglobalThis.ONE_WORKER_PRESET=(()=>{throw Error("must not execute")})();\n')
  assert.throws(()=>importWorkerPreset(old),/not a JSON literal/)
})

test('update source stays on the paired site; shortcuts quote special characters',()=>{
  const preset=p(47880)
  assert.throws(()=>updateAddress({...preset,updateUrl:'https://evil.example/mcp/one-worker.mjs'}),/original/)
  assert.throws(()=>updateAddress({...preset,origin:'http://example.com',dev:false}),/HTTPS/)
  assert.throws(()=>updateAddress({...preset,updateUrl:preset.origin+'/mcp/one-worker.mjs?token=bad'}),/original/)
  assert.match(shortcutText('C:\\Some Path\\node.exe','C:\\A%Name!\\start.cjs',true),/DisableDelayedExpansion/)
  assert.match(shortcutText('C:\\Some Path\\node.exe','C:\\A%Name!\\start.cjs',true),/A%%Name!/) 
  assert.match(shortcutText('/a node',"/a'b/start.cjs",false),/exec '\/a node'/)
})

test('built supervisor: one process, drain active task, preserve pairing, update, rollback and recover failed startup', {timeout:100000},async()=>{
  const r=makeRepo(),port=await freePort(),preset=p(port)
  let candidate=built.replaceAll(version,'1.33.0'),badChecksum=false
  const site=createServer((req,res)=>{
    res.setHeader('content-type',req.url?.endsWith('.json')?'application/json':'text/javascript')
    if(req.url==='/mcp/one-worker.release.json')res.end(JSON.stringify({version:/coding worker (\d+\.\d+\.\d+)/.exec(candidate)![1],size:Buffer.byteLength(candidate),sha256:badChecksum?'a'.repeat(64):sha(candidate)}))
    else if(req.url==='/mcp/one-worker.mjs')res.end(candidate)
    else{res.statusCode=404;res.end()}
  })
  await new Promise<void>(r=>site.listen(0,'127.0.0.1',r));preset.origin=`http://127.0.0.1:${(site.address() as {port:number}).port}`
  const config=writeConfig(r,{workspace:WS_LOCAL.id,port,pollSec:1,repos:[repoEntry(r)]}),dir=profileDir(config)
  const start=await installManaged({dir,config,preset,file:presetBundle({...preset}),version,args:['--no-browser'],desktop:null})
  const beforeConfig=readFileSync(config,'utf8'),mfile=join(dir,'current.json'),first=JSON.parse(readFileSync(mfile,'utf8')).current
  const worker=await spawnWorker({bundle:start})
  let tab:FakeTab|null=null
  const attach=async()=>{const t=await FakeTab.connect(port);t.hello(WS_LOCAL,preset.pair);const w=await t.next('welcome');assert.equal(w.managed,true);return t}
  const status=async()=>{const reply=await tab!.request({op:'worker-manage',action:'status'});assert.equal(reply.ok,true,JSON.stringify(reply));return (reply as any).result}
  try{
    tab=await attach()
    const duplicate=await spawnWorker({bundle:start});await waitFor(()=>duplicate.child.exitCode!==null,12000);assert.match(duplicate.stdout(),/already running/)
    assert.equal(JSON.parse(readFileSync(join(dir,'control.json'),'utf8')).pid!==duplicate.child.pid,true)
    const oldCopy=await spawnWorker({bundle:presetBundle({...preset}),args:['--config',config]});await waitFor(()=>oldCopy.child.exitCode!==null,12000);assert.match(oldCopy.stderr(),/fixed installation/)
    badChecksum=true
    const bad=await tab.request({op:'worker-manage',action:'update'});assert.equal(bad.ok,false);assert.equal(JSON.parse(readFileSync(mfile,'utf8')).current,first)
    badChecksum=false
    const run=tab.run(task({kind:'implement'},{text:'FAKE:LIVE\nImplement a small fixture.'}),25000)
    await waitFor(()=>tab!.messages.some(m=>m.type==='status'&&m.busy.length>0),10000)
    const update=await tab.request({op:'worker-manage',action:'update'});assert.equal(update.ok,true,JSON.stringify(update));assert.equal((update as any).result.phase,'waiting-for-idle')
    assert.equal(JSON.parse(readFileSync(mfile,'utf8')).current,first,'Do not replace the running task')
    const blocked=await tab.request({op:'text-models'});assert.equal(blocked.ok,false,'No new work during drain')
    const cancelled=await tab.request({op:'worker-manage',action:'cancel'});assert.equal(cancelled.ok,true);assert.equal((cancelled as any).result.phase,'running')
    const again=await tab.request({op:'worker-manage',action:'update'});assert.equal(again.ok,true)
    assert.equal((await run).status,'ok','Running work completes instead of being cancelled')
    await waitFor(()=>JSON.parse(readFileSync(mfile,'utf8')).current!==first,15000,worker.stderr)
    tab.close();tab=await attach()
    assert.equal((await status()).version,'1.33.0')
    const installed=readFileSync(join(dir,JSON.parse(readFileSync(mfile,'utf8')).current),'utf8');assert.ok(installed.includes(preset.pair));assert.equal(readFileSync(config,'utf8'),beforeConfig)
    const rollback=await tab.request({op:'worker-manage',action:'rollback'});assert.equal(rollback.ok,true)
    await waitFor(()=>JSON.parse(readFileSync(mfile,'utf8')).current===first,15000,worker.stderr)
    tab.close();tab=await attach();assert.equal((await status()).version,version)
    candidate=built.replaceAll(version,'1.34.0').replace('#!/usr/bin/env node\n',"#!/usr/bin/env node\nif(process.env.ONE_WORKER_MANAGED_CHILD==='1')process.exit(1);\n")
    const broken=await tab.request({op:'worker-manage',action:'update'});assert.equal(broken.ok,true)
    await waitFor(()=>worker.stderr().includes('previous release restored'),20000,worker.stderr)
    tab.close();tab=await attach();assert.equal((await status()).version,version);assert.equal(JSON.parse(readFileSync(mfile,'utf8')).current,first)
    // Unauthenticated control callers cannot change the running installation.
    assert.ok(existsSync(join(dir,'supervisor.lock')))
    const control=JSON.parse(readFileSync(join(dir,'control.json'),'utf8'))
    const denied=await new Promise<any>((resolve,reject)=>{const socket=connect(control.port,'127.0.0.1');let data='';socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify({key:'x'.repeat(43),op:'rollback'})+'\n'));socket.on('data',c=>data+=c);socket.on('end',()=>resolve(JSON.parse(data)))})
    assert.equal(denied.failed,true);assert.match(denied.error,/authentication/);assert.equal(JSON.parse(readFileSync(mfile,'utf8')).current,first)
  }finally{tab?.close();await worker.stop();await new Promise<void>(resolve=>site.close(()=>resolve()))}
})
