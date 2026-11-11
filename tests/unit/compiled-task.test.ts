import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {QuandRuntime} from '../../src/shared/quandprofile/runtime.ts'
import {taskEvidence,taskBoundaries,atlasIdentityTask,type TaskContract,type TaskReport} from '../../src/shared/quandprofile/task.ts'
import {TaskSession,TaskBlocked} from '../../src/shared/quandprofile/task-session.ts'
const {instance}=await WebAssembly.instantiate(await readFile(new URL('../../src/shared/quandprofile/quandprofile.wasm',import.meta.url)),{})
const runtime=new QuandRuntime(instance)
const contract=():TaskContract=>({id:'task-test',revision:1,goal:'Read Atlas sources, then prepare a proposal.',instruction_context:'Host-owned role instructions',input_hash:'initial-transcript-hash',scope_hash:'actor-workspace-policy-v1',source_pointers:['one:fixture'],allowed_tools:['read','stage','write','execute'],read_only:false,external_write:false,execute:false,requires_sources:true,search_one:true,search_atlas:true,output:'text',required_literals:[],decisions:[]})
const evidence=()=>({...taskEvidence(),provider_checked:true})
const check=(changes:Record<string,unknown>={})=>runtime.task({contract:contract(),evidence:evidence(),phase:'compile',tool:null,effect:null,...changes} as any)
test('real WASM compiles seven dimensions with explicit open semantic acceptance',()=>{const c=check();assert.equal(c.protocol,'quandprofile.task.v1');assert.equal(c.dimension_definitions.length,7);assert.equal(c.decision,'allow');assert.equal(c.findings.find(f=>f.id==='task_human_acceptance')?.status,'open');assert(!c.quanta.some(q=>q.obligation_id==='task_human_acceptance'));assert.equal(c.model_context.goal,contract().goal)})
test('source pointers, discovery and model prose cannot mint successful reads',()=>{const r=check({phase:'result',evidence:{...evidence(),answer:'It is all done.'}});assert.equal(r.decision,'block');assert.equal(r.findings.find(f=>f.id==='task_sources_observed')?.status,'open')})
test('question before actual available-source inspection is blocked',()=>{assert.equal(check({phase:'question'}).decision,'block');assert.equal(check({phase:'question',evidence:{...evidence(),one_checked:true,atlas_checked:true}}).decision,'allow')})
test('unresolved prerequisites block every effect but allow independent reads',()=>{for(const effect of ['stage','write','execute'])assert.equal(check({phase:'dispatch',tool:effect,effect,evidence:{...evidence(),pending_decisions:1}}).decision,'block');assert.equal(check({phase:'dispatch',tool:'read',effect:'read',evidence:{...evidence(),pending_decisions:1}}).decision,'allow')})
test('read-only contract, unknown effects, stale workspace and revoked provider fail closed',()=>{assert.equal(check({phase:'dispatch',tool:'stage',effect:'stage',contract:{...contract(),read_only:true}}).decision,'block');assert.equal(check({phase:'dispatch',tool:'write',effect:'forbidden'}).decision,'block');for(const field of ['scope_current','provider_checked'])assert.equal(check({evidence:{...evidence(),[field]:false}}).decision,'block')})
test('accepted remote effects need an explicit trusted boundary',()=>{assert.equal(check({phase:'dispatch',tool:'write',effect:'write'}).decision,'block');assert.equal(check({phase:'dispatch',tool:'execute',effect:'execute'}).decision,'block');assert.equal(check({phase:'dispatch',tool:'write',effect:'write',contract:{...contract(),external_write:true}}).decision,'allow')})
test('successful Atlas observation cannot replace required JSON or literal checks',()=>{const c={...contract(),output:'json',required_literals:['expected']};for(const answer of ['not json','{"other":1}'])assert.equal(check({contract:c,phase:'result',evidence:{...evidence(),source_reads:1,atlas_reads:1,answer}}).decision,'block');const pass=check({contract:c,phase:'result',evidence:{...evidence(),source_reads:1,atlas_reads:1,answer:'{"expected":1}'}});assert.equal(pass.decision,'allow');assert.equal(pass.findings.at(-1)?.status,'open')})
test('human answer changes the actual compiled contract and is passed as data, not new permissions',async()=>{const reports:TaskReport[]=[];let scope='v1';const ac=new AbortController();const task=new TaskSession(contract(),{compile:r=>runtime.task(r),signature:()=>scope,check:()=>{},signal:ac.signal,interactive:true,report:r=>reports.push(r)});task.observe('one',true,true);task.observe('atlas',true,true);const pending=task.question({question:'Which project is authoritative?',needed_for:'Save the spec',options:[{label:'A',effect:'Use A'}]});assert.equal(reports.at(-1)?.phase,'decision');assert(task.canAnswer(reports.at(-1)!.questions[0].id));assert.throws(()=>task.dispatch('stage','stage'),TaskBlocked);const before=task.report().compiled.contract_hash;assert.equal(task.answer('made-up','self approval'),false);assert(task.answer(reports.at(-1)!.questions[0].id,'Project A'));assert.equal(task.canAnswer(reports.at(-1)!.questions[0].id),false);const response=JSON.parse(await pending);assert.equal(response.permissions_unchanged,true);assert.notEqual(task.report().compiled.contract_hash,before);assert.equal(task.report().compiled.contract.external_write,false);assert.equal(JSON.parse(task.packet()).human_decisions[0].answer,'Project A');task.dispatch('stage','stage');task.finish('Draft for Project A');assert.equal(task.report().phase,'ready');assert.equal(task.report().evidence.human_accepted,false);assert(task.accept());assert.equal(task.report().phase,'accepted');scope='v2';assert.throws(()=>task.dispatch('read','read'));task.close()})
test('a stale UI, abort or a headless model cannot answer a decision',async()=>{let scope='v1';const ac=new AbortController(),task=new TaskSession({...contract(),search_one:false,search_atlas:false},{compile:r=>runtime.task(r),signature:()=>scope,check:()=>{},signal:ac.signal,interactive:true});const pending=task.question({question:'Missing input?',needed_for:'Dependent write'});scope='v2';assert.equal(task.canAnswer(task.report().questions[0].id),false);assert.equal(task.answer(task.report().questions[0].id,'guess'),false);ac.abort();await assert.rejects(pending,/stopped/);const headless=new TaskSession({...contract(),search_one:false,search_atlas:false},{compile:r=>runtime.task(r),signature:()=>'',check:()=>{}});await assert.rejects(headless.question({question:'Missing input?',needed_for:'Dependent write'}),/human prerequisite/);assert.equal(headless.report().phase,'decision');headless.close()})
test('negated and quoted commands never grant remote write/execute authority',()=>{for(const goal of ['Nur lesen. Erstelle keine Records.','Do not create anything.','Erkläre den Text „create a record“.','Nicht starten und nicht speichern.']){const b=taskBoundaries(goal);assert.equal(b.externalWrite,false,goal);assert.equal(b.execute,false,goal)}assert.equal(taskBoundaries('Erstelle einen Atlas-Entwurf.').externalWrite,true);assert.equal(taskBoundaries('Read Atlas ref 42 and replace its body.').externalWrite,true)})


