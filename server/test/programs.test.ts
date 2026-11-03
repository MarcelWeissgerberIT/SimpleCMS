import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {captureProgramInspection} from '../../src/shared/quandprofile/program-inspection.ts'
import {QuandRuntime} from '../../src/shared/quandprofile/runtime.ts'
import {taskEvidence,type TaskContract} from '../../src/shared/quandprofile/task.ts'
import {randomUUID} from 'node:crypto'
import {startServer,signIn} from './helpers.ts'
import {compileProgram,draftWorkflow,programDigest} from '../../src/shared/quandprofile/program.ts'
test('private compiled versions are immutable, actor scoped, membership gated, integrity checked and runs bound',async()=>{
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 try{
  const alice=await signIn(server,'alice@program.test'),bob=await signIn(server,'bob@program.test'),guest=await signIn(server,'guest@program.test'),alien=await signIn(server,'alien@program.test')
  const ws=(await alice.post('/api/workspaces',{name:'Programs'})).body.id,path=`/api/workspaces/${ws}/programs`
  for(const [c,email,role]of [[bob,'bob@program.test','member'],[guest,'guest@program.test','viewer']]as const){const link=(await alice.post(`/api/workspaces/${ws}/invites`,{email,role})).body.link;await c.post('/api/invites/'+link.split('#/invite/')[1]+'/accept')}
  const id=randomUUID(),compiled=compileProgram({protocol:'one.program.v1',goal:'Private briefing',parameters:{},steps:[{id:'read',kind:'tool',tool:'read_page',schema:{type:'object'},effect:'read',args:{literal:{id:'p'}}}],output:{result:'read',path:[]}}),input={id,name:'Private',previous:0,compiled}
  assert.equal((await alien.get(path)).status,404);assert.equal((await guest.get(path)).status,403)
  assert.equal((await alice.post(path,{...input,compiled:{...compiled,hash:'0'.repeat(64)}})).status,400)
  assert.equal((await alice.post(path,input)).status,201);assert.equal((await alice.post(path,input)).status,409)
  assert.equal((await alice.post(path,{...input,previous:1,name:'Private v2'})).body.version,2)
  assert.equal((await bob.get(path)).body.programs.length,0);assert.equal((await alice.get(path)).body.programs.length,2)
  const run={id:randomUUID(),programId:id,version:1,hash:compiled.hash,inputHash:'1'.repeat(64),route:{provider:'local',model:'atlas-flow'},startedAt:Date.now(),finishedAt:Date.now(),status:'done',steps:[],answer:'Private result'}
  assert.equal((await bob.post(path+'/runs',run)).status,400);assert.equal((await alice.post(path+'/runs',{...run,hash:'0'.repeat(64)})).status,400)
  assert.equal((await alice.post(path+'/runs',run)).status,201);assert.equal((await bob.get(path+'/runs')).body.runs.length,0);assert.equal((await alice.get(path+'/runs')).body.runs[0].answer,'Private result')
  assert.equal((await bob.get(path+'?user_id=alice')).body.programs.length,0)
 }finally{await server.stop()}
})


test('personal workflow database isolates owners, workspaces and receipts; caller cannot choose another actor',async()=>{
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 try{
  const alice=await signIn(server,'alice@workflow.test'),bob=await signIn(server,'bob@workflow.test')
  const ws=(await alice.post('/api/workspaces',{name:'Shared'})).body.id,other=(await alice.post('/api/workspaces',{name:'Other'})).body.id,path=`/api/workspaces/${ws}/programs`
  const invite=(await alice.post(`/api/workspaces/${ws}/invites`,{email:'bob@workflow.test',role:'member'})).body.link;await bob.post('/api/invites/'+invite.split('#/invite/')[1]+'/accept')
  const compiled=compileProgram(draftWorkflow('/ba inspect requirements','ba','bound-page',[])),id=randomUUID()
  assert.equal((await alice.post(path,{id,name:'Only Alice',previous:0,compiled})).status,201)
  assert.equal((await bob.get(path)).body.programs.length,0)
  assert.equal((await bob.get(path+'?user_id=alice&include_all=true')).body.programs.length,0)
  assert.equal((await alice.get(`/api/workspaces/${other}/programs`)).body.programs.length,0)
  assert.equal((await bob.post(path,{id,name:'Impersonated',previous:0,compiled,user_id:'alice'})).status,400)
  assert.equal((await bob.post(path,{id,name:'Only Bob',previous:0,compiled})).status,201)
  assert.deepEqual((await alice.get(path)).body.programs.map((p:any)=>p.name),['Only Alice'])
  assert.deepEqual((await bob.get(path)).body.programs.map((p:any)=>p.name),['Only Bob'])
  const receipt={id:randomUUID(),programId:id,version:1,hash:compiled.hash,inputHash:'1'.repeat(64),route:{provider:'local',model:'atlas-flow'},startedAt:Date.now(),finishedAt:Date.now(),status:'done',steps:[],answer:'Personal BA analysis'}
  assert.equal((await alice.post(path+'/runs',receipt)).status,201);assert.deepEqual((await bob.get(path+'/runs')).body.runs,[])
 }finally{await server.stop()}
})


