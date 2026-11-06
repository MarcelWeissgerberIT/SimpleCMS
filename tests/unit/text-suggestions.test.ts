import {test} from 'node:test'
import assert from 'node:assert/strict'
import {textValueSuggestions} from '../../src/app/database/model/textSuggestions.ts'
const page=(id:string,extra:Record<string,unknown>={})=>({id,title:id,parentId:null,properties:{},createdAt:1,updatedAt:2,...extra}) as any
const prop={id:'area',name:'Area',type:'text'} as const
test('suggestions stay in the current column and exclude hidden, deleted, template and private sources',()=>{
 const pages={db:page('db'),public:page('public',{databaseId:'db',parentId:'db',properties:{area:'Design',other:'Not this column'}}),private:page('private',{databaseId:'db',parentId:'db',private:true,properties:{area:'Private context'}}),hidden:page('hidden',{databaseId:'db',parentId:'db',hidden:true,properties:{area:'Hidden context'}}),deleted:page('deleted',{databaseId:'db',parentId:'db',trashed:true,properties:{area:'Deleted context'}}),other:page('other',{databaseId:'other-db',properties:{area:'Other database'}}),template:page('template',{template:true}),templateRow:page('templateRow',{databaseId:'db',parentId:'template',properties:{area:'Template context'}})}
 assert.deepEqual(textValueSuggestions(pages,'db',prop).map(x=>x.value),['Design'])
 assert.deepEqual(new Set(textValueSuggestions(pages,'db',prop,'private').map(x=>x.value)),new Set(['Design','Private context']))
 pages.db.trashed=true;assert.deepEqual(textValueSuggestions(pages,'db',prop),[])
})
test('saving a new text value automatically extends suggestions without changing the property type',()=>{
 const pages={db:page('db'),a:page('a',{databaseId:'db',parentId:'db',properties:{area:'Design'}}),b:page('b',{databaseId:'db',parentId:'db',properties:{area:'New custom area'}})}
 assert.deepEqual(new Set(textValueSuggestions(pages,'db',prop).map(x=>x.value)),new Set(['Design','New custom area']))
 assert.equal(prop.type,'text');assert.equal('options' in prop,false)
 pages.b.properties.area='';assert.deepEqual(textValueSuggestions(pages,'db',prop).map(x=>x.value),['Design'])
})
test('unique/custom fields and prose/secrets never become reusable column choices',()=>{
 const pages={db:page('db'),a:page('a',{databaseId:'db',parentId:'db',properties:{area:'vault:secret:1234'}}),b:page('b',{databaseId:'db',parentId:'db',properties:{area:'First line\nSecond line'}})}
 assert.deepEqual(textValueSuggestions(pages,'db',prop),[])
 pages.a.properties.area='Normal value';assert.deepEqual(textValueSuggestions(pages,'db',{...prop,key:true}),[]);assert.deepEqual(textValueSuggestions(pages,'db',{...prop,custom:'custom'}),[])
})
