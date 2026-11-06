import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fitNativeToolContext} from '../../src/shared/ai/native-context.ts'
import {McpResults} from '../../src/shared/mcp/results.ts'
test('many native Atlas answers fit while preserving human request, calls, thinking and source handles',()=>{
 const messages:any[]=[{role:'user',content:'Review the original source; preserve all decisions.'}]
 for(let i=0;i<30;i++){messages.push({role:'assistant',content:[{type:'thinking',thinking:'signed',signature:'sig'},{type:'tool_use',id:'call'+i,name:'atlas_get',input:{ref:i+1}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call'+i,content:JSON.stringify({result_id:'source'+i,oneObservedFacts:{refs:[i+1],effect:'read'},content:'x'.repeat(8000)})}]})}
 const fitted=fitNativeToolContext(messages,25000);assert(new TextEncoder().encode(JSON.stringify(fitted)).length<=25000)
 assert.deepEqual(fitted[0],messages[0]);assert.equal(messages[2].content[0].content.length>8000,true)
 for(let i=0;i<30;i++){assert.deepEqual(fitted[1+i*2],messages[1+i*2]);const result=JSON.parse((fitted[2+i*2]!.content as any)[0].content);assert.equal(result.result_id,'source'+i);assert.deepEqual(result.oneObservedFacts.refs,[i+1])}
})
test('earlier large source remains readable after more than eight Atlas calls',()=>{
 const cache=new McpResults(),first=JSON.parse(cache.pack(JSON.stringify({item:{ref:1,title:'First',body:'first source '.repeat(800)}})))
 for(let ref=2;ref<=35;ref++)cache.pack(JSON.stringify({item:{ref,title:'Other',body:'source '.repeat(1000)}}))
 assert(JSON.parse(cache.read({result_id:first.result_id,path:'/item/body'})).content.includes('first source'))
})

test('SDK continues a compacted round without replaying a completed tool',async()=>{
 const {default:Anthropic}=await import('@anthropic-ai/sdk')
 let requests=0,writes=0
 const packets:any[]=[]
 const client=new Anthropic({apiKey:'synthetic-test-key',maxRetries:0,fetch:async(_url,init)=>{
  packets.push(JSON.parse(String(init?.body)));requests++
  return new Response(JSON.stringify({id:'message'+requests,type:'message',role:'assistant',model:'test',content:requests===1?[{type:'tool_use',id:'write-1',name:'save',input:{ref:42}}]:[{type:'text',text:'Done'}],stop_reason:requests===1?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}}),{headers:{'content-type':'application/json'}})
 }})
 const runner=client.beta.messages.toolRunner({model:'test',max_tokens:100,messages:[{role:'user',content:'Save the prepared result once.'}],tools:[{name:'save',description:'Fixture write',input_schema:{type:'object'},run:async()=>{writes++;return JSON.stringify({oneObservedFacts:{refs:[42],outcome:'ok'},result_id:'saved-42',body:'x'.repeat(20000)})}}]})
 for await(const message of runner){if(message.stop_reason==='tool_use'){
  const receipt=await runner.generateToolResponse()
  const closed:any[]=[...runner.params.messages,{role:'assistant',content:message.content},receipt]
  runner.setMessagesParams(p=>({...p,messages:fitNativeToolContext(closed,4000)}))
 }}
 assert.equal(writes,1);assert.equal(requests,2)
 const results=packets[1].messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='tool_result'):[])
 assert.equal(results.length,1);assert.equal(results[0].tool_use_id,'write-1');assert.equal(JSON.parse(results[0].content).oneObservedFacts.outcome,'ok')
})
