import {createHash} from 'node:crypto'
import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,reloadApp,mockClaude} from './fixtures'
import {claudeSse} from './helpers/providers'
const organizer=(p:any)=>p.getByRole('region',{name:'Organize work',exact:true})
test.beforeEach(async({context})=>{if(process.env.E2E_ROOT==='1')await context.route('**/api/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html>'}))})
async function seed(page:any){
 await openApp(page);await page.emulateMedia({reducedMotion:'reduce'})
 const a=await createPage(page,{title:'Release requirements',content:doc(para('The release needs SSO. The authentication scope must be agreed with the team.'))})
 const b=await createPage(page,{title:'Implementation',content:doc(para('Only local accounts are implemented. SSO has not been implemented or tested.'))})
 const id=await createPage(page,{title:'Authentication workshop',content:doc(para('Working desk'))})
 const pages=await wsEval(page,s=>s.pages)
 const cards=[a,b].map((pid,i)=>({type:'card',id:'card-'+i,title:i?'Local accounts only':'Agree authentication scope',detail:pages[pid].content.content[0].content[0].text,source:{kind:'page',pageId:pid,blockId:pages[pid].content.content[0].attrs?.id??'block:0',quote:pages[pid].content.content[0].content[0].text,signature:createHash('sha256').update(JSON.stringify([pages[pid].title,pages[pid].content])).digest('hex'),label:pages[pid].title},x:i*280,y:0,group:'Release',level:1,evidence:'',evidenceUrl:'',at:1,by:'Tester'}))
 await wsEval(page,(s,v)=>{s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'});s.updatePage(v.id,{workbench:true,settings:{...s.pages[v.id].settings,fullWidth:true},workbenchRecords:Object.fromEntries(v.cards.map((c:any)=>[c.id,c]))})},{id,a,b,cards})
 await gotoPage(page,id);await page.getByRole('button',{name:/^Organize work /}).click();await expect(organizer(page)).toBeVisible()
 return {id,a,b,cards}
}
function answer(raw:string,invalid=false,empty=false){
 const body=JSON.parse(raw),content=body.messages[0].content,input=JSON.parse(typeof content==='string'?content:content.find((x:any)=>x.type==='text').text)
 const ids=input.cards.map((c:any)=>c.id)
 return JSON.stringify({title:'Authentication follow-up',summary:'The authentication scope needs clarification. These are proposals from the selected sources.',items:empty?[]:[{title:'Agree the authentication scope',detail:'Compare the requirement with the current implementation and record the agreed scope.',criterion:'An agreed scope is recorded with the team.',cards:invalid?['invented']:ids},{title:'Record the missing evidence',detail:'Identify the missing authentication evidence before planning verification.',criterion:'List the evidence still needed.',cards:[ids[0]]}]})
}
const output=async(page:any,id:string)=>wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.parentId===id&&p.kind==='database'),id)

