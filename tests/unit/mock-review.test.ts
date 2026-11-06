import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkpointMock,adoptMockPreview,mockVersionKey,mockNoteHash,mockMarkdownTask,mockReviewTask,mockReviewSource,mockReviewUnavailable,MOCK_VERSION_LIMIT,type MockFeedback} from '../../src/shared/ai/mockReview.ts'
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
 assert.throws(()=>adoptMockPreview(d,preview('revised'),{journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash}],assessments:[{id:n.id,scope:'design-system',reason:'Old assessment',proposal:'Old proposal',refs:[12]}]}),/Notiz wurde inzwischen geändert/)
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


test('legacy preview feedback prepares a fresh source read without fabricating a receipt',()=>{
 const d=checkpointMock(data(),'legacy');d.journal!.notes.push(note(d));d.requirement='#42'
 const restored=mockBlockData(JSON.parse(JSON.stringify(d))),task=mockReviewTask(restored,'page-1')!
 assert.match(task,/Atlas design source: https:\/\/atlas.example\/r\/12/)
 assert.match(task,/Atlas requirement record: #42/)
 assert.match(task,/One mock review:/)
 assert.match(task,/Use a badge instead/)
 assert.equal(restored.preview!.provenance,undefined)
 assert.equal(mockReviewUnavailable(restored),null)
 assert.match(mockMarkdownTask(restored,restored.journal!.notes[0]),/https:\/\/atlas.example\/r\/12/)
})
test('feedback explains missing source, resolved notes, missing preview and oversized document',()=>{
 const d=checkpointMock(data(),'legacy');d.journal!.notes.push(note(d))
 assert.equal(mockReviewUnavailable({...d,source:''}),'source')
 assert.equal(mockReviewTask({...d,source:''},'page-1'),null)
 assert.equal(mockReviewSource({...d,source:'javascript:alert(1)'}),'')
 assert.equal(mockReviewUnavailable({...d,preview:null}),'preview')
 assert.equal(mockReviewUnavailable({...d,preview:{...d.preview!,document:'x'.repeat(160001)}}),'size')
 d.journal!.notes[0].resolved=true;assert.equal(mockReviewUnavailable(d),'notes')
})

test('accepted feedback records its resulting version without completing pending Markdown work',()=>{
 let d=checkpointMock(data(),'initial');const n=note(d);d.journal!.notes.push(n)
 const review={journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash:mockNoteHash(n)}],assessments:[{id:n.id,scope:'design-system' as const,reason:'Shared variant needed',proposal:'Document badge mapping',refs:[12]}]}
 d=adoptMockPreview(d,preview('revised'),review)
 const saved=mockBlockData(JSON.parse(JSON.stringify(d))),feedback=saved.journal!.notes[0]
 assert.equal(feedback.appliedIn,mockVersionKey(saved.preview!));assert.equal(feedback.resolved,false);assert.equal(feedback.md,'pending')
 assert.equal(mockReviewTask(saved,'p1'),null)
 feedback.appliedIn=undefined;assert.match(mockReviewTask(saved,'p1')!,/Use a badge/)
 feedback.appliedIn='nonexistent';assert.equal(mockBlockData(saved).journal!.notes[0].appliedIn,undefined)
})

test('an adopted revision remains traceable when the separate design-system assessment was unavailable',()=>{
 let d=checkpointMock(data(),'initial');const n={...note(d),scope:'design-system' as const,md:'pending' as const};d.journal!.notes.push(n)
 d=adoptMockPreview(d,preview('revised'),{journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash:mockNoteHash(n)}],assessments:[]})
 assert.equal(d.journal!.notes[0].appliedIn,mockVersionKey(d.preview!));assert.equal(d.journal!.notes[0].md,'pending');assert.equal(d.journal!.notes[0].assessment,undefined)
})

test('pending proposals survive JSON, keep base unchanged and reject stale or overflowing drafts',async()=>{
 const {stageMockProposal}=await import('../../src/shared/ai/mockReview.ts')
 let d=checkpointMock(data(),'initial');const n=note(d);d.journal!.notes.push(n)
 const review={journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash:mockNoteHash(n)}],assessments:[]}
 const original=d.preview!.document
 for(let i=0;i<8;i++)d=stageMockProposal(d,{id:'proposal-'+i,preview:preview('new'+i),review,status:'pending'})
 const restored=mockBlockData(JSON.parse(JSON.stringify(d)))
 assert.equal(restored.preview!.document,original);assert.equal(restored.journal!.proposals!.length,8)
 assert.throws(()=>stageMockProposal(d,{id:'overflow',preview:preview('extra'),review,status:'pending'}),/prüfen/)
 assert.throws(()=>stageMockProposal({...d,preview:preview('changed')},{id:'stale',preview:preview('extra'),review,status:'pending'}),/geändert/)
})
test('Markdown checkpoints retain uncertainty and verified receipt but reject a forged base hash',async()=>{
 const {readMarkdownChange}=await import('../../src/shared/ai/mockReview.ts')
 const c={ref:12,url:'https://atlas.example/r/12',before:'Original Markdown',after:'Revised Markdown',beforeHash:sha256Hex('Original Markdown'),state:'uncertain' as const}
 assert.equal(readMarkdownChange(JSON.parse(JSON.stringify(c)))!.state,'uncertain')
 assert.equal(readMarkdownChange({...c,before:'Unexpected edit'}),undefined)
 assert.equal(readMarkdownChange({...c,state:'verified',verifiedAt:'2026-11-06'})!.verifiedAt,'2026-11-06')
})
