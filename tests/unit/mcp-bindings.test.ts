import {test} from 'node:test'
import assert from 'node:assert/strict'
import {McpBindings, selectMcpSchemas} from '../../src/shared/mcp/bindings.ts'

test('a large exact Atlas schema is never silently dropped by the small model budget',()=>{
 const schema={type:'object',properties:{ref:{type:'number'},replaceBody:{type:'string',description:'Full replacement. '.repeat(600)}},required:['ref']}
 const tool={server:'atlas',name:'atlas_update',description:'Update the requested record only.',inputSchema:schema}
 const selected=selectMcpSchemas([tool],6000)
 assert.equal(selected.length,1);assert.deepEqual(selected[0]!.inputSchema,schema)
 const bindings=new McpBindings();bindings.expose(selected)
 assert.deepEqual(bindings.functions()[0]!.parameters,schema)
 const args={ref:123,replaceBody:'Requested text'}
 assert.deepEqual(bindings.resolve(bindings.functions()[0]!.name,args),{server:'atlas',name:'atlas_update',arguments:args})
 assert.throws(()=>bindings.resolve('atlas_update',args),/discovered/)
})
test('native bindings work for all families, keep identity stable and cannot invent access',()=>{
 const bindings=new McpBindings(),tool=(server:string,name:string)=>({server,name,description:name,inputSchema:{type:'object',properties:{action:{type:'string',enum:['list','get','create']}}}})
 const rows=['atlas_get','atlas_create','atlas_update','atlas_agent_create','atlas_agent_flow','atlas_flow_start','atlas_polarion_connect','atlas_polarion_prepare_change','atlas_polarion_apply_change'].map(name=>tool('own',name))
 for(const row of rows){bindings.expose([row]);const f=bindings.functions().find(f=>f.name===bindings.functionName(row.server,row.name))!;assert.deepEqual(bindings.resolve(f.name,{action:'list'}),{server:'own',name:row.name,arguments:{action:'list'}})}
 bindings.expose([tool('own','atlas_get')]);const first=bindings.functionName('own','atlas_get')!
 bindings.expose([tool('other','atlas_get')]);const second=bindings.functionName('other','atlas_get')!
 assert.notEqual(first,second);assert.equal(bindings.resolve(first,{}).server,'own')
 assert.throws(()=>bindings.resolve('one_remote_999',{}),/discovered/)
 bindings.expose([]);assert.ok(bindings.functions().length<=6)
})

test('schema budgets retain the best large match and bound the active native catalogue',()=>{
 const tools=Array.from({length:6},(_,i)=>({server:'a',name:'tool'+i,description:'x'.repeat(i===0?7000:1000),inputSchema:{type:'object'}}))
 const selected=selectMcpSchemas(tools,6000);assert.equal(selected.length,1)
 const bindings=new McpBindings();bindings.expose(selected);assert.equal(bindings.functions().length,1)
 assert.ok(!bindings.has('one_remote_2'))
})

test('a model cannot prove unavailable MCP tools with prose; actual tool errors remain separate',async()=>{
 const {unverifiedMcpDenial}=await import('../../src/shared/mcp/execution.ts')
 for(const answer of ['Atlas tools are not available.','Der Atlas-MCP ist nicht verbunden.','Kein Zugriff auf Atlas.','atlas_get ist nicht in der Liste der verfügbaren Werkzeuge enthalten.'])assert.equal(unverifiedMcpDenial(answer),true,answer)
 for(const answer of ['Atlas returned record 123.','No entries were returned by Atlas.','No hardware available.'])assert.equal(unverifiedMcpDenial(answer),false,answer)
})

test('several discoveries in one model batch keep every selected native schema for the following round',()=>{
 const bindings=new McpBindings()
 for(const name of ['atlas_get','atlas_update','atlas_query'])bindings.expose([{server:'atlas',name,description:name,inputSchema:{type:'object',properties:{ref:{type:'number'}}}}])
 assert.equal(bindings.functions().length,3)
 for(const name of ['atlas_get','atlas_update','atlas_query'])assert.ok(bindings.functions().some(f=>f.name===bindings.functionName('atlas',name)))
})

test('native and wrapper aliases cannot replay the same mutation, including reordered fields',()=>{
 const bindings=new McpBindings();bindings.expose([{server:'atlas',name:'atlas_update',inputSchema:{type:'object'}}])
 const native=bindings.functionName('atlas','atlas_update')!
 const key=bindings.callKey(native,{ref:123,fields:{a:1,b:2}})
 assert.equal(key,bindings.callKey('one_mcp_call',{server:'atlas',name:'atlas_update',arguments:{fields:{b:2,a:1},ref:123}}))
 assert.notEqual(key,bindings.callKey(native,{ref:124,fields:{a:1,b:2}}))
})

test('shared wire limits negotiate with each host and keep old hosts at their original bound',async()=>{
 const {sharedInputMax}=await import('../../src/shared/ai/shared-model.ts')
 assert.equal(sharedInputMax(),22000);assert.equal(sharedInputMax(36000),36000);assert.equal(sharedInputMax(99999),36000);assert.equal(sharedInputMax(-1),22000)
})
