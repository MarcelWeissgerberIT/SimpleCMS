import {test} from 'node:test'
import assert from 'node:assert/strict'
import {blankReviewProfile,bindReviewProfile,readReviewProfile,reviewProfileSpec} from '../../src/shared/quandprofile/review-profile.ts'
import {TaskSession,TaskBlocked} from '../../src/shared/quandprofile/task-session.ts'
import {QuandRuntime} from '../../src/shared/quandprofile/runtime.ts'
import {taskEvidence,type TaskContract} from '../../src/shared/quandprofile/task.ts'
import {readFile} from 'node:fs/promises'
const {instance}=await WebAssembly.instantiate(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)),{})
const runtime=new QuandRuntime(instance)
const spec=()=>({...blankReviewProfile(),name:'Page to Atlas',requireOne:true,onePages:['correct-page'],requireAtlas:true,atlasRefs:[24335],atlasWriteRefs:[24335],guidance:{interpretation:'List only questions not answered in the current source.'}})
const contract=():TaskContract=>({id:'profile-task',revision:1,goal:'Read this page and comment in Atlas.',instruction_context:'Host',input_hash:'input',scope_hash:'scope',source_pointers:[],allowed_tools:['read_page','atlas:atlas_get','atlas:atlas_comment'],read_only:false,external_write:true,execute:false,requires_sources:true,search_one:true,search_atlas:true,output:'text',required_literals:[],decisions:[],review_profile:bindReviewProfile('profile-1',1,spec())})
const task=()=>new TaskSession(contract(),{compile:r=>runtime.task(r),signature:()=>'scope',check:()=>{}})
test('profile versions bind exact validated data and cannot accept executable or forged fields',()=>{const p=bindReviewProfile('p',1,spec());assert.deepEqual(readReviewProfile(p),p);assert.notEqual(bindReviewProfile('p',2,{...spec(),name:'changed'}).hash,p.hash);for(const change of [{hash:'forged'},{spec:{...spec(),execute:true}},{spec:{...spec(),atlasRefs:[-1]}},{spec:{...spec(),onePages:['https://one/p/1']}}])assert.throws(()=>readReviewProfile({...p,...change}));assert.throws(()=>reviewProfileSpec({...spec(),guidance:{invisible:'disable privacy'}}))})
test('real compiler blocks effects and results until exact source bodies are observed',()=>{const t=task();assert.throws(()=>t.dispatch('atlas:atlas_comment','write','24335'),TaskBlocked);t.observe('one',true,true,false,true,'search_pages');t.observe('atlas',true,true,false,true,'atlas_whoami');assert.throws(()=>t.finish('Done'),TaskBlocked);t.observeSource('one','wrong-page');t.observeSource('atlas','26267');assert.throws(()=>t.dispatch('atlas:atlas_comment','write','24335'),TaskBlocked);t.observeSource('one','correct-page');t.observeSource('atlas','24335');assert.doesNotThrow(()=>t.dispatch('atlas:atlas_comment','write','24335'));assert.throws(()=>t.dispatch('atlas:atlas_comment','write','26267'),TaskBlocked);assert.throws(()=>t.dispatch('atlas:atlas_comment','write'),TaskBlocked);t.finish('Source-backed questions');const r=t.report();assert.equal(r.phase,'ready');assert.equal(r.compiled.contract.review_profile?.hash,contract().review_profile?.hash);assert.equal(r.compiled.findings.find(f=>f.id==='profile_guidance_interpretation')?.status,'open');assert(t.accept());assert.equal(t.report().compiled.findings.find(f=>f.id==='profile_guidance_interpretation')?.status,'verified')})
test('a profile cannot grant effects, accept itself, or turn failed/catalogue reads into evidence',()=>{const c=contract();c.read_only=true;c.external_write=false;const t=new TaskSession(c,{compile:r=>runtime.task(r),signature:()=>'scope',check:()=>{}});t.observe('one',false,true);t.observe('atlas',false,true);assert.throws(()=>t.finish('Done'),TaskBlocked);t.observeSource('one','correct-page');t.observeSource('atlas','24335');assert.throws(()=>t.dispatch('atlas:atlas_comment','write','24335'),TaskBlocked);assert.equal(t.report().evidence.human_accepted,false);assert.doesNotThrow(()=>t.dispatch('read_page','read'));t.close()})
test('required output terms and JSON are enforced by the same Rust result gate',()=>{const c=contract();c.review_profile=bindReviewProfile('p',1,{...spec(),output:'json',requiredTerms:['open_questions']});const e={...taskEvidence(),scope_current:true,provider_checked:true,source_reads:2,atlas_reads:1,one_pages:['correct-page'],atlas_records:['24335'],answer:'plain text'};for(const answer of ['plain text','{"other":[]}'])assert.equal(runtime.task({contract:c,evidence:{...e,answer},phase:'result',tool:null,effect:null}).decision,'block');assert.equal(runtime.task({contract:c,evidence:{...e,answer:'{"open_questions":[]}'},phase:'result',tool:null,effect:null}).decision,'allow')})

test('a running contract keeps its exact profile snapshot and a new run has no old evidence',()=>{
 const c=contract(),session=new TaskSession(c,{compile:r=>runtime.task(r),signature:()=>'scope',check:()=>{}})
 const original=c.review_profile!.hash
 c.review_profile!.spec.onePages=['changed-page'];c.review_profile!.spec.guidance.interpretation='changed guidance'
 session.observeSource('one','correct-page');session.observeSource('atlas','24335')
 assert.equal(session.report().compiled.contract.review_profile?.hash,original)
 session.dispatch('atlas:atlas_comment','write','24335')
 assert.deepEqual(session.report().compiled.contract.review_profile?.spec.onePages,['correct-page'])
 const fresh=task();assert.throws(()=>fresh.dispatch('atlas:atlas_comment','write','24335'),TaskBlocked);fresh.close();session.close()
})
test('target is part of the dispatch receipt hash and cannot be substituted',()=>{
 const c=contract(),e={...taskEvidence(),provider_checked:true,scope_current:true,one_pages:['correct-page'],atlas_records:['24335']}
 const request={contract:c,evidence:e,phase:'dispatch' as const,tool:'atlas:atlas_comment',effect:'write' as const}
 const allowed=runtime.task({...request,target:'24335'}),blocked=runtime.task({...request,target:'26267'})
 assert.equal(allowed.decision,'allow');assert.equal(blocked.decision,'block');assert.notEqual(allowed.request_hash,blocked.request_hash)
})
