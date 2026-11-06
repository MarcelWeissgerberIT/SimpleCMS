import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para} from './fixtures'
import {zipSync,strToU8} from 'fflate'
import {createHash} from 'node:crypto'
const markdown='# Test UI\n\n<!-- ui-component:C001:start -->\n# Button\nKomponenten-ID: C001\n\nUse One styling.\n<!-- ui-component:C001:end -->\n\n<!-- ui-manifest:start -->\n```json\n'+JSON.stringify({version:1,definitions:[{id:'C001',name:'Button',kind:'Button',evidence:'dom'}],trees:[{id:'T1',name:'Main',width:1440,nodes:[{id:'N1',componentId:'C001',parentId:null,label:'Save'}]}]})+'\n```\n<!-- ui-manifest:end -->'
const project={format:'component-studio-project',version:1,settings:{project:'Test UI'},markdown}
const node=(value:any={})=>({type:'codeBlock',attrs:{language:'ui-instructions'},content:[{type:'text',text:JSON.stringify(value)}]})
test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{version:'fixture',signup:{mode:'open',domains:[]},max_upload_mb:20,dev_mode:false,source_url:'',schema_min:6,supports:[]}}));await page.route('**/api/session',r=>r.fulfill({json:{user:null,workspaces:[]}}))})
test('native UI project import, editing and export survive reload with One styling',async({page},info)=>{
 await openApp(page);const id=await createPage(page,{title:'Design library',content:doc(node(),para(''))});await gotoPage(page,id)
 const studio=page.getByRole('region',{name:'UI Studio'});await studio.locator('input[aria-label="Import UI project"]').setInputFiles({name:'test.ui-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))})
 await expect(studio).toContainText('Test UI');const contract=studio.getByLabel('Component contract');await expect(contract).toHaveValue(/One styling/)
 await contract.fill('# Button\nKomponenten-ID: C001\n\nUse an accessible name.');await studio.getByRole('button',{name:'Save contract',exact:true}).click()
 await expect.poll(()=>wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toContain('accessible name')
 const downloaded=page.waitForEvent('download');await studio.getByRole('button',{name:'Task with dependencies'}).click();expect((await downloaded).suggestedFilename()).toBe('BUILD-TASK-C001.md')
 for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s,t)=>s.updateSettings({theme:t}),theme);expect(await studio.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`studio-${theme}-${width}.png`),animations:'disabled'})}
 await page.reload();await expect(page.getByLabel('Component contract')).toHaveValue(/accessible name/)
})
test('HTML analysis measures three widths locally and never executes source scripts',async({page,aiNet,errors})=>{
 errors.allow(/^console.error: Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/)
 await openApp(page);const id=await createPage(page,{title:'New reference',content:doc(node(),para(''))});await gotoPage(page,id)
 const studio=page.getByRole('region',{name:'UI Studio'});await studio.getByRole('button',{name:'Paste HTML'}).click();const modal=page.getByRole('dialog',{name:'Analyze HTML'})
 await modal.getByLabel('HTML',{exact:true}).fill('<style>button{color:rgb(120,30,40);padding:12px} @media(max-width:500px){button{padding:8px}}</style><main><h1>Controls</h1><button>Save</button></main><script>parent.window.UNSAFE=true</script>')
 await modal.getByRole('button',{name:'Analyze locally'}).click();await expect(modal).toHaveCount(0);await expect(studio).toContainText('3 views')
 expect(await page.evaluate(()=>(window as any).UNSAFE)).toBeUndefined();expect(aiNet.count('anthropic')).toBe(0)
 const content=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id);expect(content).toContain('V1440');expect(content).toContain('V768');expect(content).toContain('V390');expect(content).toContain('8px');expect(content).toContain('12px')
 expect(await page.locator('iframe[sandbox="allow-same-origin"]').count()).toBe(0)
})
test('invalid project preserves the existing tree and stored document',async({page})=>{
 await openApp(page);const id=await createPage(page,{title:'Invalid import',content:doc(node(project),para(''))});await gotoPage(page,id);const studio=page.getByRole('region',{name:'UI Studio'})
 const before=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)
 await studio.locator('input[aria-label="Import UI project"]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"format":"wrong"}')});await expect(studio.getByRole('alert')).toBeVisible();await expect(studio).toContainText('Test UI');expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toBe(before)
})
test('image analysis saves the reference and prepares an unstarted model task',async({page,aiNet})=>{
 await openApp(page);const id=await createPage(page,{title:'Image reference',content:doc(node(),para(''))});await gotoPage(page,id)
 await page.getByRole('region',{name:'UI Studio'}).locator('input[aria-label="Analyze UI reference with AI"]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQXYAAAAASUVORK5CYII=','base64')})
 const terminal=page.getByRole('region',{name:'AI terminal'});await expect(terminal).toBeVisible();await expect(terminal.locator('textarea').last()).toHaveValue(/ui-instructions/);expect(aiNet.count('anthropic')).toBe(0)
 await expect.poll(()=>wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toContain('reference.png')
})

test('collection ZIP verifies source hashes before importing a selected part',async({page})=>{
 await openApp(page);const id=await createPage(page,{title:'Collection',content:doc(node(),para(''))});await gotoPage(page,id)
 const studio=page.getByRole('region',{name:'UI Studio'}),bytes=strToU8(markdown),sha256=createHash('sha256').update(bytes).digest('hex')
 const archive=(hash:string)=>Buffer.from(zipSync({'collection.json':strToU8(JSON.stringify({format:'component-studio-collection',version:1,project:'Library',parts:[{id:'button',name:'Button',sha256:hash}]})),'parts/button/instructions.md':bytes}))
 const input=studio.locator('input[aria-label="Import UI project"]')
 await input.setInputFiles({name:'bad.ui-project.zip',mimeType:'application/zip',buffer:archive('0'.repeat(64))});await expect(studio.getByRole('alert')).toContainText('Prüfsumme')
 await input.setInputFiles({name:'library.ui-project.zip',mimeType:'application/zip',buffer:archive(sha256)})
 await page.getByRole('dialog',{name:'Choose project part'}).getByRole('button',{name:'Button',exact:true}).click();await expect(studio).toContainText('Library · Button')
})
