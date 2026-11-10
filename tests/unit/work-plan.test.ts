import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseWorkPlan,reviewedWorkItems,workOutputId,workOutputs,workReceipt} from '../../src/app/features/workbench/workPlan.ts'
import {workProperties,workRow} from '../../src/app/features/workbench/workDatabase.ts'
import {workTemplates,recommendedWorkTemplate} from '../../src/app/features/workbench/workTemplates.ts'
import {sanitizeDeskRecords,deskSourceVisible,type Card} from '../../src/app/features/workbench/model.ts'
const item={title:'Clarify SSO scope',detail:'The sources disagree about SSO support.',criterion:'Record the agreed authentication scope.',cards:['a','b']}
const data={title:'Authentication follow-up',summary:'Two selected sources; the scope is unresolved.',items:[item]}
const parse=(x:unknown)=>parseWorkPlan(JSON.stringify(x),['a','b'])
test('work drafts accept only supplied source IDs and bounded complete items',()=>{
 assert.deepEqual(parse(data).items[0],{...item,id:'item-0'})
 for(const change of [{cards:[]},{cards:['invented']},{cards:['a','a']},{title:' '},{detail:''},{criterion:'x'.repeat(1001)},{owner:'invented'}])assert.throws(()=>parse({...data,items:[{...item,...change}]}))
 assert.throws(()=>parse({...data,items:Array.from({length:21},()=>item)}))
 assert.throws(()=>parse({...data,title:''}))
 assert.deepEqual(parse({...data,items:[]}).items,[])
})
test('human edits preserve exact attribution and may select a subset, never introduce an item',()=>{
 const plan=parse({...data,items:[item,{...item,title:'Review implementation',cards:['b']}]})
 assert.equal(reviewedWorkItems(plan,[{...plan.items[1],title:'Inspect current implementation'}],['a','b'])[0].id,'item-1')
 for(const rows of [[],[{...plan.items[0],cards:['b']}],[{...plan.items[0],id:'other'}],[plan.items[0],plan.items[0]],[{...plan.items[0],detail:' '}]])assert.throws(()=>reviewedWorkItems(plan,rows,['a','b']))
})
const card=(id:string,kind:'page'|'note'='page'):Card=>({type:'card',id,title:'Source '+id,detail:'Interpretation '+id,source:{kind,pageId:'source-'+id,blockId:'paragraph-'+id,quote:'Exact quotation '+id,signature:'',label:'Source '+id},x:0,y:0,group:'',level:kind==='note'?0:3,evidence:'Earlier run',evidenceUrl:'',at:1,by:'Tester'})
test('working rows preserve full quotes and deep links, start open and never infer owners, dates or results',()=>{
 for(const t of workTemplates(true)){
  const row=workRow({...item,id:'item-0'},[card('a'),card('b','note')],'desk','Clarify scope',t.id,true),json=JSON.stringify(row.content)
  assert.equal(row.properties['work-status'],'work-open')
  for(const field of ['work-owner','work-due','work-response'])assert.equal((row.properties as any)[field],undefined)
  assert(json.includes('Exact quotation a'));assert(json.includes('Exact quotation b'))
  assert(json.includes('#/p/source-a?b=paragraph-a'));assert(json.includes('#/p/desk'))
  assert(json.includes('Eigene Aussage / Annahme'));assert(json.includes('Interpretation a'))
  assert.equal(row.properties['work-count'],2)
  const props=workProperties(t.id,true)
  assert.equal(props.find(p=>p.id==='work-status')?.options?.[0].group,'todo')
  assert(props.some(p=>p.id==='work-criterion'&&p.name===t.criterion))
 }
 assert.throws(()=>workRow({...item,id:'item-0'},[card('a')],'desk','Scope','tasks',false))
})
test('work receipts persist through desk sanitization and do not confuse scenario or patch receipts',()=>{
 const receipt={type:'adoption',id:workOutputId('draft-1'),analysisId:'draft-1',index:-1,pageId:'db-1',after:JSON.stringify({template:'tasks',title:'Follow-up'}),at:1,by:'Tester'}
 const records=sanitizeDeskRecords({[receipt.id]:receipt,scenario:{...receipt,id:'scenario'},patch:{...receipt,id:'patch',index:0}})
 assert.deepEqual(workOutputs(records).map(r=>r.pageId),['db-1'])
 assert.deepEqual(workReceipt(receipt.after),{template:'tasks',title:'Follow-up'})
 assert.equal(workReceipt('{"template":"invented","title":"Other"}'),null)
 assert.equal(workReceipt('Earlier scenario'),null)
})
test('focus suggestions work in both UI languages',()=>{
 for(const dimension of ['Widersprüche','Contradictions','Offene Punkte','Open questions','conflicts'])assert.equal(recommendedWorkTemplate(dimension),'questions')
 for(const dimension of ['Prüfplan','Verification'])assert.equal(recommendedWorkTemplate(dimension),'checks')
 assert.equal(recommendedWorkTemplate('Entscheidung'),'decisions')
 assert.equal(recommendedWorkTemplate('Nächste Schritte'),'tasks')
})

test('source visibility follows ancestry, scope, trash and templates and rejects cycles',()=>{
 const pages:any={desk:{id:'desk'},root:{id:'root'},source:{id:'source',parentId:'root'}}
 assert.equal(deskSourceVisible(pages,'desk','source'),true)
 for(const patch of [{hidden:true},{trashed:true},{private:true},{template:true},{parentId:'missing'},{parentId:'source'}]){
  assert.equal(deskSourceVisible({...pages,root:{...pages.root,...patch}},'desk','source'),false)
 }
 assert.equal(deskSourceVisible(pages,'missing','source'),false)
 assert.equal(deskSourceVisible(pages,'desk','missing'),false)
 assert.equal(deskSourceVisible({desk:{id:'desk',private:true},root:{id:'root',private:true},source:{id:'source',private:true,parentId:'root'}} as any,'desk','source'),true)
})
