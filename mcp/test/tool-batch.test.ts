import {test} from 'node:test'
import assert from 'node:assert/strict'
import {closeToolBatch} from '../../src/shared/ai/tool-batch.ts'
import {localChatMessages} from '../src/worker/local-chat.ts'
test('a stopped/repeated batch retains real receipts and closes every remaining native call without claiming execution',()=>{
 const calls=[{id:'read',name:'one_mcp_call',input:{name:'atlas_query'}},{id:'repeated',name:'one_mcp_call',input:{name:'atlas_query'}},{id:'write',name:'one_workspace_call',input:{name:'create_page'}}]
 const done=[{type:'tool_result' as const,tool_use_id:'read',content:'Actual Atlas error',is_error:true}]
 const before=structuredClone(done),closed=closeToolBatch(calls,done)
 assert.deepEqual(done,before);assert.deepEqual(closed[0],done[0]);assert.equal(closed.length,3)
 for(const r of closed.slice(1)){assert.equal(r.is_error,true);assert.match(r.content,/Execution is unverified/);assert.match(r.content,/do not retry writes/)}
 const wire=localChatMessages([{role:'assistant',content:JSON.stringify(calls.map(c=>({type:'tool_use',...c})))},{role:'user',content:JSON.stringify(closed)}])
 assert.deepEqual(wire.slice(1).map(m=>m.tool_call_id),calls.map(c=>c.id))
 assert.ok(wire.slice(1).every(m=>m.role==='tool'&&m.tool_name))
})
test('successful receipts and empty batches are preserved without extra calls',()=>{
 const receipts=[{type:'tool_result' as const,tool_use_id:'read',content:'Actual source evidence'}]
 assert.deepEqual(closeToolBatch([{id:'read'}],receipts),receipts)
 assert.deepEqual(closeToolBatch([],[]),[])
})
