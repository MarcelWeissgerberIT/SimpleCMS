import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explicitMockSources} from '../../src/shared/ai/mockPlan.ts'
test('fixed mock plan accepts only explicit trusted record refs, preserves target and deduplicates',()=>{assert.deepEqual(explicitMockSources('/mock Dialog für Atlas-Record 32155, ref 32155, ref 1174 und ref 1179.'),{target:32155,refs:[32155,1174,1179]});for(const p of ['Create a mock ref 1 ref 2 ref 3','/mock Make a nice dialog','/mock Atlas-Record 1 ref 2','/mock Atlas-Record 0 ref 2 ref 3','/mock Atlas-Record 1 ref 2 ref 3 ref 4 ref 5 ref 6 ref 7'])assert.equal(explicitMockSources(p),null)})
