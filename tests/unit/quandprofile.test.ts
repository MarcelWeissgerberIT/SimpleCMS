import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {QuandRuntime,providerSnapshot,stateHash,compactQuantumProof} from '../../src/shared/quandprofile/runtime.ts'
import {inspectQuantumProof} from '../../src/shared/quandprofile/inspection.ts'
import {modelAtlasReceipt} from '../../src/shared/mcp/facts.ts'
import {allowedFor,DATA_CLASSES} from '../../src/shared/ai/policy.ts'
import {PROVIDER_ORDER} from '../../src/shared/ai/providers.ts'
const {instance}=await WebAssembly.instantiate(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)),{})
const runtime=new QuandRuntime(instance)
const scope={workspace:'synthetic-one',target:'request',actor:'synthetic-user',state_revision:'r1',operation_digest:'op1'}
const provider=(p:string,classes:string[],ws?:any,device?:any)=>({gate:'one_provider' as const,scope,snapshot:providerSnapshot(p,classes,ws,device)})
const allowed=(r:ReturnType<typeof provider>)=>{try{runtime.check(r);return true}catch{return false}}
test('actual WASM matches all 416 current ONE class-policy cases, including Copilot',()=>{
 let compared=0
 for(const p of PROVIDER_ORDER){const cases=[
  [undefined,undefined],
  [{policy:{providers:{[p]:{allow:['page','selection'],forbid:['mail']}}}},undefined],
  [undefined,{allow:{[p]:['mail']},narrow:{[p]:['page','memory']}}],
  [{policy:{providers:{[p]:{allow:['private','mail'],forbid:['mail']}}}},{allow:{[p]:['private','mail']}}],
 ];for(const [ws,device] of cases)for(const cls of DATA_CLASSES){assert.equal(allowed(provider(p,[cls],ws,device)),allowedFor(p,cls,ws,device),p+'/'+cls);compared++}}
 assert.equal(compared,416)
})
test('all providers obey destination restrictions even with otherwise permitted classes',()=>{
 for(const p of PROVIDER_ORDER){const ws={dataFlow:{providers:[]},policy:{providers:{[p]:{allow:['page']}}}};assert.equal(allowed(provider(p,['page'],ws)),false,p)}
 assert.equal(allowed(provider('unknown',['public'])),false)
})
test('fresh policy, actor, state and concrete action change evidence; no imported permit API',()=>{
 const a=provider('anthropic',['page']);const first=runtime.check(a)
 assert.notEqual(runtime.check({...a,scope:{...scope,actor:'other'}}).profileHash,first.profileHash)
 assert.notEqual(runtime.check({...a,scope:{...scope,operation_digest:stateHash({body:'changed'})}}).operationHash,first.operationHash)
 assert.throws(()=>runtime.check({...a,snapshot:{...a.snapshot,device_narrow:['page']}}))
 assert.doesNotMatch(JSON.stringify(compactQuantumProof(first)),/synthetic-user|synthetic-one/)
})
test('MCP writes require selected tool, allowed origin and an observed target',()=>{
 const r={gate:'one_mcp' as const,scope,snapshot:{origin:'https://atlas.example',allowed_origins:['https://atlas.example'],tool:'atlas_update',allowed_tools:['atlas_update'],denied_tools:[],target_ref:42,observed_refs:[] as number[]}}
 assert.throws(()=>runtime.check(r));r.snapshot.observed_refs=[42];assert.equal(runtime.check(r).status,'verified')
 assert.throws(()=>runtime.check({...r,snapshot:{...r.snapshot,allowed_origins:[]}}))
 assert.throws(()=>runtime.check({...r,snapshot:{...r.snapshot,denied_tools:['atlas_update']}}))
 assert.throws(()=>runtime.check({...r,snapshot:{...r.snapshot,target_ref:43}}))
})
test('Atlas review verifier accepts current linked approval and refuses a changed head',()=>{
 const r={gate:'atlas_review' as const,scope,snapshot:{head_sha:'abc',linked_reviews:[{verdict:'approve',commit_sha:'abc'}]}}
 assert.equal(runtime.check(r).status,'verified')
 assert.throws(()=>runtime.check({...r,snapshot:{...r.snapshot,head_sha:'def'}}))
})
test('WASM has no host imports and bounded inputs cannot trigger arbitrary host actions',async()=>{
 const module=await WebAssembly.compile(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)))
 assert.deepEqual(WebAssembly.Module.imports(module),[])
 assert.throws(()=>runtime.check(provider('anthropic',['x'.repeat(270000)])),/limit/)
 assert.throws(()=>runtime.check({...provider('anthropic',['page']),gate:'shell' as any}))
})
test('recorded compiler evidence preserves actual dimension findings, snapshots and hashes across serialization',()=>{
 const r={gate:'one_mcp' as const,scope,snapshot:{origin:'https://atlas.example',allowed_origins:['https://atlas.example'],tool:'atlas_update',allowed_tools:['atlas_update'],denied_tools:[],target_ref:42,observed_refs:[42]}}
 const proof=runtime.check(r),saved=JSON.parse(JSON.stringify(proof)),view=inspectQuantumProof(saved)
 assert.equal(view.kind,'detailed');assert.ok(view.inspection)
 assert.deepEqual(view.inspection.result.quanta[0].dimensions,['permission','provenance'])
 assert.equal(view.inspection.result.quanta[0].id,proof.quantumIds[0])
 assert.equal(view.inspection.result.request_digest,proof.requestHash)
 assert.deepEqual(view.inspection.request.snapshot,r.snapshot)
 r.snapshot.observed_refs.push(99)
 assert.deepEqual(view.inspection.request.snapshot.observed_refs,[42])
 const receipt=modelAtlasReceipt({tool:'atlas_update',effect:'write_accepted',outcome:'ok',refs:[42],ids:[],counts:[],quantum:proof})
 assert.equal(receipt.quantum?.inspection,undefined)
 assert.doesNotMatch(JSON.stringify(receipt),/synthetic-user|synthetic-one|allowed_origins/)
})
test('historical compact receipts remain partial and mismatched detail never becomes confirmed evidence',()=>{
 const proof=runtime.check(provider('anthropic',['page']))
 assert.equal(inspectQuantumProof(compactQuantumProof(proof)).kind,'legacy')
 assert.equal(inspectQuantumProof({...proof,profileHash:'changed'}).kind,'mismatch')
 assert.equal(inspectQuantumProof({...proof,quantumIds:['different']} ).kind,'mismatch')
 assert.equal(inspectQuantumProof({...proof,inspection:{} as any}).kind,'mismatch')
 assert.deepEqual(proof.inspection?.result.quanta[0].dimensions,['permission','privacy'])
})
