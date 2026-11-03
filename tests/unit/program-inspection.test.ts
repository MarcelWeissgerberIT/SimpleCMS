import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {QuandRuntime} from '../../src/shared/quandprofile/runtime.ts'
import {taskEvidence,type TaskContract,type TaskReport} from '../../src/shared/quandprofile/task.ts'
import {captureProgramInspection,readProgramInspection} from '../../src/shared/quandprofile/program-inspection.ts'
const {instance}=await WebAssembly.instantiate(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)),{})
const runtime=new QuandRuntime(instance)
const contract:TaskContract={id:'private-task',revision:1,goal:'Read one source',instruction_context:'Source-bound briefing',input_hash:'input',scope_hash:'scope',source_pointers:[],allowed_tools:['read_page'],read_only:true,external_write:false,execute:false,requires_sources:true,search_one:true,search_atlas:false,output:'text',required_literals:[],decisions:[]}
function report():TaskReport{const evidence={...taskEvidence(),source_reads:1,one_pages:['source-page'],one_checked:true,provider_checked:true,answer:'Source-backed briefing.'};return{id:contract.id,at:Date.now(),phase:'ready',compiled:runtime.task({contract,evidence,phase:'result',tool:null,effect:null}),observations:[{area:'one',tool:'read_page',success:true,at:Date.now()}],questions:[],evidence}}
test('the actual Rust task output can be archived with its exact packet and current evidence statuses',()=>{
 const r=report(),saved=captureProgramInspection(r);assert.equal(saved.contractHash,r.compiled.contract_hash);assert.deepEqual(saved.findings,r.compiled.findings);assert.deepEqual(saved.quanta,r.compiled.quanta);assert.deepEqual(saved.packet,r.compiled.model_context);assert.deepEqual(saved.sources.one,['source-page']);assert.equal(saved.packetOmitted,false);assert.equal(saved.findings.find(f=>f.id==='task_human_acceptance')?.status,'open')
})
test('mismatched packets, unknown fields, fabricated quantum statuses and missing-packet claims fail validation',()=>{
 const good=captureProgramInspection(report());assert.throws(()=>readProgramInspection({...good,packet:{changed:true}}));assert.throws(()=>readProgramInspection({...good,approved:true}));assert.throws(()=>readProgramInspection({...good,packet:undefined,packetOmitted:false}));assert.throws(()=>readProgramInspection({...good,quanta:[{...good.quanta[0],result:'violated'}]}))
})
test('oversized compiler packets retain a digest without pretending to contain the full packet',()=>{
 const r=report();r.compiled.model_context={source:'x'.repeat(121000)};const saved=captureProgramInspection(r);assert.equal(saved.packetOmitted,true);assert.equal(saved.packet,undefined);assert.match(saved.packetHash,/^[a-f0-9]{64}$/)
})
