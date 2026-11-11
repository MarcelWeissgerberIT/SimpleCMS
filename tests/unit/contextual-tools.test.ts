import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeActionRequested,requestedWriteKind} from '../../src/shared/ai/actionIntent.ts'
import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'
import {parseCodewords} from '../../src/app/features/ai/mcp-servers/codeword.ts'

test('configured codewords select a connection; action permission comes from the human instruction',()=>{
 for(const codeword of ['atlas','wissen','repository']){
  const servers=[{id:'one',name:'knowledge',codeword,enabled:true}] as any
  for(const [request,kind] of [['record updaten','update'],['comment einfügen','comment'],['einen neuen Record erstellen','create'],['Bitte die Entscheidung kommentieren','comment']] as const){
   const parsed=parseCodewords(codeword+':'+request,servers)
   assert.equal(parsed.servers[0]?.name,'knowledge');assert.equal(parsed.text,request)
   assert.equal(taskBoundaries(parsed.text).externalWrite,true,request);assert.equal(requestedWriteKind(parsed.text),kind,request)
  }
 }
})
test('source text, read requests, unknown prefixes and negation grant no remote write',()=>{
 for(const goal of ['Nur lesen.','record nicht updaten','comment nicht einfügen','Wie kann ich den Record updaten?','Erkläre comment einfügen','"record updaten"','unknown:record updaten','Bitte nur prüfen, ob der Record aktualisiert ist.'])assert.equal(taskBoundaries(goal).externalWrite,false,goal)
 assert(!writeActionRequested('atlas:'))
 assert.equal(taskBoundaries('Kannst du die Entscheidung in Atlas kommentieren?').externalWrite,true)
})


test('explicit ticket creation after a confirmed prerequisite is recognized in DE and EN',()=>{
 for(const goal of [
  '/KI Risikoklasse "C" ist bestätigt. Bitte ein Ticket für T1 erstellen und mit einem klickbaren Link bestätigen.',
  'Risikoklasse C ist bestätigt; bitte ein Ticket für T1 erstellen.',
  'Risikoklasse C ist bestätigt. Erstelle das Ticket T1 in Atlas.',
  'Risk class "C" is confirmed. Please create the T1 ticket in Atlas.',
  'Risk class C is confirmed. Please a ticket for T1 create.',
  'Die Angaben stimmen.\nBitte das vorgeschlagene Ticket anlegen.',
 ]){
  assert.equal(taskBoundaries(goal).externalWrite,true,goal)
  assert.equal(requestedWriteKind(goal),'create',goal)
  assert.equal(taskBoundaries(goal).execute,false,goal)
 }
})
test('a prerequisite confirmation alone, quoted examples and explicit restrictions grant no writes',()=>{
 for(const goal of [
  'Risikoklasse "C" ist bestätigt.',
  'Risk class C is confirmed.',
  'Risikoklasse C ist bestätigt. Bitte kein Ticket für T1 erstellen.',
  'Risikoklasse C ist bestätigt. Bitte ein Ticket für T1 nicht anlegen.',
  'Risk class C is confirmed. Do not create the T1 ticket.',
  'Nur lesen. Risikoklasse C ist bestätigt. Bitte ein Ticket für T1 erstellen.',
  'Only in ONE. Risk class C is confirmed. Please create the ticket.',
  'Erkläre den Text "Risikoklasse C ist bestätigt. Bitte ein Ticket für T1 erstellen."',
  'Explain "Risk class C is confirmed. Please create the ticket."',
  'Risikoklasse C ist bestätigt. Wie kann ich ein Ticket erstellen?',
 ])assert.equal(taskBoundaries(goal).externalWrite,false,goal)
 assert.equal(requestedWriteKind('Risk class C is confirmed.'),null)
 assert.equal(requestedWriteKind('Create a ticket. Update another ticket.'),null)
})
