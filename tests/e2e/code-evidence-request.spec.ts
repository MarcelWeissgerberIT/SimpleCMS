import {test,expect,openApp,createPage,gotoPage,doc,para,editorOf,wsEval} from './fixtures'
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

for(const kind of ['paragraph','table','multiple'] as const)test(`block menu sends exactly the selected ${kind} to evidence review`,async({page,aiNet})=>{
 await openApp(page)
 const cell=(text:string)=>({type:'tableCell',content:[para(text)]})
 const material=kind==='table'?{type:'table',content:[{type:'tableRow',content:[cell('Calibration claim'),cell('The blank value is retained.')]}]}:para('Calibration claim')
 const id=await createPage(page,{title:'Calibration requirements',content:doc(para('Unselected before'),material,para('Second selected claim'),para('Unselected after'))})
 if(kind==='multiple')await wsEval(page,s=>s.updateSettings({language:'de'}))
 await gotoPage(page,id);const ed=editorOf(page,id)
 if(kind==='multiple'){
  await ed.getByText('Calibration claim',{exact:true}).click();await page.keyboard.press('Escape')
  await ed.getByText('Second selected claim',{exact:true}).click({modifiers:['Shift']})
 }else if(kind==='table'){
  await ed.locator('table').hover({position:{x:10,y:10}})
 }else{
  await ed.evaluate((el:any)=>{const editor=el.editor;editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize)})
 }
 await page.getByRole('button',{name:kind==='multiple'?'Blockmenü · 2 Blöcke':'Block menu',exact:true}).click()
 const menu=page.locator('[data-popover][role="menu"]').first()
 await menu.getByRole('textbox').fill('atlas')
 const label=kind==='multiple'?'Quellcode-Belege nachfordern':'Request source-code evidence'
 await menu.getByRole('menuitem',{name:label,exact:true}).click()
 const modal=page.getByRole('dialog',{name:label});await expect(modal).toBeVisible();await expect(modal.locator('blockquote')).toContainText('Calibration claim')
 await expect(modal.locator('blockquote')).not.toContainText('Unselected')
 if(kind==='table')await expect(modal.locator('blockquote')).toContainText('The blank value is retained.')
 if(kind==='multiple')await expect(modal.locator('blockquote')).toContainText('Second selected claim')
 else await expect(modal.locator('blockquote')).not.toContainText('Second selected claim')
 await modal.getByRole('button',{name:kind==='multiple'?'Im Terminal vorbereiten':'Prepare in terminal',exact:true}).click()
 await expect(page.getByRole('region',{name:kind==='multiple'?'KI-Terminal':'AI terminal'})).toBeVisible()
 expect(aiNet.count('anthropic')).toBe(0);await expect(ed).toContainText('Unselected before');await expect(ed).toContainText('Unselected after')
})

test('oversized block evidence is rejected instead of silently clipped',async({page,aiNet})=>{
 await openApp(page);const id=await createPage(page,{title:'Large claim',content:doc(para('Long claim '.repeat(900))) });await gotoPage(page,id)
 const ed=editorOf(page,id);await ed.evaluate((el:any)=>el.editor.commands.setNodeSelection(0))
 await page.getByTestId('selection-grip').getByRole('button',{name:'Block menu',exact:true}).click()
 await page.getByRole('menuitem',{name:'Request source-code evidence',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Request source-code evidence'})).not.toBeVisible()
 await expect(page.getByText('Select a text passage of at most 8,000 characters.',{exact:true})).toBeVisible()
 expect(aiNet.count('anthropic')).toBe(0)
})
