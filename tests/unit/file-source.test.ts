import {test} from 'node:test'
import assert from 'node:assert/strict'
import {makeSource, sourceChunks, validateAnalysis} from '../../src/app/features/ai/file/source/model.ts'
test('all 137 pages including text beyond 200k survive bounded analysis slices exactly',()=>{
 const pages=Array.from({length:137},(_,i)=>({number:i+1,text:`PAGE-${i+1}: `+'A'.repeat(2100)+` END-${i+1}`}))
 const source=makeSource('register.pdf','hash',pages)
 assert.equal(source.totalPages,137);assert.ok(source.characters>200000)
 const recovered=new Map<number,string>()
 for(const c of source.chunks){assert.ok(c.text.length<=10000);for(const part of c.text.matchAll(/\[Page (\d+)\]\n([\s\S]*?)(?:\n\n)(?=\[Page |$)/g))recovered.set(+part[1],(recovered.get(+part[1])??'')+part[2])}
 assert.deepEqual([...recovered],pages.map(p=>[p.number,p.text]))
 assert.match(source.chunks.at(-1)!.text,/END-137/)
})
test('small chunks terminate and missing pages cannot claim complete extraction',()=>{
 assert.equal(sourceChunks([{number:1,text:'x'.repeat(300)}],100).length,4)
 assert.throws(()=>makeSource('x','h',[{number:2,text:'missing first'}],2),/Incomplete/)
 assert.deepEqual(makeSource('x','h',[{number:1,text:''}]).emptyPages,[1])
})
test('invented quotations and quotes on a different page are refused',()=>{
 const s=makeSource('x','h',[{number:1,text:'The system shall record the start time.'},{number:2,text:'The system shall end the session.'}])
 const result={summary:'Inventory',findings:[{page:1,quote:'The system shall record',finding:'Record the start time.'}],limitations:[]}
 assert.deepEqual(validateAnalysis(result,s.chunks[0],s),result)
 assert.throws(()=>validateAnalysis({...result,findings:[{...result.findings[0],page:2}]},s.chunks[0],s),/unverified/)
 assert.throws(()=>validateAnalysis({...result,findings:[{...result.findings[0],quote:'The system supports everything.'}]},s.chunks[0],s),/unverified/)
})