test('private inspection snapshots validate packet integrity, stay actor scoped and do not admit unknown or credential fields',async()=>{
 const wasm=(globalThis as unknown as {WebAssembly:{instantiate(bytes:Uint8Array,imports:object):Promise<{instance:{exports:unknown}}>}}).WebAssembly
 const {instance}=await wasm.instantiate(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)),{}),runtime=new QuandRuntime(instance)
 const contract:TaskContract={id:'task',revision:1,goal:'Read one source',instruction_context:'Source-bound briefing',input_hash:'input',scope_hash:'scope',source_pointers:[],allowed_tools:['read_page'],read_only:true,external_write:false,execute:false,requires_sources:false,search_one:true,search_atlas:false,output:'text',required_literals:[],decisions:[]},evidence=taskEvidence()
 const inspection=captureProgramInspection({id:contract.id,at:Date.now(),phase:'working',compiled:runtime.task({contract,evidence,phase:'compile',tool:null,effect:null}),observations:[],questions:[],evidence})
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 try{
  const alice=await signIn(server,'alice@inspection.test'),bob=await signIn(server,'bob@inspection.test'),ws=(await alice.post('/api/workspaces',{name:'Inspection'})).body.id,path=`/api/workspaces/${ws}/programs`
  const invite=(await alice.post(`/api/workspaces/${ws}/invites`,{email:'bob@inspection.test',role:'member'})).body.link;await bob.post('/api/invites/'+invite.split('#/invite/')[1]+'/accept')
  const compiled=compileProgram(draftWorkflow('/ba read source','ba','source',[])),id=randomUUID();assert.equal((await alice.post(path,{id,name:'My check',previous:0,compiled})).status,201)
  const run={id:randomUUID(),programId:id,version:1,hash:compiled.hash,inputHash:'1'.repeat(64),route:{provider:'local',model:'test'},startedAt:Date.now(),finishedAt:Date.now(),status:'done',steps:[],answer:'Private finding',inspection}
  assert.equal((await alice.post(path+'/runs',{...run,inspection:{...inspection,packet:{changed:true}}})).status,400)
  assert.equal((await alice.post(path+'/runs',{...run,inspection:{...inspection,approved:true}})).status,400)
  assert.equal((await alice.post(path+'/runs',run)).status,201)
  const actual=(await alice.get(path+'/runs')).body.runs[0];assert.deepEqual(actual.inspection,inspection);assert.equal((await bob.get(path+'/runs')).body.runs.length,0)
  assert.equal((await bob.post(path+'/runs',{...run,id:randomUUID()})).status,400)
  const summary=(await alice.get(path+'/runs?summary=1')).body.runs[0]
  assert.equal(summary.summary,true);assert.equal(summary.hasInspection,true);assert.equal(Object.hasOwn(summary,'inspection'),false);assert.equal(Object.hasOwn(summary,'answer'),false);assert.deepEqual(summary.steps,[])
  const privateRun=await alice.get(path+'/runs/'+run.id);assert.equal(privateRun.status,200);assert.deepEqual(privateRun.body.inspection,inspection)
  assert.equal((await bob.get(path+'/runs/'+run.id)).status,404)
  const largePacket={source:'ü'.repeat(100000)},large={...run,id:randomUUID(),answer:'A'.repeat(90000),inspection:{...inspection,packet:largePacket,packetHash:programDigest(largePacket)}}
  assert.ok(Buffer.byteLength(JSON.stringify(large))>256*1024)
  assert.equal((await alice.post(path+'/runs',large)).status,201)
  const summaries=(await alice.get(path+'/runs?summary=1')).body.runs
  assert.ok(Buffer.byteLength(JSON.stringify(summaries))<Buffer.byteLength(JSON.stringify(large))/100)

 }finally{await server.stop()}
})

test('terminal receipts include failed work without creating executable programs and remain actor scoped',async()=>{
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 try{
  const alice=await signIn(server,'alice@terminal.test'),bob=await signIn(server,'bob@terminal.test')
  const ws=(await alice.post('/api/workspaces',{name:'Receipts'})).body.id,path=`/api/workspaces/${ws}/programs`
  const invite=(await alice.post(`/api/workspaces/${ws}/invites`,{email:'bob@terminal.test',role:'member'})).body.link;await bob.post('/api/invites/'+invite.split('#/invite/')[1]+'/accept')
  const id=randomUUID(),task='Read the Atlas target and record the blocked transfer.',hash=programDigest({task})
  const run={id,programId:id,version:1,hash,inputHash:hash,route:{provider:'anthropic',model:'claude-opus-5-5'},startedAt:Date.now()-1000,finishedAt:Date.now(),status:'failed',steps:[],answer:'Partial result',error:'The write failed.',terminal:{task,tools:[{id:'s1',name:'atlas_comment',server:'atlas',status:'err',at:Date.now(),error:'Not executed',notExecuted:true}]}}
  assert.equal((await alice.post(path+'/runs',run)).status,201)
  assert.equal((await alice.get(path)).body.programs.length,0)
  assert.equal((await bob.get(path+'/runs')).body.runs.length,0)
  assert.equal((await bob.get(path+'/runs/'+id)).status,404)
  assert.equal((await alice.get(path+'/runs/'+id)).body.terminal.tools[0].name,'atlas_comment')
  const preview=(await alice.get(path+'/runs?summary=1')).body.runs[0];assert.equal(preview.status,'failed');assert.equal(preview.terminal.task,task);assert.deepEqual(preview.terminal.tools,[]);assert(!('answer'in preview))
  assert.equal((await alice.post(path+'/runs',{...run,id:randomUUID(),hash:'0'.repeat(64)})).status,400)
  assert.equal((await alice.post(path+'/runs',{...run,user_id:'bob'})).status,400)
 }finally{await server.stop()}
})
