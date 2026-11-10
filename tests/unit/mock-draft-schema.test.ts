import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mockDraftSchema} from '../../src/shared/ai/mockDraftSchema.ts'
import {MOCK_SCHEMA} from '../../src/shared/ai/designMock.ts'
import {anthropicOutputSchema} from '../../src/shared/ai/anthropic-schema.ts'
import {validateValue} from '../../src/shared/quandprofile/program.ts'
const ids=Array.from({length:18},(_,i)=>'design-source-test-'+(i+1))
test('catalogue display names survive initial and correction schemas without identifier conversion',()=>{
 const schema=mockDraftSchema(ids,ids[0]!,null)
 for(const name of ['Progress Indicator','Button','DataTable_C12','État / progression (v2)','Zahl & Größe','A']){
  for(const candidate of [MOCK_SCHEMA,schema])validateValue(name,candidate.properties.components.items.properties.name)
 }
 for(const name of ['', ' Progress Indicator','Progress Indicator ', 'Progress\nIndicator','Progress\tIndicator','Progress\u0000Indicator','x'.repeat(161)]){
  assert.throws(()=>validateValue(name,schema.properties.components.items.properties.name),name)
 }
})
test('Epic draft keeps the selected root pinned independently of child citations',()=>{
 const before=JSON.stringify(MOCK_SCHEMA),schema=mockDraftSchema(ids,ids[0]!,null)
 assert.deepEqual(schema.properties.design.properties.source.enum,[ids[0]])
 for(const field of ['tokens','components'])assert.deepEqual(schema.properties[field].items.properties.source.enum,ids)
 assert.throws(()=>validateValue({source:ids[1],quote:'An actual source quote'},schema.properties.design))
 validateValue({source:ids[0],quote:'An actual source quote'},schema.properties.design)
 assert.equal(JSON.stringify(MOCK_SCHEMA),before)
 assert.deepEqual(mockDraftSchema(['new-source'],'new-source',null).properties.design.properties.source.enum,['new-source'])
})
test('free mock has an unambiguous null target on the Claude wire and still rejects requirements locally',()=>{
 const schema=mockDraftSchema(ids,ids[0]!,null),wire=anthropicOutputSchema(schema) as any
 assert.deepEqual(wire.properties.target,{type:'null'})
 validateValue(null,schema.properties.target)
 assert.throws(()=>validateValue(ids[1],schema.properties.target))
 validateValue([],schema.properties.requirements)
 assert.throws(()=>validateValue([{source:ids[1],quote:'An actual source quote'}],schema.properties.requirements))
})
test('a supplied requirement remains pinned and discovery permits only read source IDs or null',()=>{
 const selected=mockDraftSchema(ids,ids[0]!,ids[17]!)
 assert.deepEqual(selected.properties.target,{type:'string',enum:[ids[17]]})
 const discovery=mockDraftSchema(ids,null,null),wire=anthropicOutputSchema(discovery) as any
 for(const value of [null,...ids]){validateValue(value,discovery.properties.target);validateValue(value,wire.properties.target)}
 assert.throws(()=>validateValue('unread',wire.properties.target))
 assert.equal(wire.properties.target.type,undefined)
 assert.deepEqual(wire.properties.target.anyOf,[{type:'string',enum:ids},{type:'null',enum:[null]}])
})
