import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkedMockDraft,MockDraftValidationError} from '../../src/shared/ai/mockCorrection.ts'
test('schema-invalid and truncated drafts enter exactly one correction with the failed draft',async()=>{
 for(const draft of [{tokens:[{quote:'short'}]},'{"title":']){
  let calls=0,notes=0
  assert.equal(await checkedMockDraft(async(input,error,repair)=>{if(!calls++)throw new MockDraftValidationError(draft,Error('invalid draft'));assert.deepEqual(input,draft);assert.match(String(error),/invalid draft/);assert.equal(repair,true);return 'valid'},x=>x,()=>notes++),'valid')
  assert.equal(calls,2);assert.equal(notes,1)
 }
})
test('compilation errors pass their complete draft to correction',async()=>{
 let calls=0;const bad={css:'invalid',html:'body'}
 assert.equal(await checkedMockDraft(async(input,error,repair)=>{calls++;if(!repair)return bad;assert.deepEqual(input,bad);assert.match(String(error),/CSS/);return {...bad,css:'valid'}},x=>{if(x.css==='invalid')throw Error('CSS');return x.css},()=>{}),'valid')
 assert.equal(calls,2)
})
test('provider failure is not retried and failed correction is final',async()=>{
 let calls=0
 await assert.rejects(checkedMockDraft(async()=>{calls++;throw Error('provider rejected')},x=>x,()=>assert.fail()),/provider rejected/);assert.equal(calls,1)
 calls=0
 await assert.rejects(checkedMockDraft(async()=>{calls++;throw new MockDraftValidationError('bad','still invalid')},x=>x,()=>{}),/still invalid/);assert.equal(calls,2)
})