for(const [focus,type,criterion] of [['Deliver','board','Done when'],['Clarify','table','Needed to resolve'],['Verify','table','Acceptance criterion'],['Decide','table','Needed for a decision']] as const)test('focus '+focus+' creates a reviewed native database with source-linked editable rows',async({page,context},info)=>{
 const calls=await mockClaude(context,raw=>answer(raw)),{id,a,b}=await seed(page),view=organizer(page)
 const original=await wsEval(page,(s,ids)=>ids.map((id:string)=>s.pages[id].content),[a,b])
 await view.getByRole('button',{name:new RegExp('^'+focus+' ')}).click()
 await view.getByLabel('What should this view help you achieve?').fill('Prepare our next authentication review.')
 await view.getByRole('button',{name:'✦ Create work draft',exact:true}).click()
 const draft=view.getByRole('region',{name:'Review work draft'})
 await expect(draft).toBeVisible();expect(await output(page,id)).toHaveLength(0);expect(calls).toHaveLength(1)
 await draft.getByLabel('Working view name').fill('My review actions')
 await draft.getByLabel('Title',{exact:true}).first().fill('Agree scope with the team')
 await draft.getByRole('checkbox',{name:'Include: Record the missing evidence',exact:true}).uncheck()
 await draft.getByText('Review source basis · 2 cards',{exact:true}).click();await expect(draft).toContainText('SSO has not been implemented or tested.')
 await page.screenshot({path:info.outputPath('work-draft-'+focus+'.png')})
 await draft.getByRole('button',{name:'Create working view with 1 item'}).click()
 await expect(view.getByRole('link',{name:'Open working view ↗',exact:true})).toBeVisible()
 const databases=await output(page,id);expect(databases).toHaveLength(1);const dbId=databases[0].id
 const state=await wsEval(page,(s,id)=>({db:s.databases[id],rows:Object.values(s.pages).filter((p:any)=>p.databaseId===id)}),dbId)
 expect(state.db.views[0].type).toBe(type);expect(state.db.views.map((v:any)=>v.type).sort()).toEqual(['board','table'])
 expect(state.db.properties.find((p:any)=>p.id==='work-criterion').name).toBe(criterion)
 expect(state.rows).toHaveLength(1);const row=state.rows[0];expect(row.title).toBe('Agree scope with the team');expect(row.parentId).toBe(dbId)
 expect(row.properties['work-status']).toBe('work-open');expect(row.properties['work-owner']).toBeUndefined();expect(row.properties['work-due']).toBeUndefined();expect(row.properties['work-response']).toBeUndefined()
 expect(JSON.stringify(row.content)).toContain('#/p/'+a);expect(JSON.stringify(row.content)).toContain('#/p/'+b);expect(JSON.stringify(row.content)).toContain('#/p/'+id)
 expect(await wsEval(page,(s,ids)=>ids.map((id:string)=>s.pages[id].content),[a,b])).toEqual(original)
 await view.getByRole('link',{name:'Open working view ↗',exact:true}).click();await expect(page.locator('.db-viewbody')).toBeVisible()
 if(focus==='Deliver'){
  const card=page.getByRole('region',{name:'Open',exact:true}).locator('.dbc'),target=page.getByRole('region',{name:'In progress',exact:true}).locator('.dbb-col__body')
  await card.hover();const from=(await card.boundingBox())!,to=(await target.boundingBox())!
  await page.mouse.down();await page.mouse.move(from.x+from.width/2+12,from.y+from.height/2,{steps:5});await page.mouse.move(to.x+to.width/2,to.y+35,{steps:15});await page.mouse.up()
  await expect.poll(()=>wsEval(page,(s,rowId)=>s.pages[rowId].properties['work-status'],row.id)).toBe('work-progress')
  await page.screenshot({path:info.outputPath('working-board.png')})
 }else await wsEval(page,(s,rowId)=>s.setRowProperty(rowId,'work-status','work-progress'),row.id)
 await reloadApp(page);expect(await wsEval(page,(s,rowId)=>s.pages[rowId].properties['work-status'],row.id)).toBe('work-progress')
 await gotoPage(page,id);await page.getByRole('button',{name:/^Organize work /}).click()
 await expect(view.getByRole('navigation',{name:'Your working views'}).getByRole('link',{name:'My review actions ↗'})).toBeVisible()
 expect(await output(page,id)).toHaveLength(1);expect(calls).toHaveLength(1)
})

test('material drag sets the focus, limits the model to selected cards and fits mobile',async({page,context},info)=>{
 const calls=await mockClaude(context,raw=>answer(raw));await seed(page);const view=organizer(page)
 await view.getByRole('button',{name:'Clear selection',exact:true}).click()
 const handle=view.getByRole('button',{name:'Drag card to a focus: Local accounts only'});await handle.scrollIntoViewIfNeeded();await handle.hover();const box=(await handle.boundingBox())!;await page.mouse.down();await page.mouse.move(box.x+box.width/2-15,box.y+box.height/2-10,{steps:5});await view.getByRole('button',{name:/^Clarify /}).hover();await page.mouse.up()
 await expect(view.getByRole('button',{name:/^Clarify /})).toHaveAttribute('aria-pressed','true')
 await expect(view.getByRole('checkbox')).toHaveCount(2);await expect(view.getByRole('checkbox').last()).toBeChecked();await expect(view.getByRole('checkbox').first()).not.toBeChecked()
 await page.screenshot({path:info.outputPath('work-desktop.png')})
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__one.ui.setState({mobileSidebarOpen:false}));await expect(page.locator('.sb')).not.toBeInViewport()
 await view.locator('.work-templates').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('work-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view.getByRole('region',{name:'Review work draft'})).toBeVisible()
 const request=JSON.stringify(JSON.parse(calls[0]).messages);expect(request).toContain('Local accounts only');expect(request).not.toContain('Agree authentication scope')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('work-draft-mobile.png')})
})

