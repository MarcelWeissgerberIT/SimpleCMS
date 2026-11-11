import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {suggestTaskPlan,taskPlanPrompt,taskPlanSteps} from '../../src/shared/ai/taskPlan.ts'
const de='Bitte basierend auf den Repos von ICM FeliX und Flux die implementierten Features und zugehörigen Requirements extrahieren, den Features zuordnen und in EARS Notation beschreiben.'
const en='Extract implemented features and associated requirements from the repositories of ICM FeliX and Flux. Map requirements to features and describe them in EARS notation.'
test('compound repository analysis gets the same four-stage suggestion in German and English',()=>{
 for(const task of [de,en,'Analysiere sämtliche Funktionen, Tests und Boards im Quellcode.','Analyze all features and tests across the codebase.'])assert.ok(suggestTaskPlan(task),task)
 for(const lang of [true,false])assert.equal(taskPlanSteps('requirements',lang).length,4)
})
test('bounded tasks, authentication, quoted tool commands and generated stages do not get another plan',()=>{
 for(const task of ['Liste die 10 Hauptfeatures des Flux Clients basierend auf dem Repo auf und erstelle eine Tabelle.','Describe only one feature from the repo as EARS requirements.','Beschreibe nur ein Feature aus dem Repo mit EARS-Anforderungen.','Bitte bei Polarion anmelden','Please log in to Atlas','/mock Extract all features and requirements from repos','',taskPlanPrompt(de,'requirements',0,'',true)])assert.equal(suggestTaskPlan(task),null,task)
})
test('preparing stages preserves the original, requires a scope for detailed work and bounds the result',()=>{
 for(const lang of [true,false]){
  const original=lang?de:en
  const first=taskPlanPrompt(original,'requirements',0,'',lang)
  assert.ok(first.includes(JSON.stringify(original)))
  assert.equal(suggestTaskPlan(first),null)
  for(const index of [1,2])assert.throws(()=>taskPlanPrompt(original,'requirements',index,' ',lang))
  const ears=taskPlanPrompt(original,'requirements',2,'Repo A · feature B',lang)
  assert.match(ears,/Repo A · feature B/);assert.match(ears,/5 EARS/)
  assert.match(ears,/keine Atlas-ID|not an Atlas ID/)
  assert.match(ears,/Keine externen Änderungen|No external changes/)
  assert.match(taskPlanPrompt(original,'requirements',3,'',lang),/keine neue Gesamtanalyse|not start another full analysis/)
 }
 assert.throws(()=>taskPlanPrompt(de,'requirements',8,'',true))
})

test('Polarion export and comparison requests offer original PDFs in ONE before an optional Atlas stage',()=>{
 for(const goal of ['für die polarion quellen bitte exporte nach pdf von polarion aus in one ablegen und dann nach atlas wenn gewünscht','gleiche die Polarion Quellen mit Atlas ab','Export Polarion documents as PDFs and save them in ONE before optional Atlas transfer'])assert.equal(suggestTaskPlan(goal),'polarion')
 for(const de of [true,false]){
  const steps=taskPlanSteps('polarion',de);assert.equal(steps.length,4)
  assert.match(steps[1].instruction,/native|nativen/)
  assert.match(steps[2].instruction,/Originalanhang|original attachment/)
  assert.match(steps[3].title,/Optional/)
  for(let i=0;i<4;i++)assert.equal(taskBoundaries(taskPlanPrompt('Polarion PDF','polarion',i,'Source A',de)).externalWrite,i===3)
  for(const index of [1,2,3])assert.throws(()=>taskPlanPrompt('Polarion PDF','polarion',index,'',de))
  assert.match(taskPlanPrompt('Polarion PDF','polarion',2,'Source A',de),/Keine externen Änderungen in Atlas|No external changes in Atlas/)
  assert.match(taskPlanPrompt('Polarion PDF','polarion',3,'Source A',de),/ausdrücklicher Auftrag|explicit request/)
 }
})
