import {test} from 'node:test'
import assert from 'node:assert/strict'
import {atlasEvidenceProof,evidenceMarker,readHandoff} from '../../src/shared/coding/evidence.ts'
const evidence='a'.repeat(64),expected={ref:123,project:'one-webserver',evidence}
const item={ref:123,project:'one-webserver',content:'Test exit 0\n'+evidenceMarker(evidence)}
test('Atlas readback confirms only exact record, project and a marker in body; errors, echo and other targets fail',()=>{
 assert.ok(atlasEvidenceProof({result:JSON.stringify({item})},expected))
 assert.ok(atlasEvidenceProof([{type:'text',text:JSON.stringify({item})}],expected))
 for(const raw of [{isError:true,item},{content:[{type:'text',text:'failed'}]},{item:{...item,project:'other'}},{item:{...item,ref:124}},{item:{...item,content:'model said success'}},{item:{ref:123,project:'one-webserver',metadata:{content:evidenceMarker(evidence)}}},'not JSON'])assert.equal(atlasEvidenceProof(raw,expected),false)
})
test('handoff reader strips extra fields, rejects tokens in URLs and preserves bounded stages',()=>{
 const h={run:'run-1',state:'confirmed',at:1,server:'atlas',ref:123,project:'one-webserver',evidence,url:'https://aj-atlas.com/r/123',token:'private'}
 assert.ok(readHandoff(h));assert.equal('token' in readHandoff(h)!,false)
 assert.equal(readHandoff({...h,url:h.url+'?token=private'}),null)
 assert.equal(readHandoff({...h,url:'https://other.test/r/123'}),null)
 assert.equal(readHandoff({...h,project:'bad project'}),null)
 assert.equal(readHandoff({...h,evidence:'wrong'}),null)
})

import {readHostExecution} from '../../src/shared/coding/evidence.ts'
test('host execution export strips unknown fields and rejects malformed receipts instead of inventing metadata',()=>{
 const proof={command:['npm','test'],commit:'a'.repeat(40),dirty:true,changedDuring:false,platform:'win32',startedAt:1,finishedAt:2,token:'private'}
 assert.deepEqual(readHostExecution(proof)?.command,['npm','test']);assert.ok(!('token' in readHostExecution(proof)!))
 for(const bad of [{...proof,command:'npm test'},{...proof,commit:'model said passed'},{...proof,finishedAt:0},{...proof,platform:'private-hostname'}])assert.equal(readHostExecution(bad),null)
})
