import {createHash} from 'node:crypto'
import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,flush,reloadApp,mockClaude} from './fixtures'
import {docxBytes} from './helpers/files'
import {claudeSse} from './helpers/providers'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
test.beforeEach(async({page})=>{if(process.env.E2E_ROOT==='1')await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html>'}))})
const desk=(p:any)=>p.getByRole('region',{name:'Thinking desk',exact:true})
async function seed(page:any){
 await openApp(page);await page.emulateMedia({reducedMotion:'reduce'})
 const a=await createPage(page,{title:'Questionnaire',content:doc(para('SSO is supported in release 1.0.'))}),b=await createPage(page,{title:'Implementation notes',content:doc(para('Release 1.0 only supports local accounts. SSO is not implemented.'))})
 const id=await createPage(page,{title:'What can we promise?',content:doc(para('Working desk'))})
 const pages=await wsEval(page,s=>s.pages)
 const cards=[a,b].map((pid,i)=>({type:'card',id:'card-'+i,title:i?'Local accounts only':'SSO supported',detail:pages[pid].content.content[0].content[0].text,source:{kind:'page',pageId:pid,blockId:pages[pid].content.content[0].attrs?.id??'block:0',quote:pages[pid].content.content[0].content[0].text,signature:hash(JSON.stringify([pages[pid].title,pages[pid].content])),label:pages[pid].title},x:i*280,y:0,group:'Release 1.0',level:1,evidence:'',evidenceUrl:'',at:1,by:'Tester'}))
 await wsEval(page,(s,v)=>{s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'});s.updatePage(v.id,{workbench:true,workbenchRecords:Object.fromEntries(v.cards.map((c:any)=>[c.id,c]))})},{id,cards})
 await gotoPage(page,id);await expect(desk(page).locator('.wb-card-hit')).toHaveCount(2)
 await expect(desk(page).getByText('Loading source pages …',{exact:true})).toHaveCount(0)
 return {id,a,b,cards}
}
async function selectBoth(page:any){await desk(page).getByRole('checkbox',{name:'Select: SSO supported',exact:true}).check();await desk(page).getByRole('checkbox',{name:'Select: Local accounts only',exact:true}).check()}
function answer(raw:string,invalid=false){
 const body=JSON.parse(raw),c=body.messages[0].content,input=JSON.parse(typeof c==='string'?c:c.find((x:any)=>x.type==='text').text),ids=input.cards.map((c:any)=>c.id)
 return JSON.stringify({summary:'Selected sources disagree about SSO. This is a draft for review.',findings:[{text:'The questionnaire and implementation describe different capabilities.',cards:invalid?['invented']:ids}],conflicts:input.mode==='compare'?[{a:ids[0],b:ids[1],reason:'One source promises SSO; the other says local accounts only.'}]:[],patches:input.mode==='impact'?[{card:ids[0],before:input.cards[0].text,after:'Only local accounts are supported in release 1.0.',reason:'Reflect the confirmed scope decision.'}]:[],tasks:input.mode==='scenario'?[{text:'Check the additional authentication integration before committing to SSO.',cards:ids}]:[]})
}

test('a desk can be created from a normal page and collect a real source passage',async({page})=>{
 await openApp(page);const id=await createPage(page,{title:'Business analysis',content:doc(para('The release scope remains open.'))});await gotoPage(page,id)
 await page.getByRole('button',{name:'Open thinking desk',exact:true}).click();await page.getByLabel('New thinking desk',{exact:true}).fill('Release workshop');await page.getByRole('button',{name:'Create and open',exact:true}).click()
 await expect(desk(page)).toBeVisible();await desk(page).getByRole('button',{name:'Choose first source'}).click()
 await desk(page).getByLabel('Select source',{exact:true}).selectOption(id)
 await desk(page).getByRole('button',{name:'Add to desk',exact:true}).click()
 await expect(desk(page).locator('.wb-card-hit')).toHaveCount(1);await reloadApp(page);await expect(desk(page).locator('.wb-card-hit')).toHaveCount(1)
})

test('semantic zoom, keyboard positions and evidence levels persist; mobile fits',async({page},info)=>{
 const {id}=await seed(page)
 await desk(page).getByText('Display & filters',{exact:true}).click()
 for(const size of [8,16,32,64,128,256]){await desk(page).locator('.wb-zoom-steps').getByRole('button',{name:String(size),exact:true}).click();await expect(desk(page).locator('.wb-card').first()).toHaveCSS('width',size+'px');await expect(desk(page).locator('.wb-card').first()).toHaveCSS('height',size+'px')}
 const trigger=desk(page).getByRole('button',{name:'SSO supported · Source available',exact:true});await trigger.focus();await page.keyboard.press('Alt+ArrowDown')
 expect(await wsEval(page,(s,id)=>s.pages[id].workbenchRecords['card-0'].y,id)).toBe(280)
 await trigger.click();const details=desk(page).getByRole('complementary',{name:'Card details'})
 await details.getByLabel('Evidence level',{exact:true}).selectOption('3');await expect(details.getByRole('button',{name:'Save',exact:true})).toBeDisabled()
 await details.getByLabel('Rationale / test result').fill('Authentication test run 42 passed.');await details.getByLabel('Evidence or test report (link)').fill('https://example.com/tests/42');await details.getByRole('button',{name:'Save',exact:true}).click()
 await desk(page).getByLabel('Evidence level',{exact:true}).selectOption('3');await expect(desk(page).locator('.wb-card-hit')).toHaveCount(1)
 await reloadApp(page);await desk(page).getByText('Display & filters',{exact:true}).click();await expect(desk(page).locator('.wb-zoom-steps').getByRole('button',{name:'256',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.screenshot({path:info.outputPath('desk-desktop.png')})
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__one.ui.setState({mobileSidebarOpen:false}));await expect(page.locator('.sb')).not.toBeInViewport()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('desk-mobile.png')})
})

test('comparison creates possible conflict; human decision resolves it and applies one reviewed patch',async({page,context})=>{
 const calls=await mockClaude(context,answer),{id,a}=await seed(page);await selectBoth(page)
 await desk(page).getByLabel('Question about the selection').fill('Do these claims agree?');await desk(page).getByRole('button',{name:'Analyze selection'}).click()
 await expect(desk(page).getByLabel('Analysis result')).toContainText('Selected sources disagree')
 await desk(page).getByRole('button',{name:/Threads/}).click();await expect(desk(page)).toContainText('POSSIBLE CONFLICT')
 expect(await wsEval(page,(s,id)=>s.pages[id].content.content[0].content[0].text,a)).toBe('SSO is supported in release 1.0.')
 await desk(page).getByRole('button',{name:'Record decision',exact:true}).click();await desk(page).getByLabel('What applies from now on?').fill('Only local accounts are included in release 1.0.');await desk(page).getByRole('button',{name:'Confirm and record',exact:true}).click()
 await desk(page).getByRole('button',{name:/Threads/}).click();await expect(desk(page)).toContainText('RESOLVED BY DECISION')
 await desk(page).getByRole('button',{name:'Analyze selection'}).click();await expect(desk(page).locator('.wb-patch')).toHaveCount(1)
 expect(await wsEval(page,(s,id)=>s.pages[id].content.content[0].content[0].text,a)).toBe('SSO is supported in release 1.0.')
 await desk(page).getByRole('button',{name:'Apply this change'}).click();await expect(desk(page).getByRole('link',{name:'Applied · open document'})).toBeVisible()
 expect(await wsEval(page,(s,id)=>s.pages[id].content.content[0].content[0].text,a)).toBe('Only local accounts are supported in release 1.0.')
 expect(calls).toHaveLength(2);await reloadApp(page)
 expect(Object.values(await wsEval(page,(s,id)=>s.pages[id].workbenchRecords,id)).filter((r:any)=>r.type==='adoption')).toHaveLength(1)
})

test('what-if produces a separate provisional plan without changing original pages',async({page,context})=>{
 await mockClaude(context,answer);const {id,a,b}=await seed(page),before=await wsEval(page,(s,ids)=>ids.map((id:string)=>s.pages[id].content),[a,b]);await selectBoth(page)
 await desk(page).getByText('More tools: decisions & scenarios',{exact:true}).click();await desk(page).getByLabel('Tool',{exact:true}).selectOption('scenario');await desk(page).getByLabel('Alternative assumption').fill('What if we include SSO in release 1.0?');await desk(page).getByRole('button',{name:'Analyze selection'}).click()
 await expect(desk(page).getByLabel('Analysis result')).toContainText('PROVISIONAL SCENARIO');await desk(page).getByRole('button',{name:'Save as a separate scenario plan'}).click()
 await expect(desk(page).getByRole('link',{name:'Open saved plan'})).toBeVisible()
 expect(await wsEval(page,(s,ids)=>ids.map((id:string)=>s.pages[id].content),[a,b])).toEqual(before)
 const plans=await wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.parentId===id&&p.title.startsWith('Scenario ·')),id);expect(plans).toHaveLength(1);expect(JSON.stringify(plans[0])).toContain('taskList')
})

test('unknown source IDs and changed sources cannot become analyses',async({page,context})=>{
 const calls=await mockClaude(context,raw=>answer(raw,true));const {id,a}=await seed(page);await selectBoth(page)
 await desk(page).getByLabel('Question about the selection').fill('Compare');await desk(page).getByRole('button',{name:'Analyze selection'}).click();await expect(desk(page).getByRole('alert')).toContainText('invalid source references')
 expect(Object.values(await wsEval(page,(s,id)=>s.pages[id].workbenchRecords,id)).filter((r:any)=>r.type==='analysis')).toHaveLength(0)
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Changed source'}),a)
 await desk(page).getByRole('button',{name:'Analyze selection'}).click();await expect(desk(page).getByRole('alert')).toContainText('source changed');expect(calls).toHaveLength(1)
})

test('locked desks are readable and private source pages are not offered to a shared desk',async({page})=>{
 const {id}=await seed(page);await wsEval(page,s=>{const p=s.createPage({title:'Private secret'});s.updatePage(p,{private:true})})
 await desk(page).getByRole('button',{name:'＋ Collect sources'}).click();await expect(desk(page).getByLabel('Select source').locator('option',{hasText:'Private secret'})).toHaveCount(0)
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:true}),id)
 await expect(desk(page).getByRole('button',{name:'Analyze selection'})).toHaveCount(0);await expect(desk(page).getByRole('button',{name:'＋ Collect sources'})).toHaveCount(0)
 await desk(page).locator('.wb-card-hit').first().click();await expect(desk(page).getByRole('complementary',{name:'Card details'}).getByRole('button',{name:'Save',exact:true})).toHaveCount(0)
})

