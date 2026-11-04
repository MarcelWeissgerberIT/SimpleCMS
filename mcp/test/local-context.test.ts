import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitLocalToolContext,fitLocalToolPacket } from '../../src/shared/ai/local-context.ts'
import { localChatMessages } from '../src/worker/local-chat.ts'

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
test('local context keeps a large Atlas conversation closed and preserves its original task and run history', () => {
  const messages = [
    { role: 'system' as const, content: 'Keep all permissions and review requirements. '.repeat(70) },
    { role: 'user' as const, content: 'Read Atlas identity. Do not modify anything. Keep my attached source verbatim. '.repeat(50) },
    { role: 'assistant' as const, content: JSON.stringify([{ type: 'tool_use', id: 'discover', name: 'one_mcp_search', input: { query: 'atlas_whoami' } }]) },
    { role: 'user' as const, content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'discover', content: 'Tool schema: ' + 'Ö🤖\\"'.repeat(1500) }]) },
    { role: 'assistant' as const, content: JSON.stringify([{ type: 'tool_use', id: 'identity', name: 'one_mcp_call', input: { server: 'atlas', name: 'atlas_whoami', arguments: {} } }]) },
    { role: 'user' as const, content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'identity', content: 'Active tenant: one. ' + 'Other allowed projects. '.repeat(250) }]) },
  ]
  const before = structuredClone(messages), tools = [{ name: 'one_mcp_call', parameters: {} }]
  const packed = fitLocalToolContext(messages, next => size({ messages: next, tools }) <= 22000)
  assert.ok(size({ messages: packed, tools }) <= 22000)
  assert.deepEqual(messages, before)
  assert.deepEqual(packed.slice(0, 3), before.slice(0, 3))
  assert.deepEqual(packed[4], before[4])
  assert.equal(packed[5]!.content, before[5]!.content, 'preserve the newest result when older discovery can be excerpted')
  assert.match(packed[3]!.content, /Harness context excerpt/)
  const native = localChatMessages(packed)
  assert.equal(native[3].tool_call_id, 'discover')
  assert.equal(native[5].tool_call_id, 'identity')
  assert.match(native[5].content, /Active tenant: one/)
  assert.equal(fitLocalToolContext(before, () => true), before)
})

test('one-shot result envelopes retain ids and explicit tool errors when latest results must be shortened', () => {
  const messages = [
    { role: 'system' as const, content: 'System policy' },
    { role: 'user' as const, content: 'User task' },
    { role: 'assistant' as const, content: JSON.stringify({ content: '', tool_calls: [{ id: 'get', name: 'one_mcp_call', arguments: { server: 'atlas', name: 'atlas_get', arguments: { ref: 43 } } }] }) },
    { role: 'user' as const, content: JSON.stringify({ tool_result: { id: 'get', is_error: true, content: 'Source unavailable: ' + 'x'.repeat(20000) } }) },
  ]
  const packed = fitLocalToolContext(messages, next => size(next) <= 3000)
  const result = JSON.parse(packed[3]!.content).tool_result
  assert.equal(result.id, 'get'); assert.equal(result.is_error, true)
  assert.match(result.content, /Source unavailable/); assert.match(result.content, /Harness context excerpt/)
  assert.ok(size(packed) <= 3000)
  assert.deepEqual(packed[2], messages[2])
})

test('an oversized task or unrelated JSON cannot be silently removed to fit local context', () => {
  const task = [{ role: 'user' as const, content: JSON.stringify({ tool_result: { id: 'invented', content: 'x'.repeat(10000) } }) }]
  assert.throws(() => fitLocalToolContext(task, next => size(next) <= 2000), /fresh task or select a smaller/)
  assert.equal(task[0]!.content.length > 10000, true)
})

test('completed earlier drafts/traces fold first, while every human message and current tool call remain',()=>{
 const human='Original human instruction: no changes; only Atlas sources.'
 const messages=[
  {role:'system' as const,content:'All permissions unchanged.'},
  {role:'user' as const,content:human},
  {role:'assistant' as const,content:JSON.stringify([{type:'tool_use',id:'old',name:'one_mcp_call',input:{ref:43}}])},
  {role:'user' as const,content:JSON.stringify([{type:'tool_result',tool_use_id:'old',content:'Old source. '.repeat(1000)}])},
  {role:'assistant' as const,content:'Old draft answer. '.repeat(500)},
  {role:'user' as const,content:'This week as a table, please.'},
  {role:'assistant' as const,content:JSON.stringify([{type:'tool_use',id:'new',name:'one_mcp_search',input:{query:'atlas_query'}}])},
  {role:'user' as const,content:JSON.stringify([{type:'tool_result',tool_use_id:'new',content:'Actual new source schema.'}])},
 ]
 const original=structuredClone(messages);let notified=0
 const result=fitLocalToolContext(messages,next=>size(next)<2500,{completedBefore:5,onCompact:()=>notified++})
 assert.equal(notified,1);assert.deepEqual(messages,original)
 assert.equal(result[0]!.content,messages[0]!.content);assert.equal(result[1]!.content,human)
 assert.match(result[2]!.content,/Harness history boundary/)
 assert.deepEqual(result.slice(3),messages.slice(5))
 assert.throws(()=>fitLocalToolContext(messages,next=>size(next)<300,{completedBefore:1}),/fresh task/)
 assert.throws(()=>fitLocalToolContext(messages.map(m=>m.role==='user'?{...m,content:human.repeat(500)}:m),next=>size(next)<2500,{completedBefore:5}),/fresh task/)
})

