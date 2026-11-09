import {ledger} from './helpers/aiFlows'
import {claudeSse} from './helpers/providers'
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
async function model(context:BrowserContext,{invalid=false,wait,sourceContains='Tip Touch'}: {invalid?:boolean;wait?:Promise<void>;sourceContains?:string}={}){
 const bodies:any[]=[]
 await context.route('https://api.anthropic.com/**',async route=>{
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET'}
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const body=route.request().postDataJSON();bodies.push(body)
  const content=body.messages[0].content,prompt=typeof content==='string'?content:content.find((x:any)=>x.type==='text').text
  const source=JSON.parse(prompt).sources.find((s:any)=>s.text.includes(sourceContains))
  const base={role:'',doneWhen:'',options:[],sourceId:source.id,quote:invalid?'Eine erfundene Quellenstelle ohne Beleg.':source.text}
  const items=[{...base,kind:'summary',title:'Umfang noch offen',detail:'Vor der Umsetzung ist eine Entscheidung über Tip Touch nötig.'},{...base,kind:'decision',title:'Tip Touch jetzt aufnehmen?',detail:'Das Team entscheidet über die Lieferung.',role:'Fachseite',options:['Aktuelle Lieferung','Spätere Lieferung']},{...base,kind:'action',title:'Adaptergrenzen klären',detail:'Fehlende Grenzen mit der Fachseite abstimmen.',role:'Fachseite',doneWhen:'Die fehlenden Adaptergrenzen sind dokumentiert und fachlich bestätigt.'}]
  await wait
  await route.fulfill({status:200,headers:{...cors,'content-type':body.stream?'text/event-stream':'application/json'},body:body.stream?claudeSse({blocks:[{type:'text',text:JSON.stringify({items})}]},body.model):JSON.stringify({id:'msg_overview',type:'message',role:'assistant',model:body.model,content:[{type:'text',text:JSON.stringify({items})}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:30,output_tokens:100}})}).catch(()=>{})
 });return bodies
}
const overview=(page:BrowserPage)=>page.getByRole('region',{name:'Page overview',exact:true})
async function generate(page:BrowserPage){await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect(overview(page).locator('.overview-card')).toHaveCount(3);await expect(overview(page).getByRole('button',{name:'Update overview',exact:true})).toBeEnabled()}

test('explicit cached overview preserves document and source navigation; personal choice survives reload',async({page,context})=>{
 const calls=await model(context),id=await setup(page),before=await wsEval(page,(s,id)=>s.pages[id].content,id)
 expect(calls).toHaveLength(0);await generate(page);expect(calls).toHaveLength(1)
 expect(await wsEval(page,(s,id)=>s.pages[id].content,id)).toEqual(before)
 expect(calls[0].tools??[]).toHaveLength(0)
 await overview(page).locator('.overview-card').first().getByText('Source passage',{exact:true}).click()
 await overview(page).locator('.overview-card').first().getByRole('button',{name:'Show passage in document'}).click();await expect(editorOf(page)).toBeVisible();await expect(editorOf(page)).toContainText('Tip Touch')
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
 await expect(overview(page).getByRole('alert').filter({hasText:'changed during generation'})).toBeVisible();expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
})

