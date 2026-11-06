import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {demoCopilot} from '../src/worker/demo-compare.ts'
const fixture=fileURLToPath(new URL('./fixtures/fake-copilot.mjs',import.meta.url))
test('demo comparison supports native auto, preserves nested JSON text and retains failed-request receipts',async()=>{
 const text=JSON.stringify({content:'synthetic source',findings:[]}),messages=[{role:'user' as const,content:'Return source JSON'}]
 const env={...process.env,COPILOT_BIN:fixture,COPILOT_ANSWERS:JSON.stringify([{content:text,tool_calls:[]}])}
 const r=await demoCopilot(messages,512,'auto',env)
 assert.equal(r.model,'auto');assert.equal(r.text,text);assert.equal(r.usd,null);assert.equal(r.copilotReceipt?.rounds,1)
 await assert.rejects(demoCopilot(messages,512,'auto',{...env,COPILOT_ANSWERS:JSON.stringify(['malformed JSON'])}),(e:any)=>{
  assert.equal(e.copilotReceipt.rounds,1);assert.match(e.message,/invalid/i);return true
 })
})
