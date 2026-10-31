import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkAtlasMcp,runAtlasMcp} from '../src/coding/atlas-mcp.ts'
import type {WorkerMcpRequest} from '../../src/shared/ai/worker.ts'
import {startServer,signIn} from './helpers.ts'
const secret='synthetic-personal-atlas-token',server={name:'aj-atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:secret,allow:null,deny:[]}
const request={action:'call',servers:[server],server:'aj-atlas',name:'atlas_whoami',arguments:{}} as WorkerMcpRequest
test('personal Atlas proxy rejects arbitrary destinations, headers and malformed tokens',()=>{
 assert.equal(checkAtlasMcp(request),true)
 for(const patch of [{url:'https://eh-atlas.com/api/atlas/mcp'},{url:'http://127.0.0.1:8080'},{url:'https://aj-atlas.com/api/atlas/mcp?token=x'},{token:secret+'\n'},{headers:{Cookie:'private'}}])assert.equal(checkAtlasMcp({...request,servers:[{...server,...patch}]}),false)
 assert.equal(checkAtlasMcp({...request,servers:[server,server]}),false)
})
test('calls are selected from the actual allowed catalogue, schema checked and token redacted',async()=>{
 let called=0,closed=false
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:[{name:'atlas_whoami',description:'identity',inputSchema:{type:'object',additionalProperties:false}}]}),callTool:async()=>{called++;return {content:[{type:'text',text:secret}] }},close:async()=>{closed=true}}) as any
 const r=await runAtlasMcp(request,new AbortController().signal,factory)
 assert.equal(called,1);assert.equal(closed,true);assert.equal(JSON.stringify(r).includes(secret),false)
 await assert.rejects(runAtlasMcp({...request,name:'atlas_delete'} as WorkerMcpRequest,new AbortController().signal,factory),/unavailable/)
 await assert.rejects(runAtlasMcp({...request,servers:[{...server,deny:['atlas_whoami']}]} as WorkerMcpRequest,new AbortController().signal,factory),/unavailable/)
 await assert.rejects(runAtlasMcp({...request,arguments:{unexpected:true}} as WorkerMcpRequest,new AbortController().signal,factory),/invalid/)
 assert.equal(called,1)
})
test('Atlas authorization failures are sanitized and never become ONE session 401s',async()=>{
 const factory=()=>({connect:async()=>{throw new Error('401 '+secret)},close:async()=>{}}) as any
 await assert.rejects(runAtlasMcp(request,new AbortController().signal,factory),(e:any)=>e.status===502&&e.code==='mcp_auth'&&!e.message.includes(secret))
})
test('the proxy is workspace guarded and unavailable without an admin-provided AJ setup',async()=>{
 const app=await startServer()
 try{
  const owner=await signIn(app,'aj-owner@test.invalid'),alien=await signIn(app,'aj-alien@test.invalid')
  const ws=(await owner.post('/api/workspaces',{name:'AJ'})).body.id
  assert.equal((await owner.post(`/api/workspaces/${ws}/atlas-mcp`,request)).status,403)
  assert.equal((await alien.post(`/api/workspaces/${ws}/atlas-mcp`,request)).status,404)
 }finally{await app.stop()}
})

test('discovery exposes at most six schemas to the local-model harness',async()=>{
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:Array.from({length:20},(_,i)=>({name:'atlas_get_'+i,inputSchema:{type:'object'}}))}),close:async()=>{}}) as any
 const result=await runAtlasMcp({action:'search',servers:[server],query:'atlas'} as WorkerMcpRequest,new AbortController().signal,factory)
 assert.equal((result as any).tools.length,6)
})