test('invalid source references and changed source drafts never create a database',async({page,context})=>{
 const calls=await mockClaude(context,raw=>answer(raw,true)),{id,a}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view.getByRole('alert')).toContainText('invalid content or source references');expect(await output(page,id)).toHaveLength(0)
 await context.unroute('https://api.anthropic.com/**');await mockClaude(context,raw=>answer(raw))
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view.getByRole('region',{name:'Review work draft'})).toBeVisible()
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Changed requirements'}),a)
 await view.getByRole('button',{name:'Create working view with 2 items'}).click();await expect(view.getByRole('alert')).toContainText('Sources or cards changed')
 expect(await output(page,id)).toHaveLength(0);expect(calls).toHaveLength(1)
})

test('an empty draft explains missing material and cannot be adopted',async({page,context})=>{
 await mockClaude(context,raw=>answer(raw,false,true));const {id}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view).toContainText('The material does not support this focus yet.')
 await expect(view.getByRole('button',{name:'Create working view with 0 items'})).toBeDisabled();expect(await output(page,id)).toHaveLength(0)
})

test('cancelling a work draft ignores a late model response',async({page,context})=>{
 let finish!:()=>void;const held=new Promise<void>(resolve=>{finish=resolve}),requests:string[]=[]
 await context.route('https://api.anthropic.com/v1/messages*',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST'}});const raw=route.request().postData()!;requests.push(raw);await held;await route.fulfill({headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'},body:claudeSse({blocks:[{type:'text',text:answer(raw)}]})}).catch(()=>{})})
 const {id}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect.poll(()=>requests.length).toBe(1)
 await view.getByRole('button',{name:'Cancel',exact:true}).click();finish()
 await expect(view.getByRole('button',{name:'✦ Create work draft'})).toBeEnabled();await expect(view.getByRole('region',{name:'Review work draft'})).toHaveCount(0);expect(await output(page,id)).toHaveLength(0)
})

test('a reviewed draft survives tab changes and can be adopted once with edited table outcomes',async({page,context},info)=>{
 const calls=await mockClaude(context,raw=>answer(raw)),{id}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:/^Clarify /}).click();await view.getByRole('button',{name:'✦ Create work draft'}).click()
 const draft=view.getByRole('region',{name:'Review work draft'});await expect(draft).toBeVisible();await draft.getByLabel('Working view name').fill('Retained clarification')
 await page.getByRole('button',{name:/^Map & desk /}).click();await expect(draft).not.toBeVisible();await page.getByRole('button',{name:/^Organize work /}).click()
 await expect(draft.getByLabel('Working view name')).toHaveValue('Retained clarification');expect(calls).toHaveLength(1)
 await draft.getByRole('button',{name:'Create working view with 2 items'}).dblclick()
 await expect(view.getByRole('link',{name:'Open working view ↗',exact:true})).toBeVisible();const dbs=await output(page,id);expect(dbs).toHaveLength(1)
 await view.getByRole('link',{name:'Open working view ↗',exact:true}).click()
 const cell=page.locator('[data-cell="0:5"]');await cell.dblclick();await page.getByRole('textbox',{name:'Answer',exact:true}).fill('Scope confirmed with the team');await page.getByRole('textbox',{name:'Answer',exact:true}).press('Enter')
 await expect.poll(()=>wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.databaseId===id).map((p:any)=>p.properties['work-response']??''),dbs[0].id)).toContain('Scope confirmed with the team')
 await page.evaluate(id=>{location.hash='#/p/'+id+'?desk=work'},id);await expect(view).toBeVisible();await expect(view.getByRole('navigation',{name:'Your working views'})).toContainText('Retained clarification')
 const nav=view.getByRole('navigation',{name:'Your working views'});await expect(nav).toContainText('2 items · 0 completed')
 await wsEval(page,(s,id)=>{const rows=Object.values(s.pages).filter((p:any)=>p.databaseId===id) as any[];s.setRowProperty(rows[0].id,'work-status','work-done');s.updatePage(rows[1].id,{trashed:true})},dbs[0].id)
 await expect(nav).toContainText('1 item · 1 completed');await expect(nav.getByRole('progressbar')).toHaveAttribute('value','1')
 await nav.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('work-progress.png')})
})

