import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localChatMessages, localChatResult } from '../src/worker/local-chat.ts'
import { textRequest, checkTextRequest } from '../src/worker/text-models.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const tools = [{name:'one_mcp_search',description:'Discover selected tools',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}]
const base = {provider:'local' as const,model:'local-coder',messages:[{role:'user' as const,content:'Find Atlas tools.'}],maxTokens:512,tools}

test('local function transcripts close assistant calls with native tool results',()=>{
 const calls=[{id:'a1',name:'one_mcp_search',arguments:{query:'atlas'}}]
 const messages=localChatMessages([
  {role:'assistant',content:JSON.stringify({content:'',tool_calls:calls})},
  {role:'user',content:JSON.stringify({tool_result:{id:'a1',content:'{"tools":[]}'}})},
  {role:'assistant',content:JSON.stringify([{type:'tool_use',id:'a2',name:'read_page',input:{id:'p1'}}])},
  {role:'user',content:JSON.stringify([{type:'tool_result',tool_use_id:'a2',content:'Page source'}])},
  {role:'user',content:'Unrelated plain question'},
 ])
 assert.equal(messages[0].tool_calls[0].function.name,'one_mcp_search')
 assert.deepEqual(messages[1],{role:'tool',tool_call_id:'a1',tool_name:'one_mcp_search',content:'{"tools":[]}'})
 assert.equal(messages[2].tool_calls[0].function.name,'read_page')
 assert.equal(messages[3].role,'tool');assert.equal(messages[4].role,'user')
})

test('unknown functions, invalid arguments and bad structured answers never leave inference as calls',()=>{
 assert.throws(()=>localChatResult({content:'',tool_calls:[{function:{name:'run_shell',arguments:{}}}]},base))
 assert.throws(()=>localChatResult({tool_calls:[{function:{name:'one_mcp_search',arguments:{query:3}}}]},base))
 assert.throws(()=>localChatResult({tool_calls:[{function:{name:'one_mcp_search',arguments:{query:'atlas',url:'https://evil.test'}}}]},base))
 assert.throws(()=>localChatResult({tool_calls:[{function:{name:'one_mcp_search',arguments:{query:'atlas'}}}]},{...base,tools:[]}))
 assert.throws(()=>localChatResult({content:'{"answer":3}'},{...base,tools:[],schema:{type:'object',properties:{answer:{type:'string'}},required:['answer']}}))
 const result=localChatResult({content:'',tool_calls:[{function:{name:'one_mcp_search',arguments:{query:'atlas'}}}]},base)
 assert.equal(result.calls?.[0]?.name,'one_mcp_search');assert.ok(result.calls?.[0]?.id)
 assert.throws(()=>checkTextRequest({...base,servers:[{token:'private'}]}))
})

test('local inference returns schema-validated function requests without contacting any MCP server',async()=>{
 const original=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'local-chat-'))
 const requests:any[]=[]
 globalThis.fetch=async(input:any,init:any)=>{
  const u=new URL(String(input)),b=init?.body?JSON.parse(init.body):null
  assert.equal(u.origin,'http://127.0.0.1:11434')
  if(u.pathname==='/api/tags')return Response.json({models:[{name:'local-coder'}]})
  if(u.pathname==='/api/show')return Response.json({capabilities:['completion','tools']})
  if(u.pathname==='/api/chat'){requests.push(b);return Response.json({message:{content:'',tool_calls:[{function:{name:'one_mcp_search',arguments:{query:'atlas'}}}]},prompt_eval_count:30,eval_count:12})}
  throw Error('Unexpected network request')
 }
 try {
  const reply=await textRequest(join(dir,'worker.json'),base,AbortSignal.timeout(10000))
  assert.equal(reply.calls?.[0]?.name,'one_mcp_search')
  assert.equal(requests.length,1);assert.equal(requests[0].tools[0].function.name,'one_mcp_search')
  assert.equal(reply.usd,0)
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true})}
})


