import {test,expect,openApp,wsEval,createPage,gotoPage,MOD,reloadApp,editorOf,doc,para} from './fixtures'
import {mockClaudeScript,text} from './helpers/providers'

test('ONE-only source → answer → reviewed ONE page works without Atlas or another model call',async({page},info)=>{
 await openApp(page)
 const source=await createPage(page,{title:'Calibration meeting',content:doc(para('The history must list all calibration versions and show the creator.'))})
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test',mcpServers:[{id:'not-needed',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'unused-private-token',enabled:true,prompt:'EXTERNAL_INSTRUCTIONS_NOT_FOR_ONE',checkedAt:Date.now()}]}))
 const model=await mockClaudeScript(page,[{blocks:[{type:'tool_use',id:'read-source',name:'read_page',input:{id:source}}]},text('# Calibration draft\n\nThe history must list all versions.\n\nOpen decision: may old versions be edited?\n\n![untrusted](https://example.org/collect.png)')])
 await gotoPage(page,source);await page.keyboard.press(`${MOD}+j`)
 const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
 await input.fill('Bitte nur in ONE: Lies diese Seite und bereite einen fachlichen Entwurf vor.');await input.press('Enter')
 await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:20000})
 expect(model.requests).toHaveLength(2)
 expect(JSON.stringify(model.requests)).not.toContain('unused-private-token');expect(JSON.stringify(model.requests)).not.toContain('EXTERNAL_INSTRUCTIONS_NOT_FOR_ONE')
 for(const req of model.requests)expect((req.body.tools??[]).map((x:{name:string})=>x.name)).not.toContain('one_mcp_search')
 await term.getByRole('button',{name:'Prepare as a ONE page',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Save this answer in ONE'})
 await dialog.getByLabel('Page title',{exact:true}).fill('Reviewed calibration draft')
 await dialog.getByLabel('Location in ONE',{exact:true}).selectOption(source)
 for(const width of [1440,390])for(const theme of ['light','dark'] as const){
  await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme)
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
  await dialog.screenshot({path:info.outputPath(`answer-page-${theme}-${width}.png`),animations:'disabled'})
 }
 await page.setViewportSize({width:1440,height:900});await wsEval(page,s=>s.updateSettings({theme:'light',language:'de'}))
 await page.getByRole('dialog',{name:'Antwort in ONE ablegen'}).screenshot({path:info.outputPath('answer-page-de-1440.png'),animations:'disabled'})
 await wsEval(page,s=>s.updateSettings({language:'en'}))
 await dialog.getByRole('button',{name:'Prepare page for review',exact:true}).click()
 await expect(dialog).not.toBeVisible()
 expect(await wsEval(page,s=>Object.values(s.pages).filter((p:any)=>p.title==='Reviewed calibration draft').length)).toBe(0)
 await expect(term).toContainText('ONE page prepared below')
 const apply=term.getByRole('button',{name:/^Apply all/}).last();await expect(apply).toBeVisible();await apply.click()
 await expect(term).toContainText('Saved as a ONE page. No Atlas synchronization was performed.')
 expect(model.requests).toHaveLength(2)
 const saved=await wsEval(page,s=>Object.values(s.pages).find((p:any)=>p.title==='Reviewed calibration draft')) as any
 expect(saved.parentId).toBe(source);expect(JSON.stringify(saved.content)).toContain('Open decision');expect(JSON.stringify(saved.content)).not.toContain('"type":"image"')
 expect(await wsEval(page,(s,id)=>s.pages[id].plain,source)).toContain('show the creator')
 await term.getByRole('button',{name:'Open ONE page',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Reviewed calibration draft')
 await reloadApp(page);expect(await wsEval(page,s=>Object.values(s.pages).filter((p:any)=>p.title==='Reviewed calibration draft').length)).toBe(1)
})

test('a stopped or failed answer is not offered as a completed ONE page',async({page})=>{
 await openApp(page);await page.keyboard.press(`${MOD}+j`)
 // The terminal seam is test-only; no provider or external request is executed here.
 await page.waitForFunction(()=>(window as any).__oneTerm);await page.evaluate(()=>{(window as any).__oneTerm.state.setState({status:'error',turns:[{n:1,task:'Incomplete',startedAt:Date.now(),status:'error',answer:'Partial text',error:{code:'unknown',message:'Stopped before completion'}}]})})
 await expect(page.getByRole('button',{name:'Prepare as a ONE page',exact:true})).toHaveCount(0)
})

test('inline ONE-only writing ignores an attached Atlas connection and its instructions',async({page})=>{
 await openApp(page)
 const id=await createPage(page,{title:'ONE working draft',content:doc(para('History lists all versions.'),para(''))})
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test',mcpServers:[{id:'unused-atlas',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'unused-private-token',enabled:true,prompt:'EXTERNAL_INSTRUCTIONS_NOT_FOR_ONE',checkedAt:Date.now()}]}))
 const model=await mockClaudeScript(page,[text('## Draft in ONE\n\nHistory lists all versions.')])
 await gotoPage(page,id);const ed=editorOf(page,id),ask=page.getByPlaceholder('Ask AI to write anything…')
 await expect(async()=>{await ed.locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space');try{await expect(ask).toBeFocused({timeout:1500})}catch(e){if(!(await ask.count()))await page.keyboard.press('Backspace');throw e}}).toPass({timeout:15000})
 await ask.fill('Nur in ONE: Bereite aus dieser Seite einen Entwurf vor. Atlas kommt später.');await ask.press('Enter')
 const panel=page.getByRole('dialog',{name:'Ask AI'});await expect(panel.locator('.ai-out__body')).toContainText('History lists all versions.')
 expect(model.requests).toHaveLength(1);expect(JSON.stringify(model.requests)).not.toContain('EXTERNAL_INSTRUCTIONS_NOT_FOR_ONE');expect(JSON.stringify(model.requests)).not.toContain('one_mcp_search')
 expect(await wsEval(page,(s,id)=>s.pages[id].plain,id)).toContain('History lists all versions.')
})