test('cancel leaves no saved result and locked/viewer pages cannot generate or adopt',async({page,context})=>{
 let release!:()=>void;const calls=await model(context,{wait:new Promise<void>(r=>release=r)}),id=await setup(page)
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect.poll(()=>calls.length).toBe(1)
 await overview(page).getByRole('button',{name:'Cancel generation',exact:true}).click();release();await expect(overview(page).getByRole('button',{name:'Create overview',exact:true})).toBeEnabled()
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

/** A controllable browser response stream: held open until the test explicitly completes it.
 * No provider/network request is made, including in the deployed-asset live smoke test.
 */
async function slowModel(page:BrowserPage){
 await page.evaluate(()=>{
  const native=window.fetch.bind(window),w=window as any
  w.__overviewWire={calls:0}
  window.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
   if(!url.startsWith('https://api.anthropic.com/')||!url.includes('/messages'))return native(input,init)
   const wire=w.__overviewWire;wire.calls++
   const body=JSON.parse(String(init?.body));wire.body=body
   const prompt=typeof body.messages[0].content==='string'?body.messages[0].content:body.messages[0].content.find((c:any)=>c.type==='text').text
   const source=JSON.parse(prompt).sources.find((s:any)=>s.text.includes('Tip Touch'))
   const common={role:'',doneWhen:'',options:[],sourceId:source.id,quote:source.text}
   const first={...common,kind:'summary',title:'Erste Zusammenfassung',detail:'Der Umfang ist noch offen.'}
   const last={...common,kind:'action',title:'Grenzen bestätigen',detail:'Die Fachseite klärt die Grenzen.',doneWhen:'Die Grenzen sind bestätigt.'}
   const event=(type:string,data:object)=>`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`
   const stream=new ReadableStream<Uint8Array>({start(controller){
    const send=(value:string)=>controller.enqueue(new TextEncoder().encode(value))
    wire.first=()=>send(event('message_start',{message:{id:'msg_progress',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:30,output_tokens:1}}})+event('content_block_start',{index:0,content_block:{type:'text',text:''}})+event('content_block_delta',{index:0,delta:{type:'text_delta',text:'{"items":['+JSON.stringify(first)}}))
    wire.finish=()=>{send(event('content_block_delta',{index:0,delta:{type:'text_delta',text:','+JSON.stringify(last)+']}'}})+event('content_block_stop',{index:0})+event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:100}})+event('message_stop',{}));controller.close()}
    wire.fail=()=>controller.error(new Error('Test stream interrupted'))
    init?.signal?.addEventListener('abort',()=>{wire.aborted=true;controller.error(new DOMException('Aborted','AbortError'))},{once:true})
   }})
   return new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}})
  }
 })
}
const wire=(page:BrowserPage,method:'first'|'finish'|'fail')=>page.evaluate(method=>(window as any).__overviewWire[method](),method)

test('slow stream gives real progress and early cards before completion; document reading keeps its place',async({page},testInfo)=>{
 const id=await setup(page);await slowModel(page)
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click()
 await expect(overview(page).getByRole('status')).toContainText('Wait for model response')
 await expect.poll(()=>page.evaluate(()=>(window as any).__overviewWire.calls)).toBe(1)
 await expect(overview(page).getByRole('timer')).not.toHaveText('0:00')
 await wire(page,'first')
 await expect(overview(page).getByRole('status')).toContainText('1 card ready')
 await expect(overview(page).getByRole('region',{name:'First results'})).toContainText('Erste Zusammenfassung')
 await expect(overview(page).getByRole('button',{name:'Adopt as task'})).toHaveCount(0)
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
 await page.screenshot({path:testInfo.outputPath('overview-progress-desktop.png'),animations:'disabled'})
 await page.setViewportSize({width:390,height:844});await page.locator('.overview-progress').scrollIntoViewIfNeeded()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:testInfo.outputPath('overview-progress-mobile.png'),animations:'disabled'})
 await overview(page).getByRole('button',{name:'Read document while waiting'}).click();await expect(editorOf(page)).toBeVisible()
 await wire(page,'finish');await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].overview?.items.length,id)).toBe(2)
 await expect(editorOf(page)).toBeVisible()
 await page.getByRole('group',{name:'Page view',exact:true}).getByRole('button',{name:'Overview',exact:true}).click()
 await expect(overview(page).getByRole('region',{name:'First results'})).toHaveCount(0)
 await expect(overview(page).getByRole('button',{name:'Adopt as task'})).toBeVisible()
 const entries=await ledger(page);expect(entries).toHaveLength(1);expect(entries[0].purpose).toBe('page.overview');expect(entries[0].outcome).toBe('ok')
 expect(await page.evaluate(()=>(window as any).__overviewWire.body.stream)).toBe(true)
 expect(await page.evaluate(()=>(window as any).__overviewWire.calls)).toBe(1)
})

