import {test,expect,openApp,createPage,gotoPage,doc,para} from './fixtures'
test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{version:'fixture',signup:{mode:'open',domains:[]},max_upload_mb:20,dev_mode:false,source_url:'',schema_min:6,supports:[]}}));await page.route('**/api/session',r=>r.fulfill({json:{user:null,workspaces:[]}}))})
async function select(page:any,text:string){
 const ed=page.locator('.ProseMirror[contenteditable="true"]').first();await ed.click()
 await ed.evaluate((el:any,text:string)=>{const editor=el.editor;let from=0;editor.state.doc.descendants((n:any,p:number)=>{if(n.isText&&n.text.includes(text))from=p+n.text.indexOf(text)});editor.chain().focus().setTextSelection({from,to:from+text.length}).run()},text)
 await page.getByRole('button',{name:'Request source-code evidence',exact:true}).click()
 return page.getByRole('dialog',{name:'Request source-code evidence'})
}
test('selected claim becomes a reviewable evidence request with no immediate model call',async({page,aiNet})=>{
 await openApp(page);const text='The endpoint allows anonymous access.';const id=await createPage(page,{title:'Endpoint finding',content:doc(para(text))});await gotoPage(page,id)
 const modal=await select(page,text);await expect(modal).toContainText(text)
 await modal.getByLabel('Repository (optional)').fill('icm-felix');await modal.getByLabel('Branch, commit or snapshot (optional)').fill('release/2026')
 await modal.getByRole('button',{name:'Prepare in terminal'}).click()
 const terminal=page.getByRole('region',{name:'AI terminal'});await expect(terminal).toBeVisible()
 const draft=terminal.locator('textarea').last();await expect(draft).toHaveValue(/icm-felix/);await expect(draft).toHaveValue(/release\/2026/);await expect(draft).toHaveValue(/atlas_code_verify/);await expect(draft).toHaveValue(/Do not edit the original passage/)
 await expect(terminal).toContainText('Endpoint finding');expect(aiNet.count('anthropic')).toBe(0)
 await expect(page.locator('.ProseMirror').first()).toContainText(text)
})
test('existing terminal draft is preserved when requesting evidence',async({page})=>{
 await openApp(page);const text='A statement to check.';const id=await createPage(page,{title:'Finding',content:doc(para(text))});await gotoPage(page,id)
 let modal=await select(page,text);await modal.getByRole('button',{name:'Prepare in terminal'}).click()
 const terminal=page.getByRole('region',{name:'AI terminal'});const draft=terminal.locator('textarea').last();await draft.fill('My unfinished task')
 modal=await select(page,text);await expect(modal.getByRole('button',{name:'Prepare in terminal'})).toBeDisabled();await modal.getByRole('button',{name:'Close',exact:true}).click();await expect(draft).toHaveValue('My unfinished task')
})
