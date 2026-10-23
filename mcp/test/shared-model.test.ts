import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SharedModelHost} from '../src/worker/shared-model.ts'
import {emptyConfig,withPreset} from '../src/worker/config.ts'
import {sharedRequestBox,openShared,type SharedBox} from '../../src/shared/ai/shared-model.ts'

test('shared worker host runs only its explicitly selected local model, with no tools, and persists disable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'one-model-share-')),original=globalThis.fetch
 let publicKey:any,job:any,outcome:any,available=true,enabled=true,modelRequests=0
 let host:SharedModelHost|undefined
 const seen:any[]=[]
 globalThis.fetch=async(input:any,init:any)=>{
  const u=new URL(String(input));const b=init?.body?JSON.parse(init.body):null
  if(u.pathname==='/api/tags')return Response.json({models:[{name:'safe-local'},{name:'not-local',remote_host:'https://ollama.com'}]})
  if(u.pathname==='/api/show')return Response.json({capabilities:['completion']})
  if(u.pathname==='/api/chat'){modelRequests++;seen.push(b);return Response.json({message:{content:'Synthetic answer'},prompt_eval_count:8,eval_count:3})}
  if(u.pathname==='/api/coding/shared-model/info')return Response.json({workerId:'worker-test'})
  if(u.pathname.endsWith('/config')){enabled=b.enabled;return Response.json({enabled})}
  if(u.pathname.endsWith('/poll')){
   publicKey=b.publicKey
   if(b.outcome)outcome=b.outcome
   const current=job;job=null
   return Response.json({enabled,model:'safe-local',...(current?{job:current}:{}),cancel:!available})
  }
  throw new Error('Unexpected network request: '+u.pathname)
 }
 try{
  const config=withPreset(emptyConfig(join(dir,'worker.json')),{workspace:'team:workshop-test',name:'Workshop',origin:'https://one.example.test',port:19882,pair:'x'.repeat(43),cloud:{token:'test-only'}})
  host=new SharedModelHost(config,()=>false,()=>{})
  await assert.rejects(host.configure({model:'not-local',label:'Cloud alias',enabled:true}),/installed local/)
  await host.configure({model:'safe-local',label:'Shared model',enabled:true})
  for(let i=0;!publicKey&&i<100;i++)await new Promise(r=>setTimeout(r,20))
  assert.ok(publicKey)
  const id=crypto.randomUUID(),request={model:'safe-local',messages:[{role:'user' as const,content:'Review synthetic source'}],maxTokens:512}
  const encrypted=await sharedRequestBox(request,publicKey,'worker-test',id);job={id,box:encrypted.box}
  // No owner tab is required: the outbound poller carries the encrypted request.
  for(let i=0;!outcome&&i<400;i++)await new Promise(r=>setTimeout(r,25))
  assert.ok(outcome?.box,'Encrypted result delivered')
  const result=await openShared<any>(outcome.box as SharedBox,encrypted.key,'worker-test',id)
  assert.equal(result.result.text,'Synthetic answer');assert.equal(modelRequests,1)
  assert.deepEqual(seen[0].tools,[]);assert.equal(seen[0].model,'safe-local')
  // An attempted extra field cannot turn text inference into local tool execution.
  outcome=null
  const badId=crypto.randomUUID(),bad=await sharedRequestBox({...request,tools:[{name:'run_shell'}]} as any,publicKey,'worker-test',badId)
  job={id:badId,box:bad.box}
  for(let i=0;!outcome&&i<400;i++)await new Promise(r=>setTimeout(r,25))
  assert.equal(outcome.id,badId);assert.equal(outcome.box,undefined);assert.equal(modelRequests,1)
  enabled=false;available=false
  for(let i=0;host.status().choice?.enabled&&i<200;i++)await new Promise(r=>setTimeout(r,25))
  assert.equal(JSON.parse(readFileSync(config.file+'.model-share.json','utf8')).enabled,false)
 }finally{host?.stop();globalThis.fetch=original;rmSync(dir,{recursive:true,force:true})}
})