for(const end of ['cancel','fail'] as const)test(`partial refresh ${end} preserves saved cards and clears previews without a second call`,async({page})=>{
 const id=await setup(page);await slowModel(page)
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__overviewWire.calls)).toBe(1)
 await wire(page,'first');await wire(page,'finish')
 await expect(overview(page).getByRole('button',{name:'Update overview',exact:true})).toBeEnabled()
 const saved=await wsEval(page,(s,id)=>s.pages[id].overview,id)
 await page.evaluate(()=>(window as any).__overviewWire.calls=0)
 await overview(page).getByRole('button',{name:'Update overview',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__overviewWire.calls)).toBe(1)
 await wire(page,'first');await expect(overview(page).getByRole('region',{name:'First results'})).toBeVisible()
 if(end==='cancel')await overview(page).getByRole('button',{name:'Cancel generation',exact:true}).click()
 else {await wire(page,'fail');await expect(overview(page).getByRole('alert')).toBeVisible()}
 await expect(overview(page).getByRole('button',{name:'Update overview',exact:true})).toBeEnabled()
 await expect(overview(page).getByRole('region',{name:'First results'})).toHaveCount(0)
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toEqual(saved)
 expect(await page.evaluate(()=>(window as any).__overviewWire.calls)).toBe(1)
})


test('Haiku structured previews use the ordinary stream endpoint and meter the completed response once',async({page,context})=>{
 const calls=await model(context);await setup(page)
 await wsEval(page,s=>s.updateSettings({aiModel:'claude-haiku-4-5'}))
 await generate(page)
 expect(calls).toHaveLength(1);expect(calls[0].stream).toBe(true);expect(calls[0].model).toBe('claude-haiku-4-5')
 expect(calls[0].output_config.format.type).toBe('json_schema')
 const entries=await ledger(page);expect(entries).toHaveLength(1);expect(entries[0].purpose).toBe('page.overview');expect(entries[0].outcome).toBe('ok');expect(entries[0].served.model).toBe('claude-haiku-4-5')
})


