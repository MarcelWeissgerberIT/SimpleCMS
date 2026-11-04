import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DOC_SCHEMA_VERSION,NODE_GENERATIONS,asGeneration,restoreNewer} from '../../src/app/store/generations.ts'
const paragraph=(text:string)=>({type:'paragraph',content:[{type:'text',text}]})
for(const mode of ['drop','unwrap'] as const)test('an older '+mode+' copy preserves the mock while keeping the older tab edits',()=>{
 assert(DOC_SCHEMA_VERSION>=2);assert.equal(NODE_GENERATIONS.designMock,2)
 const mock={type:'designMock',content:[paragraph('Mock preview')],attrs:{id:'mock-id',spec:{request:'CyBio head',source:'https://aj-atlas.com/r/12'}}}
 const before={type:'doc',content:[paragraph('Before'),mock,paragraph('After')]}
 const older=asGeneration(before,1,mode)
 older.content![0]=paragraph('Edited before')
 const restored=restoreNewer(before,older,1,mode)
 assert.deepEqual(restored!.content?.find(n=>n.type==='designMock'),mock)
 assert.equal(restored!.content?.[0].content?.[0].text,'Edited before')
})