test('identity evidence applies only to an explicitly bounded identity task, never an Atlas briefing',()=>{
 for(const goal of ['atlas whoami','atlas_whoami','atlas: whoami. Nur lesen.','Who am I in Atlas?','Wer bin ich in Atlas?','Prüfe meine Atlas-Identität.','Read Atlas identity.'])assert.equal(atlasIdentityTask(goal),true,goal)
 for(const goal of ['Call atlas_whoami then list all tasks.','Read Atlas sources, then prepare a proposal.','Show my Atlas identity and brief me on CNSX.','Do not call atlas_whoami'])assert.equal(atlasIdentityTask(goal),false,goal)
})
test('packet ordering preserves every compiler value and a stable instruction prefix across tool discovery',()=>{
 const task=new TaskSession({...contract(),instruction_context:'Unchanged verified role instructions. '.repeat(200)},{compile:r=>runtime.task(r),signature:()=>'scope',check:()=>{}})
 const before=task.packet();assert.deepEqual(JSON.parse(before),task.report().compiled.model_context)
 task.expose(['atlas:atlas_get']);const after=task.packet()
 assert.deepEqual(JSON.parse(after),task.report().compiled.model_context)
 assert.notEqual(JSON.parse(before).contract_hash,JSON.parse(after).contract_hash)
 const prefix=before.slice(0,before.indexOf('"contract_hash"'))
 assert(prefix.length>7500);assert(after.startsWith(prefix));task.close()
})

