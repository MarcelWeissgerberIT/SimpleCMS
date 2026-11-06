import {test,expect} from '@playwright/test'
import {build} from '../../server/node_modules/esbuild/lib/main.js'
let bundle:string
// Exercise the actual browser comparison module without a model, Atlas, or production test hooks.
test.beforeAll(async()=>{const result=await build({entryPoints:['src/shared/ai/mockComparison.ts'],bundle:true,write:false,format:'iife',globalName:'MockCompare',platform:'browser',tsconfig:'tsconfig.app.json'});bundle=result.outputFiles[0].text})
test.beforeEach(async({page})=>{await page.goto('about:blank');await page.addScriptTag({content:bundle})})
async function compare(page:any,before:string,after:string,options:any={}){return page.evaluate(async({before,after,options}:any)=>{const p=(document:string)=>({title:'Fixture',document,width:960,height:640,createdAt:'now',htmlHash:'0'.repeat(64),targetUrl:''});return (window as any).MockCompare.compareMockPreviews({...p(before),...options.before},{...p(after),...options.after})},{before,after,options})}
const doc=(body:string,css='')=>`<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}${css}</style></head><body>${body}</body></html>`
test('equivalent markup and receipt refresh are not new mock versions',async({page})=>{
 const a=doc('<button data-ds-component="Button" data-mock-id="old">Save</button>'),b=a.replace('old','new')
 const source={id:'read-1',server:'atlas',url:'https://atlas.example/r/1',hash:'a',stateHash:'a',readAt:'yesterday'}
 const result=await compare(page,a,b,{before:{provenance:{sources:[source]}},after:{provenance:{sources:[{...source,id:'read-2',readAt:'today'}]}}})
 expect(result.state).toBe('identical');expect(result.sources).toEqual([]);expect(await page.locator('iframe').count()).toBe(0)
 const changed=await compare(page,a,b,{before:{provenance:{sources:[source]}},after:{provenance:{sources:[{...source,hash:'b'}]}}})
 expect(changed.state).toBe('identical');expect(changed.sources).toEqual([source.url])
})
test('unmarked text, CSS-only and pseudo-element changes have concrete before/after evidence',async({page})=>{
 const body='<h1>Protocols</h1><button data-ds-component="Button" data-mock-id="save">Save</button>'
 const result=await compare(page,doc(body,'button{padding:8px;color:rgb(0,0,0)}button::after{content:"↓"}'),doc(body.replace('Protocols','Available protocols'),'button{padding:16px;color:rgb(255,0,0)}button::after{content:"↑"}'))
 expect(result.state).toBe('changed');const details=result.changes.flatMap((c:any)=>c.details)
 expect(details).toContainEqual({property:'text',before:'Protocols',after:'Available protocols'})
 expect(details).toContainEqual({property:'padding-top',before:'8px',after:'16px'})
 expect(details).toContainEqual({property:'color',before:'rgb(0, 0, 0)',after:'rgb(255, 0, 0)'})
 expect(details).toContainEqual({property:'::after content',before:'"↓"',after:'"↑"'})
})
test('stable repeated instances retain identity when inserted, reordered or replaced',async({page})=>{
 const before=doc('<div data-mock-id="a" data-ds-component="Label">Ready</div><div data-mock-id="b" data-ds-component="Label">Ready</div>')
 const after=doc('<div data-mock-id="new" data-ds-component="Label">New</div><div data-mock-id="b" data-ds-component="Badge">Ready</div><div data-mock-id="a" data-ds-component="Label">Ready</div>')
 const result=await compare(page,before,after),change=result.changes.find((c:any)=>c.details.some((d:any)=>d.property==='component'))
 expect(change.beforePath).toBe('body > div:nth-of-type(2)');expect(change.afterPath).toBe('body > div:nth-of-type(2)')
 expect(change.details).toContainEqual({property:'component',before:'Label',after:'Badge'})
 expect(result.changes.filter((c:any)=>c.kind==='added')).toHaveLength(1)
})
test('excessive documents are unverified, and abort always removes measurement frames',async({page})=>{
 const large=doc('<span>x</span>'.repeat(1801));expect((await compare(page,large,large)).state).toBe('unverified');expect(await page.locator('iframe').count()).toBe(0)
 const aborted=await page.evaluate(async()=>{const controller=new AbortController(),p={document:'<body>Hello</body>',width:960,height:640};const promise=(window as any).MockCompare.compareMockPreviews(p,p,controller.signal);controller.abort();try{await promise;return false}catch{return true}})
 expect(aborted).toBe(true);expect(await page.locator('iframe').count()).toBe(0)
})
test('comparison does not run source scripts or load remote assets',async({page})=>{
 let requests=0;await page.route('https://untrusted.example/**',route=>{requests++;return route.abort()})
 const html=doc('<img src="https://untrusted.example/a"><script>parent.executed=true</script><p>Preview</p>','body{background-image:url(https://untrusted.example/b)}')
 expect((await compare(page,html,html)).state).toBe('identical');expect(requests).toBe(0);expect(await page.evaluate(()=>(window as any).executed)).toBeUndefined()
})

test('source-only citation changes and additional revisions of the same record remain separate',async({page})=>{
 const html=doc('<p>Unchanged</p>'),source={id:'s',server:'atlas',url:'https://atlas.example/r/1',hash:'a',stateHash:'a'},draft={design:{source:'s',quote:'Definition A'},authority:null,requirements:[],tokens:[],components:[]}
 const citations=await compare(page,html,html,{before:{provenance:{sources:[source],draft}},after:{provenance:{sources:[source],draft:{...draft,design:{source:'s',quote:'Definition B'}}}}})
 expect(citations.state).toBe('identical');expect(citations.sources).toEqual([source.url])
 const versions=await compare(page,html,html,{before:{provenance:{sources:[source],draft}},after:{provenance:{sources:[source,{...source,id:'s2',hash:'b'}],draft}}})
 expect(versions.state).toBe('identical');expect(versions.sources).toEqual([source.url])
})
