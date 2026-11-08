import {test,expect,openApp,createPage,gotoPage,reloadApp,wsEval,doc,para} from './fixtures'
import {createHash} from 'node:crypto'
import {analysisFixture} from './helpers/codeAnalysisStory.mjs'
import {inventory} from '../../src/app/features/ai/workflow/inventory'
import {sourceConnections} from '../../src/app/features/ai/workflow/sourceLinks'
test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{schema_min:7}}));await page.route('**/api/session',r=>r.fulfill({json:{}}))})

test('unsaved grouped mock note survives navigation and reload, while an updated preview invalidates targets',async({page,errors})=>{
 errors.allow(/Blocked script execution in 'about:srcdoc'/)
 await openApp(page)
 const document='<html><body><button data-ds-component="Button">First</button><button data-ds-component="Button">Second</button></body></html>'
 const id=await createPage(page,{title:'Draft mock',content:doc({type:'designMock',attrs:{id:'draft-mock',spec:{source:'https://aj-atlas.com/r/12',preview:{title:'Draft preview',document,width:960,height:640,createdAt:'2026-11-08',htmlHash:createHash('sha256').update(document).digest('hex'),targetUrl:''}}},content:[para('Review')]})})
 const other=await createPage(page,{title:'Another page',content:doc(para('Continue work'))})
 await gotoPage(page,id)
 const block=page.locator('.mock-block'),frame=page.frameLocator('.mock-block__preview iframe'),compose=block.locator('.mock-review__compose')
 await block.getByRole('button',{name:'Mark element',exact:true}).click();await frame.getByRole('button',{name:'First',exact:true}).click();await frame.getByRole('button',{name:'Second',exact:true}).click()
 await block.getByRole('button',{name:'Write note for selection'}).click()
 await compose.getByRole('textbox').fill('Use badges for both states')
 await compose.getByLabel('Intent',{exact:true}).selectOption('replace');await compose.getByLabel('Scope',{exact:true}).selectOption('mock')
 await expect(compose).toContainText('Draft saved privately')
 expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).not.toContain('Use badges for both states')
 await gotoPage(page,other);await gotoPage(page,id)
 await block.getByRole('button',{name:'Continue draft note'}).click();await expect(compose.getByRole('textbox')).toHaveValue('Use badges for both states');await expect(compose).toContainText('Selected elements: 2')
 await reloadApp(page);await gotoPage(page,id);await block.getByRole('button',{name:'Continue draft note'}).click()
 await expect(compose.getByLabel('Intent',{exact:true})).toHaveValue('replace');await expect(compose.getByLabel('Scope',{exact:true})).toHaveValue('mock');await expect(compose).toContainText('Selected elements: 2')
 await wsEval(page,(s,id)=>{const content=structuredClone(s.pages[id].content);content.content[0].attrs.spec.preview.document+='<p>New version</p>';s.setContent(id,content,'remote-fixture')},id)
 await expect(compose.getByRole('textbox')).toHaveValue('Use badges for both states');await expect(compose.getByRole('button',{name:'Save note',exact:true})).toBeDisabled()
 await block.getByRole('button',{name:'Mark element',exact:true}).click();await frame.getByRole('button',{name:'First',exact:true}).click()
 await compose.getByRole('button',{name:'Save note',exact:true}).click();await expect(block.locator('.mock-review__notes>li')).toHaveCount(1)
 await reloadApp(page);await gotoPage(page,id);await expect(block.getByRole('button',{name:'Continue draft note'})).toHaveCount(0)
})

test('saved result search, expansion and work paths survive leaving the overview',async({page,aiNet},info)=>{
 await openApp(page);const a=analysisFixture(true);a.active=a.revisions[0].id;a.revisions[0].state='accepted'
 const id=await createPage(page,{title:'Protocol review',content:doc({type:'codeBlock',attrs:{id:'review-source',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})});await gotoPage(page,id)
 const open=()=>page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click()
 await open();const dialog=page.getByRole('dialog',{name:'Work overview'}),saved=dialog.locator('.work-summary details')
 await saved.locator('summary').click();await saved.getByRole('searchbox').fill('Protocol review');await saved.getByRole('button',{name:'Open saved result'}).click()
 await open();await expect(saved).toHaveAttribute('open','');await expect(saved.getByRole('searchbox')).toHaveValue('Protocol review')
 await page.keyboard.press('Escape');await reloadApp(page);await open();await expect(saved).toHaveAttribute('open','');await expect(saved.getByRole('searchbox')).toHaveValue('Protocol review')
 await dialog.getByRole('button',{name:'Work paths',exact:true}).click();await expect(dialog).toContainText('Next step:');await expect(dialog.getByRole('button',{name:'Continue here'})).toBeVisible()
 for(const theme of ['light','dark'])for(const width of [1440,390]){await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await page.setViewportSize({width,height:width===390?844:900});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await dialog.screenshot({path:info.outputPath(`paths-${theme}-${width}.png`)})}
 await page.setViewportSize({width:1440,height:900});await dialog.getByRole('button',{name:'Open work',exact:true}).click();await expect(saved.getByRole('searchbox')).toHaveValue('Protocol review')
 expect(aiNet.count('anthropic')).toBe(0)
})

test('review tasks keep an exact finding backlink and reuse their existing subpage',async({page,aiNet})=>{
 await openApp(page);const a=analysisFixture(true)
 const id=await createPage(page,{title:'Review source',content:doc({type:'codeBlock',attrs:{id:'analysis-source',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})});await gotoPage(page,id)
 const report=page.getByRole('region',{name:'Code analysis',exact:true})
 await report.getByRole('tab',{name:'Findings',exact:true}).click();await report.getByRole('button',{name:'Create linked review task'}).click()
 const child=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.parentId===id)?.id,id)
 expect(child).toBeTruthy();await expect(page).toHaveURL(new RegExp('/p/'+child))
 await expect(page.locator('.workitem')).toHaveCount(1)
 const stored=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),child)
 expect(stored).toContain('work-revision=revision-one');expect(stored).toContain('work-item=f1');expect(stored).toContain('Decision and rationale')
 await page.getByRole('link',{name:'Open original finding and revision'}).click()
 await expect(report.getByRole('tab',{name:'Findings',exact:true})).toHaveAttribute('aria-selected','true')
 await report.getByRole('button',{name:'Open review task'}).click();await expect(page).toHaveURL(new RegExp('/p/'+child))
 expect(await wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.parentId===id).length,id)).toBe(1)
 expect(aiNet.count('anthropic')).toBe(0)
})

test('source changes expose affected findings and requirements, including complete requirements',()=>{
 const a=analysisFixture(true);a.revisions[0].report.requirements[0].gap='';(a.revisions[0] as any).sourceChecks=[{evidence:'e1',snapshot:'new',commit:'b'.repeat(40),state:'different',at:Date.now()}]
 const data=inventory([{id:'p',title:'Evidence',content:doc({type:'codeBlock',attrs:{id:'a',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})}],false)
 expect(data.work.filter(w=>w.kind==='stale')).toHaveLength(2)
 expect(data.traces.filter(t=>t.changed)).toHaveLength(2)
 expect(sourceConnections(data.traces)[0].owners).toHaveLength(2)
})