test('a premature model question can recover without opening a decision or weakening source checks',async()=>{
 const task=new TaskSession(contract(),{compile:r=>runtime.task(r),signature:()=>'',check:()=>{},interactive:true})
 task.observe('atlas',true,true)
 const rejected=JSON.parse(await task.modelQuestion({question:'Which threshold?',needed_for:'Future implementation'}))
 assert.equal(rejected.isError,true);assert.equal(rejected.oneNotExecuted,true);assert.equal(task.report().questions.length,0);assert.equal(task.report().evidence.pending_decisions,0);assert.equal(task.report().compiled.contract.decisions.length,0)
 task.finish('The source leaves the threshold decision open; this analysis makes no implementation choice.')
 assert.equal(task.report().phase,'ready');assert.equal(task.report().evidence.human_accepted,false)
 let scope='initial';const stale=new TaskSession(contract(),{compile:r=>runtime.task(r),signature:()=>scope,check:()=>{},interactive:true});scope='changed'
 await assert.rejects(stale.modelQuestion({question:'Which threshold?',needed_for:'Future implementation'}));stale.close();task.close()
})

test('a host result-check failure publishes a blocked card and cannot be accepted',()=>{const task=new TaskSession(contract(),{compile:r=>runtime.task(r),signature:()=>'',check:()=>{}});task.observe('atlas',true,true);task.fail('No reviewable draft passed the host checks.');assert.equal(task.report().phase,'blocked');assert.equal(task.report().evidence.issues,1);assert.equal(task.accept(),false);task.close()})

test('explicit personal Polarion login is separate from write and execution authority',()=>{
 for(const goal of ['Verbinde meinen Polarion-Zugang. Keine Änderungen an Inhalten.','verbinde dich mit polarion','Bitte verbinde dich mit meinem Polarion. Nur lesen.','Verbinde mich mit Polarion. Ohne Änderungen an Inhalten.','Starte die Polarion-Anmeldung. Nur lesen.','Connect my Polarion access. Do not write.','Connect to Polarion. Read only.']){const b=taskBoundaries(goal);assert.equal(b.authenticate,true,goal);assert.equal(b.externalWrite,false);assert.equal(b.execute,false)}
 for(const goal of ['Erkläre mir Polarion.','Erkläre „Verbinde meinen Polarion-Zugang“.','Erkläre „verbinde dich mit polarion“.','Verbinde meinen Polarion-Zugang nicht.','Verbinde dich nicht mit Polarion.','Verbinde dich mit Polarion nicht.','Verbinde dich mit Polarion ohne Anmeldung.','Do not connect my Polarion access.','Never connect to Polarion.','Prüfe den Polarion-Status.','Verbinde dich mit Atlas.'])assert.equal(taskBoundaries(goal).authenticate,false,goal)
 const c={...contract(),read_only:true,authenticate:true,allowed_tools:['atlas:atlas_polarion_connect','atlas:atlas_agent_trigger','atlas:atlas_polarion_apply_change']}
 const req={phase:'dispatch',contract:c,tool:'atlas:atlas_polarion_connect',effect:'authenticate'}
 assert.equal(check(req).decision,'allow')
 assert.equal(check({...req,contract:{...c,authenticate:false}}).decision,'block')
 assert.equal(check({...req,evidence:{...evidence(),pending_decisions:1}}).decision,'block')
 for(const tool of ['atlas:atlas_agent_trigger','atlas:atlas_polarion_apply_change'])for(const effect of ['execute','write','authenticate'])assert.equal(check({...req,tool,effect}).decision,'block')
 for(const field of ['scope_current','provider_checked'])assert.equal(check({...req,evidence:{...evidence(),[field]:false}}).decision,'block')
})

test('explicit page-to-Atlas transfer intent is allowed while descriptions and negation cannot grant it',()=>{
 assert.equal(taskBoundaries('mach aus dieser seite in atlas die unterseiten zu dossiers und die tests zu test records mit ihrer beschreibung und verlinke die neuen atlas records').externalWrite,true)
 assert.equal(taskBoundaries('Kommentiere die offenen Fragen in Atlas.').externalWrite,true)
 for(const text of ['Wie mache ich aus dieser Seite in Atlas ein Dossier?','Bitte nicht kommentieren oder verlinken in Atlas.','Kommentiere nicht in Atlas.','Übertrage nicht nach Atlas.','Ändere nicht in Atlas.','Nur lesen. Verlinke die Records in Atlas.'])assert.equal(taskBoundaries(text).externalWrite,false)
})


