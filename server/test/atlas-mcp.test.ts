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
test('large generated HTML/PNG attachment payloads are narrowly bounded without relaxing other MCP tools',()=>{
 const attachment={...request,name:'atlas_attach',arguments:{ref:42,filename:'mock.png',mime:'image/png',contentBase64:'AAAA'.repeat(20000)}}
 assert.equal(checkAtlasMcp(attachment),true)
 assert.equal(checkAtlasMcp({...attachment,name:'atlas_update'}),false)
 assert.equal(checkAtlasMcp({...attachment,arguments:{...attachment.arguments,ref:0}}),false)
 assert.equal(checkAtlasMcp({...attachment,arguments:{...attachment.arguments,contentBase64:'A'.repeat(850001)}}),false)
 assert.equal(checkAtlasMcp({...attachment,arguments:{...attachment.arguments,mime:'application/javascript'}}),false)
})
test('calls are selected from the actual allowed catalogue, schema checked and token redacted',async()=>{
 let called=0,closed=false
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:[{name:'atlas_whoami',description:'identity',inputSchema:{type:'object',additionalProperties:false}}]}),callTool:async()=>{called++;return {content:[{type:'text',text:secret}] }},close:async()=>{closed=true}}) as any
 const r=await runAtlasMcp(request,new AbortController().signal,factory)
 assert.equal(called,1);assert.equal(closed,true);assert.equal(JSON.stringify(r).includes(secret),false)
 await assert.rejects(runAtlasMcp({...request,name:'atlas_delete'} as WorkerMcpRequest,new AbortController().signal,factory),/unavailable/)
 await assert.rejects(runAtlasMcp({...request,servers:[{...server,deny:['atlas_whoami']}]} as WorkerMcpRequest,new AbortController().signal,factory),/unavailable/)
 await assert.rejects(runAtlasMcp({...request,arguments:{unexpected:true}} as WorkerMcpRequest,new AbortController().signal,factory),(e:any)=>e.code==='mcp_arguments_invalid')
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

test('topic discovery returns generic Atlas search/query while respecting denied tools',async()=>{
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:['atlas_search','atlas_query','atlas_get','atlas_delete'].map(name=>({name,description:'General Atlas operation',inputSchema:{type:'object'}}))}),close:async()=>{}}) as any
 for(const query of ['atlas document lab notebook','atlas work items last week']){
  const result:any=await runAtlasMcp({action:'search',servers:[{...server,deny:['atlas_delete']}],query} as WorkerMcpRequest,new AbortController().signal,factory)
  assert.ok(result.tools.some((t:any)=>t.name==='atlas_search'));assert.ok(result.tools.some((t:any)=>t.name==='atlas_query'))
  assert.ok(!result.tools.some((t:any)=>t.name==='atlas_delete'));assert.match(result.note,/Tool discovery only, not a content read/)
 }
})

test('every selected MCP page and complete server usage guide remains available, including large write schemas',async()=>{
 let pages=0
 const schema={type:'object',properties:{body:{type:'string',description:'Do not truncate semantics. '.repeat(600)}},required:['body']}
 const instructions='Atlas AQL uses field filters. Agent identity and Polarion approvals remain separate. '+secret
 const factory=()=>({connect:async()=>{},getInstructions:()=>instructions,listTools:async(args:any)=>{pages++;return args.cursor?{tools:[{name:'atlas_update',description:'Full write operation. '.repeat(100),inputSchema:schema}]}:{tools:[{name:'atlas_whoami',inputSchema:{type:'object'}}],nextCursor:'second'}},close:async()=>{}})as any
 const result:any=await runAtlasMcp({action:'search',servers:[server],query:'atlas_update'}as WorkerMcpRequest,new AbortController().signal,factory)
 assert.equal(pages,2);assert.equal(result.tools.length,1);assert.deepEqual(result.tools[0].inputSchema,schema);assert.equal(result.tools[0].description.length,2200)
 assert.match(result.guides[0].instructions,/AQL/);assert.ok(!JSON.stringify(result).includes(secret))
})
test('a looping catalogue fails explicitly instead of pretending unavailable tools are absent',async()=>{
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:[],nextCursor:'same'}),close:async()=>{}})as any
 await assert.rejects(runAtlasMcp({action:'search',servers:[server],query:'atlas_agent_flow'}as WorkerMcpRequest,new AbortController().signal,factory),/repeated catalogue/)
})


