import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mockBlockData,mockBlockTask,mockSourceUrl,mockBlockFrame} from '../../src/shared/ai/mockBlock.ts'
test('design links do not persist authentication query parameters',()=>{
 assert.equal(mockSourceUrl('https://aj-atlas.com/docs/p/design?token=secret#x'),'https://aj-atlas.com/docs/p/design')
 for(const u of ['javascript:alert(1)','http://atlas.test/r/1','https://person:secret@atlas.test/r/1'])assert.equal(mockSourceUrl(u),'')
})
test('drafts require source, actual requirement record and request; preparing makes a normal /mock task',()=>{
 const s=mockBlockData({source:'https://aj-atlas.com/r/12',requirement:'#14',request:'Create a head selector dialog'})
 assert.match(mockBlockTask(s)!,/^\/mock Create a head selector dialog/);assert.match(mockBlockTask(s)!,/https:\/\/aj-atlas.com\/r\/12/);assert.match(mockBlockTask(s)!,/#14/)
 for(const key of ['source','request','requirement'])assert.equal(mockBlockTask({...s,[key]:''}),null)
})
test('pasted or malformed blocks cannot supply unbounded preview payloads or invalid dimensions',()=>{
 assert.equal(mockBlockData('{broken').preview,null)
 const preview={title:'Mock',document:'<p>Visible</p>',width:960,height:640}
 assert.equal(mockBlockData({preview}).preview?.width,960)
 for(const patch of [{width:Infinity},{width:99999},{height:-1},{document:'x'.repeat(160001)}])assert.equal(mockBlockData({preview:{...preview,...patch}}).preview,null)
})
test('stored preview documents always receive the host CSP before their own content',()=>{
 const html=mockBlockFrame('<meta http-equiv="Content-Security-Policy" content="default-src *"><script>evil()</script>')
 assert(html.startsWith('<meta http-equiv="Content-Security-Policy"'));assert(html.indexOf("script-src 'none'")<html.indexOf('<script>'));assert(html.includes("form-action 'none'"))
})

test('server Markdown keeps the request and source while omitting the HTML payload',async()=>{
 const {blocksMarkdown}=await import('../../server/src/api/markdown.ts')
 const md=blocksMarkdown([{type:'designMock',attrs:{spec:{source:'https://aj-atlas.com/r/12',requirement:'#14',request:'Select a CyBio head',preview:{title:'Head dialog',document:'<script>never export this</script>',width:960,height:640}}},children:[{type:'paragraph',attrs:{},children:[{text:'My block title',marks:{}}]}]}],{title:()=>null})
 assert(md.includes('My block title'));assert(md.includes('Select a CyBio head'));assert(md.includes('https://aj-atlas.com/r/12'));assert(!md.includes('<script>'))
})

test('cloud creation waits for generation two and never bypasses viewer or outdated state',async()=>{
 const {mockBlocksAllowed}=await import('../../src/shared/ai/mockBlock.ts')
 const c={active:{kind:'cloud'},readOnly:false,outdated:false,schemaMin:null as number|null}
 for(const schemaMin of [null,0,1])assert.equal(mockBlocksAllowed({...c,schemaMin}),false)
 assert.equal(mockBlocksAllowed({...c,schemaMin:2}),true)
 assert.equal(mockBlocksAllowed({...c,active:{kind:'local'}}),true)
 assert.equal(mockBlocksAllowed({...c,schemaMin:2,readOnly:true}),false)
 assert.equal(mockBlocksAllowed({...c,schemaMin:2,outdated:true}),false)
})