test('natural-language connection checks require actual identity evidence without accepting content analysis',()=>{
 const goal='Prüfe nur meine persönliche AJ-Atlas-Verbindung: Rufe atlas_whoami über MCP tatsächlich auf und nenne kurz die bestätigte Identität und den zugänglichen Tenant. Keine weiteren Quellen lesen und nichts ändern.'
 assert.equal(atlasIdentityTask(goal),true)
 for(const extra of [' Liste alle Aufgaben.',' und fasse CNSx zusammen.',' Erstelle einen Record.',' Lies Record 42.'])assert.equal(atlasIdentityTask(goal+extra),false)
 for(const success of [false,true]){
  const task=new TaskSession({...contract(),goal},{compile:r=>runtime.task(r),signature:()=>'',check:()=>{}})
  assert.equal(task.identityOnly(),true)
  task.observe('atlas',success,task.identityOnly(),false,true,'atlas_whoami')
  if(success){task.finish('Die tatsächlich bestätigte Atlas-Identität ist die Antwort.');assert.equal(task.report().phase,'ready')}
  else assert.throws(()=>task.finish('Identität angeblich bestätigt'),TaskBlocked)
  task.close()
 }
 const analysis=new TaskSession({...contract(),goal:'Show my Atlas identity and brief me on CNSX.'},{compile:r=>runtime.task(r),signature:()=>'',check:()=>{}})
 analysis.observe('atlas',true,analysis.identityOnly(),false,true,'atlas_whoami')
 assert.throws(()=>analysis.finish('An unsupported briefing'),TaskBlocked);analysis.close()
})

test('human Atlas delivery choice is host-enforced and bound in the compiler goal',async()=>{
 const {atlasTransferTask}=await import('../../src/shared/quandprofile/atlas-transfer.ts')
 const goal=atlasTransferTask('Bitte die Entscheidung nach Atlas bringen.','comment')
 const task=new TaskSession({...contract(),goal,external_write:true,allowed_tools:['atlas:atlas_comment','atlas:atlas_update','atlas:atlas_create','stage']},{compile:r=>runtime.task(r),signature:()=>'',check:()=>{}})
 assert.equal(JSON.parse(task.packet()).goal,goal)
 task.dispatch('atlas:atlas_comment','write')
 for(const [tool,effect]of [['atlas:atlas_update','write'],['atlas:atlas_create','write'],['stage','stage']] as const)assert.throws(()=>task.dispatch(tool,effect),/human selected Atlas delivery mode/)
 task.close()
})


test('document source policy permits real One reads without forcing optional Atlas calls',()=>{
 const c={...contract(),requires_atlas_sources:false}
 assert.equal(check({contract:c,phase:'result',evidence:{...evidence(),answer:'Unsupported'}}).decision,'block')
 assert.equal(check({contract:c,phase:'result',evidence:{...evidence(),source_reads:1,one_pages:['task'],answer:'Based on the One document'}}).decision,'allow')
 // Existing and explicitly Atlas-required contracts still need a successful external read.
 for(const required of [undefined,true])assert.equal(check({contract:{...contract(),...(required===undefined?{}:{requires_atlas_sources:required})},phase:'result',evidence:{...evidence(),source_reads:1,answer:'One alone'}}).decision,'block')
 assert.equal(check({contract:{...c,requires_atlas_sources:true},phase:'result',evidence:{...evidence(),source_reads:1,atlas_reads:1,answer:'Read Atlas'}}).decision,'allow')
 // Availability still controls prerequisite questions; the document policy does not fake source checks.
 assert.equal(check({contract:c,phase:'question',evidence:{...evidence(),one_checked:true}}).decision,'block')
})