test('German focus recommendation, keyboard selection and dark mobile layout',async({page,context},info)=>{
 const calls=await mockClaude(context,raw=>answer(raw)),{id}=await seed(page)
 await wsEval(page,(s,id)=>{s.updateSettings({language:'de',theme:'dark'});s.updatePage(id,{workbenchRecords:{...s.pages[id].workbenchRecords,focus:{type:'focus',id:'focus',at:1,by:'Tester',dimension:'Widersprüche',question:'Was müssen wir vor dem Review klären?',cards:['card-0','card-1']}}})},id)
 await page.evaluate(id=>{location.hash='#/p/'+id+'?desk=work'},id);await reloadApp(page)
 const view=page.getByRole('region',{name:'Arbeit organisieren',exact:true})
 await expect(view.getByRole('button',{name:/Klären Unklarheiten/})).toHaveAttribute('aria-pressed','true');await expect(view.getByLabel('Wobei soll dir die Ansicht helfen?')).toHaveValue('Was müssen wir vor dem Review klären?')
 await view.getByRole('button',{name:'Auswahl leeren',exact:true}).click();await view.getByRole('checkbox',{name:'Local accounts only'}).focus();await page.keyboard.press('Space')
 await expect(view.getByRole('checkbox',{name:'Local accounts only'})).toBeChecked();expect(calls).toHaveLength(0)
 await view.locator('.work-heading').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('work-german-dark.png')})
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__one.ui.setState({mobileSidebarOpen:false}));await view.locator('.work-brief').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('work-german-mobile.png')})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('a source moved under a hidden parent is excluded and cannot be adopted from an older draft',async({page,context})=>{
 await mockClaude(context,raw=>answer(raw));const {id,a}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view.getByRole('region',{name:'Review work draft'})).toBeVisible()
 await wsEval(page,(s,id)=>{const parent=s.createPage({title:'Hidden material',hidden:true});s.updatePage(id,{parentId:parent})},a)
 await view.getByRole('button',{name:'Create working view with 2 items'}).click();await expect(view.getByRole('alert')).toContainText('unavailable');expect(await output(page,id)).toHaveLength(0)
 await view.getByRole('button',{name:'Back to focus & material'}).click();await expect(view.getByRole('checkbox',{name:'Agree authentication scope'})).toHaveCount(0)
})


test('a new desk question is offered without overwriting an existing work goal',async({page,context})=>{
 const calls=await mockClaude(context,raw=>answer(raw));await seed(page);const view=organizer(page)
 await view.getByLabel('What should this view help you achieve?').fill('Keep my review goal')
 await page.getByRole('button',{name:/^Map & desk /}).click()
 await page.getByRole('checkbox',{name:'Select: Local accounts only',exact:true}).check()
 await page.getByLabel('Question about the selection',{exact:true}).fill('Which evidence is missing for local accounts?')
 await page.getByRole('button',{name:/^Organize work /}).click()
 await expect(view.getByLabel('What should this view help you achieve?')).toHaveValue('Keep my review goal')
 await view.getByRole('button',{name:/^Use question and selection from the desk:/}).click()
 await expect(view.getByLabel('What should this view help you achieve?')).toHaveValue('Which evidence is missing for local accounts?')
 await expect(view.getByRole('checkbox',{name:'Local accounts only',exact:true})).toBeChecked()
 await expect(view.getByRole('checkbox',{name:'Agree authentication scope',exact:true})).not.toBeChecked()
 expect(calls).toHaveLength(0)
})

