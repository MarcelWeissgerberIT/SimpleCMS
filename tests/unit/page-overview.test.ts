import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {overviewSources,overviewSignature,overviewPreview,parseOverview,sanitizeOverview,sanitizeOverviewReviews} from '../../src/app/shell/page/overview/model.ts'
import {writeOverviewReviews,readOverviewReviews} from '../../src/app/cloud/overview.ts'
const page={title:'Release',content:{type:'doc',content:[{type:'paragraph',attrs:{id:'block-a'},content:[{type:'text',text:'Das Team entscheidet über Tip Touch.'}]}]}}
const sources=overviewSources(page),signature=overviewSignature(page)
const item={kind:'summary',title:'Freigabe offen',detail:'Das Team muss den Umfang festlegen.',role:'',doneWhen:'',options:[],sourceId:'block-a',quote:sources[0].text}
const parsed=(items=[item])=>parseOverview(JSON.stringify({items}),sources,signature,'de')
test('overview is bounded and every card must quote its actual source; no invented passage',()=>{
 assert.equal(parsed().items[0].sourceId,'block-a')
 for(const bad of [{...item,quote:'Dieser Satz steht nicht in der Seite.'},{...item,sourceId:'other'},{...item,title:'a'.repeat(161)},{...item,kind:'action',doneWhen:''}])assert.throws(()=>parsed([bad]))
 assert.throws(()=>parsed([item,item]));assert.throws(()=>parsed([]));assert.throws(()=>parsed(Array(19).fill(item)))
})
test('source signatures ignore review metadata and change with actual source edits',()=>{
 assert.equal(overviewSignature({...page,overview:parsed()} as any),signature)
 assert.notEqual(overviewSignature({...page,title:'New title'}),signature)
 assert.equal(sources[0].blockId,'block-a')
})
test('stored input rejects malformed data and drops unexpected fields',()=>{
 assert.equal(sanitizeOverview({...parsed(),signature:'x'.repeat(64)}),undefined)
 assert.equal(sanitizeOverview({...parsed(),items:[]}),undefined)
 const x=parsed();assert.equal((sanitizeOverview({...x,items:[{...x.items[0],extra:'ignored'}]})!.items[0] as any).extra,undefined)
 assert.deepEqual(sanitizeOverviewReviews({bad:{}}),{})
})
test('concurrent first reviews of distinct items converge without losing either person’s work',()=>{
 const a=new Y.Doc(),b=new Y.Doc();a.getMap('page').set('title','Release');Y.applyUpdate(b,Y.encodeStateAsUpdate(a))
 const first=parsed().items[0],second=parsed([{...item,kind:'summary',quote:'entscheidet über Tip Touch.'}]).items[0]
 const review=(item:any,by:string)=>({item,signature,at:1,by,state:'confirmed',note:'Reviewed',owner:''})
 const left={[first.id]:review(first,'Anna')},right={[second.id]:review(second,'Ben')}
 writeOverviewReviews(a.getMap('page'),left);writeOverviewReviews(b.getMap('page'),right)
 const ua=Y.encodeStateAsUpdate(a),ub=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,ub);Y.applyUpdate(b,ua)
 assert.deepEqual(readOverviewReviews(a.getMap('page')),readOverviewReviews(b.getMap('page')))
 assert.equal(Object.keys(readOverviewReviews(a.getMap('page'))).length,2)
 writeOverviewReviews(a.getMap('page'),{},left)
 assert.equal(Object.keys(readOverviewReviews(a.getMap('page'))).length,2)
})

test('stream previews show only complete source-checked cards, even across escaped strings and byte-sized chunks',()=>{
 const values=[{...item,detail:'Text with "quotes", \\ escapes and {braces}.'},{...item,kind:'action',doneWhen:'Fachlich bestätigt.',title:'Klären'}]
 const raw=JSON.stringify({items:values}),feed=overviewPreview(sources,signature,'de')
 const counts:number[]=[]
 for(const c of raw){const next=feed(c);if(next)counts.push(next.length)}
 assert.deepEqual(counts,[1,2])
 const first=JSON.stringify({items:[values[0]]}).slice(0,-2)
 assert.equal(overviewPreview(sources,signature,'de')(first)?.length,1)
})
test('invalid or duplicate streamed cards never enter the preview; final validation remains mandatory',()=>{
 for(const bad of [{...item,quote:'Invented quotation that is not on the page.'},{...item,kind:'action',doneWhen:''},item]){
  const feed=overviewPreview(sources,signature,'de')
  assert.equal(feed('{"items":['+JSON.stringify(item))?.length,1)
  assert.equal(feed(','+JSON.stringify(bad)),undefined)
  assert.throws(()=>parsed([item,bad]))
 }
 assert.equal(overviewPreview(sources,signature,'de')('{"items":[{"kind":"summary"'),undefined)
})
