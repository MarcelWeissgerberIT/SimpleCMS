import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mcpArgumentFeedback} from '../../src/shared/mcp/argumentFeedback.ts'
test('reports screenshot arguments without rewriting or inventing repository identity',()=>{
 const schema={type:'object',properties:{repo:{type:'string'},snapshot:{type:'string'},query:{type:'string'}},required:['repo','snapshot','query'],additionalProperties:false}
 const args={version:'snapshot-id',query:'BlowoutVolume'}
 const feedback=mcpArgumentFeedback(schema,args)!
 assert.deepEqual(feedback.missing,['repo','snapshot']);assert.deepEqual(feedback.unexpected,['version'])
 assert.equal(feedback.inputSchema,schema);assert.deepEqual(args,{version:'snapshot-id',query:'BlowoutVolume'})
 assert.equal(mcpArgumentFeedback(schema,{repo:'repo-id',snapshot:'snapshot-id',query:'BlowoutVolume'}),null)
})
test('open and pattern maps are not mistaken for unsupported arguments',()=>{
 assert.equal(mcpArgumentFeedback({type:'object'}, {extension:1}),null)
 assert.equal(mcpArgumentFeedback({type:'object',additionalProperties:false,patternProperties:{'^x':{type:'string'}}},{xFoo:'value'}),null)
})
