import {test,expect,openApp,createPage,gotoPage,doc,para,wsEval} from './fixtures'
const button=(prompt:string)=>({type:'button',attrs:{label:'Prepare with Frankfurt',variant:'signal',actions:[{id:'prepare-ba',type:'ai_task',prompt}]}})
test('BA task button prepares a visible prompt and never starts inference itself',async({page})=>{
 await openApp(page)
 const prompt='Read the Atlas source and separate evidence from open questions.'
 const id=await createPage(page,{title:'BA starter',content:doc(para('One bounded job'),button(prompt))})
 await gotoPage(page,id)
 await page.getByRole('button',{name:'Prepare with Frankfurt',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Task for the agent',exact:true})).toHaveValue(prompt)
 await expect(page.getByRole('region',{name:'AI terminal',exact:true})).not.toContainText('Running')
})
test('BA task button sends an unconfigured Atlas member to token setup without modifying credentials',async({page})=>{
 await openApp(page)
 const start=await createPage(page,{title:'Atlas token start',content:doc(para('Enter your own token'))})
 const id=await createPage(page,{title:'BA starter',content:doc(button('Read one source'))})
 await wsEval(page,(s,start)=>s.setWorkspaceAI({...s.ai,onboarding:{startPageId:start,mcpName:'aj-atlas',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',project:'CNSx',tenant:'analytik-jena',skipIntro:true}}),start)
 await gotoPage(page,id)
 await page.getByRole('button',{name:'Prepare with Frankfurt',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Atlas token start')
 expect(await wsEval(page,s=>s.settings.workspaceMcpServers??[])).toEqual([])
})
