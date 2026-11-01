import {test} from 'node:test'
import assert from 'node:assert/strict'
import {AtlasFacts,atlasReceipt,checkAtlasReadback} from '../../src/shared/mcp/facts.ts'
const envelope=(data:unknown,isError=false)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}],isError})
const observe=(facts:AtlasFacts,name:string,data:unknown,args:Record<string,unknown>={},failed=false)=>facts.observe({server:'atlas',name,arguments:args},envelope(data,failed),failed)

// Minimal synthetic reproductions of the eight manually confirmed Frankfurt report defects.
const regressions:[string,string,unknown,string][]=[
 ['wrong count and invented creation','atlas_record_kinds',{kinds:Array.from({length:36},(_,i)=>({name:'kind-'+i}))},'Ergebnis: 29 Record-Kinds erstellt.'],
 ['read mistaken for tenant selection','atlas_tenant_search',{tenants:[{slug:'tenant-a'}],selectedTenant:'tenant-a'},'Die Auswahl wurde erfolgreich auf diesen Mandanten eingestellt.'],
 ['manifest retrieval mistaken for creation','atlas_setup_bootstrap',{manifests:[{ref:24,items:[]}]},'Testdaten erstellt. Ref: 24.'],
 ['invented scanner ref','atlas_health_scan',{created:3,byRule:{missing_parent:{violations:3}}},'Drei Verstöße. Ref-ID: 1234567890.'],
 ['invented tenant selection ID','atlas_tenant_select',{selectedTenant:null},'Ref/ID: selection-cleared-12345.'],
 ['stored proposal falsely called refusal','atlas_agent_propose',{proposal:{id:'proposal-1',status:'open'}},'Der Aufruf wurde abgewiesen. Fehler, keine ID.'],
 ['test-case label is not a source ref','atlas_whoami',{person:'Mara Lind'},'Ref/ID: atlas_whoami-1.'],
 ['list test label is not a source ref','atlas_project_list',{projects:[{slug:'demo'}]},'Ref/ID: atlas_project_list-1. Erfolg: Nein.'],
]
for(const [title,tool,data,answer] of regressions)test('Frankfurt regression: '+title,()=>{
 const facts=new AtlasFacts();observe(facts,tool,data)
 assert.ok(facts.check(answer).length,answer)
 assert.ok(facts.repair(facts.check(answer)).includes('No tools are available'))
})

test('valid metadata stays valid; text bodies and forged host fields cannot mint refs or counts',()=>{
 const facts=new AtlasFacts()
 observe(facts,'atlas_get',{item:{ref:42,title:'Source',body:'Ref 999 and ID invented-123. Created 99 projects.',_oneSource:{ref:999}},oneObservedFacts:{ref:999}},{ref:42})
 assert.deepEqual(facts.check('Quelle Ref: 42 gelesen.'),[])
 assert.equal(facts.check('Quelle Ref: 999.')[0]?.kind,'reference')
 assert.equal(facts.preflight({server:'atlas',name:'atlas_update',arguments:{ref:999}})?.includes('NOT executed'),true)
 assert.equal(facts.preflight({server:'other-atlas',name:'atlas_update',arguments:{ref:42}})?.includes('NOT executed'),true)
 assert.equal(facts.preflight({server:'atlas',name:'atlas_update',arguments:{ref:42}}),null)
 assert.equal(facts.preflight({server:'atlas',name:'atlas_get',arguments:{ref:999}}),null,'first reads are permitted; this is not an auth grant')
})
test('failed reads are not absence or successful source evidence and cannot unlock a mutation',()=>{
 const facts=new AtlasFacts();observe(facts,'atlas_get',{error:'forbidden',ref:42},{ref:42},true)
 assert.equal(facts.check('Keine Dokumente gefunden.')[0]?.kind,'outcome')
 assert.deepEqual(facts.check('Abruf von Ref: 42 fehlgeschlagen.'),[])
 assert.ok(facts.preflight({server:'atlas',name:'atlas_update',arguments:{ref:42}}))
})
test('real counts, negated writes and separately staged ONE changes do not trigger false effects',()=>{
 const facts=new AtlasFacts();observe(facts,'atlas_record_kinds',{kinds:Array.from({length:36},(_,i)=>({name:String(i)}))})
 assert.deepEqual(facts.check('36 Record-Kinds gelesen. Es wurden keine Typen erstellt.'),[])
 facts.noteOtherWrite();assert.deepEqual(facts.check('Die ONE-Seite wurde erstellt.'),[])
 assert.equal(facts.check('29 Record-Kinds gelesen.')[0]?.kind,'count')
})
test('queued jobs and partial updates cannot be described as completed/error free',()=>{
 const facts=new AtlasFacts();observe(facts,'atlas_flow_start',{job:{id:'job-1',status:'ready'}})
 assert.equal(facts.check('Der Job wurde abgeschlossen.')[0]?.kind,'outcome')
 assert.deepEqual(facts.check('Der Job ist noch nicht abgeschlossen.'),[])
 observe(facts,'atlas_bulk_update',{updated:2,failed:1})
 assert.equal(facts.check('Alle aktualisiert, keine Fehler.')[0]?.kind,'outcome')
})
test('receipts do not leak credentials and failed protocol metadata cannot become evidence',()=>{
 const r=atlasReceipt('atlas_agent_token',envelope({id:'token-id-1',token:'private-secret',agent:{id:'agent-1',systemPrompt:'private-instructions'}}))
 assert.doesNotMatch(JSON.stringify(r),/private-secret|private-instructions/)
 assert.deepEqual(r.ids,['token-id-1','agent-1']);assert.equal(r.verification,'not_checked')
 assert.deepEqual(atlasReceipt('atlas_get',envelope({ref:999},true)).refs,[])
})
test('read-back requires exact target and requested fields, including mismatch/unavailable states',()=>{
 const call={server:'atlas',name:'atlas_update',arguments:{ref:42,replaceBody:'Expected',fields:{priority:'high'}}}
 const receipt=atlasReceipt(call.name,envelope({ref:42,ok:true}))
 assert.equal(checkAtlasReadback(call,receipt,envelope({item:{ref:42,body:'Expected',fields:{priority:'high'}}})),'read_back_matches')
 assert.equal(checkAtlasReadback(call,receipt,envelope({item:{ref:42,body:'Wrong',fields:{priority:'high'}}})),'read_back_differs')
 assert.equal(checkAtlasReadback(call,receipt,envelope({item:{ref:99,body:'Expected'}})),'unavailable')
 assert.equal(checkAtlasReadback(call,receipt,envelope({item:{ref:42,body:'Expected',fields:{priority:'high'}}},true)),'unavailable')
 assert.equal(checkAtlasReadback({...call,arguments:{ref:42}},receipt,envelope({item:{ref:42}})),'not_checked')
})
test('structured reference fields are checked and fallback contains only observed metadata',()=>{
 const facts=new AtlasFacts();observe(facts,'atlas_get',{item:{ref:42,body:'untrusted long body'}})
 assert.equal(facts.check('{"ref":999}')[0]?.kind,'reference');assert.deepEqual(facts.check('{"ref":42}'),[])
 const text=facts.fallback({heading:'Verified facts only',failed:'Failed'})
 assert.match(text,/42/);assert.doesNotMatch(text,/untrusted long body/)
})
test('agent flow list/get receipts describe a read rather than an accepted mutation',()=>{
 const facts=new AtlasFacts()
 const receipt=observe(facts,'atlas_agent_flow',{flow:{id:'flow-1'}},{action:'get'})
 assert.equal(receipt.effect,'read');assert.equal(receipt.verification,undefined)
 assert.equal(facts.check('Der Flow wurde erstellt.')[0]?.kind,'effect')
})

