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
