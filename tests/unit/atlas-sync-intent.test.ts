import test from 'node:test'
import assert from 'node:assert/strict'
import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'
import {requestedWriteKind} from '../../src/shared/ai/actionIntent.ts'
test('explicit human Atlas sync permits the requested effect without granting execution',()=>{
 for(const goal of ['synce diese seite mit einem neuen atlas records type dossier in flux-client','Bitte synchronisiere diese Seite nach Atlas.','Sync this page to a new Atlas record.','Synchronize this page with Atlas.','screibe diese Seite in Atlas','schreibe in Atlas einen Record','leg in atlas an','lege in Atlas an']){
  assert.deepEqual(taskBoundaries(goal),{readOnly:false,externalWrite:true,execute:false,authenticate:false},goal)
 }
 assert.equal(requestedWriteKind('synce diese seite mit einem neuen atlas records type dossier in flux-client'),'create')
 assert.equal(requestedWriteKind('Sync this page to an existing Atlas record'),'update')
 assert.equal(requestedWriteKind('Sync this page with Atlas'),'create')
 for(const goal of ['synce nach Atlas','screibe diese Seite in Atlas','schreibe diese Seite in Atlas','leg in Atlas an','lege in Atlas an'])assert.equal(requestedWriteKind(goal),'create',goal)
})
test('sync examples, questions, local destinations and negations do not authorize external effects',()=>{
 for(const goal of ['Warum geht sync nach Atlas nicht?','Wie synchronisiere ich die Seite nach Atlas?','Erkläre „synce diese Seite nach Atlas“.','Bitte synce diese Seite nicht nach Atlas.','Do not sync this page with Atlas.','Sync this page to Atlas. Read only.','Nur in ONE arbeiten. Synce diese Seite nach Atlas.','Sync this page in ONE.','Synce keine Records nach Atlas.','Screibe nichts in Atlas.','Schreibe keine Records in Atlas.','Wie lege ich in Atlas an?','Erkläre „screibe diese Seite in Atlas“.','Schreibe eine Zusammenfassung in ONE.'])assert.equal(taskBoundaries(goal).externalWrite,false,goal)
})

test('continuation is limited to the concrete task with proven non-executed writes',async()=>{
 const {canResumeAtlasWrite,atlasResumeTask}=await import('../../src/app/features/ai/agent/atlasResume.ts')
 const turn:any={n:1,status:'done',task:'synce diese seite mit einem neuen atlas records type dossier in flux-client'}
 const blocked:any={turn:1,mcp:{tool:'atlas_create',notExecuted:true},state:'err'}
 assert.equal(canResumeAtlasWrite(turn,[blocked]),true)
 assert.equal(taskBoundaries(atlasResumeTask(turn.task)).externalWrite,true)
 for(const status of ['running'])assert.equal(canResumeAtlasWrite({...turn,status},[blocked]),false)
 assert.equal(canResumeAtlasWrite(turn,[{...blocked,turn:2}]),false)
 assert.equal(canResumeAtlasWrite(turn,[{...blocked,mcp:{tool:'atlas_create'}}]),false)
 assert.equal(canResumeAtlasWrite(turn,[blocked,{turn:1,mcp:{tool:'atlas_update',receipt:{effect:'write_accepted'}}} as any]),false)
 assert.equal(canResumeAtlasWrite({...turn,task:'Nur lesen. Synce nach Atlas'},[blocked]),false)
})
