import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DOC_SCHEMA_VERSION,NODE_GENERATIONS,asGeneration,restoreNewer} from '../../src/app/store/generations.ts'
const paragraph=(text:string)=>({type:'paragraph',content:[{type:'text',text}]})
for(const gen of [1,2,3,4])for(const mode of ['drop','unwrap'] as const)test('generation '+gen+' '+mode+' copy preserves the mock while keeping the older tab edits',()=>{
 assert(DOC_SCHEMA_VERSION>=3);assert.equal(NODE_GENERATIONS.designMock,5)
 const mock={type:'designMock',content:[paragraph('Mock preview')],attrs:{id:'mock-id',spec:{request:'CyBio head',source:'https://aj-atlas.com/r/12'}}}
 const before={type:'doc',content:[paragraph('Before'),mock,paragraph('After')]}
 const older=asGeneration(before,gen,mode)
 older.content![0]=paragraph('Edited before')
 const restored=restoreNewer(before,older,gen,mode)
 assert.deepEqual(restored!.content?.find(n=>n.type==='designMock'),mock)
 assert.equal(restored!.content?.[0].content?.[0].text,'Edited before')
})

test('an older generation-2 edit retains the journal while keeping its preview change',()=>{
 const journal={id:'j',versions:[{key:'v1'}],notes:[{text:'Use a badge',elements:[{path:'a'},{path:'b'}]}]}
 const before={type:'doc',content:[{type:'designMock',attrs:{id:'m',spec:{request:'Original',journal}},content:[paragraph('Mock')]}]}
 const after={type:'doc',content:[{type:'designMock',attrs:{id:'m',spec:{request:'Edited in old tab'}},content:[paragraph('Renamed')]}]}
 for(const gen of [2,3,4])for(const mode of ['drop','unwrap'] as const){
  const restored=restoreNewer(before,after,gen,mode)!
  assert.deepEqual(restored.content![0].attrs!.spec.journal,journal)
  assert.equal(restored.content![0].attrs!.spec.request,'Edited in old tab')
  assert.equal(restored.content![0].content![0].content![0].text,'Renamed')
 }
})