test('the reported German sign-in instruction grants only the Polarion authentication effect',()=>{
 const goal='melde dich bei polarion an',bounds=taskBoundaries(goal)
 assert.deepEqual(bounds,{readOnly:false,externalWrite:false,execute:false,authenticate:true})
 const c={...contract(),goal,authenticate:bounds.authenticate,external_write:bounds.externalWrite,execute:bounds.execute,allowed_tools:['atlas:atlas_polarion_connect','atlas:atlas_update','atlas:atlas_polarion_apply_change']}
 assert.equal(check({contract:c,phase:'dispatch',tool:'atlas:atlas_polarion_connect',effect:'authenticate'}).decision,'allow')
 for(const [tool,effect] of [['atlas:atlas_update','write'],['atlas:atlas_polarion_apply_change','execute']])assert.equal(check({contract:c,phase:'dispatch',tool,effect}).decision,'block')
})
test('natural login commands support separable German verbs and English sign-in',()=>{
 for(const goal of ['Melde mich bei Polarion an.','Bitte melde dich bei Polarion an. Nur lesen.','Melde dich bitte bei Polarion an','Melde dich in Polarion bitte an','Melde bitte mich bei Polarion an','  MELDE   dich\nbei Polarion an  ','Logge dich bei Polarion ein','Bitte logge mich in Polarion ein.','Log in to Polarion','Please sign me in to Polarion','Sign into Polarion']){
  const b=taskBoundaries(goal);assert.equal(b.authenticate,true,goal);assert.equal(b.externalWrite,false,goal);assert.equal(b.execute,false,goal)
 }
})
test('login mentions, status questions, incomplete verbs and negation do not grant authentication',()=>{
 for(const goal of ['Melde dich bei Polarion nicht an','Bitte melde dich nicht bei Polarion an','Melde dich bei Polarion an ohne Anmeldung','Logge dich nicht bei Polarion ein','Do not log in to Polarion','Never sign in to Polarion','Wie melde ich mich bei Polarion an?','Bin ich bei Polarion angemeldet?','Erkläre: melde dich bei polarion an','Erkläre „melde dich bei polarion an“.','"Melde dich bei Polarion an"','`log in to Polarion`','Melde dich bei Polarion','Melde dich bei Atlas an','Logge dich bei Polarion','Sign in to Atlas'])assert.equal(taskBoundaries(goal).authenticate,false,goal)
})


test('short Polarion commands authorize authentication through the compiled gate, including read-only work',()=>{
 for(const goal of ['polarion anmelden','Polarion anmelden!','Bitte Polarion anmelden. Nur lesen.','bei Polarion anmelden','Polarion bitte erneut anmelden','Polarion wieder anmelden bitte','Bitte in Polarion neu einloggen','anmelden bei Polarion','erneut einloggen in Polarion','Polarion-Login starten','Polarion Anmeldung bitte starten']){
  const b=taskBoundaries(goal)
  assert.equal(b.authenticate,true,goal);assert.equal(b.externalWrite,false,goal);assert.equal(b.execute,false,goal)
  const c={...contract(),goal,read_only:b.readOnly,authenticate:b.authenticate,external_write:b.externalWrite,execute:b.execute,allowed_tools:['atlas:atlas_polarion_connect','atlas:atlas_update','atlas:atlas_polarion_apply_change']}
  assert.equal(check({contract:c,phase:'dispatch',tool:'atlas:atlas_polarion_connect',effect:'authenticate'}).decision,'allow',goal)
  for(const [tool,effect] of [['atlas:atlas_update','write'],['atlas:atlas_polarion_apply_change','execute']])assert.equal(check({contract:c,phase:'dispatch',tool,effect}).decision,'block',goal)
 }
})
test('short login mentions and qualified requests do not authorize authentication',()=>{
 for(const goal of ['Polarion anmelden erklären','Polarion anmelden Anleitung','Wie bei Polarion anmelden?','Kann ich mich bei Polarion anmelden?','Warum wieder bei Polarion anmelden?','Polarion nicht anmelden','Bitte Polarion niemals anmelden','Polarion anmelden ohne Anmeldung','Polarion anmelden erst nach Freigabe','Erkläre: polarion anmelden','„polarion anmelden“','`polarion anmelden`','Polarion Anmeldung','Polarion Login Status','Atlas anmelden'])assert.equal(taskBoundaries(goal).authenticate,false,goal)
})

test('Kai ticket request with explicit /KI prefix and common typo recognizes the requested write',()=>{
 for(const goal of ['/KI Bitte die Ticets im Atlas entsprecehd des Seiteninhalstes anlegen.','Bitte die Tickets im Atlas entsprechend des Seiteninhaltes anlegen.','Please create the tickets in Atlas.'])assert.equal(taskBoundaries(goal).externalWrite,true,goal)
 for(const goal of ['/KI Bitte die Ticets nicht im Atlas anlegen.','Erkläre den Satz „Bitte die Ticets in Atlas anlegen“.','Only read. Please create the tickets in Atlas.'])assert.equal(taskBoundaries(goal).externalWrite,false,goal)
})
