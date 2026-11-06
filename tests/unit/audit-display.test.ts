import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditResultFailed,auditPreview,AUDIT_PREVIEW_CHARS} from '../../src/shared/ai/audit-display.ts'
test('audit recognises structured refusals through actual MCP wrappers without interpreting source prose',()=>{
 for(const result of [{ok:false,error:'forbidden'},{isError:true},{oneNotExecuted:true},{result:JSON.stringify({content:[{type:'text',text:JSON.stringify({ok:false,error:'denied'})}]})}])assert.equal(auditResultFailed(result),true)
 assert.equal(auditResultFailed({result:JSON.stringify({ok:true,item:{body:'{"ok":false,"error":"document example"}'}})}),false)
 assert.equal(auditResultFailed({result:JSON.stringify({content:[{type:'text',text:JSON.stringify({items:[]})}]})}),false)
})
test('audit bounds DOM preview while preserving the full download source',()=>{
 const value={body:'ä'.repeat(2000000)},before=JSON.stringify(value),preview=auditPreview(value)
 assert.equal(preview.truncated,true);assert.equal(preview.text.length,AUDIT_PREVIEW_CHARS);assert.equal(JSON.stringify(value),before)
 assert.deepEqual(auditPreview('small'),{text:'small',truncated:false})
})
