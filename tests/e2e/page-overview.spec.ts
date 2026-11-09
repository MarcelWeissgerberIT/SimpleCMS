import type {BrowserContext,Page as BrowserPage} from '@playwright/test'
import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,editorOf,flush,reloadApp} from './fixtures'
const text='Tip Touch ist für eine spätere Lieferung vorgesehen. Das Team muss entscheiden, ob es zum aktuellen Umfang gehört. Die fehlenden Adaptergrenzen müssen fachlich bestätigt werden.'
async function setup(page:BrowserPage){
 await openApp(page)
 const id=await createPage(page,{title:'Blowout: Umfang und Freigabe',content:doc(para(text))})
 await gotoPage(page,id);await flush(page)
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 await page.getByRole('group',{name:'Page view',exact:true}).getByRole('button',{name:'Overview',exact:true}).click()
 return id
}
async function model(context:BrowserContext,{invalid=false,wait}: {invalid?:boolean;wait?:Promise<void>}={}){
 const bodies:any[]=[]
 await context.route('https://api.anthropic.com/**',async route=>{
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET'}
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const body=route.request().postDataJSON();bodies.push(body)
  const content=body.messages[0].content,prompt=typeof content==='string'?content:content.find((x:any)=>x.type==='text').text
  const source=JSON.parse(prompt).sources.find((s:any)=>s.text.includes('Tip Touch'))
  const base={role:'',doneWhen:'',options:[],sourceId:source.id,quote:invalid?'Eine erfundene Quellenstelle ohne Beleg.':source.text}
  const items=[{...base,kind:'summary',title:'Umfang noch offen',detail:'Vor der Umsetzung ist eine Entscheidung über Tip Touch nötig.'},{...base,kind:'decision',title:'Tip Touch jetzt aufnehmen?',detail:'Das Team entscheidet über die Lieferung.',role:'Fachseite',options:['Aktuelle Lieferung','Spätere Lieferung']},{...base,kind:'action',title:'Adaptergrenzen klären',detail:'Fehlende Grenzen mit der Fachseite abstimmen.',role:'Fachseite',doneWhen:'Die fehlenden Adaptergrenzen sind dokumentiert und fachlich bestätigt.'}]
  await wait
  await route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({id:'msg_overview',type:'message',role:'assistant',model:body.model,content:[{type:'text',text:JSON.stringify({items})}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:30,output_tokens:100}})}).catch(()=>{})
 });return bodies
}
const overview=(page:BrowserPage)=>page.getByRole('region',{name:'Page overview',exact:true})
async function generate(page:BrowserPage){await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect(overview(page).locator('.overview-card')).toHaveCount(3)}

test('explicit cached overview preserves document and source navigation; personal choice survives reload',async({page,context})=>{
 const calls=await model(context),id=await setup(page),before=await wsEval(page,(s,id)=>s.pages[id].content,id)
 expect(calls).toHaveLength(0);await generate(page);expect(calls).toHaveLength(1)
 expect(await wsEval(page,(s,id)=>s.pages[id].content,id)).toEqual(before)
 expect(calls[0].tools??[]).toHaveLength(0)
 await overview(page).locator('.overview-card').first().getByText('Source passage',{exact:true}).click()
 await overview(page).getByRole('button',{name:'Show passage in document'}).click();await expect(editorOf(page)).toBeVisible();await expect(editorOf(page)).toContainText('Tip Touch')
 await reloadApp(page);await expect(editorOf(page)).toBeVisible()
 await page.getByRole('group',{name:'Page view',exact:true}).getByRole('button',{name:'Overview',exact:true}).click()
 await expect(overview(page).locator('.overview-card')).toHaveCount(3);expect(calls).toHaveLength(1)
})

test('human decisions and adopted tasks survive refresh, with outdated-source indication',async({page,context})=>{
 await model(context);const id=await setup(page);await generate(page)
 const decision=overview(page).locator('[data-kind=decision]')
 await decision.getByRole('button',{name:'Review and record'}).click();await expect(decision.getByRole('button',{name:'Confirm',exact:true})).toBeDisabled()
 await decision.getByLabel('Decision or feedback').fill('Tip Touch bleibt außerhalb dieser Lieferung.');await decision.getByLabel('Responsible (optional)').fill('Anna');await decision.getByRole('button',{name:'Confirm',exact:true}).click()
 const action=overview(page).locator('[data-kind=action]');await action.getByRole('button',{name:'Adopt as task'}).click();await expect(action.getByRole('link',{name:'Open adopted task'})).toBeVisible()
 const task=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.parentId===id&&p.title==='Adaptergrenzen klären'),id) as any
 expect(task.content.content[0].type).toBe('taskList')
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Updated scope'}),id)
 await expect(overview(page).getByRole('status')).toContainText('older version');await expect(overview(page).getByRole('button',{name:'Review and record'})).toHaveCount(0)
 await overview(page).getByRole('button',{name:'Update overview',exact:true}).click();await expect(overview(page).getByRole('status')).toHaveCount(0)
 await expect(decision).toContainText('Tip Touch bleibt außerhalb dieser Lieferung.');await expect(decision).toContainText('Review needed')
 await expect(action.getByRole('link',{name:'Open adopted task'})).toHaveAttribute('href','#/p/'+task.id)
 expect(await wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.parentId===id&&p.title==='Adaptergrenzen klären').length,id)).toBe(1)
 await reloadApp(page);await expect(overview(page)).toContainText('Anna')
})

