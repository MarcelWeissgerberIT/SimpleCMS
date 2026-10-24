import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readDataFlow, modelDestinationAllowed, mcpDestinationAllowed, pageDestinationAllowed, sourceDestinationsAllowed, sensitiveHints, inferencePlace, providersForSources } from '../../src/shared/ai/dataFlow.ts'
import { requiredGen, sanitizeWorkspaceAI, policyKnown, allowedFor, loosens } from '../../src/shared/ai/policy.ts'
import { GEN } from '../../src/shared/ai/generations.ts'

test('no explicit rule adds no destination restriction; inference and hints never set policy',()=>{
  assert.equal(modelDestinationAllowed('copilot'),true)
  assert.equal(mcpDestinationAllowed('https://example.org/mcp'),true)
  const text='CONFIDENTIAL — internal protocol structure'
  assert.deepEqual(sensitiveHints(text),['confidential'])
  assert.equal(requiredGen({dataFlow:{hints:'quiet'}}),1)
  assert.equal(modelDestinationAllowed('anthropic',{hints:'quiet'}),true)
  assert.deepEqual(sensitiveHints('Workshop-Protokoll: interne Aufgaben besprechen. Public API documentation.'),[])
})
test('explicit local-only includes no cloud provider; empty and malformed lists close destinations',()=>{
  const flow=readDataFlow({providers:['local','local','unknown'],mcpOrigins:['https://atlas.example/mcp?token=not-stored','nonsense']})!
  assert.deepEqual(flow,{providers:['local'],mcpOrigins:['https://atlas.example']})
  for(const p of ['anthropic','copilot','codex','ollama','minimax','openrouter','openai'] as const)assert.equal(modelDestinationAllowed(p,flow),false)
  assert.equal(modelDestinationAllowed('local',flow),true)
  assert.equal(modelDestinationAllowed('local',readDataFlow({providers:'local'})),false)
  for(const malformed of [null, false, 'local', []]) {
    assert.equal(modelDestinationAllowed('local',readDataFlow(malformed)),false)
    assert.equal(mcpDestinationAllowed('https://atlas.example',readDataFlow(malformed)),false)
  }
  assert.equal(mcpDestinationAllowed('https://atlas.example/mcp',flow),true)
  assert.equal(mcpDestinationAllowed('https://atlas.example.evil/mcp',flow),false)
  assert.equal(mcpDestinationAllowed('http://atlas.example/mcp',flow),false)
  assert.equal(mcpDestinationAllowed('https://atlas.example:444/mcp',flow),false)
  assert.equal(mcpDestinationAllowed('https://user:secret@atlas.example/mcp',flow),false)
  assert.equal(mcpDestinationAllowed('https://atlas.example',readDataFlow({mcpOrigins:[]})),false)
})
const world={pages:{root:{parentId:null},child:{parentId:'root'},other:{parentId:null},copy:{parentId:null,content:{type:'doc',content:[{type:'syncedBlock',attrs:{sourcePageId:'child'}}]}},loop:{parentId:'loop'}}}
const restrictions=[{root:'root',to:['local' as const]},{root:'child',to:['local' as const,'anthropic' as const]}]
test('page/task subtree and synced-copy boundaries intersect; a child and a selection cannot loosen them',()=>{
  assert.equal(pageDestinationAllowed('anthropic','child',world,restrictions),false)
  assert.equal(pageDestinationAllowed('local','child',world,restrictions),true)
  assert.equal(pageDestinationAllowed('anthropic','other',world,restrictions),true)
  assert.equal(pageDestinationAllowed('anthropic','copy',world,restrictions),false)
  assert.equal(pageDestinationAllowed('local','loop',world,restrictions),false)
  assert.equal(sourceDestinationsAllowed('copilot',[{page:'child',as:'selection'}],world,restrictions),false)
  assert.deepEqual(providersForSources(undefined,[{row:'child'},{page:'other'}],world,restrictions),['local'])
})
test('explicit limits survive round-trip, block provider classes and invalidate old clients',()=>{
  const ai=sanitizeWorkspaceAI({dataFlow:{providers:['local'],mcpOrigins:[]},policy:{providers:{},restricted:restrictions}})!
  assert.equal(requiredGen(ai),GEN.dataFlow)
  assert.equal(policyKnown({...ai,gen:requiredGen(ai)},null,GEN.copilot),false)
  assert.equal(allowedFor('anthropic','page',ai),false)
  assert.equal(allowedFor('anthropic','mcp',ai),false)
  assert.ok(loosens(ai,undefined).length>0)
  assert.equal(inferencePlace('local','one-shared/demo'),'shared-local')
  assert.equal(inferencePlace('local','qwen'),'local-worker')
  assert.equal(inferencePlace('ollama'),'cloud')
})