test('workspace tenant defaults are stateless, schema-aware and never overwrite an explicit tenant',async()=>{
 const calls:any[]=[]
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:[{name:'atlas_search',inputSchema:{type:'object',properties:{q:{type:'string'},tenant:{type:'string'}},additionalProperties:false}},{name:'atlas_whoami',inputSchema:{type:'object',additionalProperties:false}}]}),callTool:async(v:any)=>{calls.push(v);return {content:[{type:'text',text:'{"items":[]}'}]}},close:async()=>{}})as any
 const args={q:'Laborbuch'},signal=new AbortController().signal
 await runAtlasMcp({...request,name:'atlas_search',arguments:args} as WorkerMcpRequest,signal,factory,'analytik-jena')
 assert.deepEqual(calls[0].arguments,{q:'Laborbuch',tenant:'analytik-jena'});assert.deepEqual(args,{q:'Laborbuch'})
 await runAtlasMcp({...request,name:'atlas_search',arguments:{...args,tenant:'explicit-other'}} as WorkerMcpRequest,signal,factory,'analytik-jena')
 assert.equal(calls[1].arguments.tenant,'explicit-other')
 await runAtlasMcp(request,signal,factory,'analytik-jena');assert.deepEqual(calls[2].arguments,{})
 const discovery:any=await runAtlasMcp({action:'search',servers:[server],query:'atlas_search'},signal,factory,'analytik-jena')
 assert.match(discovery.guides[0].instructions,/Workspace Atlas tenant default: analytik-jena/)
 assert.match(discovery.guides[0].instructions,/Do not change the person's global tenant/)
 assert.equal(calls.some(c=>c.name==='atlas_tenant_select'),false)
})


test('search discovery includes only the permitted real workspace project directory instead of guessed labels',async()=>{
 const called:string[]=[]
 const factory=()=>({connect:async()=>{},listTools:async()=>({tools:[{name:'atlas_search',inputSchema:{type:'object'}},{name:'atlas_project_list',inputSchema:{type:'object'}}]}),callTool:async(v:any)=>{called.push(v.name);return {content:[{type:'text',text:JSON.stringify({projects:[{slug:'flux-part-felix',title:'Flux Part FeliX',tenant:'analytik-jena',parentSlug:'flux-client'},{slug:'unrelated',title:'Other workspace',tenant:'other'}]})}]}},close:async()=>{}})as any
 const r:any=await runAtlasMcp({action:'search',servers:[server],query:'atlas_search'},new AbortController().signal,factory,'analytik-jena')
 assert.deepEqual(r.projectDirectory,{server:'aj-atlas',tenant:'analytik-jena',projects:[{slug:'flux-part-felix',parentSlug:'flux-client'}]});assert.deepEqual(called,['atlas_project_list']);assert.match(r.guides[0].instructions,/flux-part-felix/);assert.match(r.guides[0].instructions,/flux-client/);assert.ok(!r.guides[0].instructions.includes('unrelated'))
 called.length=0
 await runAtlasMcp({action:'search',servers:[{...server,deny:['atlas_project_list']}],query:'atlas_search'},new AbortController().signal,factory,'analytik-jena')
 assert.deepEqual(called,[])
})


test('stability: 403, TLS and timeouts do not become invalid-token claims',async()=>{
 for(const [message,code] of [['403 Forbidden','mcp_permission'],['self signed certificate','mcp_tls'],['Connection timed out.','mcp_timeout']] as const){
  const factory=()=>({connect:async()=>{throw Error(message+' '+secret)},close:async()=>{}}) as any
  await assert.rejects(runAtlasMcp(request,new AbortController().signal,factory),(e:any)=>e.code===code&&!e.message.includes(secret))
 }
})
