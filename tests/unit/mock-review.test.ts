import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkpointMock,adoptMockPreview,mockVersionKey,mockNoteHash,mockMarkdownTask,MOCK_VERSION_LIMIT,type MockFeedback} from '../../src/shared/ai/mockReview.ts'
import {mockBlockData,type MockBlockData,type MockBlockPreview} from '../../src/shared/ai/mockBlock.ts'
import {sha256Hex} from '../../src/shared/mcp/sha256.ts'
const preview=(label:string):MockBlockPreview=>({title:label,document:'<body><button>'+label+'</button></body>',width:960,height:640,createdAt:'2026-11-05T00:00:00Z',htmlHash:sha256Hex('<body><button>'+label+'</button></body>'),targetUrl:''})
const data=():MockBlockData=>({source:'https://atlas.example/r/12',requirement:'',request:'Status',preview:preview('original')})
const note=(d:MockBlockData):MockFeedback=>({id:'note-1',at:'2026-11-05',version:mockVersionKey(d.preview!),element:{path:'body > button:nth-of-type(1)',tag:'button',text:'Status',component:'Label',requirement:'',snippet:'<button>Status</button>'},text:'Use a badge instead of a label',intent:'replace',scope:'mock',resolved:false,md:'none'})
test('notes retain exact snapshots through replacement, restoration and serialisation',()=>{
 let d=checkpointMock(data(),'initial');d.journal!.notes.push(note(d));d=adoptMockPreview(d,preview('revised'))
 const read=mockBlockData(JSON.parse(JSON.stringify(d)));assert.equal(read.journal!.versions.length,2);assert.equal(read.journal!.notes[0].element.component,'Label');assert.equal(read.journal!.versions[0].preview.document,data().preview!.document)
 const restored=checkpointMock({...read,preview:read.journal!.versions[0].preview},'restored');assert.equal(restored.journal!.versions.length,2);assert.equal(restored.journal!.notes.length,1)
})
test('a proposed design-system change stays queued even after mock completion',()=>{
 let d=checkpointMock(data(),'initial');const n=note(d);d.journal!.notes.push(n)
 d=adoptMockPreview(d,preview('revised'),{journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash:mockNoteHash(n)}],assessments:[{id:n.id,scope:'design-system',reason:'Catalogue has no suitable badge variant.',proposal:'Document the status badge and its mapping.',refs:[12]}]})
 assert.equal(d.journal!.notes[0].md,'pending');d.journal!.notes[0].resolved=true
 const read=mockBlockData(d);assert.equal(read.journal!.notes[0].md,'pending');assert.match(mockMarkdownTask(read,read.journal!.notes[0]),/Noch nichts schreiben/);assert.match(mockMarkdownTask(read,read.journal!.notes[0]),/Document the status badge/)
})
test('stale note assessments cannot overwrite newer feedback',()=>{
 let d=checkpointMock(data(),'initial');const n=note(d);d.journal!.notes.push(n);const hash=mockNoteHash(n);n.text='Keep the original label'
 d=adoptMockPreview(d,preview('revised'),{journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash}],assessments:[{id:n.id,scope:'design-system',reason:'Old assessment',proposal:'Old proposal',refs:[12]}]})
 assert.equal(d.journal!.notes[0].assessment,undefined)
})
test('version capacity blocks a new checkpoint without silently dropping history',()=>{
 let d=data();for(let i=0;i<MOCK_VERSION_LIMIT;i++)d=checkpointMock({...d,preview:preview('v'+i)},'version')
 assert.throws(()=>checkpointMock({...d,preview:preview('overflow')},'extra'),/30 Versionen/);assert.equal(d.journal!.versions.length,30)
})

test('server Markdown exports saved feedback and pending MD work without historical HTML',async()=>{
 const {blocksMarkdown}=await import('../../server/src/api/markdown.ts')
 const d=checkpointMock(data(),'initial');d.journal!.notes.push({...note(d),resolved:true,md:'pending'})
 const md=blocksMarkdown([{type:'designMock',attrs:{spec:d},children:[]}],{title:()=>null})
 assert.match(md,/Use a badge instead of a label/);assert.match(md,/mock resolved; MD pending/);assert(!md.includes('<button>'))
})

test('a revision cannot overwrite a mock edited since its request',()=>{
 let d=checkpointMock(data(),'initial');const base=mockVersionKey(d.preview!)
 d=checkpointMock({...d,preview:preview('edited later')},'later')
 assert.throws(()=>adoptMockPreview(d,preview('stale result'),{journal:d.journal!.id,base,notes:[],assessments:[]}),/seit diesem KI-Auftrag/)
})
