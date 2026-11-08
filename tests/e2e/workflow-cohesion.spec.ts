import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,MOD} from './fixtures'
import {analysisFixture} from './helpers/codeAnalysisStory.mjs'
import {packageFixture} from './helpers/packageFreshness.mjs'
import {mockAgent,call,say,setKey,terminal,prompt} from './helpers/terminal'
import {sourceConnections} from '../../src/app/features/ai/workflow/sourceLinks'
import {checkpointMock,mockVersionKey,mockSourcesKey} from '../../src/shared/ai/mockReview'
import {mockBlockData} from '../../src/shared/ai/mockBlock'

test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{schema_min:6}}));await page.route('**/api/session',r=>r.fulfill({json:{}}))})
const openOverview=async(page:any)=>{await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click();return page.getByRole('dialog',{name:'Work overview'})}

test('source connections require exact recorded repository snapshots, never similar titles',()=>{
 const a=analysisFixture(true).revisions[0].report.evidence[0].reference
 const row=(id:string,reference:any)=>({id,page:id,title:'Same title',detail:'',references:[reference]})
 expect(sourceConnections([row('a',a),row('b',{...a,citation:{...a.citation,snapshot:'other'}})])).toHaveLength(0)
 const groups=sourceConnections([row('a',a),row('b',a)])
 expect(groups).toHaveLength(1);expect(groups[0].owners).toHaveLength(2)
})