test('Kai: an unoffered native database call is corrected once by inference, never executed, with complete usage',async()=>{
 const original=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'local-tool-repair-'))
 const requests:any[]=[]
 const offered=[{name:'one_workspace_search',description:'Discover permitted ONE tools',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}]
 let stillInvalid=false
 globalThis.fetch=async(input:any,init:any)=>{
  const u=new URL(String(input)),b=init?.body?JSON.parse(init.body):null
  assert.equal(u.origin,'http://127.0.0.1:11434','no host tool, MCP endpoint or credential exchange')
  if(u.pathname==='/api/tags')return Response.json({models:[{name:'local-coder'}]})
  if(u.pathname==='/api/show')return Response.json({capabilities:['completion','tools']})
  if(u.pathname==='/api/chat'){
   requests.push(b)
   const bad=stillInvalid||requests.length===1
   return Response.json({message:{content:'',tool_calls:[{function:bad?{name:'query_database',arguments:{database_id:'baKai20261102'}}:{name:'one_workspace_search',arguments:{query:'query_database'}}}]},prompt_eval_count:30,eval_count:12})
  }
  throw Error('Unexpected network request')
 }
 try{
  const request={...base,tools:offered,messages:[{role:'system' as const,content:'Read only. German answer. Human update is not a coding request.'},{role:'user' as const,content:'K2: API /api/v1, AICM-2246, Sprint 45. Only identify the remaining question.'}]}
  const reply=await textRequest(join(dir,'worker.json'),request,AbortSignal.timeout(10000))
  assert.equal(reply.calls?.[0]?.name,'one_workspace_search');assert.equal(reply.toolRepairs,1)
  assert.equal(reply.inputTokens,60);assert.equal(reply.outputTokens,24);assert.equal(requests.length,2)
  assert.deepEqual(requests[1].messages.slice(0,2),request.messages)
  assert.match(requests[1].messages[2].content,/No function.*executed/)
  assert.deepEqual(requests[0].tools,requests[1].tools)
  assert.equal(requests[1].messages.some((m:any)=>m.role==='tool'),false,'no invented result')
  requests.length=0;stillInvalid=true
  await assert.rejects(textRequest(join(dir,'worker.json'),request,AbortSignal.timeout(10000)),(e:any)=>e.code==='tool_output')
  assert.equal(requests.length,2,'one bounded correction, no loop')
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true})}
})


test('shared inference correction respects the gateway native byte bound without clipping the human task',async()=>{
 const original=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'local-repair-bound-')),requests:any[]=[]
 const offered=[{name:'one_workspace_search',description:'Discover permitted tools',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}]
 const messages=[{role:'system' as const,content:'Permissions and source rules remain intact.'},{role:'user' as const,content:'Keep this exact human instruction; read only.'},{role:'assistant' as const,content:JSON.stringify({content:'',tool_calls:[{id:'read-1',name:'read_page',arguments:{id:'k2'}}]})},{role:'user' as const,content:JSON.stringify({tool_result:{id:'read-1',content:'Actual source: '+'x'.repeat(34500)}})}]
 let source=''
 globalThis.fetch=async(input:any,init:any)=>{
  const u=new URL(String(input)),b=init?.body?JSON.parse(init.body):null
  if(u.pathname==='/api/tags')return Response.json({models:[{name:'local-coder'}]})
  if(u.pathname==='/api/show')return Response.json({capabilities:['completion','tools']})
  if(u.pathname==='/api/chat'){
   requests.push(b)
   const bytes=Buffer.byteLength(JSON.stringify([b.messages,b.tools,b.format,undefined]))
   assert.ok(bytes<=36000,'native gateway boundary: '+bytes)
   if(requests.length===2)source=b.messages.find((m:any)=>m.role==='tool').content
   return Response.json({message:{content:'',tool_calls:[{function:requests.length===1?{name:'query_database',arguments:{database_id:'k2'}}:{name:'one_workspace_search',arguments:{query:'query_database'}}}]},prompt_eval_count:100,eval_count:10})
  }
  throw Error('Unexpected endpoint')
 }
 try{
  const reply=await textRequest(join(dir,'worker.json'),{...base,messages,tools:offered},AbortSignal.timeout(10000),{job:'fixture-repair'})
  assert.equal(reply.toolRepairs,1);assert.equal(requests.length,2)
  assert.deepEqual(requests[1].messages.slice(0,2),messages.slice(0,2))
  // At this size a correction may still fit in full. A larger source must be excerpted.
  messages[3]!.content=JSON.stringify({tool_result:{id:'read-1',content:'Actual source: '+'x'.repeat(35000)}})
  requests.length=0
  await textRequest(join(dir,'worker.json'),{...base,messages,tools:offered},AbortSignal.timeout(10000),{job:'fixture-repair-2'})
  assert.match(source,/Harness context excerpt/)
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true})}
})


test('gateway context rejection preserves its fixed classification without leaking provider text',async()=>{
 const original=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'local-gateway-error-'))
 globalThis.fetch=async(input:any)=>{
  const u=new URL(String(input))
  if(u.pathname==='/api/tags')return Response.json({models:[{name:'local-coder'}]})
  if(u.pathname==='/api/show')return Response.json({capabilities:['completion','tools']})
  return Response.json({error:{type:'context_limit',message:'private-provider-token-do-not-echo'}},{status:400})
 }
 try{await assert.rejects(textRequest(join(dir,'worker.json'),base,AbortSignal.timeout(10000)),(e:any)=>e.code==='context'&&!e.message.includes('private-provider'))}
 finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true})}
})