test('invalid source quotes cannot replace an existing overview',async({page,context})=>{
 await model(context);const id=await setup(page);await generate(page)
 const saved=await wsEval(page,(s,id)=>s.pages[id].overview,id)
 await context.unroute('https://api.anthropic.com/**');await model(context,{invalid:true})
 await overview(page).getByRole('button',{name:'Update overview',exact:true}).click();await expect(overview(page).getByRole('alert')).toContainText('source passages')
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toEqual(saved)
})

test('a page edit during inference refuses the old result',async({page,context})=>{
 let release!:()=>void;const calls=await model(context,{wait:new Promise<void>(r=>release=r)}),id=await setup(page)
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect.poll(()=>calls.length).toBe(1)
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Changed while generating'}),id);release()
 await expect(overview(page).getByRole('alert')).toContainText('changed during generation');expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
})

test('cancel leaves no saved result and locked/viewer pages cannot generate or adopt',async({page,context})=>{
 let release!:()=>void;const calls=await model(context,{wait:new Promise<void>(r=>release=r)}),id=await setup(page)
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect.poll(()=>calls.length).toBe(1)
 await overview(page).getByRole('button',{name:'Cancel',exact:true}).click();release();await expect(overview(page).getByRole('button',{name:'Create overview',exact:true})).toBeEnabled()
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:true}),id);await expect(overview(page).getByRole('button',{name:'Create overview'})).toHaveCount(0)
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:false}),id)
 await page.evaluate(()=>{(window as any).__one.cloud.useCloud.setState({readOnly:true,role:'viewer'})})
 await expect(overview(page).getByRole('button',{name:'Create overview'})).toHaveCount(0)
})

test('large pages stop explicitly before model use rather than silently truncate',async({page,context})=>{
 const calls=await model(context),id=await setup(page)
 await wsEval(page,(s,id)=>s.setContent(id,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Long content '.repeat(11000)}]}]},'e2e'),id)
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect(overview(page).getByRole('alert')).toContainText('nothing was truncated');expect(calls).toHaveLength(0)
})

test('overview fits mobile and uses One themes',async({page,context},testInfo)=>{
 await page.emulateMedia({reducedMotion:'reduce'});await model(context);await setup(page);await generate(page)
 await wsEval(page,s=>s.updateSettings({language:'de'}));await page.screenshot({path:testInfo.outputPath('overview-light.png'),fullPage:true,animations:'disabled'})
 await wsEval(page,s=>s.updateSettings({theme:'dark'}));await page.screenshot({path:testInfo.outputPath('overview-dark.png'),fullPage:true,animations:'disabled'})
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.sb')).toHaveAttribute('data-state','drawer');await expect.poll(()=>page.locator('.pv-title').evaluate(el=>el.clientWidth)).toBeGreaterThan(300);await expect.poll(()=>page.locator('.pv-title').evaluate(el=>el.clientHeight)).toBeLessThan(120);await expect(page.getByRole('region',{name:'Seitenüberblick'})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:testInfo.outputPath('overview-mobile.png'),fullPage:true,animations:'disabled'});await page.locator('.overview-section').first().scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('overview-mobile-cards.png'),animations:'disabled'})
})

test('a concurrent review does not erase unsaved feedback and requires reloading the saved version',async({page,context})=>{
 await model(context);const id=await setup(page);await generate(page)
 const decision=overview(page).locator('[data-kind=decision]')
 await decision.getByRole('button',{name:'Review and record'}).click()
 await decision.getByLabel('Decision or feedback').fill('Mein noch ungespeicherter Entwurf')
 await wsEval(page,(s,id)=>{const p=s.pages[id],item=p.overview.items.find((i:any)=>i.kind==='decision');s.updatePage(id,{overviewReviews:{[item.id]:{item,signature:p.overview.signature,at:Date.now(),by:'Ben',state:'confirmed',note:'Ben hat den Umfang bestätigt.',owner:'Ben'}}})},id)
 await expect(decision.getByRole('alert')).toContainText('changed while you were editing')
 await expect(decision.getByLabel('Decision or feedback')).toHaveValue('Mein noch ungespeicherter Entwurf')
 await expect(decision.getByRole('button',{name:'Confirm',exact:true})).toBeDisabled()
 await decision.getByRole('button',{name:'Review and record'}).click();await decision.getByRole('button',{name:'Review and record'}).click()
 await expect(decision.getByLabel('Decision or feedback')).toHaveValue('Ben hat den Umfang bestätigt.')
})
