import {test} from 'node:test'
import assert from 'node:assert/strict'
import {retryMcpRead,mcpRateDelay} from '../../src/shared/mcp/readRetry.ts'
const limited={result:JSON.stringify({isError:true,content:[{type:'text',text:'Rate limit — too many AQL queries, retry in 43s.'}]})}
test('read retries a refused rate limit and retains successful results',async()=>{
 let calls=0;const waits:number[]=[]
 const result=await retryMcpRead(async()=>++calls===1?limited:{result:'success'},{read:true,wait:async ms=>{waits.push(ms)}})
 assert.equal(result.result,'success');assert.deepEqual(waits,[43000]);assert.equal(calls,2)
})
test('writes and unrelated failures are never automatically repeated',async()=>{
 let calls=0;await retryMcpRead(async()=>{calls++;return limited},{read:false});assert.equal(calls,1)
 await assert.rejects(()=>retryMcpRead(async()=>{throw Error('Unauthorized')},{read:true}))
 assert.equal(mcpRateDelay({result:JSON.stringify({item:{body:'Rate limit — retry in 43s.'}})}),null)
})
test('retry waits have a total bound and remain cancellable',async()=>{
 let calls=0;await retryMcpRead(async()=>{calls++;return limited},{read:true,wait:async()=>{}});assert.equal(calls,9)
 const c=new AbortController();await assert.rejects(()=>retryMcpRead(async()=>limited,{read:true,signal:c.signal,wait:async()=>{c.abort()}}))
})

test('long rate-limit waits obey the ten-minute total budget',async()=>{
 let calls=0;const waits:number[]=[]
 await retryMcpRead(async()=>{calls++;return {status:429,retryAfter:120}},{read:true,wait:async ms=>{waits.push(ms)}})
 assert.equal(calls,6);assert.equal(waits.reduce((a,b)=>a+b,0),600000)
 assert.equal(mcpRateDelay({status:429,retryAfter:121}),null)
})
