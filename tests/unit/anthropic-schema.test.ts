import {test} from 'node:test'
import assert from 'node:assert/strict'
import {anthropicOutputSchema} from '../../src/shared/ai/anthropic-schema.ts'
import {validateValue} from '../../src/shared/quandprofile/program.ts'
test('Claude wire schema removes unsupported constraints recursively while original validation remains strict',()=>{
 const original={type:'object',properties:{maxItems:{type:'array',minItems:2,maxItems:3,items:{type:'object',properties:{value:{type:'string',enum:['accepted','rejected'],minLength:8,maxLength:10},score:{type:'number',minimum:0,maximum:1}},required:['value','score'],additionalProperties:false}}},required:['maxItems'],additionalProperties:false}
 const before=JSON.stringify(original),wire=anthropicOutputSchema(original) as any
 assert.equal(JSON.stringify(original),before);assert.ok(wire.properties.maxItems)
 assert.equal(wire.properties.maxItems.maxItems,undefined);assert.equal(wire.properties.maxItems.minItems,undefined)
 assert.match(wire.properties.maxItems.description,/'?maxItems"?:3/)
 assert.deepEqual(wire.properties.maxItems.items.properties.value.enum,['accepted','rejected'])
 assert.equal(wire.properties.maxItems.items.properties.value.minLength,undefined)
 assert.equal(wire.properties.maxItems.items.properties.score.maximum,undefined)
 assert.throws(()=>validateValue({maxItems:[{value:'accepted',score:0}]},original))
 assert.throws(()=>validateValue({maxItems:[{value:'accepted',score:2},{value:'accepted',score:0}]},original))
 validateValue({maxItems:[{value:'accepted',score:0},{value:'rejected',score:1}]},original)
})
test('Claude wire keeps supported minimum cardinality and exact enum/type definitions',()=>{
 const original={type:'object',properties:{values:{type:'array',minItems:1,maxItems:2,items:{type:['string','null'],enum:['yes',null]}}},required:['values'],additionalProperties:false}
 const wire=anthropicOutputSchema(original) as any
 assert.equal(wire.properties.values.minItems,1);assert.deepEqual(wire.properties.values.items,original.properties.values.items)
})