test('a current K1 read can shed model narration without losing the instruction, native calls or source identity',()=>{
 const call={type:'tool_use',id:'k1-read',name:'one_remote_2',input:{ref:23166,parts:['body','comments']}}
 const messages=[{role:'system' as const,content:'Keep source and permission rules. '.repeat(300)},{role:'user' as const,content:'Compare old Q12 with the latest human answers. Only read Atlas ref 23166.'},{role:'assistant' as const,content:JSON.stringify([{type:'text',text:'I will now inspect the actual source. '.repeat(200)},call])},{role:'user' as const,content:JSON.stringify([{type:'tool_result',tool_use_id:'k1-read',content:JSON.stringify({result_id:'mcp-result-k1',path:'/item/comments',content:'Actual comment from Kai: A12 includes AOX blank.',next_offset:null})}])}]
 const original=structuredClone(messages);let compacted=0
 const result=fitLocalToolContext(messages,next=>size(next)<12000,{completedBefore:1,onCompact:()=>compacted++})
 assert.equal(compacted,1);assert.deepEqual(messages,original);assert.deepEqual(result.slice(0,2),messages.slice(0,2));assert.deepEqual(result[3],messages[3]);assert.deepEqual(JSON.parse(result[2]!.content).find((b:any)=>b.type==='tool_use'),call);assert.match(result[2]!.content,/model narration omitted/)
 const native=localChatMessages(result);assert.equal(native[3].tool_call_id,'k1-read');assert.match(native[3].content,/A12 includes AOX blank/)
 assert.throws(()=>fitLocalToolContext(messages,next=>size(next)<1000,{completedBefore:1}),/fresh task/)
})


test('K2 discovery overflow fits the newest native schema by evicting only older optional aliases',()=>{
 const messages=[{role:'system' as const,content:'Compiler permissions and instructions. '.repeat(300)},{role:'user' as const,content:'K2 human update: Type, /api/v1, AICM-2246, Sprint 45; only read Atlas 24675 and 23166.'}]
 const tools=[{name:'one_workspace_search',parameters:{type:'object'}},{name:'one_mcp_call',parameters:{type:'object'}},{name:'one_remote_9',parameters:{description:'Latest Atlas get source schema. '.repeat(30),type:'object'}},{name:'one_remote_3',parameters:{description:'Old optional broad query. '.repeat(300),type:'object'}},{name:'one_remote_2',parameters:{description:'Older project schema. '.repeat(300),type:'object'}}]
 const before=structuredClone({messages,tools});let notices=0
 const fitted=fitLocalToolPacket(messages,tools,(m,t)=>size({messages:m,tools:t})<=14000,{completedBefore:1,onCompact:()=>notices++})
 assert.deepEqual(fitted.messages,messages)
 assert.deepEqual(fitted.tools?.map(t=>t.name),['one_workspace_search','one_mcp_call','one_remote_9'])
 assert.deepEqual(fitted.tools?.[2],tools[2],'full source schema remains exact')
 assert.deepEqual({messages,tools},before);assert.equal(notices,1)
 assert.throws(()=>fitLocalToolPacket(messages,tools,(m,t)=>size({messages:m,tools:t})<100),/fresh task/)
 assert.equal(fitLocalToolPacket(messages,tools,()=>true).tools,tools)
})

test('large discovery yields before small Atlas bodies and source handles survive a tighter context',()=>{
 const source={id:'design-source-test-1',ref:12,title:'Kit',hash:'a'.repeat(64),readAt:'2026-11-04T19:00:00Z'}
 const body='Button uses --primary: #A50034.'
 const messages=[
  {role:'system' as const,content:'Keep permissions and user task intact.'},
  {role:'user' as const,content:'Build a free mock with this design.'},
  {role:'assistant' as const,content:JSON.stringify([{type:'tool_use',id:'read',name:'one_mcp_call',input:{ref:12}}])},
  {role:'user' as const,content:JSON.stringify([{type:'tool_result',tool_use_id:'read',content:JSON.stringify({content:[{type:'text',text:body}],oneMockSource:source})}])},
  {role:'assistant' as const,content:JSON.stringify([{type:'tool_use',id:'find',name:'one_workspace_search',input:{query:'mock'}}])},
  {role:'user' as const,content:JSON.stringify([{type:'tool_result',tool_use_id:'find',content:'Tool descriptions: '.repeat(1000)}])},
 ]
 const before=structuredClone(messages)
 const result=fitLocalToolContext(messages,next=>size(next)<2500)
 assert.deepEqual(result[3],messages[3],'compact read stays complete instead of being discarded first')
 assert.match(result[5]!.content,/Harness context excerpt/)
 const huge=[...messages.slice(0,3),{role:'user' as const,content:JSON.stringify([{type:'tool_result',tool_use_id:'read',content:JSON.stringify({content:[{type:'text',text:body.repeat(2000)}],oneMockSource:source})}])}]
 const compact=fitLocalToolContext(huge,next=>size(next)<1800)
 const receipt=JSON.parse(JSON.parse(compact[3]!.content)[0].content)
 assert.deepEqual(receipt.oneMockSource,source)
 assert.equal(receipt.oneContextExcerpt,true)
 assert.match(receipt.note,/Do not infer omitted facts/)
 assert.ok(size(compact)<1800)
 assert.deepEqual(messages,before)
})
