import {test} from 'node:test'
import assert from 'node:assert/strict'
import {atlasReceipt,atlasTaskEffect} from '../../src/shared/mcp/facts.ts'
import {collectPolarionPdf,polarionPdfReceipt,readPolarionPdf,POLARION_PDF_CHUNK_BYTES as chunkBytes} from '../../src/shared/mcp/polarionPdf.ts'
import {sha256Hex} from '../../src/shared/mcp/sha256.ts'
const bytes=new TextEncoder().encode('%PDF-1.4\n'+'.'.repeat(chunkBytes)+'\n%%EOF'),job='11111111-1111-4111-8111-111111111111'
const pdf={name:'original.pdf',mime:'application/pdf' as const,bytes:bytes.length,sha256:sha256Hex(bytes),sourceUrl:'https://p2-polarion.pc-c.endress.com/polarion/#/project/CASE/wiki/Space/Document',exportedAt:'2026-11-11T14:00:00.000Z'}
const data={job,status:'done',result:{status:'exported',source:'polarion-native-pdf',pdf}}
const part=(index:number)=>({job,index,chunkBytes,pdf,data:Buffer.from(bytes.subarray(index*chunkBytes,(index+1)*chunkBytes)).toString('base64')})
test('only a completed native export status creates a PDF action',()=>{
 assert.deepEqual(polarionPdfReceipt('atlas_polarion_status',data),{job,pdf})
 for(const invalid of [{...data,status:'running'},{...data,job:'bad'},{...data,result:{...data.result,source:'generated'}},{...data,result:{status:'auth_required',pdf}}])assert.equal(polarionPdfReceipt('atlas_polarion_status',invalid),undefined)
 assert.equal(polarionPdfReceipt('atlas_search',data),undefined)
 assert.equal(atlasReceipt('atlas_polarion_status',data,true).polarionPdf,undefined)
 assert.deepEqual(atlasReceipt('atlas_polarion_status',data).polarionPdf,{job,pdf})
 for(const name of ['atlas_polarion_export_pdf','atlas_polarion_pdf_chunk'])assert.equal(atlasTaskEffect(name,{}),'read')
})
test('rejects untrusted or excessive metadata',()=>{
 for(const change of [{name:'../../x.pdf'},{name:'x.html'},{bytes:20*1024*1024+1},{bytes:-1},{sha256:'x'},{sourceUrl:pdf.sourceUrl.replace('endress.com','evil.com')},{sourceUrl:pdf.sourceUrl.replace('/Document','/%2Fetc')},{mime:'text/html'},{exportedAt:'never'}])assert.equal(readPolarionPdf({...pdf,...change}),undefined)
})
test('reassembles multiple chunks to the exact original bytes',async()=>{
 const progress:number[]=[]
 assert.deepEqual(await collectPolarionPdf({job,pdf},async i=>part(i),n=>progress.push(n)),bytes)
 assert.deepEqual(progress,[chunkBytes,bytes.length])
})
test('rejects incomplete, reordered, cross-job and changed metadata chunks',async()=>{
 for(const mutation of [{job:'22222222-2222-4222-8222-222222222222'},{index:1},{chunkBytes:1},{data:'AAAA'},{data:'!!!!'},{pdf:{...pdf,name:'other.pdf'}}])await assert.rejects(collectPolarionPdf({job,pdf},async i=>({...part(i),...mutation})))
})
test('rejects matching-length corrupted bytes and HTML disguised as PDF',async()=>{
 await assert.rejects(collectPolarionPdf({job,pdf},async i=>{
  const p=part(i),b=Buffer.from(p.data,'base64');b[20]=65;return {...p,data:b.toString('base64')}
 }),/checksum/)
 const html=new TextEncoder().encode('<html>sign in</html>'),meta={...pdf,bytes:html.length,sha256:sha256Hex(html)}
 await assert.rejects(collectPolarionPdf({job,pdf:meta},async index=>({job,index,chunkBytes,pdf:meta,data:Buffer.from(html).toString('base64')})),/validation/)
})
