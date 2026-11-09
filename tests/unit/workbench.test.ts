import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {sanitizeDeskRecords,basisOf,resolutionCurrent,sourceState,type Card} from '../../src/app/features/workbench/model.ts'
import {writeWorkbench,readWorkbench} from '../../src/app/cloud/workbench.ts'
import {overviewSignature} from '../../src/app/shell/page/overview/model.ts'
const page:any={id:'page',title:'Scope',content:{type:'doc',content:[{type:'paragraph',attrs:{id:'block'},content:[{type:'text',text:'SSO remains open.'}]}]}}
const card=(id='a'):Card=>({type:'card',id,at:1,by:'Anna',title:'Scope',detail:'SSO remains open.',source:{kind:'page',pageId:'page',blockId:'block',quote:'SSO remains open.',signature:overviewSignature(page),label:'Scope'},x:0,y:0,group:'',level:1,evidence:'',evidenceUrl:''})
test('concurrent initial cards and independent edits survive cloud synchronization and tombstones',()=>{
 const a=new Y.Doc(),b=new Y.Doc();a.getMap('page').set('workbench',true);Y.applyUpdate(b,Y.encodeStateAsUpdate(a))
 writeWorkbench(a.getMap('page'),{a:card()});writeWorkbench(b.getMap('page'),{b:card('b')})
 const merge=()=>{const ua=Y.encodeStateAsUpdate(a),ub=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,ub);Y.applyUpdate(b,ua);assert.deepEqual(readWorkbench(a.getMap('page')),readWorkbench(b.getMap('page')))}
 merge();assert.equal(Object.keys(readWorkbench(a.getMap('page'))).length,2)
 const before=readWorkbench(a.getMap('page'))
 writeWorkbench(a.getMap('page'),{...before,a:{...card(),removed:true}},before)
 writeWorkbench(b.getMap('page'),{...before,b:{...card('b'),x:280}},before)
 merge();const records=readWorkbench(a.getMap('page'));assert.equal((records.a as Card).removed,true);assert.equal((records.b as Card).x,280)
 writeWorkbench(a.getMap('page'),{},records);assert.equal(Object.keys(readWorkbench(a.getMap('page'))).length,2)
})
test('an assessment stays with its assessor when someone else moves a card',()=>{
 const c={...card(),level:3,assessment:{at:2,by:'Tester'},evidence:'Run 42 passed',evidenceUrl:'https://example.com/run/42',by:'Mover',at:3,x:280}
 assert.deepEqual((sanitizeDeskRecords({a:c}).a as Card).assessment,{at:2,by:'Tester'})
 assert.equal(basisOf([c]),basisOf([{...c,x:500,y:500,by:'Other',at:4}]))
 assert.notEqual(basisOf([c]),basisOf([{...c,detail:'Different interpretation'}]))
})
test('changed source or card invalidates a previously resolved thread',()=>{
 const c=card(),d:any={type:'decision',id:'d',at:1,by:'Anna',text:'Keep scope open',cards:['a'],basis:basisOf([c])},l:any={type:'link',id:'l',at:1,by:'Anna',a:'a',b:'b',relation:'conflict',detail:'Disagreement',resolution:'d'},records={a:c,d,l}
 assert.equal(resolutionCurrent(l,records,{page}),true)
 assert.equal(resolutionCurrent(l,records,{page:{...page,title:'Changed'}}),false)
 assert.equal(resolutionCurrent(l,{...records,a:{...c,removed:true}},{page}),false)
 assert.equal(sourceState({...c,source:{...c.source,quote:'Invented'}},{page}),'changed')
})
test('malformed imported records and unsafe links cannot become actionable cards',()=>{
 assert.deepEqual(sanitizeDeskRecords({a:{...card(),x:Infinity}}),{})
 assert.deepEqual(sanitizeDeskRecords({a:{...card(),source:{...card().source,kind:'code',code:{bad:true}}}}),{})
 assert.equal((sanitizeDeskRecords({a:{...card(),evidenceUrl:'javascript:alert(1)'}}).a as Card).evidenceUrl,'')
 assert.equal((sanitizeDeskRecords({a:{...card(),source:{...card().source,kind:'note'},level:4}}).a as Card).level,0)
})

import {requireModelProcessing} from '../../src/app/features/code-evidence/modelPermission.ts'
test('Atlas model permission is explicit, follows pagination, and refuses malformed catalogues',async()=>{
 const calls:any[]=[];await requireModelProcessing('wanted',async(name,args)=>{calls.push({name,args});return args.offset===10?{items:[{id:'wanted',modelProcessing:true}],next:null}:{items:[{id:'other',modelProcessing:true}],next:10}})
 assert.deepEqual(calls.map(c=>c.args),[{}, {offset:10}])
 for(const data of [null,{error:'denied',items:[]},{items:[{id:'wanted',modelProcessing:false}],next:null},{items:[{id:'wanted'}],next:null},{items:[],next:0},{items:[],next:'invalid'}])await assert.rejects(requireModelProcessing('wanted',async()=>data))
})


test('a question dimension and its selected cards survive cloud serialization',()=>{
 const focus:any={type:'focus',id:'focus',dimension:'Open questions',question:'What evidence is missing?',cards:['a'],at:1,by:'Anna'}
 const d=new Y.Doc();writeWorkbench(d.getMap('page'),{a:card(),focus})
 assert.deepEqual(readWorkbench(d.getMap('page')).focus,focus)
 assert.deepEqual(sanitizeDeskRecords({focus:{...focus,cards:[]}}),{})
 assert.deepEqual(sanitizeDeskRecords({focus:{...focus,question:' '}}),{})
 assert.deepEqual(sanitizeDeskRecords({focus:{...focus,cards:Array.from({length:21},(_,i)=>String(i))}}),{})
})
