import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {overviewSources,overviewSignature,overviewPreview,overviewChildren,overviewEligible,overviewScope,overviewScopeSignature,overviewScopeSources,currentOverviewSignature,sanitizeOverviewFollowUp,parseOverview,sanitizeOverview,sanitizeOverviewReviews} from '../../src/app/shell/page/overview/model.ts'
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


test('selected descendant scope excludes hidden/private/database branches, qualifies duplicate block ids and invalidates on child edits',()=>{
 const make=(id:string,parentId:string|null,extra:any={})=>({...page,id,parentId,kind:'page',order:0,trashed:false,databaseId:null,settings:{},...extra}) as any
 const root=make('root',null),child=make('child','root'),nested=make('nested','child'),hidden=make('hidden','root',{hidden:true}),inside=make('inside','hidden'),privatePage=make('private','root',{private:true}),db=make('db','root',{kind:'database'}),row=make('row','db',{databaseId:'db'})
 const pages=Object.fromEntries([root,child,nested,hidden,inside,privatePage,db,row].map(p=>[p.id,p]))
 assert.deepEqual(overviewChildren(root,pages).map(p=>p.id),['child','nested'])
 assert.throws(()=>overviewScope(root,pages,['private']))
 const scope=overviewScope(root,pages,['nested','child','child'])
 assert.deepEqual(scope.map(p=>p.id),['root','child','nested'])
 const sources=overviewScopeSources(scope);assert.equal(new Set(sources.map(s=>s.id)).size,3)
 const card={...item,sourceId:sources[1].id,sourcePageId:'forged'}
 const sig=overviewScopeSignature(scope),overview=parseOverview(JSON.stringify({items:[card]}),sources,sig,'de')
 assert.equal(overview.items[0].sourcePageId,'child');assert.equal(overview.items[0].sourceBlockId,'block-a')
 overview.sourcePages=scope.map(p=>({id:p.id,title:p.title,signature:overviewSignature(p)}));root.overview=overview
 assert.equal(currentOverviewSignature(root,pages),sig)
 assert.deepEqual(sanitizeOverview(overview),overview)
 child.title='Changed';assert.notEqual(currentOverviewSignature(root,pages),sig)
 child.parentId=null;assert.equal(currentOverviewSignature(root,pages),'unavailable')
 assert.deepEqual(sanitizeOverviewFollowUp({pageId:'root',itemId:overview.items[0].id,unwanted:true}),{pageId:'root',itemId:overview.items[0].id})
 assert.equal(sanitizeOverviewFollowUp({pageId:'root',itemId:'bad'}),undefined)
})

test('template sections survive storage and reject unsupported or mismatched assignments',()=>{
 const value={...item,section:'summary'}
 const result=parseOverview(JSON.stringify({items:[value,{...item,kind:'finding',section:'pending'}]}),sources,signature,'de','review')
 assert.equal(result.template,'review');assert.deepEqual(sanitizeOverview(result),result)
 for(const section of ['approval','summary',undefined])assert.throws(()=>parseOverview(JSON.stringify({items:[value,{...item,kind:'finding',section}]}),sources,signature,'de','review'))
 assert.equal(sanitizeOverview({...result,template:'invented'}),undefined)
 assert.equal(sanitizeOverview({...result,items:[{...result.items[0],section:'pending'}]}),undefined)
})


test('template scope accepts other pages but rejects hidden ancestors, private scope, cycles and database rows',()=>{
 const make=(id:string,parentId:string|null=null,extra:any={})=>({...page,id,parentId,kind:'page',order:0,trashed:false,databaseId:null,settings:{},...extra}) as any
 const root=make('root'),other=make('other'),hidden=make('hidden',null,{hidden:true}),inside=make('inside','hidden'),privatePage=make('private',null,{private:true}),cycle=make('cycle','cycle'),row=make('row',null,{databaseId:'db'})
 const pages=Object.fromEntries([root,other,hidden,inside,privatePage,cycle,row].map(p=>[p.id,p]))
 assert.deepEqual(overviewEligible(root,pages).map(p=>p.id),['other'])
 assert.throws(()=>overviewScope(root,pages,['other']))
 assert.deepEqual(overviewScope(root,pages,['other'],true).map(p=>p.id),['root','other'])
 for(const id of ['inside','private','cycle','row'])assert.throws(()=>overviewScope(root,pages,[id],true))
 const scope=overviewScope(root,pages,['other'],true),sig=overviewScopeSignature(scope)
 root.overview={template:'review',sourcePages:scope.map(p=>({id:p.id,title:p.title,signature:overviewSignature(p)}))}
 assert.equal(currentOverviewSignature(root,pages),sig)
 other.title='Updated';assert.notEqual(currentOverviewSignature(root,pages),sig)
 other.trashed=true;assert.equal(currentOverviewSignature(root,pages),'unavailable')
})