test('sidebar opens the work centre without terminal; saved results and shared-source impact navigate to original blocks',async({page,aiNet},info)=>{
 await openApp(page)
 const a=analysisFixture(true);a.active=a.revisions[0].id;a.revisions[0].state='accepted'
 const report=await createPage(page,{title:'Accepted investigation',content:doc({type:'codeBlock',attrs:{id:'analysis-place',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})})
 const m=checkpointMock(mockBlockData(packageFixture().spec),'Initial');m.journal!.sourceCheck={version:mockVersionKey(m.preview!),sourceHash:mockSourcesKey(m.preview!),rows:m.preview!.provenance!.sources.map(s=>({ref:s.ref,url:s.url,title:s.title,changed:s.ref===13,at:new Date().toISOString()}))}
 const make=(title:string,id:string)=>createPage(page,{title,content:doc({type:'designMock',attrs:{id,spec:m},content:[para(title)]})})
 await make('Shared mock A','mock-a');await make('Shared mock B','mock-b');await gotoPage(page,report)
 const dialog=await openOverview(page)
 await expect(terminal(page)).toHaveCount(0)
 await dialog.getByText('Saved results · 3',{exact:true}).click()
 await expect(dialog).toContainText('Analysis accepted in One')
 await dialog.getByRole('button',{name:'Evidence links',exact:true}).click()
 await dialog.locator('.source-connections summary').filter({hasText:'Badge definition'}).click()
 await expect(dialog.locator('.source-connections')).toContainText('A saved Atlas comparison reports a change')
 for(const theme of ['light','dark'])for(const width of [1440,390]){
  await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await page.setViewportSize({width,height:900})
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
  await dialog.screenshot({path:info.outputPath(`connections-${theme}-${width}.png`)})
 }
 await dialog.locator('.source-connections').getByRole('button',{name:'Open linked location'}).first().click()
 await expect(page).toHaveURL(/\?b=mock-/)
 expect(aiNet.count('anthropic')).toBe(0)
})

test('guided starts require a bounded goal and sources, prepare all four task types without model calls',async({page,aiNet})=>{
 await openApp(page)
 const id=await createPage(page,{title:'Operator requirements',content:doc(para('The operator sees the original error.'))});await gotoPage(page,id)
 for(const kind of ['requirements','ui','decision','analysis']){
  const d=await openOverview(page);await d.getByRole('button',{name:'New task',exact:true}).click()
  const guide=d.getByRole('region',{name:'Guided task start'})
  await expect(guide.getByRole('button',{name:'Prepare task',exact:true})).toBeDisabled()
  await guide.getByLabel('Task',{exact:true}).selectOption(kind)
  await guide.getByLabel('Goal and boundaries').fill('Check error presentation; exclude hardware changes.')
  await guide.getByLabel('Operator requirements',{exact:true}).check()
  await expect(guide).toContainText('requires no local worker')
  await guide.getByRole('button',{name:'Prepare task',exact:true}).click()
  const programs=page.getByRole('dialog',{name:'Saved compiled programs'})
  await expect(programs).toBeVisible();await expect(programs.locator('textarea')).toContainText(id)
  await expect(programs.locator('textarea')).toContainText('Check error presentation')
  await expect(programs.locator('textarea')).toContainText('"effect": "read"')
  await page.keyboard.press('Escape')
 }
 expect(aiNet.count('anthropic')).toBe(0)
})

test('work centre reopens hidden terminal at the selected proposal and lifecycle reflects actual adoption',async({page,context})=>{
 await openApp(page);await setKey(page)
 const a=await createPage(page,{title:'First target',content:doc(para('First before'))}),b=await createPage(page,{title:'Second target',content:doc(para('Second before'))});await gotoPage(page,a)
 await mockAgent(context,[call('read-a','read_page',{id:a}),call('read-b','read_page',{id:b}),call('edit-a','edit_page',{id:a,edits:[{op:'replace_all',markdown:'First after'}]}),call('edit-b','edit_page',{id:b,edits:[{op:'replace_all',markdown:'Second after'}]}),say('Two proposed changes await review.')])
 await page.keyboard.press(`${MOD}+j`);await prompt(page).fill('Update both pages as proposed.');await prompt(page).press('Enter')
 await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 await expect(terminal(page).locator('.term-turn .result-progress')).toHaveAttribute('data-phase','review')
 await page.keyboard.press(`${MOD}+j`)
 const d=await openOverview(page)
 const second=d.locator('article').filter({has:page.getByText('Second target',{exact:true})})
 await second.getByRole('button',{name:'Review difference',exact:true}).click()
 const c=terminal(page).locator('.term-change').filter({hasText:'Second target'})
 await expect(c).toBeFocused()
 expect(await wsEval(page,(s,id)=>s.pages[id].plain,b)).toContain('Second before')
 await c.getByRole('button',{name:/Apply|Accept/}).first().click()
 await expect(terminal(page).locator('.term-turn .result-progress')).toContainText('1 changes applied; 1 still open')
 expect(await wsEval(page,(s,id)=>s.pages[id].plain,a)).toContain('First before')
 await page.keyboard.press(`${MOD}+j`)
 const recovery=await openOverview(page)
 await expect(recovery.locator('.term-saved-work')).toContainText('Original page:')
 await expect(recovery.locator('.term-saved-work')).toContainText('Next step:')
 await recovery.locator('.term-saved-work').getByRole('button',{name:'First target',exact:true}).click()
 await expect(recovery).toHaveCount(0)
 await expect(page).toHaveURL(new RegExp('/p/'+a))
})

test('analysis lifecycle and version changes lead to the exact affected finding',async({page})=>{
 await openApp(page)
 const a=analysisFixture(true);a.active=a.revisions[0].id;a.revisions[0].state='accepted';const newer=structuredClone(a.revisions[0]);newer.id='revision-two';newer.state='ready';newer.report.findings[0].claim='Newly documented timeout behavior';a.revisions.push(newer)
 const id=await createPage(page,{title:'Versioned investigation',content:doc({type:'codeBlock',attrs:{id:'analysis-place',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})});await gotoPage(page,id)
 const block=page.getByRole('region',{name:'Code analysis'})
 await expect(block.locator('.result-progress')).toHaveAttribute('data-phase','adopted')
 await block.getByRole('tab',{name:'Versions',exact:true}).click()
 await block.getByRole('button',{name:/V2/}).click()
 await expect(block.locator('.result-progress')).toHaveAttribute('data-phase','review')
 await block.getByRole('button',{name:'Open affected finding',exact:true}).click()
 await expect(block.locator('article').filter({hasText:'Newly documented timeout behavior'})).toBeFocused()
})


test('mock versions expose feedback rationale, partial human assessment and original marked location without changing the mock',async({page,aiNet,errors})=>{
 errors.allow(/Blocked script execution.*sandboxed/)
 await openApp(page)
 const m=checkpointMock(mockBlockData(packageFixture().spec),'First snapshot'),v=m.journal!.versions[0]
 m.journal!.notes.push({id:'feedback-one',at:'2026-11-08T10:00:00Z',version:v.key,element:{path:'body',tag:'body',text:'Preview',component:'Preview',requirement:'',snippet:''},text:'Check status presentation',intent:'fix',scope:'mock',resolved:false,md:'pending',reviewed:{version:v.key,result:'partial',at:'2026-11-08T10:01:00Z'},assessment:{id:'feedback-one',scope:'mock',reason:'Use a readable status badge',proposal:'Keep the label and show its state',refs:[]}})
 const id=await createPage(page,{title:'Feedback history',content:doc({type:'designMock',attrs:{id:'feedback-history',spec:m},content:[para('Mock') ]})});await gotoPage(page,id)
 const block=page.locator('.mock-block')
 const before=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)
 await block.getByRole('tab',{name:'Versions',exact:true}).click()
 await block.getByText('Feedback and assessment for this version',{exact:true}).click()
 await expect(block).toContainText('AI rationale: Use a readable status badge')
 await expect(block).toContainText('Your assessment: partial')
 await block.getByRole('button',{name:'Locate feedback in mock',exact:true}).click()
 const modal=page.getByRole('dialog',{name:'Preview',exact:true})
 await expect(modal).toContainText('Check status presentation')
 await expect(modal.locator('iframe')).toHaveAttribute('sandbox','allow-same-origin')
 await page.keyboard.press('Escape')
 await expect(block.getByRole('button',{name:'Locate feedback in mock',exact:true})).toBeFocused()
 expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toBe(before)
 expect(aiNet.count('anthropic')).toBe(0)
})
