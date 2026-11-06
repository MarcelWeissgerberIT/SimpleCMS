import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mockBlockData,mockBlockTask,mockSourceUrl,mockBlockFrame} from '../../src/shared/ai/mockBlock.ts'
test('design links do not persist authentication query parameters',()=>{
 assert.equal(mockSourceUrl('https://aj-atlas.com/docs/p/design?token=secret#x'),'https://aj-atlas.com/docs/p/design')
 for(const u of ['javascript:alert(1)','http://atlas.test/r/1','https://person:secret@atlas.test/r/1'])assert.equal(mockSourceUrl(u),'')
})
test('drafts require source and request; requirement is optional; preparing makes a normal /mock task',()=>{
 const s=mockBlockData({source:'https://aj-atlas.com/r/12',requirement:'#14',request:'Create a head selector dialog'})
 assert.match(mockBlockTask(s)!,/^\/mock Create a head selector dialog/);assert.match(mockBlockTask(s)!,/https:\/\/aj-atlas.com\/r\/12/);assert.match(mockBlockTask(s)!,/#14/)
 for(const key of ['source','request'])assert.equal(mockBlockTask({...s,[key]:''}),null)
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

test('cloud creation waits for generation four and never bypasses viewer or outdated state',async()=>{
 const {mockBlocksAllowed}=await import('../../src/shared/ai/mockBlock.ts')
 const c={active:{kind:'cloud'},readOnly:false,outdated:false,schemaMin:null as number|null}
 for(const schemaMin of [null,0,1,2])assert.equal(mockBlocksAllowed({...c,schemaMin}),false)
 assert.equal(mockBlocksAllowed({...c,schemaMin:5}),false)
 assert.equal(mockBlocksAllowed({...c,schemaMin:6}),true)
 assert.equal(mockBlocksAllowed({...c,active:{kind:'local'}}),true)
 assert.equal(mockBlocksAllowed({...c,schemaMin:6,readOnly:true}),false)
 assert.equal(mockBlocksAllowed({...c,schemaMin:6,outdated:true}),false)
})

test('persistent mock receipt keeps source evidence and strips unrelated connection fields',async()=>{
 const {mockProvenance,mockColors,mockColorStyle}=await import('../../src/shared/ai/mockBlockProvenance.ts')
 const source={id:'source-1',ref:12,title:'Design',server:'atlas',url:'https://atlas.example/r/12?token=secret',hash:'a'.repeat(64),stateHash:'b'.repeat(64),readAt:new Date().toISOString(),token:'must-not-persist'}
 const citation={source:'source-1',quote:'Primary colour is #a50034.'}
 const receipt={id:'11111111-1111-4111-8111-111111111111',sources:[source],draft:{title:'Example',width:960,height:640,design:citation,authority:null,target:null,requirements:[],tokens:[{...citation,name:'--primary',value:'#a50034'}],components:[{...citation,name:'Button'}],notes:[]},target:null,connection:{token:'must-not-persist'}}
 const parsed=mockProvenance(receipt)!
 assert(parsed);assert.equal(parsed.sources[0].url,'https://atlas.example/r/12');assert(!JSON.stringify(parsed).includes('must-not-persist'));assert(!JSON.stringify(parsed).includes('?token'))
 assert.deepEqual(mockColors({'--primary':'#123456','--unknown':'#abcdef','--primary2':'url(evil)'},parsed),{'--primary':'#123456'})
 assert.equal(mockColorStyle({'--primary':'</style><script>bad</script>'}), '')
 assert.equal(mockProvenance({...receipt,draft:{...receipt.draft,credentials:'not allowed'}}),undefined)
 const {mockPreviewFromArtifact}=await import('../../src/shared/ai/mockBlock.ts'),{sha256Hex}=await import('../../src/shared/mcp/sha256.ts')
 const document='<html><body><p>Example</p></body></html>',artifact={...receipt,title:'Example',width:960,height:640,createdAt:new Date().toISOString(),document,htmlHash:sha256Hex(document),review:'open'} as any
 const preview=mockPreviewFromArtifact(artifact)
 const restored=mockBlockData({preview:{...preview,colors:{'--primary':'#123456'}}}).preview!
 assert.equal(restored.provenance?.id,receipt.id);assert.deepEqual(restored.colors,{'--primary':'#123456'})
 const tampered=mockBlockData({preview:{...preview,document:'tampered',colors:{'--primary':'#123456'}}}).preview!
 assert.equal(tampered.provenance,undefined);assert.deepEqual(tampered.colors,{})
})
