import {test} from 'node:test'
import assert from 'node:assert/strict'
import {needsAtlasTransferChoice,atlasTransferTask,atlasTransferChoice,atlasTransferEffectAllowed,naturalAtlasTransferMode} from '../../src/shared/quandprofile/atlas-transfer.ts'
import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'
test('natural ambiguous transfer requests open a delivery choice, including the actual Kai wording',()=>{
 for(const goal of ['Bitte trage die getroffenen Entscheidungen in die betreffenden Atlas-Tickets ein.','Kannst du das nach Atlas bringen?','Das bitte in Atlas speichern.','Bitte mit Atlas syncen.','Übertrage die Entscheidungen nach Atlas.','Transfer the result to Atlas.'])assert(needsAtlasTransferChoice(goal),goal)
 assert(needsAtlasTransferChoice('Bitte nach Atlas übertragen, als Kommentar oder einen neuen Atlas-Record anlegen.'))
 assert(needsAtlasTransferChoice('Trag das bitte ein.',['Lies die Atlas-Tickets.']))
 assert(!needsAtlasTransferChoice('Trag das bitte ein.'))
})
test('precise operations, read-only questions, negation and quoted examples do not open a transfer dialog',()=>{
 for(const goal of ['Kommentiere die Entscheidungen in Atlas.','Übertrage als Kommentare nach Atlas.','Speichere in einem neuen Atlas-Record.','Aktualisiere Atlas Record 42.','Wie kann ich nach Atlas übertragen?','Kannst du prüfen, ob das nach Atlas übertragen wurde?','Nur prüfen: bitte in Atlas eintragen.','Bitte nicht nach Atlas übertragen.','Do not transfer this to Atlas.','Erkläre „Übertrage nach Atlas“.','/ba Atlas requirement'])assert(!needsAtlasTransferChoice(goal),goal)
})
test('human choice binds one write mode while source reads remain allowed',()=>{
 for(const mode of ['create','update','comment'] as const){const task=atlasTransferTask('Bitte nach Atlas übertragen.',mode);assert.equal(atlasTransferChoice(task),mode);assert.equal(taskBoundaries(task).externalWrite,true);assert.equal(taskBoundaries(task).execute,false);assert(atlasTransferEffectAllowed(mode,'atlas:atlas_get','read'));for(const other of ['create','update','comment'] as const)assert.equal(atlasTransferEffectAllowed(mode,'atlas:atlas_'+other,'write'),mode===other);for(const [name,effect]of [['edit_page','stage'],['atlas:atlas_delete','write'],['atlas:atlas_agent_trigger','execute']])assert(!atlasTransferEffectAllowed(mode,name,effect))}
})

test('clear polite write requests keep the stated mode without a redundant question',()=>{
 for(const text of ['Kannst du die Entscheidung in Atlas kommentieren?','Bitte trage das in Atlas als Kommentar ein.','Please add a comment in Atlas.'])assert.equal(naturalAtlasTransferMode(text),'comment')
 assert.equal(naturalAtlasTransferMode('Kannst du den Inhalt in Atlas aktualisieren?'),'update')
 assert.equal(naturalAtlasTransferMode('Bitte einen neuen Atlas-Record anlegen.'),'create')
 for(const text of ['Kannst du prüfen, ob der Atlas-Kommentar erstellt wurde?','Wie kann ich in Atlas kommentieren?','Bitte nur prüfen: den Atlas-Kommentar lesen.','Bitte lies die Atlas-Kommentare.','Bitte erkläre, wie ich neue Atlas-Records anlegen kann.','Kannst du erklären, wie ich in Atlas kommentieren kann?','Bitte den Kommentar in Atlas lesen.','Ich möchte wissen, wie man in Atlas kommentiert.','Can you tell me how to comment in Atlas?','Bitte überlege, ob wir neue Atlas-Records anlegen sollten.'])assert.equal(naturalAtlasTransferMode(text),null,text)
})
