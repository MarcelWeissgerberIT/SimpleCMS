import type {BrowserContext} from '@playwright/test'
import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,flush,reloadApp} from './fixtures'
import {claudeSse} from './helpers/providers'
async function setup(page:any){
 await openApp(page)
 const id=await createPage(page,{title:'Release review',content:doc(para('Three completed entries still await confirmation by the team.'))})
 const other=await createPage(page,{title:'Integration evidence',content:doc(para('Integration is blocked by the missing adapter.'))})
 const privateId=await createPage(page,{title:'Private source',content:doc(para('This must never be sent.'))});await wsEval(page,(s,id)=>s.updatePage(id,{private:true}),privateId)
 await gotoPage(page,id);await flush(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 await page.getByRole('group',{name:'Page view',exact:true}).getByRole('button',{name:'Overview',exact:true}).click()
 await page.getByRole('group',{name:'Choose template'}).getByRole('button',{name:/01.*Review/}).click()
 return {id,other}
}
async function model(context:BrowserContext,invalid=false){
 const calls:any[]=[]
 await context.route('https://api.anthropic.com/**',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET'}
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers})
  const body=route.request().postDataJSON();calls.push(body)
  const content=body.messages[0].content,prompt=typeof content==='string'?content:content.find((x:any)=>x.type==='text').text,sources=JSON.parse(prompt).sources
  const base={role:'',doneWhen:'',options:[],sourceId:sources[0].id,quote:sources[0].text}
  const items=[{...base,kind:'summary',section:'summary',title:'Confirmation remains open',detail:'Completed work still needs team confirmation.'},{...base,kind:'question',section:invalid?'invented':'pending',title:'Confirm completed entries',detail:'Three entries await confirmation.'}]
  if(sources.length>1)items.push({...base,sourceId:sources[1].id,quote:sources[1].text,kind:'finding',section:'blocked',title:'Adapter blocks integration',detail:'The missing adapter blocks integration.'})
  await route.fulfill({status:200,headers:{...headers,'content-type':'text/event-stream'},body:claudeSse({blocks:[{type:'text',text:JSON.stringify({items})}]},body.model)})
 });return calls
}
const preview=(page:any)=>page.getByRole('region',{name:'Template preview',exact:true})
async function prepare(page:any){await page.getByRole('button',{name:'Prepare with AI',exact:true}).click();await expect(preview(page)).toBeVisible()}

test('review template accepts source drag, previews before saving and survives reload',async({page,context},info)=>{
 const calls=await model(context),{id,other}=await setup(page)
 await page.screenshot({path:info.outputPath('template-gallery.png'),fullPage:true})
 await page.getByText('Add more pages',{exact:true}).click()
 await expect(page.getByRole('button',{name:'Add source: Private source'})).toHaveCount(0)
 await page.getByLabel('Search pages',{exact:true}).fill('Integration')
 const source=page.locator('.overview-template-source-result').filter({hasText:'Integration evidence'})
 await expect(source).toContainText('text blocks');await source.dragTo(page.locator('.overview-template-drop'))
 await expect(page.locator('.overview-template-drop')).toContainText('Integration evidence')
 await prepare(page)
 expect(calls).toHaveLength(1);expect(JSON.stringify(calls[0])).not.toContain('This must never be sent')
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
 await expect(preview(page).locator('[data-lane=pending]')).toContainText('Confirm completed entries')
 await expect(preview(page).locator('[data-lane=blocked]')).toContainText('Adapter blocks integration')
 await expect(preview(page).locator('[data-lane=done]')).toContainText('No sourced statement')
 await preview(page).getByRole('button',{name:'Adopt template'}).click()
 await expect(preview(page)).toHaveCount(0)
 const saved=await wsEval(page,(s,id)=>s.pages[id].overview,id) as any
 expect(saved.template).toBe('review');expect(saved.sourcePages.map((p:any)=>p.id)).toContain(other)
 await reloadApp(page);await expect(page.locator('[data-lane=pending]')).toContainText('Confirm completed entries');expect(calls).toHaveLength(1)
 await page.screenshot({path:info.outputPath('review-template-desktop.png'),fullPage:true})
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await expect(page.locator('.sb')).toHaveAttribute('data-state','drawer');await expect.poll(()=>page.locator('.pv-title').evaluate(el=>el.clientWidth)).toBeGreaterThan(300);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('review-template-mobile.png'),fullPage:true,animations:'disabled'})
 await page.locator('[data-lane=pending]').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('review-template-mobile-content.png'),animations:'disabled'})
})

test('changed sources block adoption and discarding leaves the document untouched',async({page,context})=>{
 await model(context);const {id}=await setup(page);await prepare(page)
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Changed review'}),id)
 await preview(page).getByRole('button',{name:'Adopt template'}).click()
 await expect(page.getByRole('alert').filter({hasText:'sources or saved overview changed'})).toBeVisible()
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
 await preview(page).getByRole('button',{name:'Discard draft'}).click();await expect(preview(page)).toHaveCount(0)
})

test('invalid template section never enters a saved overview',async({page,context})=>{
 await model(context,true);const {id}=await setup(page)
 await page.getByRole('button',{name:'Prepare with AI'}).click()
 await expect(page.getByRole('alert').filter({hasText:'source passages'})).toBeVisible()
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined();await expect(preview(page)).toHaveCount(0)
})

for(const presentation of [false,true])test(`accepted template opens as ${presentation?'presentation':'thinking desk'} with sources and groups`,async({page,context})=>{
 await model(context);const {id}=await setup(page);await prepare(page)
 await preview(page).getByRole('button',{name:'Adopt template'}).click();await expect(preview(page)).toHaveCount(0)
 await page.getByRole('button',{name:presentation?'Open as presentation':'Open as thinking desk',exact:true}).click()
 await expect(page.getByRole('navigation',{name:'Desk view'})).toBeVisible()
 const desk=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.parentId===id&&p.workbench),id) as any
 const records=Object.values(desk.workbenchRecords) as any[]
 expect(records.filter(r=>r.type==='card')).toHaveLength(2)
 expect(records.filter(r=>r.type==='card').every(c=>c.source.pageId===id&&c.level===1)).toBe(true)
 expect(records.filter(r=>r.type==='link')).toHaveLength(0)
 if(presentation){expect(records.filter(r=>r.type==='slide')).toHaveLength(2);await expect(page.getByRole('button',{name:'Start presentation ↗',exact:true})).toBeEnabled()}
})
