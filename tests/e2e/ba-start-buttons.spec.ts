import {test,expect,openApp,createPage,gotoPage,doc,para,wsEval} from './fixtures'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const button=(prompt:string)=>({type:'button',attrs:{label:'Prepare with Frankfurt',variant:'signal',actions:[{id:'prepare-ba',type:'ai_task',prompt}]}})
test('a guided preparation opens its real source and keeps the visible page context without starting inference',async({page})=>{
 await openApp(page)
 const source=await createPage(page,{title:'Calibration source for guided review',content:doc(para('Measured points may be excluded and included again.'))})
 const prompt='/ba Read the source and separate evidence from open decisions.'
 const guide=await createPage(page,{title:'Guided first analysis',content:doc({type:'button',attrs:{label:'Prepare source review',variant:'signal',actions:[{id:'prepare-bound-source',type:'ai_task',sourcePageId:source,prompt}]}})})
 await gotoPage(page,guide)
 await page.getByRole('button',{name:'Prepare source review',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Calibration source for guided review')
 await expect(page.getByRole('textbox',{name:'Task for the agent',exact:true})).toHaveValue(prompt)
 await expect(page.getByRole('region',{name:'AI terminal',exact:true})).toContainText('Calibration source for guided review')
 await expect(page.getByRole('region',{name:'AI terminal',exact:true})).not.toContainText('Running')
})
test('a missing guided source stops preparation and preserves the current page',async({page})=>{
 await openApp(page)
 const guide=await createPage(page,{title:'Guide with unavailable source',content:doc({type:'button',attrs:{label:'Prepare missing source',variant:'signal',actions:[{id:'missing-source',type:'ai_task',sourcePageId:'gone-source-for-guide',prompt:'/ba Read this exact source'}]}})})
 await gotoPage(page,guide)
 await page.getByRole('button',{name:'Prepare missing source',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Guide with unavailable source')
 await expect(page.getByText(/The prepared source page is unavailable or in the trash\. Choose an accessible source before preparing this task\./)).toBeVisible()
 await expect(page.getByRole('region',{name:'AI terminal',exact:true})).not.toBeVisible()
})
test('BA task button prepares a visible prompt and never starts inference itself',async({page})=>{
 await openApp(page)
 const prompt='Read the Atlas source and separate evidence from open questions.'
 const id=await createPage(page,{title:'BA starter',content:doc(para('One bounded job'),button(prompt))})
 await gotoPage(page,id)
 await page.getByRole('button',{name:'Prepare AI task',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Task for the agent',exact:true})).toHaveValue(prompt)
 await expect(page.getByRole('region',{name:'AI terminal',exact:true})).not.toContainText('Running')
})
test('BA task button sends an unconfigured Atlas member to token setup without modifying credentials',async({page})=>{
 await openApp(page)
 const start=await createPage(page,{title:'Atlas token start',content:doc(para('Enter your own token'))})
 const id=await createPage(page,{title:'BA starter',content:doc(button('Read one source'))})
 await wsEval(page,(s,start)=>s.setWorkspaceAI({...s.ai,onboarding:{startPageId:start,mcpName:'aj-atlas',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',project:'CNSx',tenant:'analytik-jena',skipIntro:true}}),start)
 await gotoPage(page,id)
 await page.getByRole('button',{name:'Prepare AI task',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Atlas token start')
 expect(await wsEval(page,s=>s.settings.workspaceMcpServers??[])).toEqual([])
})


test('a prepared task shows its actual route and source instead of trusting descriptive model metadata',async({page})=>{
 await openApp(page)
 const ids=await wsEval(page,(s,model)=>{
  s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'})
  s.setWorkspaceAI({routes:{'*':[{p:'anthropic',m:model}]}})
  const db=s.createDatabase({title:'Model metadata',properties:[{id:'name',name:'Name',type:'title'},{id:'model',name:'Model',type:'text'}]})
  const row=s.createRow(db,{title:'BA preparation',properties:{model:'Frankfurt descriptive text'},content:{type:'doc',content:[{type:'button',attrs:{label:'Prepare with Frankfurt',variant:'signal',actions:[{id:'prepare-ba',type:'ai_task',prompt:'Read only one source'}]}}]}})
  return {db,row}
 },DEFAULT_CLAUDE_MODEL)
 await gotoPage(page,ids.row)
 const preview=page.getByRole('note',{name:'Model when preparing',exact:true})
 await expect(preview).toContainText('Opus');await expect(preview).toContainText('Workspace rule');await expect(preview).toContainText('Checked again at Start')
 await expect(page.locator('[data-prow="model"]')).toContainText('Descriptive value · the AI controls choose the model')
 await page.getByRole('button',{name:'Prepare AI task',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Task for the agent',exact:true})).toHaveValue('Read only one source')
 await expect(page.locator('.route-source')).toHaveText('This request')
 expect(await wsEval(page,(s,id)=>s.pages[id].properties.model,ids.row)).toBe('Frankfurt descriptive text')
})

test('the button editor persists the chosen source; its form fits both themes and viewport sizes',async({page},info)=>{
 await openApp(page)
 const source=await createPage(page,{title:'The actual calibration source',content:doc(para('Only actual measured points may contribute to the calibration.'))})
 const guide=await createPage(page,{title:'Source picker guide',content:doc(button('/ba Review this source'))})
 await gotoPage(page,guide)
 await page.getByRole('button',{name:'Configure button',exact:true}).click()
 const dialog=page.getByRole('dialog')
 await dialog.getByLabel('Source page when preparing',{exact:true}).selectOption(source)
 for(const width of [1440,390])for(const theme of ['light','dark'] as const){
  await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme)
  await dialog.screenshot({path:info.outputPath(`source-picker-${theme}-${width}.png`),animations:'disabled'})
  expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false)
 }
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Prepare AI task',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('The actual calibration source')
 await expect(page.getByRole('region',{name:'AI terminal',exact:true})).toContainText('The actual calibration source')
})
