import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkpointMock,adoptMockPreview,mockVersionKey,mockSourcesKey,currentMockSourceCheck,mockNoteHash,mockMarkdownTask,mockReviewTask,mockReviewSource,mockReviewUnavailable,MOCK_VERSION_LIMIT,type MockFeedback} from '../../src/shared/ai/mockReview.ts'
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

test('one note retains multiple targets, hashes every target and passes them to Markdown context',()=>{
 const d=checkpointMock(data(),'initial'),n=note(d),second={...n.element,path:'body > button:nth-of-type(2)',text:'Second status'}
 const legacyHash=mockNoteHash(n);n.elements=[n.element,second];d.journal!.notes.push(n)
 const read=mockBlockData(JSON.parse(JSON.stringify(d))),saved=read.journal!.notes[0]
 assert.deepEqual(saved.elements,[n.element,second]);assert.notEqual(mockNoteHash(saved),legacyHash)
 const hash=mockNoteHash(saved);saved.elements![1].text='Newer feedback target'
 assert.notEqual(mockNoteHash(saved),hash)
 assert.throws(()=>adoptMockPreview(read,preview('updated'),{journal:read.journal!.id,base:mockVersionKey(read.preview!),notes:[{id:n.id,hash}],assessments:[]}),/Notiz wurde inzwischen geändert/)
 assert.match(mockMarkdownTask(d,n),/Second status/)
})

test('free rectangles survive persistence, participate in approval hashes and retain Markdown context',()=>{
 const d=checkpointMock(data(),'initial'),n=note(d)
 n.region={x:12,y:24,width:220,height:140,viewportWidth:960,viewportHeight:640,targets:[{path:n.element.path,text:'Status',component:'Label',x:20,y:30,width:40,height:20}],totalTargets:1,scrolls:[]}
 d.journal!.notes.push(n)
 const read=mockBlockData(JSON.parse(JSON.stringify(d)))
 assert.deepEqual(read.journal!.notes[0].region,n.region)
 assert.match(mockMarkdownTask(read,read.journal!.notes[0]),/"region":\{"x":12/)
 const hash=mockNoteHash(n);n.region.x=13;assert.notEqual(mockNoteHash(n),hash)
 assert.throws(()=>adoptMockPreview(d,preview('new'),{journal:d.journal!.id,base:mockVersionKey(d.preview!),notes:[{id:n.id,hash}],assessments:[]}),/Notiz wurde inzwischen geändert/)
})
test('malformed rectangle annotations cannot silently become whole-body instructions',()=>{
 for(const region of [{x:-1},{x:0,y:0,width:100,height:100,viewportWidth:960,viewportHeight:640,targets:[],totalTargets:0,scrolls:[],},null]){
  const d=checkpointMock(data(),'initial'),n=note(d)
  n.region=region as any;if(region?.x===0)n.region!.width=Infinity
  d.journal!.notes.push(n);assert.equal(mockBlockData(d).journal!.notes.length,0)
 }
})

test('human fulfilment is bound to a saved version and is retained as feedback data',()=>{
 const d=checkpointMock(data(),'initial'),n=note(d);n.reviewed={version:mockVersionKey(d.preview!),result:'partial',at:'2026-11-08T10:00:00Z'};d.journal!.notes.push(n)
 const read=mockBlockData(d);assert.equal(read.journal!.notes[0].reviewed?.result,'partial');assert.equal(read.journal!.notes[0].resolved,false)
 n.reviewed.version='missing';assert.equal(mockBlockData(d).journal!.notes[0].reviewed,undefined)
})
test('source check receipts require a saved matching preview and source identity',()=>{
 const d=checkpointMock(data(),'initial')
 const source={id:'s1',ref:12,title:'Design',server:'atlas',url:'https://atlas.example/r/12',hash:'a'.repeat(64),stateHash:'b'.repeat(64),readAt:'2026-11-08T10:00:00Z'}
 const receipt={id:'11111111-1111-4111-8111-111111111111',sources:[source],draft:{title:'Example',width:960,height:640,design:{source:'s1',quote:'Badge definition'},authority:null,target:null,requirements:[],tokens:[{name:'--primary',value:'#a50034',source:'s1',quote:'Badge definition'}],components:[{name:'Badge',source:'s1',quote:'Badge definition'}],notes:[]},target:null}
 d.preview!.provenance=receipt as any
 const next=checkpointMock(d,'source version')
 next.journal!.sourceCheck={version:mockVersionKey(next.preview!),sourceHash:mockSourcesKey(next.preview!),rows:[{ref:12,url:source.url,title:'Design',changed:true,at:'2026-11-08T10:00:00Z'}]}
 assert.equal(mockBlockData(next).journal?.sourceCheck?.rows[0].changed,true)
 const changed=structuredClone(next);changed.preview!.provenance!.sources[0].hash='c'.repeat(64);assert.equal(currentMockSourceCheck(changed),undefined)
 next.journal!.sourceCheck.rows[0].url='https://unrelated.example/r/12'
 assert.equal(mockBlockData(next).journal?.sourceCheck,undefined)
})