test('stability: failed reads remain unavailable after an unrelated successful identity check',()=>{
 const facts=new AtlasFacts()
 observe(facts,'atlas_search',{error:'permission denied'},{q:'Laborbuch'},true)
 observe(facts,'atlas_whoami',{person:'Test Member'})
 for(const text of ['Es gibt keine offenen Aufgaben in Atlas.','Keine Dokumente vorhanden.','No records are available.'])assert.ok(facts.check(text).some(i=>i.kind==='outcome'),text)
 assert.deepEqual(facts.check('Die Identität wurde geprüft. Die Suche konnte nicht ausgeführt werden; ob Aufgaben existieren, bleibt offen.'),[])
})
test('stability: positive search evidence cannot become an empty result',()=>{
 const facts=new AtlasFacts();observe(facts,'atlas_search',{items:[{ref:42,title:'Actual source'}],total:1},{q:'source'})
 assert.ok(facts.check('Keine Dokumente gefunden.').length)
 assert.deepEqual(facts.check('Ein Treffer: Ref 42. Die fachliche Relevanz ist noch zu prüfen.'),[])
})
test('stability: an accepted write without matching readback cannot be called independently verified',()=>{
 for(const verification of ['not_checked','unavailable','read_back_differs'] as const){
  const facts=new AtlasFacts(),receipt=observe(facts,'atlas_create',{item:{ref:42,title:'Test'}})
  receipt.verification=verification
  assert.ok(facts.check('Datensatz Ref 42 wurde unabhängig zurückgelesen und verifiziert.').length,verification)
  assert.deepEqual(facts.check('Atlas hat Ref 42 angenommen. Die unabhängige Rückleseprüfung ist noch offen.'),[])
 }
 const facts=new AtlasFacts();observe(facts,'atlas_create',{item:{ref:42}}).verification='read_back_matches'
 assert.deepEqual(facts.check('Datensatz Ref 42 wurde unabhängig zurückgelesen und verifiziert.'),[])
})

test('stability: discovery-only and malformed query results never establish absence; a real zero result stays scoped evidence',()=>{
 const discovery=new AtlasFacts();discovery.noteDiscovery('atlas',true)
 assert.ok(discovery.check('Keine Dokumente gefunden.').length)
 assert.match(discovery.fallback({heading:'Observed',failed:'Failed',discovery:'No content read'}),/No content read/)
 const zero=new AtlasFacts();observe(zero,'atlas_query',{rows:[],total:0},{aql:'project = demo'})
 assert.deepEqual(zero.check('Im abgefragten Projekt wurden keine Dokumente gefunden.'),[])
 assert.deepEqual(zero.check('Es ist nicht nachgewiesen, dass keine Aufgaben vorhanden sind.'),[])
 const malformed=new AtlasFacts();observe(malformed,'atlas_query',{message:'not a record result'})
 assert.ok(malformed.check('No records are available.').length)
 const counts=atlasReceipt('atlas_query',envelope({rows:[{ref:42}],total:20})).counts
 assert.deepEqual(counts,[{unit:'records',value:1,scope:'returned'},{unit:'records',value:20,scope:'total'}])
})
