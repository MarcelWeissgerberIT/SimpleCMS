// Cloud MCP fixtures require E2E_ROOT=1 (the static sub-path build intentionally has no server).
import {test,expect,openApp,wsEval,createPage,gotoPage,doc,para,MOD} from './fixtures'
import type {Page} from '@playwright/test'
const citation={repo:'repo-a',snapshot:'snapshot-a',commit:'a'.repeat(40),path:'src/Host/MinimalApiEndpoints.cs',lines:[5,7],digest:'d'.repeat(64)}
const reference={citation,server:'aj-atlas',repoName:'icm-felix',finding:'The endpoint bypasses authentication.',highlight:[6,6]}
const node=(language='atlas-code',value:any=reference)=>({type:'codeBlock',attrs:{language},content:[{type:'text',text:JSON.stringify(value)}]})
const envelope=(data:unknown)=>({result:JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})})
async function setup(page:Page,options:{invalid?:boolean;mismatch?:boolean;denied?:boolean;json?:boolean;language?:string}={}){
 await page.route('**/api/config',r=>r.fulfill({json:{version:'fixture',signup:{mode:'open',domains:[]},max_upload_mb:20,dev_mode:false,source_url:'',schema_min:6,supports:['ai','providers']}}))
 await page.route('**/api/session',r=>r.fulfill({json:{user:null,workspaces:[]}}))
 await page.route('**/api/workspaces/*/model-shares',r=>r.fulfill({json:[]}))
 await openApp(page)
 const id=await createPage(page,{title:'Source evidence',content:doc(para('A finding backed by a pinned source file.'),node(options.language??(options.json?'json':'atlas-code')),para(''))})
 await wsEval(page,s=>{s.setWorkspaceAI({onboarding:{startPageId:'fixture-start',mcpName:'aj-atlas',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',project:'FeliX',tenant:'analytik-jena',skipIntro:true}});s.updateSettings({workspaceMcpServers:[{id:'atlas-code-fixture',name:'aj-atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:'synthetic-token',enabled:true,prompt:'',tools:['atlas_code_repos','atlas_code_read','atlas_code_verify']}]})})
 await gotoPage(page,id)
 await page.evaluate(()=>(window as any).__oneCloud.set({available:true,active:{kind:'cloud',id:'code-fixture'},user:{id:'member-fixture',email:'test@example.test',name:'Test'},role:'owner',readOnly:false,supports:['atlas-mcp:1']}))
 const calls:any[]=[]
 await page.route('**/api/workspaces/*/atlas-mcp',r=>{
  const body=r.request().postDataJSON();calls.push(body)
  if(body.name==='atlas_code_repos')return r.fulfill({json:envelope({items:[{id:'repo-a',name:'icm-felix',modelProcessing:!options.denied}],next:null})})
  if(options.denied&&body.name!=='atlas_code_repos')return r.fulfill({json:envelope({error:'Repository access denied'})})
  if(body.name==='atlas_code_verify')return r.fulfill({json:envelope({valid:!options.invalid,citation:body.arguments.citation})})
  const context=body.arguments.startLine===1
  const c={...citation,...context?{lines:[1,9],digest:'e'.repeat(64)}:{},...options.mismatch?{snapshot:'wrong'}:{}}
  return r.fulfill({json:envelope({citation:c,text:context?'// Context\nclass Host\n{\n  // setup\n  var user = GetUser();\n  AllowAnonymous();\n  Run();\n}\n// End':'  var user = GetUser();\n  AllowAnonymous();\n  Run();'})})
 })
 return {id,calls}
}
test('source references load verified highlighted code through cloud MCP without a model or worker',async({page,aiNet},info)=>{
 const {id,calls}=await setup(page)
 const card=page.getByRole('region',{name:'Source code reference'})
 await expect(card).toContainText('icm-felix');expect(calls).toHaveLength(0)
 await card.getByRole('button',{name:'Open code',exact:true}).click()
 const viewer=page.getByRole('dialog',{name:/MinimalApiEndpoints/})
 await expect(viewer).toContainText('Source citation verified')
 await expect(viewer.locator('.ca__row[data-line="6"][data-cur]')).toContainText('AllowAnonymous')
 await expect(viewer.locator('.ca__row[data-line="5"]')).not.toHaveAttribute('data-cur')
 expect(calls.every(c=>['atlas_code_repos','atlas_code_read','atlas_code_verify'].includes(c.name))).toBe(true)
 expect(aiNet.count('anthropic')).toBe(0)
 await viewer.getByRole('button',{name:'Load with context'}).click();await expect(viewer.locator('.ca__row[data-line="1"]')).toContainText('// Context');await expect(viewer.locator('.ca__row[data-cur]')).toHaveCount(1)
 for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s,t)=>s.updateSettings({theme:t}),theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);expect(await viewer.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`source-${theme}-${width}.png`),animations:'disabled'})}
 expect(JSON.stringify(await wsEval(page,(s,id)=>s.pages[id].content,id))).not.toContain('AllowAnonymous')
 await viewer.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.code-evidence__code')).toHaveCount(0)
})
for(const kind of ['invalid','mismatch','denied'] as const)test('unverified source is never displayed: '+kind,async({page})=>{
 const {calls}=await setup(page,{[kind]:true});await page.getByRole('button',{name:'Open code',exact:true}).click()
 const viewer=page.getByRole('dialog',{name:/MinimalApiEndpoints/});await expect(viewer.getByRole('alert')).toBeVisible();await expect(viewer.locator('.code-evidence__code')).toHaveCount(0)
 expect(calls.some(c=>c.name==='atlas_code_verify')).toBe(true)
 expect(calls.some(c=>c.name==='atlas_code_read')).toBe(kind==='mismatch')
})
test('existing JSON citations become editable source cards without any request',async({page})=>{
 const {id,calls}=await setup(page,{json:true});await page.getByRole('button',{name:'Show as source reference'}).click()
 await page.getByRole('button',{name:'Edit reference'}).click();const form=page.getByRole('dialog',{name:'Save source code reference'})
 await form.getByLabel('Finding / note').fill('Authentication must be checked.');await form.getByRole('button',{name:'Save reference',exact:true}).click()
 await expect(page.getByRole('region',{name:'Source code reference'})).toContainText('Authentication must be checked.');expect(calls).toHaveLength(0)
 await expect.poll(()=>wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toContain('Authentication must be checked.')
})
test('closing or changing access discards delayed code and never revives the viewer',async({page})=>{
 await setup(page);let release!:()=>void;const wait=new Promise<void>(r=>release=r);let reading=false
 await page.route('**/api/workspaces/*/atlas-mcp',async r=>{const b=r.request().postDataJSON();if(b.name!=='atlas_code_read')return r.fallback();reading=true;await wait;await r.fulfill({json:envelope({citation,text:'one\ntwo\nthree'})}).catch(()=>{})})
 await page.getByRole('button',{name:'Open code',exact:true}).click();await expect.poll(()=>reading).toBe(true)
 await page.getByRole('dialog',{name:/MinimalApiEndpoints/}).getByRole('button',{name:'Close',exact:true}).click();release();await expect(page.locator('.code-evidence__code')).toHaveCount(0)
 await page.getByRole('button',{name:'Open code',exact:true}).click();await expect(page.locator('.code-evidence__code')).toBeVisible()
 await wsEval(page,s=>s.updateSettings({workspaceMcpServers:[]}));await expect(page.getByRole('dialog',{name:/MinimalApiEndpoints/})).toHaveCount(0);await expect(page.locator('.code-evidence__code')).toHaveCount(0)
})
test('generated Markdown source cards survive import and export with the complete citation',async({page})=>{
 const {id,calls}=await setup(page)
 const roundtrip=await page.evaluate(({id,reference})=>{
  const seam=(window as any).__oneSettle
  const md='```atlas-code\n'+JSON.stringify(reference)+'\n```'
  const imported=seam.markdownToDoc(md,true)
  const exported=seam.docToFileMarkdown(imported)
  const restored=seam.markdownToDoc(exported,true)
  ;(window as any).__one.workspace.getState().setContent(id,restored,'e2e')
  return {exported,restored}
 },{id,reference})
 expect(roundtrip.exported).toContain('```atlas-code')
 expect(JSON.stringify(roundtrip.restored)).toContain(citation.digest)
 await expect(page.getByRole('region',{name:'Source code reference'})).toContainText('MinimalApiEndpoints.cs')
 expect(calls).toHaveLength(0)
})

async function conversionMenu(page:Page){
 await page.locator('.code-block pre').hover()
 await page.getByRole('button',{name:'Block menu',exact:true}).click()
 const turn=page.getByRole('menuitem',{name:'Turn into',exact:true})
 if(await turn.count())await turn.click()
}
for(const language of ['', 'json'])test('source conversion stays in the page and preserves the citation: '+(language||'plain'),async({page})=>{
 const {id,calls}=await setup(page,{language})
 const before=await wsEval(page,s=>Object.keys(s.pages))
 const original=await wsEval(page,(s,id)=>s.pages[id].content.content.find((n:any)=>n.type==='codeBlock'),id)
 await expect(page.getByRole('button',{name:'Show as source reference',exact:true})).toBeVisible()
 await conversionMenu(page)
 await expect(page.getByRole('menuitem',{name:/^Move to a new sub-page/})).toBeVisible()
 await page.getByRole('menuitem',{name:'Show as source reference',exact:true}).click()
 await expect(page.getByRole('region',{name:'Source code reference'})).toContainText('MinimalApiEndpoints.cs')
 expect(await wsEval(page,s=>Object.keys(s.pages))).toEqual(before)
 const converted=await wsEval(page,(s,id)=>s.pages[id].content.content.find((n:any)=>n.type==='codeBlock'),id)
 expect(converted).toEqual({...original,attrs:{...original.attrs,language:'atlas-code'}})
 expect(calls).toHaveLength(0)
 await page.keyboard.press(MOD+'+z')
 await expect(page.locator('.code-block pre')).toBeVisible()
 await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].content.content.find((n:any)=>n.type==='codeBlock'),id)).toEqual(original)
})
test('explicitly moving a source code block uses the filename and retains every JSON line',async({page})=>{
 const {id,calls}=await setup(page,{language:'json'})
 const raw=JSON.stringify(reference,null,2)+'\n'
 await wsEval(page,(s,{id,raw})=>s.setContent(id,{type:'doc',content:[{type:'codeBlock',attrs:{language:'json'},content:[{type:'text',text:raw}]}]},'e2e'),{id,raw})
 await conversionMenu(page)
 await page.getByRole('menuitem',{name:/^Move to a new sub-page/}).click()
 const subpage=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.parentId===id&&!p.trashed),id) as any
 expect(subpage.title).toBe('MinimalApiEndpoints.cs')
 expect(subpage.content.content[0].type).toBe('codeBlock')
 expect(subpage.content.content[0].content[0].text).toBe(raw)
 await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].content.content.find((n:any)=>n.type==='pageLink')?.attrs.pageId,id)).toBe(subpage.id)
 await gotoPage(page,subpage.id)
 await expect(page.locator('.code-block pre')).toHaveText(raw)
 expect(calls).toHaveLength(0)
})
