import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {installMockCollaboration,trackMockUndo} from '../../src/shared/collaboration/mock.ts'
import {checkpointMock,mockVersionKey} from '../../src/shared/ai/mockReview.ts'
const preview={title:'Controls',document:'<p>Before</p>',width:640,height:320,createdAt:'2026-11-08',htmlHash:'',targetUrl:''}
function node(d:Y.Doc){return d.getXmlFragment('default').get(0) as Y.XmlElement}
function read(d:Y.Doc){return node(d).getAttribute('spec') as any}
function write(d:Y.Doc,fn:(s:any)=>any){node(d).setAttribute('spec',fn(structuredClone(read(d))))}
function pair(){
 const a=new Y.Doc();installMockCollaboration(Y,a,()=>true)
 const n=new Y.XmlElement('designMock');n.setAttribute('spec',{preview,source:'',requirement:'',request:''} as any)
 a.getXmlFragment('default').insert(0,[n])
 const b=new Y.Doc();installMockCollaboration(Y,b,()=>true);Y.applyUpdate(b,Y.encodeStateAsUpdate(a));return {a,b}
}
function sync(a:Y.Doc,b:Y.Doc){for(let i=0;i<3;i++){Y.applyUpdate(a,Y.encodeStateAsUpdate(b),'remote');Y.applyUpdate(b,Y.encodeStateAsUpdate(a),'remote')}assert.deepEqual(read(a),read(b))}
function add(s:any,id:string){s=checkpointMock(s,'Initial');s.journal.notes.push({id,at:'2026-11-08',version:mockVersionKey(s.preview),element:{path:'button',tag:'button',text:'Save',component:'Button',requirement:'',snippet:''},text:id,intent:'check',scope:'mock',resolved:false,md:'none'});return s}
test('independent offline additions survive both reconnect orders, reload and JSON import',()=>{
 for(const reverse of [false,true]){
  const {a,b}=pair();write(a,s=>add(s,'owner'));write(b,s=>add(s,'reviewer'));sync(...(reverse?[b,a]:[a,b]) as [Y.Doc,Y.Doc])
  assert.deepEqual(read(a).journal.notes.map((n:any)=>n.id),['owner','reviewer'])
  const c=new Y.Doc();installMockCollaboration(Y,c,()=>true);Y.applyUpdate(c,Y.encodeStateAsUpdate(a));assert.deepEqual(read(c),read(a))
  const imported=new Y.Doc();installMockCollaboration(Y,imported,()=>true);const n=new Y.XmlElement('designMock');n.setAttribute('spec',structuredClone(read(a)));imported.getXmlFragment('default').insert(0,[n]);assert.deepEqual(read(imported),read(a))
  for(const d of [a,b,c,imported])d.destroy()
 }
})
test('note resolution and Markdown decision merge independently; removal wins over stale field update',()=>{
 const {a,b}=pair();write(a,s=>add(s,'note'));sync(a,b)
 write(a,s=>{s.journal.notes[0].resolved=true;return s});write(b,s=>{s.journal.notes[0].md='pending';return s});sync(a,b)
 assert.equal(read(a).journal.notes[0].resolved,true);assert.equal(read(a).journal.notes[0].md,'pending')
 write(a,s=>{s.journal.notes=[];return s});write(b,s=>{s.journal.notes[0].text='Updated offline';return s});sync(a,b)
 assert.deepEqual(read(a).journal.notes,[])
 a.destroy();b.destroy()
})
test('preview change and note append keep both previews and the note target',()=>{
 const {a,b}=pair()
 write(a,s=>{s=checkpointMock(s,'Before');s.preview={...s.preview,document:'<p>After</p>'};return checkpointMock(s,'After')})
 write(b,s=>add(s,'older-preview-note'));sync(a,b)
 assert.equal(read(a).preview.document,'<p>After</p>');assert.equal(read(a).journal.versions.length,2)
 assert.equal(read(a).journal.notes[0].version,mockVersionKey(preview));a.destroy();b.destroy()
})
test('deleted/reinserted block does not inherit the old element log; read-only replicas do not write',()=>{
 const {a,b}=pair();write(a,s=>add(s,'old'));sync(a,b)
 a.getXmlFragment('default').delete(0,1)
 const n=new Y.XmlElement('designMock');n.setAttribute('spec',{preview,request:'New'} as any);a.getXmlFragment('default').insert(0,[n]);sync(a,b)
 assert.deepEqual(read(a).journal.notes,[])
 const c=new Y.Doc();installMockCollaboration(Y,c,()=>false);let local=0;c.on('update',(_u,_o,_d,tr)=>{if(tr.local)local++});Y.applyUpdate(c,Y.encodeStateAsUpdate(a));assert.equal(local,0);assert.deepEqual(read(c),read(a))
 a.destroy();b.destroy();c.destroy()
})

test('legacy recovery reads the losing copy, retains its unique notes and keeps current decisions',async()=>{
 const {recoverLegacyMockNotes}=await import('../../src/shared/collaboration/mockLegacy.ts')
 const {a,b}=pair();write(a,s=>add(s,'shared'));sync(a,b)
 write(a,s=>{s.journal.notes[0].resolved=true;return s});write(b,s=>add(s,'offline-only'))
 const wrap=(s:any)=>({type:'doc',content:[{type:'designMock',attrs:{id:'same-block',spec:s},content:[{type:'paragraph'}]}]})
 const recovered=recoverLegacyMockNotes(wrap(read(a)),wrap(read(a)),wrap(read(b)))!
 const j=recovered.content![0].attrs!.spec.journal
 assert.equal(j.notes.length,2);assert.equal(j.notes.find((n:any)=>n.id==='shared').resolved,true)
 a.destroy();b.destroy()
})

test('concurrent additions beyond a creation limit retain all existing notes and snapshots',()=>{
 const {a,b}=pair();write(a,s=>{for(let i=0;i<149;i++)s=add(s,`note-${i}`);return s});sync(a,b)
 write(a,s=>add(s,'owner-last'));write(b,s=>add(s,'reviewer-last'));sync(a,b)
 assert.equal(read(a).journal.notes.length,151);a.destroy();b.destroy()
})

test('undo and redo remove only own operations after a peer added a note',()=>{
 const {a,b}=pair(),undo=new Y.UndoManager(a.getXmlFragment('default'))
 trackMockUndo(undo)
 write(a,s=>add(s,'owner'));undo.stopCapturing();sync(a,b)
 write(b,s=>add(s,'reviewer'));sync(a,b)
 undo.undo();sync(a,b);assert.deepEqual(read(a).journal.notes.map((n:any)=>n.id),['reviewer'])
 undo.redo();sync(a,b);assert.deepEqual(read(a).journal.notes.map((n:any)=>n.id).sort(),['owner','reviewer'])
 undo.destroy();a.destroy();b.destroy()
})

test('editable child text merges independently from journal operations',()=>{
 const {a,b}=pair()
 const paragraph=new Y.XmlElement('paragraph'),text=new Y.XmlText();paragraph.insert(0,[text]);node(a).insert(0,[paragraph]);sync(a,b)
 text.insert(0,'A title');write(b,s=>add(s,'feedback'));sync(a,b)
 assert.equal((node(a).get(0) as Y.XmlElement).toString(),'<paragraph>A title</paragraph>')
 assert.equal(read(a).journal.notes.length,1);a.destroy();b.destroy()
})