test('DOCX excerpts are extracted locally and retain their file provenance',async({page})=>{
 await seed(page)
 const source=await page.evaluate(async data=>{const one=(window as any).__one,blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))]),src=await one.files.saveFile(blob,'report.docx'),s=one.workspace.getState(),id=s.createPage({title:'Attached report'});s.setContent(id,{type:'doc',content:[{type:'fileBlock',attrs:{id:'file-report',src,name:'report.docx',size:blob.size}}]},'e2e');return id},Buffer.from(docxBytes()).toString('base64'))
 await desk(page).getByRole('button',{name:'＋ Collect sources'}).click();await desk(page).getByLabel('Select source').selectOption(source)
 await desk(page).getByText('Read attachments',{exact:true}).click();await desk(page).getByRole('button',{name:'report.docx · Load text',exact:true}).click()
 const text=await desk(page).getByLabel('report.docx',{exact:true}).inputValue();expect(text.length).toBeGreaterThan(30)
 await desk(page).getByLabel('Paste the original excerpt here').fill(text.slice(0,100));await desk(page).getByRole('button',{name:'Add file excerpt'}).click()
 await expect(desk(page).locator('.wb-card-hit')).toHaveCount(3)
})

test('a source changed during generation discards the late result; cancel never saves it',async({page,context})=>{
 await mockClaude(context,answer);const {id,a}=await seed(page);await selectBoth(page)
 let release!:()=>void,reading=false;let wait=new Promise<void>(resolve=>release=resolve)
 await context.route('**/api.anthropic.com/v1/messages**',async r=>{if(r.request().method()==='OPTIONS')return r.fallback();reading=true;const raw=r.request().postData()!;await wait;await r.fulfill({headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'},body:claudeSse({blocks:[{type:'text',text:answer(raw)}]})}).catch(()=>{})})
 await desk(page).getByLabel('Question about the selection').fill('Compare');await desk(page).getByRole('button',{name:'Analyze selection'}).click();await expect.poll(()=>reading).toBe(true)
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Changed while thinking'}),a);release()
 await expect(desk(page).getByRole('alert')).toContainText('changed during generation')
 expect(Object.values(await wsEval(page,(s,id)=>s.pages[id].workbenchRecords,id)).filter((r:any)=>r.type==='analysis')).toHaveLength(0)
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Questionnaire'}),a)
 reading=false;wait=new Promise<void>(resolve=>release=resolve)
 await desk(page).getByRole('button',{name:'Analyze selection'}).click();await expect.poll(()=>reading).toBe(true)
 await desk(page).getByRole('button',{name:'Cancel',exact:true}).click();release()
 await expect(desk(page).getByRole('button',{name:'Analyze selection'})).toBeEnabled()
 expect(Object.values(await wsEval(page,(s,id)=>s.pages[id].workbenchRecords,id)).filter((r:any)=>r.type==='analysis')).toHaveLength(0)
})

test('a removed card cannot crash a saved proposal or allow its application',async({page,context})=>{
 await mockClaude(context,answer);const {id}=await seed(page);await selectBoth(page)
 await desk(page).getByRole('button',{name:/Decisions/}).click();await desk(page).getByLabel('What applies from now on?').fill('Local accounts only.');await desk(page).getByRole('button',{name:'Confirm and record'}).click()
 await desk(page).getByRole('button',{name:'Analyze selection'}).click();await expect(desk(page).locator('.wb-patch')).toHaveCount(1)
 await wsEval(page,(s,id)=>{const p=s.pages[id];s.updatePage(id,{workbenchRecords:{...p.workbenchRecords,'card-0':{...p.workbenchRecords['card-0'],removed:true}}})},id)
 await expect(desk(page).getByRole('button',{name:'Apply this change'})).toBeDisabled();await expect(desk(page).getByLabel('Analysis result')).toBeVisible()
})

test('collecting a saved Atlas reference keeps the full pinned citation without reading the repository',async({page})=>{
 const {id}=await seed(page),citation={repo:'repo-a',snapshot:'snapshot-a',commit:'a'.repeat(40),path:'src/auth.ts',lines:[1,2],digest:'d'.repeat(64)}
 const source=await createPage(page,{title:'Code finding',content:doc({type:'codeBlock',attrs:{language:'atlas-code'},content:[{type:'text',text:JSON.stringify({citation,server:'aj-atlas',finding:'Only local accounts are implemented.'})}]})})
 await desk(page).getByRole('button',{name:'＋ Collect sources'}).click();await desk(page).getByLabel('Select source').selectOption(source);await desk(page).getByRole('button',{name:'Add to desk',exact:true}).click()
 const records=await wsEval(page,(s,id)=>s.pages[id].workbenchRecords,id),c:any=Object.values(records).find((c:any)=>c.source?.kind==='code')
 expect(c.source.code.citation).toEqual(citation);expect(c.level).toBe(1)
})


test('guided start suggests the parent, clears title searches and offers questions without an automatic model call',async({page,context},info)=>{
 const calls=await mockClaude(context,answer)
 await openApp(page)
 const source=await createPage(page,{title:'Release roadmap',content:doc(para('Login requirements are still open.'))})
 await gotoPage(page,source)
 await page.getByRole('button',{name:'Open thinking desk',exact:true}).click()
 await page.getByLabel('New thinking desk',{exact:true}).fill('Plan the release')
 await page.getByRole('button',{name:'Create and open',exact:true}).click()
 await expect(desk(page).locator('.wb-map')).toHaveCount(0)
 await expect(desk(page).locator('.wb-analysis-form')).toHaveCount(0)
 await expect(desk(page).locator('.wb-tabs')).toHaveCount(0)
 await desk(page).getByRole('button',{name:'Choose first source'}).click()
 await desk(page).getByRole('button',{name:'Release roadmap',exact:true}).click()
 await page.screenshot({path:info.outputPath('guided-source-desktop.png')})
 await expect(desk(page).getByRole('button',{name:'Add to desk',exact:true})).toBeVisible()
 await desk(page).getByLabel('Filter page titles').fill('Login')
 await expect(desk(page).getByLabel('Select source')).toHaveValue('')
 await expect(desk(page)).toContainText('No page with this title found.')
 await expect(desk(page).getByRole('button',{name:'Add to desk',exact:true})).toHaveCount(0)
 await desk(page).getByRole('button',{name:'Show all pages'}).click()
 await desk(page).getByRole('button',{name:'Release roadmap',exact:true}).click()
 await desk(page).getByRole('button',{name:'Add to desk',exact:true}).click()
 await expect(desk(page)).toContainText('1 statement collected')
 await desk(page).getByRole('button',{name:'Next: ask a question →'}).click()
 await expect(desk(page).getByLabel('Question about the selection')).toBeFocused()
 await expect(desk(page).locator('.wb-card')).toHaveCSS('width','256px')
 await expect(desk(page).getByLabel('Tool',{exact:true})).not.toBeVisible()
 await desk(page).getByRole('button',{name:'What is still open here?',exact:true}).click()
 await expect(desk(page).getByLabel('Question about the selection')).toHaveValue('What is still open here?')
 expect(calls).toHaveLength(0)
 await expect(desk(page).getByRole('button',{name:'Analyze selection'})).toBeEnabled()
 await page.screenshot({path:info.outputPath('guided-question-desktop.png')})
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__one.ui.setState({mobileSidebarOpen:false}))
 await expect(page.locator('.sb')).not.toBeInViewport()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('guided-question-mobile.png')})
})