test('selected cards become a page-specific follow-up database without duplicating or overwriting tracked work',async({page,context},testInfo)=>{
 await model(context);const id=await setup(page);await generate(page)
 const cards=overview(page).locator('.overview-card')
 await cards.nth(0).getByRole('checkbox',{name:'Select for follow-up'}).check()
 await cards.nth(1).getByRole('checkbox',{name:'Select for follow-up'}).check()
 const tracking=overview(page).getByRole('region',{name:'Follow-up',exact:true})
 await expect(tracking).toContainText('2 selected · not added yet')
 expect(await wsEval(page,(s,id)=>Object.values(s.pages).some((p:any)=>p.kind==='database'&&p.overviewFollowUp?.pageId===id),id)).toBe(false)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900})
  await cards.last().getByRole('heading').scrollIntoViewIfNeeded()
  await expect(tracking.getByRole('button',{name:'Track selected (2)',exact:true})).toBeInViewport()
  expect(await tracking.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  const check=cards.nth(0).getByRole('checkbox',{name:'Select for follow-up'})
  expect(await check.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await check.evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--signal)';el.parentElement!.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color}))
  await page.screenshot({path:testInfo.outputPath(`tracking-selected-${width}.png`),animations:'disabled'})
 }
 await page.setViewportSize({width:1440,height:900})
 await tracking.getByRole('button',{name:'Track selected (2)',exact:true}).click()
 await expect(tracking).toHaveCount(0)
 await expect(overview(page).getByRole('status')).toContainText('2 items added.')
 await expect(overview(page).getByRole('link',{name:'Open follow-up',exact:true})).toBeVisible()
 const dbId=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.kind==='database'&&p.overviewFollowUp?.pageId===id)?.id,id) as string
 await page.screenshot({path:testInfo.outputPath('overview-tracking-selection.png'),fullPage:true,animations:'disabled'})
 expect(dbId).toBeTruthy()
 const rows=await wsEval(page,(s,dbId)=>Object.values(s.pages).filter((p:any)=>p.databaseId===dbId),dbId) as any[]
 expect(rows).toHaveLength(2);expect(rows.every(r=>r.properties['ov-status']==='ov-open')).toBe(true)
 expect(rows[0].content.content.some((n:any)=>n.content?.some((c:any)=>c.text?.includes('Tip Touch')))).toBe(true)
 expect(await wsEval(page,(s,id)=>s.pages[id].overviewReviews,id)).toBeUndefined()
 const followUpLink=page.getByRole('group',{name:'Page view',exact:true}).getByRole('link',{name:'Follow-up'})
 await expect(followUpLink).toHaveAttribute('href','#/p/'+dbId)
 await followUpLink.click()
 await expect(page).toHaveURL(new RegExp(dbId));await expect(page.getByText('Umfang noch offen',{exact:true}).first()).toBeVisible();await page.screenshot({path:testInfo.outputPath('overview-tracking-database.png'),fullPage:true,animations:'disabled'})
 await wsEval(page,(s,rowId)=>{s.setRowProperty(rowId,'ov-status','ov-done');s.updatePage(rowId,{title:'Eigene Nachverfolgung'})},rows[0].id)
 await gotoPage(page,id)
 await overview(page).getByRole('button',{name:'Update overview',exact:true}).click();await expect(overview(page).getByRole('button',{name:'Update overview',exact:true})).toBeEnabled()
 await expect(overview(page).getByRole('link',{name:'Open tracked item',exact:true})).toHaveCount(2)
 await overview(page).locator('[data-kind=action]').getByRole('checkbox',{name:'Select for follow-up'}).check()
 await overview(page).getByRole('button',{name:'Track selected (1)',exact:true}).click()
 expect(await wsEval(page,(s,dbId)=>Object.values(s.pages).filter((p:any)=>p.databaseId===dbId).length,dbId)).toBe(3)
 expect(await wsEval(page,(s,id)=>[s.pages[id].title,s.pages[id].properties['ov-status']],rows[0].id)).toEqual(['Eigene Nachverfolgung','ov-done'])
 await reloadApp(page);await expect(overview(page).getByRole('link',{name:'Open tracked item',exact:true})).toHaveCount(3)
 await page.getByRole('group',{name:'Page view',exact:true}).getByRole('button',{name:'Document',exact:true}).click()
 await expect(page.getByRole('group',{name:'Page view',exact:true}).getByRole('link',{name:'Follow-up'})).toHaveAttribute('href','#/p/'+dbId)
 expect(await wsEval(page,(s,id)=>s.pages[id].parentId,dbId)).toBe(id)
})