test('locking a desk preserves its draft for reading and blocks creation',async({page,context})=>{
 const calls=await mockClaude(context,raw=>answer(raw)),{id}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view.getByRole('region',{name:'Review work draft'})).toBeVisible()
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:true}),id)
 await expect(view.getByLabel('Working view name')).toBeDisabled()
 await expect(view.getByRole('button',{name:'Create working view with 2 items'})).toBeDisabled()
 expect(await output(page,id)).toHaveLength(0);expect(calls).toHaveLength(1)
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:false}),id)
 await expect(view.getByRole('button',{name:'Create working view with 2 items'})).toBeEnabled()
})

test('reviewing an original source opens a separate tab and keeps work draft edits',async({page,context})=>{
 await mockClaude(context,raw=>answer(raw));const {id,a}=await seed(page),view=organizer(page)
 await view.getByRole('button',{name:'✦ Create work draft'}).click()
 const draft=view.getByRole('region',{name:'Review work draft'});await expect(draft).toBeVisible()
 await draft.getByLabel('Working view name').fill('Keep this reviewed title')
 await draft.getByText('Review source basis · 2 cards',{exact:true}).click()
 const popupPromise=page.waitForEvent('popup');await draft.getByRole('link',{name:'Release requirements ↗',exact:true}).click();const source=await popupPromise
 await source.waitForURL(url=>url.hash.split('?')[0]==='#/p/'+a);await expect(source.locator('.pv-title')).toContainText('Release requirements');await source.close()
 await expect(draft.getByLabel('Working view name')).toHaveValue('Keep this reviewed title')
 expect(new URL(page.url()).hash).toContain(id);expect(await output(page,id)).toHaveLength(0)
})

test('large material stays bounded, deleted selections free a slot and oversized input is never truncated',async({page,context})=>{
 const calls=await mockClaude(context,raw=>answer(raw)),{id}=await seed(page)
 await wsEval(page,(s,id)=>{const p=s.pages[id],base=p.workbenchRecords['card-0'];s.updatePage(id,{workbenchRecords:Object.fromEntries(Array.from({length:21},(_,i)=>{const key='note-'+i,quote=('Evidence '+i+' ').repeat(500);return [key,{...base,id:key,title:'Working note '+i,detail:quote,source:{kind:'note',pageId:id,blockId:'',quote,signature:'',label:'Own statement'},level:0}]}))})},id)
 const view=organizer(page);await view.getByRole('button',{name:'Select first 20',exact:true}).click()
 await expect(view.getByRole('checkbox',{name:'Working note 20',exact:true})).toBeDisabled()
 await wsEval(page,(s,id)=>{const p=s.pages[id];s.updatePage(id,{workbenchRecords:{...p.workbenchRecords,'note-0':{...p.workbenchRecords['note-0'],removed:true}}})},id)
 const last=view.getByRole('checkbox',{name:'Working note 20',exact:true});await expect(last).toBeEnabled();await last.check()
 await view.getByRole('button',{name:'✦ Create work draft'}).click();await expect(view.getByRole('alert')).toContainText('nothing was truncated')
 expect(calls).toHaveLength(0);expect(await output(page,id)).toHaveLength(0)
 await view.getByRole('button',{name:'Clear selection',exact:true}).click();await last.check();await view.getByRole('button',{name:'✦ Create work draft'}).click()
 await expect(view.getByRole('region',{name:'Review work draft'})).toBeVisible();expect(calls).toHaveLength(1)
 const request=JSON.stringify(JSON.parse(calls[0]).messages);expect(request).toContain('Working note 20');expect(request).not.toContain('Working note 1"')
})
