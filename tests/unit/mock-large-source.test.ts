import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {MockSources} from '../../src/shared/ai/designMock.ts'
import {McpResults} from '../../src/shared/mcp/results.ts'
import {sha256Hex} from '../../src/shared/mcp/sha256.ts'
test('multi-megabyte source remains complete while exact excerpts and model pages stay bounded',()=>{
 const body=process.env.MOCK_REFERENCE_MD?readFileSync(process.env.MOCK_REFERENCE_MD,'utf8'):'# Reference\n### Farben\nPrimary #a50034.\n### Schriftfamilien\nsystem-ui\n'+('Component details.\n'.repeat(200000))+'\n### HeadSelector\nActual head selection. End of source.'
 assert(body.length>3000000)
 const raw=JSON.stringify({content:[{type:'text',text:JSON.stringify({item:{ref:12,title:'Design MD',body}})}]}),cache=new McpResults(),packed=cache.pack(raw),s=new MockSources()
 const source=s.observe('atlas','https://aj-atlas.com','atlas_get',{ref:12},raw)!;assert(source);s.selectedDesign=source.id
 assert.equal(s.get(source.id)!.hash,sha256Hex(body));assert.equal(cache.materialize(packed),raw)
 assert(packed.length<4500)
 const context=s.context(undefined,'/mock Dialog for choosing a CyBio head'),windows=context[0].excerpts
 assert(windows.reduce((n,w)=>n+w.text.length,0)<=17000);assert(context[0].partial)
 for(const w of windows)assert.equal(w.text,body.slice(w.offset,w.offset+w.text.length))
 const text=windows.map(w=>w.text).join('\n');assert(text.includes('Farben'));assert(text.includes('Schriftfamilien'))
 if(process.env.MOCK_REFERENCE_MD){assert(text.includes('--brand-primary'));assert(/_C\d+/.test(text));assert(text.includes('#a50034'))}
 assert(JSON.stringify(context).length<22000)
})
