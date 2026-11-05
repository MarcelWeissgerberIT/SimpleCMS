import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explicitMockSources} from '../../src/shared/ai/mockPlan.ts'
test('fixed mock plan accepts only explicit trusted record refs, preserves target and deduplicates',()=>{assert.deepEqual(explicitMockSources('/mock Dialog für Atlas-Record 32155, ref 32155, ref 1174 und ref 1179.'),{target:32155,refs:[32155,1174,1179]});for(const p of ['Create a mock ref 1 ref 2 ref 3','/mock Make a nice dialog','/mock Atlas-Record 1 ref 2','/mock Atlas-Record 0 ref 2 ref 3','/mock Atlas-Record 1 ref 2 ref 3 ref 4 ref 5 ref 6 ref 7'])assert.equal(explicitMockSources(p),null)})

test('block request resolves the explicitly selected MD with no requirement record',()=>{
 const p=explicitMockSources('/mock Head selector\n\nAtlas design source: https://aj-atlas.com/docs/flux-client/atlas-ui-instructions')!
 assert.deepEqual(p.design?.address,{project:'flux-client',slug:'atlas-ui-instructions'});assert.equal(p.target,null);assert.equal(p.requirement,undefined)
 const q=explicitMockSources('/mock Head selector\nAtlas design source: https://aj-atlas.com/r/12\nAtlas requirement record: #14')!
 assert.deepEqual(q.design?.address,{ref:12});assert.deepEqual(q.requirement,{ref:14})
 assert.equal(explicitMockSources('/mock Head selector\nAtlas design source: https://aj-atlas.com/r/12\nAtlas requirement record: no-record'),null)
})


test('Epic delivery is explicit and never overrides preview-only intent',()=>{
 const input='/mock Create a new use case\nAtlas design epic: https://aj-atlas.com/r/38972\nAtlas mock delivery: epic'
 assert.equal(explicitMockSources(input)?.saveToEpic,true)
 assert.equal(explicitMockSources(input.replace('Create a new use case','Nur Vorschau, nicht speichern'))?.saveToEpic,undefined)
 assert.equal(explicitMockSources(input.replace('\nAtlas mock delivery: epic',''))?.saveToEpic,undefined)
})
