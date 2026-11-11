import {test,expect,openApp,wsEval,createPage,gotoPage,doc,para,MOD} from './fixtures'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'

for(const damaged of [false,true])test(`Claude continues after ${damaged?'an old malformed source':'an emoji at the search excerpt boundary'}`,async({page},info)=>{
 await page.route('**/api/config',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Local fixture</title>'}))
 await openApp(page)
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
 await page.evaluate(async m=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'anthropic',m}]),DEFAULT_CLAUDE_MODEL)
 const source='parameter '+ 'x'.repeat(209)+(damaged?'\ud83d…':'🔄 next entry')
 const id=await createPage(page,{title:'Unicode parameter fixture',content:doc(para(source))})
 await gotoPage(page,id)
 const host=await mockClaudeScript(page,[
  {blocks:[{type:'tool_use',id:'search-1',name:'search_pages',input:{query:'parameter'}}]},
  {blocks:[{type:'tool_use',id:'read-1',name:'read_page',input:{id}}]},
  text('The source was read successfully.')
 ])
 await page.keyboard.press(`${MOD}+j`)
 const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
 await input.fill('Search ONE for parameter, read the matching page and summarize it.');await input.press('Enter')
 await expect(term.locator('p').filter({hasText:/^The source was read successfully\.$/})).toBeVisible({timeout:30000})
 expect(host.requests).toHaveLength(3)
 const results=host.requests[2].body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='tool_result'):[])
 const search=results.find((r:any)=>r.tool_use_id==='search-1'),read=results.find((r:any)=>r.tool_use_id==='read-1')
 expect(search.content).toContain('Unicode parameter fixture')
 for(const result of [search,read])expect(/[\uD800-\uDFFF]/u.test(result.content)).toBe(false)
 expect(read.content).toContain(damaged?'�…':'🔄 next entry')
 expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toContain(damaged?'\\ud83d':'🔄')
 await term.screenshot({path:info.outputPath('unicode-completed.png'),animations:'disabled'})
})
