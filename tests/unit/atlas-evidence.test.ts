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

import {readHostExecution,stableCandidate,readChallenge,readStageRun} from '../../src/shared/coding/evidence.ts'
test('host execution export strips unknown fields and rejects malformed receipts instead of inventing metadata',()=>{
 const proof={command:['npm','test'],commit:'a'.repeat(40),dirty:true,changedDuring:false,platform:'win32',startedAt:1,finishedAt:2,token:'private'}
 assert.deepEqual(readHostExecution(proof)?.command,['npm','test']);assert.ok(!('token' in readHostExecution(proof)!))
 for(const bad of [{...proof,command:'npm test'},{...proof,commit:'model said passed'},{...proof,finishedAt:0},{...proof,platform:'private-hostname'}])assert.equal(readHostExecution(bad),null)
})
test('new receipts require matching candidate bytes; challenge and metrics cannot turn unknown into success or zero',()=>{
 const ex={command:['node','test.mjs'],commit:'a'.repeat(40),dirty:true,changedDuring:false,platform:'win32',startedAt:1,finishedAt:2,candidate:{schema:1,before:'b'.repeat(64),after:'b'.repeat(64),files:3,node:'v24.18.1',worker:'1.33.0',key:'secret'}}
 assert.ok(stableCandidate(ex));assert.equal('key' in readHostExecution(ex)!.candidate!,false)
 for(const candidate of [undefined,{...ex.candidate,before:null},{...ex.candidate,after:'c'.repeat(64)}])assert.equal(stableCandidate({...ex,candidate}),false)
 assert.equal(stableCandidate({...ex,changedDuring:true}),false)
 assert.equal(readChallenge({state:'passed',code:0,ms:1,execution:null}),null)
 assert.equal(readChallenge({state:'not_configured',code:null,ms:0,execution:null})?.code,null)
 const metrics={executor:'local',requestedModel:null,startedAt:1,finishedAt:2,turns:null,costUsd:null,token:'secret'}
 assert.deepEqual(readStageRun(metrics),{executor:'local',requestedModel:null,startedAt:1,finishedAt:2,turns:null,costUsd:null})
 for(const x of [{...metrics,costUsd:-1},{...metrics,executor:'unknown-model'},{...metrics,finishedAt:0}])assert.equal(readStageRun(x),null)
})