async function subpages(page:BrowserPage,id:string){return wsEval(page,(s,id)=>{
 const make=(title:string,parentId:string,body:string,extra:any={})=>{const p=s.createPage({title,parentId});s.setContent(p,{type:'doc',content:[{type:'paragraph',attrs:{id:'same-block'},content:[{type:'text',text:body}]}]},'e2e');s.updatePage(p,extra);return p}
 const child=make('Client-Analyse',id,'Client braucht eine bestätigte Schnittstelle.'),nested=make('ICM-Details',child,'ICM braucht abgestimmte Grenzwerte.')
 const privateId=make('Private Notizen',id,'Vertraulicher privater Inhalt.',{private:true}),hidden=make('Versteckter Zweig',id,'Versteckter Inhalt.',{hidden:true})
 make('Nicht sichtbares Kind',hidden,'Verstecktes Kind.')
 const db=s.createDatabase({title:'Andere Datenbank',parentId:id});s.createRow(db,{title:'Kein Quelldokument',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Tabelleneintrag nicht mitlesen.'}]}]}})
 return {child,nested,privateId,db}
},id)}

test('subpages are opt-in, selectable and source-linked; child edits make the cached scope stale',async({page,context},testInfo)=>{
 const calls=await model(context,{sourceContains:'Client braucht'}),id=await setup(page),children=await subpages(page,id)
 await expect(overview(page).getByRole('checkbox',{name:'Include subpages',exact:true})).not.toBeChecked()
 await overview(page).getByRole('checkbox',{name:'Include subpages',exact:true}).check()
 await expect(overview(page).getByRole('checkbox',{name:'Client-Analyse',exact:true})).toBeChecked()
 await expect(overview(page).getByRole('checkbox',{name:'ICM-Details',exact:true})).toBeChecked()
 await expect(overview(page).getByRole('checkbox',{name:'Private Notizen',exact:true})).toHaveCount(0)
 await expect(overview(page).getByRole('checkbox',{name:'Andere Datenbank',exact:true})).toHaveCount(0)
 await overview(page).getByRole('checkbox',{name:'ICM-Details',exact:true}).uncheck()
 await page.screenshot({path:testInfo.outputPath('overview-subpage-selection.png'),fullPage:true,animations:'disabled'})
 await generate(page)
 const input=JSON.parse(calls[0].messages[0].content)
 expect(JSON.stringify(input)).toContain('Client braucht');expect(JSON.stringify(input)).not.toContain('ICM braucht');expect(JSON.stringify(input)).not.toContain('Vertraulich');expect(JSON.stringify(input)).not.toContain('Tabelleneintrag')
 const saved=await wsEval(page,(s,id)=>s.pages[id].overview,id)
 expect(saved.sourcePages.map((p:any)=>p.id).sort()).toEqual([id,children.child].sort())
 expect(saved.items[0].sourcePageId).toBe(children.child);expect(saved.items[0].sourceBlockId).toBe('same-block')
 await overview(page).locator('.overview-card').first().getByText('Source passage',{exact:true}).click()
 await overview(page).locator('.overview-card').first().getByRole('button',{name:'Show passage in document',exact:true}).click()
 await expect(page).toHaveURL(new RegExp(children.child));await expect(editorOf(page)).toContainText('Client braucht')
 await gotoPage(page,id);await reloadApp(page)
 await expect(overview(page).getByRole('checkbox',{name:'Client-Analyse',exact:true})).toBeChecked();await expect(overview(page).getByRole('checkbox',{name:'ICM-Details',exact:true})).not.toBeChecked()
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Client geändert'}),children.child)
 await expect(overview(page).getByRole('status')).toContainText('older version')
 await expect(overview(page).getByRole('checkbox',{name:'Select for follow-up'})).toHaveCount(0)
})

test('a child changing during inference rejects the whole new overview',async({page,context})=>{
 let release!:()=>void;const calls=await model(context,{sourceContains:'Client braucht',wait:new Promise<void>(r=>release=r)})
 const id=await setup(page),children=await subpages(page,id)
 await overview(page).getByRole('checkbox',{name:'Include subpages',exact:true}).check()
 await overview(page).getByRole('button',{name:'Create overview',exact:true}).click();await expect.poll(()=>calls.length).toBe(1)
 await wsEval(page,(s,id)=>s.updatePage(id,{parentId:null}),children.child);release()
 await expect(overview(page).getByRole('alert').filter({hasText:'changed during generation'})).toBeVisible()
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
})

test('follow-up is isolated per page and respects a locked destination',async({page,context})=>{
 await model(context);const id=await setup(page);await generate(page)
 await overview(page).locator('[data-kind=summary]').getByRole('checkbox',{name:'Select for follow-up'}).check();await overview(page).getByRole('button',{name:'Track selected (1)',exact:true}).click()
 const dbId=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.kind==='database'&&p.overviewFollowUp?.pageId===id)?.id,id) as string
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:true}),dbId)
 await overview(page).locator('[data-kind=action]').getByRole('checkbox',{name:'Select for follow-up'}).check();await overview(page).getByRole('button',{name:'Track selected (1)',exact:true}).click()
 await expect(overview(page).getByRole('alert')).toContainText('locked')
 expect(await wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.databaseId===id).length,dbId)).toBe(1)
 const second=await createPage(page,{title:'Separate Analyse',content:doc(para(text))});await gotoPage(page,second)
 await page.getByRole('group',{name:'Page view',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();await generate(page)
 await overview(page).locator('[data-kind=summary]').getByRole('checkbox',{name:'Select for follow-up'}).check();await overview(page).getByRole('button',{name:'Track selected (1)',exact:true}).click()
 const secondDb=await wsEval(page,(s,id)=>Object.values(s.pages).find((p:any)=>p.kind==='database'&&p.overviewFollowUp?.pageId===id)?.id,second)
 expect(secondDb).not.toBe(dbId);expect(secondDb).toBeTruthy()
})


