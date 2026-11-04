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
