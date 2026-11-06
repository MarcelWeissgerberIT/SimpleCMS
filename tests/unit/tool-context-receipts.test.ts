import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fitLocalToolContext} from '../../src/shared/ai/local-context.ts'
test('context excerpts preserve source handles, reuse markers and receipts without repeating metadata inside excerpts',()=>{
 const facts={effect:'write_accepted',refs:[42],verification:'unavailable',detail:'receipt detail '.repeat(40)}
 const raw=JSON.stringify({result_id:'source-42',oneObservedFacts:facts,oneReadReuse:{fresh:false},oneNotExecuted:true,body:'source content '.repeat(5000)})
 const messages=[{role:'user' as const,content:'Review record 42; do not repeat the write.'},{role:'assistant' as const,content:JSON.stringify({tool_calls:[{id:'read-42',name:'atlas_get',arguments:{ref:42}}]})},{role:'user' as const,content:JSON.stringify({tool_result:{id:'read-42',content:raw}})}]
 const next=fitLocalToolContext(messages,rows=>JSON.stringify(rows).length<2200),result=JSON.parse(JSON.parse(next[2].content).tool_result.content)
 assert.equal(result.result_id,'source-42');assert.deepEqual(result.oneObservedFacts,facts);assert.equal(result.oneNotExecuted,true);assert.deepEqual(result.oneReadReuse,{fresh:false})
 assert.ok(!result.excerpt.includes('receipt detail'));assert.match(result.excerpt,/source content/);assert.equal(next[0].content,messages[0].content);assert.equal(next[1].content,messages[1].content)
 assert.equal(JSON.parse(JSON.parse(messages[2].content).tool_result.content).body.length,75000)
})
