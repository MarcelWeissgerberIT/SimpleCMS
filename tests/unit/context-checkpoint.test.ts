import {test} from 'node:test'
import assert from 'node:assert/strict'
import {contextCheckpoint} from '../../src/app/features/ai/agent/checkpoint.ts'
import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'
test('compact checkpoint preserves actual effect receipts and labels drafts as unverified historical data',()=>{
 const turn={n:1,answer:'Draft, not verified',contract:{evidence:{one_pages:['one-source'],atlas_records:['42']},questions:[{state:'answered',question:'Which record?',answer:'42'}]}}
 const steps=[{turn:1,kind:'mcp',state:'ok',arg:'Confirmed decision',mcp:{server:'knowledge',tool:'atlas_comment',receipt:{effect:'write_accepted',outcome:'ok',refs:[42],ids:['accepted-once'],verification:'not_checked'}}}]
 const value=JSON.parse(contextCheckpoint([turn] as any,steps as any,[]))
 assert.equal(value.kind,'historical_host_checkpoint');assert.equal(value.tools[0].receipt.ids[0],'accepted-once');assert.equal(value.unverifiedDraft,'Draft, not verified');assert(value.notice.includes('not current source evidence'))
 const bounds=taskBoundaries('Kommentiere die Entscheidung in Atlas.\nNur lesen. Keine externen Änderungen und keine Ausführung.')
 assert.equal(bounds.readOnly,true);assert.equal(bounds.externalWrite,false);assert.equal(bounds.execute,false)
})
test('large historical logs have explicit bounded omission instead of carrying source bodies forward',()=>{
 const turns=Array.from({length:100},(_,i)=>({n:i+1,answer:'x'.repeat(100000)}))
 const steps=Array.from({length:1000},(_,i)=>({turn:i%100+1,kind:'tool',tool:'read_page',state:'ok',arg:'x'.repeat(10000),result:'BODY_NOT_CARRIED'}))
 const text=contextCheckpoint(turns as any,steps as any,[]),value=JSON.parse(text)
 assert(value.earlierToolsOmitted);assert.equal(value.tools.length,24);assert(text.length<16000);assert(!text.includes('BODY_NOT_CARRIED'));assert.equal(value.unverifiedDraft.length,1800)
})

test('old accepted writes and answered decisions survive many later read tasks',()=>{
 const turns=Array.from({length:30},(_,i)=>({n:i,answer:'',contract:{evidence:{one_pages:[],atlas_records:[String(i)]},questions:i===0?[{state:'answered',question:'Destination?',answer:'Keep record 42'}]:[]}}))
 const steps=[{turn:0,kind:'mcp',state:'ok',mcp:{server:'Atlas',tool:'atlas_update',receipt:{effect:'write_accepted',outcome:'ok',refs:[42],ids:['original-write'],verification:'verified'}}},...Array.from({length:100},()=>({turn:29,kind:'tool',tool:'read_page',state:'ok'}))]
 const result=JSON.parse(contextCheckpoint(turns as any,steps as any,[]))
 assert.equal(result.effects[0].receipt.ids[0],'original-write')
 assert.equal(result.decisions[0].answer,'Keep record 42')
 assert(result.sources.some((s:any)=>s.id==='0'))
})
