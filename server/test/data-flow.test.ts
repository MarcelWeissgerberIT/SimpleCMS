import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import { roots } from '../src/api/meta.ts'
import { inScope, redact } from '../src/agents/scope.ts'
import { runAgent } from '../src/agents/runner.ts'

test('server agents cannot expose restricted titles, including through all-scope relations',()=>{
  const d=new Y.Doc(),r=roots(d)
  for(const[id,parentId]of[['private',null],['child','private'],['public',null]] as const){const p=new Y.Map();p.set('kind','page');p.set('parentId',parentId);p.set('title',id);r.pages.set(id,p)}
  r.workspace.set('ai',{policy:{providers:{},restricted:[{root:'private',to:['local']}]}})
  const scope={everything:true,pages:[],databases:[]}
  assert.equal(inScope(r,scope,'child'),false)
  assert.equal(inScope(r,scope,'public'),true)
  assert.deepEqual(redact(r,scope,[{id:'child',title:'secret title'}]),[{id:'child',title:'(outside this agent’s scope)'}])
  d.destroy()
})
test('server runner stops before constructing a cloud request under local-only rules',async()=>{
  const d=new Y.Doc(),r=roots(d);r.workspace.set('ai',{dataFlow:{providers:['local']}})
  const result=await runAgent({wsId:'test',agent:{id:'test',name:'Test',write:'none',scope:{everything:true,pages:[],databases:[]},mcpServers:[],maxRunUsd:1},runtime:{claudeKey:'test-key-not-live',mcpServers:[]},model:{read:async(_:string,f:any)=>f(r)},signal:new AbortController().signal,s:{}} as any)
  assert.equal(result.status,'error')
  assert.match(result.error??'',/data-flow rule/)
  assert.equal(result.usage.usd,0)
  d.destroy()
})

test('server runner refuses excluded MCP origins before constructing a cloud request',async()=>{
  const d=new Y.Doc(),r=roots(d);r.workspace.set('ai',{dataFlow:{mcpOrigins:['https://allowed.invalid']}})
  const result=await runAgent({wsId:'test',agent:{id:'test',name:'Test',write:'none',scope:{everything:true,pages:[],databases:[]},mcpServers:['Atlas'],maxRunUsd:1},runtime:{claudeKey:'test-key-not-live',mcpServers:[{name:'Atlas',url:'https://blocked.invalid/mcp',token:'not-a-live-secret'}]},model:{read:async(_:string,f:any)=>f(r)},signal:new AbortController().signal,s:{}} as any)
  assert.equal(result.status,'error')
  assert.match(result.error??'',/MCP destination/)
  assert.equal(result.usage.usd,0)
  d.destroy()
})
