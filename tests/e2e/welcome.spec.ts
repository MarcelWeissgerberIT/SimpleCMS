import { test, expect, openApp, wsEval } from './fixtures'
import type { Page } from '@playwright/test'
const USER={id:'organizer',email:'organizer@example.test',name:'Organizer'}
const WORKSPACES=[{id:'ws_team',name:'Workshop team',role:'owner',icon:null},{id:'ws_guests',name:'Workshop guests',role:'owner',icon:null}]
async function cloud(page:Page,viewer=false){
  await page.evaluate(({USER,WORKSPACES,viewer})=>{
    const c=(window as any).__oneCloud
    c.mock({listMembers:async()=>[{user:USER,role:viewer?'viewer':'owner',created_at:Date.now()}],listInvites:async()=>[],cloudRequest:async(method:string,path:string,body?:unknown)=>{const r=await fetch('/SimpleCMS/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});if(!r.ok)throw new Error('Fixture refusal');return r.status===204?undefined:r.json()}})
    c.set({available:true,status:'online',active:{kind:'cloud',id:'ws_team'},user:USER,role:viewer?'viewer':'owner',readOnly:viewer,workspaces:WORKSPACES,supports:['welcome:1','guests:1']})
  },{USER,WORKSPACES,viewer})
}
test('private bulk input matches recipients locally; save sends no invitation and a future deadline keeps Send disabled',async({page},info)=>{
  const recipients=[{id:'a',name:'Mara Schön',email:'mara.schoen@example.test',workspaceId:'ws_team',role:'member',guest:false,note:'Team',status:'draft',hasAtlasLink:false,hasAtlasToken:false,atlasHost:null},{id:'b',name:'Jan Sommer',email:'jan.sommer@example.test',workspaceId:'ws_team',role:'viewer',guest:true,note:'Guest only',status:'draft',hasAtlasLink:false,hasAtlasToken:false,atlasHost:null}]
  let draft={revision:1,title:'Workshop',notBefore:Date.now()+86400000,lang:'en',recipients},saved:any=null,send=0
  await page.route('**/api/workspaces/ws_team/welcome**',async route=>{
    const req=route.request()
    if(req.url().includes('welcome-access'))return route.fulfill({json:[]})
    if(req.url().endsWith('/send')){send++;return route.fulfill({status:409,json:{error:{code:'welcome_early'}}})}
    if(req.url().includes('/preview/'))return route.fulfill({json:{text:'Welcome to ONE and Atlas. Personal links hidden.'}})
    if(req.method()==='PUT'){saved=req.postDataJSON();draft={...saved,revision:2,recipients:saved.recipients.map(({atlasLink,atlasToken,...r}:any)=>({...r,status:'draft',hasAtlasLink:true,hasAtlasLinkToken:true,hasAtlasToken:true,atlasHost:'atlas.example.test'}))}}
    await route.fulfill({json:draft})
  })
  await openApp(page);await cloud(page);await page.evaluate(()=>{location.hash='#/workspace/people'})
  const editor=page.getByRole('region',{name:'Welcome emails'});await expect(editor).toBeVisible()
  const cards=editor.getByTestId('welcome-recipient')
  await expect(cards).toHaveCount(2);await expect(editor.locator('.welcome-recipient[open]')).toHaveCount(0)
  await expect(cards.first().getByLabel('Name',{exact:true})).not.toBeVisible()
  await expect(cards.nth(1).locator('summary')).toContainText('Guest · read only')
  await cards.first().locator('summary').click()
  await cards.first().getByLabel('Note in the email',{exact:true}).fill('Keep this note when collapsed')
  await cards.first().locator('summary').focus();await page.keyboard.press('Enter')
  await expect(cards.first()).not.toHaveAttribute('open')
  await editor.getByRole('button',{name:'Expand all',exact:true}).click();await expect(editor.locator('.welcome-recipient[open]')).toHaveCount(2)
  await editor.getByRole('button',{name:'Collapse all',exact:true}).click();await expect(editor.locator('.welcome-recipient[open]')).toHaveCount(0)
  await cards.first().locator('summary').click()
  await expect(cards.first().getByLabel('Note in the email',{exact:true})).toHaveValue('Keep this note when collapsed')
  const linkField=cards.first().getByLabel('Personal Atlas link (including URL token)',{exact:false})
  await linkField.fill('https://atlas.example.test/invite?token=SYNTHETIC-LINK-ONLY')
  await expect(cards.first().getByTestId('welcome-link-token')).toHaveText('Access token detected in link')
  await expect(cards.first().locator('summary')).toContainText('No separate MCP token')
  await editor.getByText('Paste names, links and tokens together',{exact:true}).click()
  await editor.getByLabel('Protected import',{exact:true}).fill('Mara Schoen\nLink: https://atlas.example.test/invite?token=MAX-URL\nMCP-Token:\nMAX-MCP\nJan Sommer | Link: https://atlas.example.test/invite?token=JULIAN-URL | Authorization: Bearer JULIAN-MCP')
  await editor.getByRole('button',{name:'Match locally',exact:true}).click()
  expect(saved).toBeNull();expect(send).toBe(0)
  await editor.getByRole('button',{name:'Save encrypted',exact:true}).click()
  await expect(editor).toContainText('Saved encrypted. Nothing sent.')
  expect(saved.recipients.map((r:any)=>[r.id,r.workspaceId,r.atlasToken])).toEqual([['a','ws_team','MAX-MCP'],['b','ws_team','JULIAN-MCP']])
  expect(await editor.getByLabel('Separate Atlas agent token (optional)').first().inputValue()).toBe('')
  await expect(cards.first().getByTestId('welcome-link-token')).toHaveText('Access token detected in link')
  const tokenField=cards.first().getByLabel('Separate Atlas agent token (optional)',{exact:false})
  const left=await linkField.boundingBox(),right=await tokenField.boundingBox()
  expect(Math.abs(left!.y-right!.y)).toBeLessThan(1)
  expect(Math.abs(left!.height-right!.height)).toBeLessThan(1)
  await editor.getByRole('button',{name:'Email preview',exact:true}).first().click();await expect(page.getByRole('dialog')).toContainText('Personal links hidden');await page.keyboard.press('Escape')
  await editor.getByRole('checkbox').check();await expect(editor.getByRole('button',{name:/Send welcome emails/})).toBeDisabled();expect(send).toBe(0)
  await editor.getByRole('button',{name:'Collapse all',exact:true}).click()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await editor.locator('.welcome-list-head').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`welcome-cards-${width}.png`),animations:'disabled'});expect(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)}
  await cards.first().locator('summary').click();await expect(cards.first().getByLabel('Name',{exact:true})).toBeVisible()
  for(const width of [1440,390])for(const theme of ['light','dark'] as const){
    await page.setViewportSize({width,height:width===390?844:900})
    await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme)
    await linkField.scrollIntoViewIfNeeded()
    const left=await linkField.boundingBox(),right=await tokenField.boundingBox()
    if(width===1440)expect(Math.abs(left!.y-right!.y)).toBeLessThan(1)
    else expect(right!.y).toBeGreaterThan(left!.y+left!.height)
    expect(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
    await page.screenshot({path:info.outputPath(`welcome-aligned-${width}-${theme}.png`),animations:'disabled'})
  }
  await expect(cards.first().locator('summary')).not.toContainText('MAX-MCP')
  await editor.getByRole('button',{name:'Add person',exact:true}).click()
  await expect(cards.last()).toHaveAttribute('open','');await expect(cards.last().getByLabel('Name',{exact:true})).toBeVisible()

})
test('Start reveals only the signed-in recipient’s credentials on a click; explicit completion removes the personal button',async({page},info)=>{
  let completed=false,opened=0
  await page.route('**/api/workspaces/ws_team/welcome-access**',async route=>{
    if(route.request().url().endsWith('/open')){opened++;return route.fulfill({json:{name:'Participant',atlasLink:'https://atlas.example.test/invite?token=PERSONAL-URL',atlasToken:'PERSONAL-MCP'}})}
    if(route.request().url().endsWith('/complete')){completed=true;return route.fulfill({status:204})}
    await route.fulfill({json:completed?[]:[{id:'own-access'}]})
  })
  await openApp(page);await cloud(page,true);await page.evaluate(()=>{location.hash='#/'})
  const start=page.getByTestId('atlas-welcome');await expect(start).toBeVisible();expect(opened).toBe(0)
  expect(await page.locator('body').innerHTML()).not.toContain('PERSONAL-MCP')
  await start.getByRole('button',{name:'Set up Atlas access',exact:true}).click()
  const modal=page.getByRole('dialog',{name:'Your personal Atlas access'})
  await expect(modal.getByLabel('Atlas agent token',{exact:true})).toHaveValue('PERSONAL-MCP')
  await expect(modal.getByLabel('Atlas agent token',{exact:true})).toHaveAttribute('type','password')
  await expect(modal.getByRole('link',{name:'Open Atlas'})).toHaveAttribute('href','https://atlas.example.test/invite?token=PERSONAL-URL')
  const urlToken=modal.getByLabel('Access token from Atlas link · not a verified MCP token',{exact:true})
  await expect(urlToken).toHaveValue('PERSONAL-URL')
  await expect(urlToken).toHaveAttribute('type','password')
  expect(opened).toBe(1)
  await page.screenshot({path:info.outputPath('atlas-welcome-modal.png'),animations:'disabled'})
  await expect(modal.getByRole('button',{name:'Atlas access works · dismiss reminder'})).toBeDisabled()
  await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Atlas access works · dismiss reminder'}).click()
  await expect(start).toHaveCount(0);expect(completed).toBe(true)
  await page.reload();await cloud(page,true);await page.evaluate(()=>{location.hash='#/'})
  await expect(start).toHaveCount(0)
})
