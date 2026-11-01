import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {startServer,signIn} from './helpers.ts'
import {compileProgram} from '../../src/shared/quandprofile/program.ts'
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
