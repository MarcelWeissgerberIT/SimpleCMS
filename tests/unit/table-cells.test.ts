import {test} from 'node:test'
import assert from 'node:assert/strict'
import {snapshotTable, pageTableIds, parseCellAnswer, planCellPatches, resolveCellPatch, cellText, type TableNode} from '../../src/shared/ai/tableCells.ts'
const cell=(id:string,text='',type='tableCell'):TableNode=>({type,attrs:{colspan:1,rowspan:1,colwidth:[180],backgroundColor:'#ff5500'},content:[{type:'paragraph',attrs:{id,textAlign:'right'},content:text?[{type:'text',text}]:[]}]})
const fixture=():TableNode=>({type:'doc',content:[{type:'callout',attrs:{id:'plate',color:'orange',title:'Keep plate'},content:[{type:'table',attrs:{id:'table'},content:[{type:'tableRow',content:[cell('h1','Requirement','tableHeader'),cell('h2','Result','tableHeader')]},{type:'tableRow',content:[cell('a2','Original input'),cell('b2')]}]}]},{type:'paragraph',attrs:{id:'outside'},content:[{type:'text',text:'Keep outside'}]}]})
const table=(d:TableNode)=>d.content![0].content![0]
const patch=()=>planCellPatches(snapshotTable(fixture(),'table'),[{cellId:'b2',value:'Source-supported proposal'}],['b2'])[0]
test('addresses existing cells in a plate; cell values change without altering layout, attributes or unrelated content',()=>{
 const d=fixture(),before=structuredClone(d),p=patch(),resolved=resolveCellPatch(d,p)
 assert.deepEqual(pageTableIds(d),['table'])
 assert.deepEqual(snapshotTable(d,'table').cells.map(c=>c.address),['A1','B1','A2','B2'])
 assert.deepEqual(d,before)
 assert.deepEqual(resolved.after.attrs,resolved.before.attrs)
 assert.deepEqual(resolved.after.content![0].attrs,resolved.before.content![0].attrs)
 table(d).content![1].content![1]=resolved.after
 assert.equal(cellText(table(d).content![1].content![1]),p.value)
 const expected=fixture();table(expected).content![1].content![1]=resolved.after
 assert.deepEqual(d,expected)
})
test('concurrent unrelated cell edits survive; changed target, removed target and topology changes fail closed',()=>{
 const p=patch(),d=fixture();table(d).content![1].content![0]=cell('a2','Another member typed this')
 assert.equal(cellText(resolveCellPatch(d,p).after),p.value)
 table(d).content![1].content![1]=cell('b2','Another member owns this now')
 assert.throws(()=>resolveCellPatch(d,p),/changed/)
 const moved=fixture();table(moved).content![1].content!.reverse();assert.throws(()=>resolveCellPatch(moved,p),/changed/)
 const gone=fixture();table(gone).content!.pop();assert.throws(()=>resolveCellPatch(gone,p))
})
test('merged cells have actual coordinates and keep merged layout',()=>{
 const d=fixture(),tb=table(d);tb.content![0].content=[{...cell('h1','Header','tableHeader'),attrs:{colspan:2,rowspan:1}}]
 const s=snapshotTable(d,'table');assert.equal(s.columns,2);assert.deepEqual(s.cells.map(c=>c.address),['A1','A2','B2'])
 const p=planCellPatches(s,[{cellId:'b2',value:'ok'}])[0];assert.equal(resolveCellPatch(d,p).after.attrs?.colspan,1)
 tb.content![0].content![0].attrs!.colspan=1;assert.throws(()=>resolveCellPatch(d,p))
})
test('row spans skip occupied columns; malformed rectangular layout is refused',()=>{
 const d=fixture(),tb=table(d);tb.content![0].content![0].attrs!.rowspan=2;tb.content![1].content!.shift()
 assert.deepEqual(snapshotTable(d,'table').cells.map(c=>c.address),['A1','B1','B2'])
 tb.content![1].content!.pop();assert.throws(()=>snapshotTable(d,'table'))
})
test('rejects cells outside selected scope, duplicate IDs, malformed JSON, extra keys, wrong types and excessive output',()=>{
 for(const raw of ['nonsense','{"cells":{}}','{"cells":[{"cellId":"a2","value":"x"}]}','{"cells":[{"cellId":"b2","value":2}]}','{"cells":[{"cellId":"b2","value":"x","attrs":{}}]}','{"cells":[],"markdown":"x"}','{"cells":[{"cellId":"b2","value":"x"},{"cellId":"b2","value":"y"}]}',JSON.stringify({cells:[{cellId:'b2',value:'x'.repeat(4001)}]})]) assert.throws(()=>parseCellAnswer(raw,['b2']))
 assert.deepEqual(parseCellAnswer('```json\n{"cells":[]}\n```',['b2']),[])
 assert.deepEqual(parseCellAnswer('{"cells":[{"cellId":"b2","value":"a\\r\\nb"}]}',['b2']),[{cellId:'b2',value:'a\nb'}])
 assert.throws(()=>planCellPatches(snapshotTable(fixture(),'table'),[{cellId:'a2',value:'overwrite'}],['b2']))
})
test('rich atoms, nested blocks, missing or ambiguous anchors and foreign synced projections cannot be overwritten',()=>{
 for(const content of [[{type:'mention',attrs:{id:'person'}}],[{type:'image',attrs:{src:'onefile:keep'}}],[{type:'workItem',attrs:{id:'task'}}]]){
  const d=fixture();table(d).content![1].content![1].content![0].content=content
  assert.equal(snapshotTable(d,'table').cells.at(-1)?.editable,false)
  assert.throws(()=>planCellPatches(snapshotTable(d,'table'),[{cellId:'b2',value:'lost rich content'}]))
 }
 const duplicate=fixture();table(duplicate).content![1].content![0].content![0].attrs!.id='b2'
 assert.equal(snapshotTable(duplicate,'table').cells.at(-1)?.editable,false)
 const sync:TableNode={type:'doc',content:[{type:'syncedBlock',attrs:{sourcePageId:'foreign'},content:fixture().content}]}
 assert.deepEqual(pageTableIds(sync),[]);assert.throws(()=>snapshotTable(sync,'table'))
})
test('model text stays literal, line breaks work, no HTML/Markdown nodes or attributes are accepted',()=>{
 const d=fixture(),value='<script>alert(1)</script>\n[link](javascript:bad)\n=SUM(A1:A2)'
 const p=planCellPatches(snapshotTable(d,'table'),[{cellId:'b2',value}])[0]
 const after=resolveCellPatch(d,p).after
 assert.equal(cellText(after),value)
 assert.ok(after.content![0].content!.every(n=>n.type==='text'||n.type==='hardBreak'))
 assert.throws(()=>resolveCellPatch(d,{...p,value:'\u0000'}))
})
test('no-op proposals write nothing and source snapshots are independent of later object mutation',()=>{
 const d=fixture(),s=snapshotTable(d,'table')
 assert.deepEqual(planCellPatches(s,[{cellId:'a2',value:'Original input'}]),[])
 table(d).content![1].content![0].content![0].content![0].text='Changed'
 assert.equal(s.cells.find(c=>c.id==='a2')?.text,'Original input')
})
