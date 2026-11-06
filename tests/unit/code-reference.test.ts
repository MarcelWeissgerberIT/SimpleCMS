import {test} from 'node:test'
import assert from 'node:assert/strict'
import {codeReference,checkedCodeExcerpt} from '../../src/shared/mcp/codeReference.ts'
const citation={repo:'repo-a',snapshot:'snapshot-a',commit:'a'.repeat(40),path:'src/run.ts',lines:[5,7],digest:'d'.repeat(64)}
const ref=codeReference(JSON.stringify({citation,highlight:[6,6],finding:'Validation missing'}))!
test('portable reference preserves full evidence but drops source bytes, credentials and unsafe links',()=>{
 const got=codeReference(JSON.stringify({...ref,token:'SECRET',text:'CODE',atlasUrl:'javascript:alert(1)'}))!
 assert.deepEqual(got,ref);assert.deepEqual(codeReference(JSON.stringify(citation))!.citation,citation)
 assert.equal(codeReference(JSON.stringify({...ref,highlight:[4,6]})),null)
 assert.equal(codeReference(JSON.stringify({...ref,highlight:[6,8]})),null)
 assert.equal(codeReference(JSON.stringify({...ref,citation:{...citation,lines:[1,2001]}})),null)
})
test('source viewer accepts exact excerpts including final newline without shifting absolute line numbers',()=>{
 const got=checkedCodeExcerpt({citation,text:'first\r\nsecond\r\nthird\r\n'},ref,false)
 assert.deepEqual(got.lines,['first','second','third']);assert.deepEqual(got.citation.lines,[5,7])
})
test('wrong version, digest, file, truncated and wrong line count fail closed',()=>{
 for(const patch of [{snapshot:'new'}, {commit:'new'}, {path:'other.ts'}, {digest:'different'}, {lines:[4,6]}])assert.throws(()=>checkedCodeExcerpt({citation:{...citation,...patch},text:'a\nb\nc'},ref,false))
 for(const patch of [{truncated:true},{text:'a\nb'},{error:'no access'}])assert.throws(()=>checkedCodeExcerpt({citation,text:'a\nb\nc',...patch},ref,false))
})
test('context may widen a verified citation but never move it to another snapshot or omit the finding',()=>{
 const wide={...citation,lines:[4,8],digest:'w'.repeat(64)}
 assert.deepEqual(checkedCodeExcerpt({citation:wide,text:'a\nb\nc\nd\ne'},ref,true).citation.lines,[4,8])
 assert.throws(()=>checkedCodeExcerpt({citation:{...wide,commit:'new'},text:'a\nb\nc\nd\ne'},ref,true))
 assert.throws(()=>checkedCodeExcerpt({citation:{...wide,lines:[6,10]},text:'a\nb\nc\nd\ne'},ref,true))
})