test('without opting in, even populated descendants stay out of the request',async({page,context})=>{
 const calls=await model(context),id=await setup(page);await subpages(page,id);await generate(page)
 const input=JSON.stringify(calls[0].messages[0].content)
 expect(input).toContain('Tip Touch');expect(input).not.toContain('Client braucht');expect(input).not.toContain('ICM braucht')
 expect(await wsEval(page,(s,id)=>s.pages[id].overview.sourcePages,id)).toBeUndefined()
})


test('long titles leave room for the overview; language controls and source navigation remain accessible',async({page,context},testInfo)=>{
 await model(context);const id=await setup(page)
 const title='Kurztabelle: kritische Fragen im FeliX-DI-Fragebogen mit Antwortvorschlägen'
 await wsEval(page,(s,a)=>s.updatePage(a.id,{title:a.title}),{id,title});await generate(page)
 const first=overview(page).locator('.overview-card').first(),titleBox=page.locator('.pv-title')
 await titleBox.scrollIntoViewIfNeeded()
 await expect(titleBox).toHaveValue(title)
 expect((await titleBox.boundingBox())!.height).toBeLessThan(115)
 expect((await first.boundingBox())!.y).toBeLessThan(460)
 await expect(overview(page).getByRole('region',{name:'Follow-up',exact:true})).toHaveCount(0)
 await expect(overview(page).locator('.overview-tracking-intro')).not.toHaveAttribute('open','')
 await expect(first.getByRole('button',{name:'Show passage in document'})).toBeVisible()
 await expect(first.locator('blockquote')).not.toBeVisible()
 await page.screenshot({path:testInfo.outputPath('compact-overview-desktop.png'),animations:'disabled'})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await titleBox.scrollIntoViewIfNeeded()
  expect(await titleBox.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true)
  const menu=page.getByTestId('translation-menu');await menu.click()
  await expect(page.getByTestId('content-language')).toBeFocused()
  await expect(page.getByTestId('translation-manage')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false')
 }
 await page.screenshot({path:testInfo.outputPath('compact-overview-mobile.png'),animations:'disabled'})
 await first.getByRole('button',{name:'Show passage in document'}).click()
 await expect(editorOf(page)).toBeVisible();await expect(editorOf(page)).toContainText(text)
})

test('a summary-only overview omits unsupported decision and task sections',async({page,context})=>{
 await model(context);const id=await setup(page);await generate(page)
 await wsEval(page,(s,id)=>{const p=s.pages[id];s.updatePage(id,{overview:{...p.overview,items:p.overview.items.filter((i:any)=>i.kind==='summary')}})},id)
 await expect(overview(page).locator('.overview-section')).toHaveCount(1)
 await expect(overview(page).getByRole('heading',{name:'What this is about'})).toBeVisible()
 await expect(overview(page).getByRole('button',{name:'Adopt as task'})).toHaveCount(0)
 await expect(overview(page).getByRole('button',{name:'Review and record'})).toHaveCount(0)
 await expect(overview(page).getByRole('button',{name:'Show passage in document'})).toBeVisible()
})
