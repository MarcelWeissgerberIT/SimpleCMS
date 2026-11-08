import assert from 'node:assert/strict'
import {test} from 'node:test'
import {searchHits} from '../../src/shared/mcp/searchHits.ts'
test('connected search renders real evidence links and refuses opaque or unsafe targets',()=>{
 const raw=JSON.stringify({content:[{type:'text',text:JSON.stringify({results:[{title:'Guide',url:'https://example.test/guide',snippet:'Read this'},{title:'Guide',url:'https://example.test/guide',snippet:'duplicate'},{title:'Opaque',id:'guid-only'},{name:'Unsafe',url:'javascript:alert(1)',description:'Plain text remains'},{name:'Credentials',url:'https://user:secret@example.test/',description:'No credential links'}]})}]})
 assert.deepEqual(searchHits(raw),[{title:'Guide',url:'https://example.test/guide',snippet:'Read this'},{title:'Unsafe',url:null,snippet:'Plain text remains'},{title:'Credentials',url:null,snippet:'No credential links'}])
 assert.equal(searchHits(JSON.stringify(Array.from({length:1000},(_,i)=>({title:String(i),snippet:'result'})))).length,30)
 assert.deepEqual(searchHits('{broken'),[])
})
