import {test} from 'node:test'
import assert from 'node:assert/strict'
import {searchSnippet,textExcerpt} from '../../src/shared/ai/text-excerpts.ts'
import {claudeUnicodeMiddleware} from '../../src/shared/ai/anthropic-unicode.ts'

test('search excerpts do not split the emoji at character 220 (production regression)',()=>{
 const source='parameter '+ 'x'.repeat(209)+'🔄 next entry'
 assert.equal(source.charCodeAt(219),0xd83d)
 const snippet=searchSnippet(source,'parameter')
 assert.equal(snippet,source.slice(0,219)+'…')
 assert(snippet.isWellFormed())
})
test('search excerpt also avoids a low surrogate at its starting boundary',()=>{
 const source='x'.repeat(82)+'😀'+'x'.repeat(79)+'needle'+'z'.repeat(250)
 assert.equal(source.indexOf('needle')-80,83)
 const snippet=searchSnippet(source,'needle')
 assert(snippet.isWellFormed());assert(snippet.includes('needle'));assert(snippet.startsWith('…x'))
})
test('all excerpt boundaries preserve complete supplementary characters and exact source text',()=>{
 const source='A😀B𝄞C👩‍🔬D'
 for(let start=0;start<=source.length;start++)for(let end=start;end<=source.length;end++){
  const excerpt=textExcerpt(source,start,end)
  assert(excerpt.isWellFormed());assert(source.includes(excerpt));assert(excerpt.length<=end-start)
 }
 assert.equal(textExcerpt(source,0,source.length),source)
 assert.equal(searchSnippet('  short\ntext  ','text'),'short text')
})

test('actual SDK transport repairs lone surrogates once, preserving tools, signatures, escapes and source objects',async()=>{
 const {default:Anthropic}=await import('@anthropic-ai/sdk')
 const messages:any[]=[{role:'user',content:'Review 😀'},
  {role:'assistant',content:[{type:'thinking',thinking:'Preserve 😀',signature:'opaque-signature'},{type:'tool_use',id:'read-1',name:'read_page',input:{id:'page-1'}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'read-1',content:'start\ud83d… middle\udc00 end 😀 literal \\ud83d and \\n'}]}]
 const before=JSON.stringify(messages)
 let calls=0
 const client=new Anthropic({apiKey:'synthetic',maxRetries:0,middleware:[claudeUnicodeMiddleware],fetch:async(_url,init)=>{
  calls++
  const body=JSON.parse(String(init?.body)),receipt=body.messages[2].content[0]
  assert.equal(receipt.content,'start�… middle� end 😀 literal \\ud83d and \\n')
  assert.equal(receipt.tool_use_id,'read-1');assert.deepEqual(body.messages[1],messages[1]);assert.deepEqual(body.messages[0],messages[0])
  return new Response(JSON.stringify({id:'reply',type:'message',role:'assistant',model:'test',content:[{type:'text',text:'Read complete'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}),{headers:{'content-type':'application/json'}})
 }})
 await client.beta.messages.create({model:'test',max_tokens:100,messages})
 assert.equal(calls,1);assert.equal(JSON.stringify(messages),before)
})

test('middleware leaves well-formed JSON and non-JSON requests alone and never retries',async()=>{
 for(const body of [JSON.stringify({text:'😀 ü é literal \\ud83d',nested:{text:'𠮷'}}),'binary']){
  const request={url:'https://example.test/v1/messages',method:'POST',body,headers:new Headers({'content-type':body==='binary'?'application/octet-stream':'application/json'})}
  let calls=0
  await claudeUnicodeMiddleware(request,async sent=>{calls++;assert.equal(sent,request);return new Response(null,{status:400})},{} as any)
  assert.equal(calls,1)
 }
})
