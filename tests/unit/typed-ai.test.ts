import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {typedTemplate,typedAI,resolveTypedAI,parseTagChain,typedShadow,verifyTypedSource,sourceKey,typedSourceState,shadowFromBody,type TypedSource} from '../../src/shared/quandprofile/typed-ai.ts'
import {bindReviewProfile,blankReviewProfile,readReviewProfile} from '../../src/shared/quandprofile/review-profile.ts'
import {TaskSession,TaskBlocked} from '../../src/shared/quandprofile/task-session.ts'
import {QuandRuntime} from '../../src/shared/quandprofile/runtime.ts'
import {taskEvidence,type TaskContract} from '../../src/shared/quandprofile/task.ts'
import {sha256Hex} from '../../src/shared/mcp/sha256.ts'
import {compileProgram,readProgram,draftWorkflow} from '../../src/shared/quandprofile/program.ts'
const {instance}=await WebAssembly.instantiate(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)),{})
const runtime=new QuandRuntime(instance)
const spec=()=>typedTemplate('ba')
const contract=(typed=spec()):TaskContract=>({id:'typed-task',revision:1,goal:'Analyse source requirements.',instruction_context:'Host',input_hash:'input',scope_hash:'scope',source_pointers:[],allowed_tools:['read_page','atlas:atlas_get','atlas:atlas_create'],read_only:false,external_write:true,execute:true,requires_sources:false,search_one:true,search_atlas:false,output:'text',required_literals:[],decisions:[],review_profile:bindReviewProfile('typed-profile',1,{...blankReviewProfile(),name:'Typed work',beforeEffects:false,typedAI:typed})})
const check=(c:TaskContract,e={...taskEvidence(),provider_checked:true},phase='compile',tool:string|null=null,effect:string|null=null)=>runtime.task({contract:c,evidence:e,phase,tool,effect}as any)
const source=():TypedSource=>({kind:'rule',server:'atlas',origin:'https://atlas.example.org',tenant:'aj',project:'flux',ref:42,stateHash:typedSourceState({ref:42,project:'flux',tenant:'aj'}),hash:sha256Hex('Design V5 is the current applicable catalogue.'),quote:'Design V5 is the current applicable catalogue.',binding:'rule:flux-design@5'})
test('all task kinds resolve through the same versioned typed protocol',()=>{
 for(const op of ['ba','po','pm','research','test','mock','coding']){
  const typed=typedTemplate(op),c=contract(typed),r=check(c)
  assert.equal(resolveTypedAI(typed).status,'ready',op);assert.equal(r.decision,'allow',op)
  assert.equal(r.findings.find(f=>f.id==='typed_selection')?.status,'verified')
  assert.deepEqual((r.model_context.review_profile as any).spec.typedAI,typed)
 }
})
test('unknown, duplicate, unversioned and executable tag/shadow fields fail validation',()=>{
 assert.throws(()=>parseTagChain('rule:design'));assert.throws(()=>parseTagChain('permission:admin'))
 assert.throws(()=>typedAI({...spec(),tags:[...spec().tags,spec().tags[0]]}))
 assert.throws(()=>typedShadow({...spec().shadows[0],execute:true}))
 assert.throws(()=>typedShadow({...spec().shadows[0],format:'inherit',requiredKeys:['facts']}))
 assert.throws(()=>typedShadow({...spec().shadows[0],format:'json',requiredKeys:['__proto__']}))
})
test('ambiguity and incompatible input/output types stop the real Rust compiler before generation',()=>{
 for(const update of [
  {shadows:[...spec().shadows,{...spec().shadows[0]!,id:'another.ba'}]},
  {tags:spec().tags.map(t=>t.kind==='input'?{...t,value:'png'}:t)},
  {tags:spec().tags.map(t=>t.kind==='output'?{...t,value:'patch'}:t)},
  {tags:spec().tags.filter(t=>t.kind!=='domain')},
  {tags:[...spec().tags,{kind:'rule',value:'flux-design',version:'5'}]},
 ]){
  const typed=typedAI({...spec(),...update});assert.notEqual(resolveTypedAI(typed).status,'ready');assert.equal(check(contract(typed)).decision,'block')
 }
})
test('rule binding requires exact actual scope, full body, version quote and hash',()=>{
 const s=source(),typed=typedAI({...spec(),tags:[...spec().tags,{kind:'rule',value:'flux-design',version:'5'}],sources:[s]}),record={ref:42,project:'flux',tenant:'aj',body:s.quote}
 assert.equal(verifyTypedSource(s,'atlas',s.origin,{ref:42,tenant:'aj'},record,typed),sourceKey(s))
 for(const changed of [{body:'Design V4 is current.'},{project:'other'},{tenant:'other'},{ref:43},{archived:true},{truncated:true},{status:'superseded'}])assert.throws(()=>verifyTypedSource(s,'atlas',s.origin,{ref:42,tenant:'aj'},{...record,...changed},typed))
 assert.throws(()=>verifyTypedSource(s,'atlas',s.origin,{ref:42,tenant:'other'},record,typed))
 assert.throws(()=>verifyTypedSource(s,'other',s.origin,{ref:42,tenant:'aj'},record,typed))
 const task=new TaskSession(contract(typed),{compile:r=>runtime.task(r),signature:()=>'scope',check:()=>{}})
 task.observeSource('one','requirements');assert.throws(()=>task.dispatch('atlas:atlas_create','write'),TaskBlocked)
 task.observeTypedSource(s,'atlas',s.origin,{ref:42,tenant:'aj'},record)
 // A read-only shadow cannot grant a write, even after every source is observed.
 assert.throws(()=>task.dispatch('atlas:atlas_create','write'),TaskBlocked);task.finish('Source-grounded requirements');assert.equal(task.report().phase,'ready');assert.equal(task.report().evidence.human_accepted,false);task.close()
})
test('discovery and whoami cannot satisfy a typed source input; a real body read can',()=>{
 const t=new TaskSession(contract(),{compile:r=>runtime.task(r),signature:()=>'scope',check:()=>{}})
 t.observe('atlas',true,true,false,true,'atlas_whoami');assert.throws(()=>t.finish('Unfounded analysis'),TaskBlocked)
 t.observeSource('one','real-source');t.finish('Analysis of the actual source');assert.equal(t.report().phase,'ready');t.close()
})
test('source reads are mandatory before typed effects even when ordinary profile beforeEffects is disabled',()=>{
 const typed=typedTemplate('coding'),c=contract(typed),e={...taskEvidence(),provider_checked:true}
 assert.equal(check(c,e,'dispatch','atlas:atlas_create','write').decision,'block')
 assert.equal(check(c,{...e,one_pages:['specification']}as any,'dispatch','atlas:atlas_create','write').decision,'allow')
 c.external_write=false;assert.equal(check(c,{...e,one_pages:['specification']}as any,'dispatch','atlas:atlas_create','write').decision,'block')
})
test('JSON shape and required keys/terms are actual result gates, not model self certification',()=>{
 const typed=spec();typed.shadows[0]={...typed.shadows[0]!,format:'json',requiredKeys:['facts','questions'],requiredTerms:['facts']}
 const c=contract(typed),e={...taskEvidence(),provider_checked:true,one_pages:['source']}
 for(const answer of ['all done','{"facts":[]}'])assert.equal(check(c,{...e,answer}as any,'result').decision,'block')
 assert.equal(check(c,{...e,answer:'{"facts":[],"questions":[]}'}as any,'result').decision,'allow')
})
test('Atlas shadow JSON must match the exact approved version, not a similarly named definition',()=>{
 const shadow=spec().shadows[0]!,body='```json\n'+JSON.stringify(shadow)+'\n```',s={...source(),kind:'shadow' as const,hash:sha256Hex(body),quote:'"protocol":"one.typed-shadow.v1"',binding:shadow.id+'@'+shadow.version},typed=typedAI({...spec(),sources:[s]}),record={ref:42,tenant:'aj',project:'flux',body}
 assert.deepEqual(shadowFromBody(body),shadow);assert.equal(verifyTypedSource(s,'atlas',s.origin,{ref:42,tenant:'aj'},record,typed),sourceKey(s))
 const changed=typedAI({...typed,shadows:[{...shadow,guidance:'Different approved-looking text'}]});assert.throws(()=>verifyTypedSource(s,'atlas',s.origin,{ref:42,tenant:'aj'},record,changed))
 assert.throws(()=>shadowFromBody(body+'\n'+body))
})
test('saved compilations retain the exact typed profile snapshot and reject tampering',()=>{
 const profile=bindReviewProfile('typed',1,{...blankReviewProfile(),name:'Typed analysis',typedAI:spec()}),program={...draftWorkflow('/ba Analyse requirements','ba','source-page',[]),profile},compiled=compileProgram(program)
 assert.deepEqual(readProgram(compiled).profile,profile);assert.deepEqual(readReviewProfile(profile),profile)
 const changed=structuredClone(profile);changed.spec.typedAI!.tags[0]!.value='other'
 assert.throws(()=>compileProgram({...program,profile:changed}));assert.throws(()=>readProgram({...compiled,canonical:compiled.canonical.replace('Typed analysis','Tampered analysis')}))
})

test('external source bodies are supported and expired Atlas checks cannot authorize a result',()=>{
 const e={...taskEvidence(),provider_checked:true,other_sources:['https://source.example/spec']}
 assert.equal(check(contract(),{...e,answer:'A source-based comparison'}as any,'result').decision,'allow')
 const s=source(),typed=typedAI({...spec(),tags:[...spec().tags,{kind:'rule',value:'flux-design',version:'5'}],sources:[s]})
 assert.equal(check(contract(typed),{...e,typed_sources:[sourceKey(s)],typed_sources_current:false,answer:'Old evidence'}as any,'result').decision,'block')
 assert.equal(check(contract(typed),{...e,typed_sources:[sourceKey(s)],typed_sources_current:true,answer:'Current evidence'}as any,'result').decision,'allow')
})
