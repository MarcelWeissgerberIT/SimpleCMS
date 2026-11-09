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
