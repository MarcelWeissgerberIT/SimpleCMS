import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mockEpic,epicSelection,isEpicMember} from '../../src/shared/ai/mockEpic.ts'
import {MockSources,mockIssues,type MockDraft} from '../../src/shared/ai/designMock.ts'
import {ensureMockDestination} from '../../src/shared/ai/mockDestination.ts'
const members=Array.from({length:79},(_,i)=>({ref:100+i,name:i===0?'Color':i===1?'Button':'Part '+i,category:i<9?'Foundation':'Component'}))
const root={ref:42,title:'Design V5',kind:'epic',project:'flux-client',tags:['ui-package:design-v5'],body:'# Design library\nThese are the actual design package members.\n<!-- ui-collection-members: '+JSON.stringify(members)+' -->'}
test('large Epic navigation selects only requested members and shared foundations',()=>{
 const epic=mockEpic(root,'https://atlas.test/r/42')!
 assert.equal(epic.members.length,79);assert.equal(epicSelection(epic,[110,111,110]).length,11)
 assert.throws(()=>epicSelection(epic,[999]));assert.equal(mockEpic({...root,kind:'doc'},epic.url),null)
 for(const patch of [{project:'other'},{parent:{ref:43}},{tags:[]},{ref:999},{archived:true}])assert(!isEpicMember(epic,{...root,ref:110,parent:{ref:42},...patch}))
})
test('citations can span verified Epic children but never arbitrary records',()=>{
 const sources=new MockSources(),observe=(item:any)=>sources.observe('atlas','https://atlas.test','atlas_get',{ref:item.ref},JSON.stringify({item}))!
 const r=observe(root);sources.selectDesign(r.id)
 const body='Button uses the exact primary colour #A50034 and spacing 8px.'
 const child=observe({...root,kind:'doc',ref:110,title:'Button',parent:{ref:42},body})
 const draft:MockDraft={title:'New use case',width:960,height:640,html:'<button>Test</button>',css:'button{color:var(--primary)}',design:{source:r.id,quote:'These are the actual design package members.'},authority:null,target:null,requirements:[],tokens:[{source:child.id,name:'--primary',value:'#A50034',quote:body}],components:[{source:child.id,name:'Button',quote:body}],notes:[]}
 assert(mockIssues(draft,sources).length);sources.acceptEpicMember(child.id);assert.deepEqual(mockIssues(draft,sources),[])
 const alien=observe({...root,ref:111,title:'Alien',parent:{ref:666},body});assert.throws(()=>sources.acceptEpicMember(alien.id))
})
test('all selected children retain original excerpts within one context budget',()=>{
 const sources=new MockSources(),observe=(item:any)=>sources.observe('atlas','https://atlas.test','atlas_get',{ref:item.ref},JSON.stringify({item}))!
 sources.selectDesign(observe(root).id)
 for(const m of members.slice(0,17)){const body='# '+m.name+'\n\n## Originaldokumentation\nExact design value #A50034.\n'+'x'.repeat(200000);sources.acceptEpicMember(observe({...root,...m,title:m.name,kind:'doc',parent:{ref:42},body}).id)}
 const context=sources.context();assert.equal(context.length,18);assert(context.every(s=>s.excerpts.length));assert(context.reduce((n,s)=>n+s.excerpts.reduce((m,e)=>m+e.text.length,0),0)<=36000)
 assert(context.slice(1).every(s=>s.excerpts.some(e=>e.text.includes('Exact design value #A50034.'))))
})
test('new mock is linked by parent and package tag; retry reuses the same child',async()=>{
 let child:any=null,creates=0
 const a:any={id:'11111111-2222-3333-4444-555555555555',htmlHash:'abc',title:'New case',request:'Select a head',sources:[],draft:{notes:[]},atlasContext:mockEpic(root,'https://atlas.test/r/42')}
 const call=async(name:string,args:any)=>{
  if(name==='atlas_search')return {rows:child?[{ref:200}]:[]}
  if(name==='atlas_constraints')return {constraints:[]}
  if(name==='atlas_create'){creates++;child={...args,ref:200,parent:{ref:Number(args.parent)}};return {item:child}}
  if(name==='atlas_get')return {item:args.ref===42?root:child}
  throw Error(name)
 }
 assert.equal((await ensureMockDestination(a,call)).ref,200);assert.equal((await ensureMockDestination(a,call)).ref,200);assert.equal(creates,1)
 assert(child.tags.includes('ui-package:design-v5'));assert(child.body.includes('Select a head'))
 child.parent={ref:99};await assert.rejects(()=>ensureMockDestination(a,call))
})
