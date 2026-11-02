/** A real cloud server and browser SDK; only the external provider is fake. No paid calls. */
import {resolve} from 'node:path'
import {createServer} from 'node:http'
import {mkdirSync} from 'node:fs'
import {test,expect} from '@playwright/test'
import {startServer,signIn} from '../../server/test/helpers'
import {waitForApp,wsEval} from './fixtures'
import {openTerminal,run} from './helpers/terminal'
import {FEATURE_CLASSES} from '../../src/shared/ai/policy'
import {claudeSse} from './helpers/providers'
const KEY='sk-ant-fictional-central-ui-key-1234567890'
const OUT='/Users/marcelweissgerber/Documents/Playground/artifacts/one-central-claude-2026-11-02'

test('owner config, write-only key, member use, private logs and responsive views',async({page,context,browser})=>{
 mkdirSync(OUT,{recursive:true})
 let calls=0
 const fake=createServer(async(req,res)=>{
  if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'claude-opus-5-5'}));return}
  let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);calls++
  const text='Central Claude answered through the ONE server. No browser API key was used.'
  res.writeHead(200,{'content-type':p.stream?'text/event-stream':'application/json'}).end(p.stream?claudeSse({blocks:[{type:'text',text}]},p.model):JSON.stringify({id:'msg_test',model:p.model,type:'message',role:'assistant',content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:50}}))
 })
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 const app=await startServer({APP_DIR:resolve('dist'),ANTHROPIC_BASE_URL:'http://127.0.0.1:'+(fake.address()as any).port})
 let memberContext:Awaited<ReturnType<typeof browser.newContext>>|undefined
 try{
  const owner=await signIn(app,'central.ui.owner@test.invalid'),member=await signIn(app,'central.ui.member@test.invalid')
  const w1=(await owner.post('/api/workspaces',{name:'Analytik Jena · CNSx'})).body.id,w2=(await owner.post('/api/workspaces',{name:'Analytik Jena · FeliX'})).body.id
  const invite=await owner.post(`/api/workspaces/${w1}/invites`,{role:'member'});await member.post('/api/invites/'+invite.body.link.split('#/invite/')[1]+'/accept')
  await context.addCookies([...owner.cookies].map(([name,value])=>({name,value,url:app.url})))
  const direct:any[]=[];await context.route('https://api.anthropic.com/**',r=>{direct.push(r.request().url());void r.abort()})
  const browserErrors:string[]=[];page.on('pageerror',e=>browserErrors.push(e.message))
  await page.goto(`${app.url}/app/?e2e&w=${w1}#/workspace/ai`);await waitForApp(page)
  const plate=page.getByTestId('central-ai-settings');await expect(plate).toBeVisible()
  await plate.getByLabel('Shared monthly budget · USD').fill('100')
  await plate.getByLabel('Analytik Jena · FeliX',{exact:true}).check()
  await plate.getByRole('button',{name:'Save configuration',exact:true}).click()
  await expect(plate.getByTestId('central-key-input')).toBeEnabled()
  await plate.getByTestId('central-key-input').fill(KEY)
  await plate.getByRole('button',{name:'Verify key and save encrypted'}).click()
  await expect(plate.getByTestId('central-key-input')).toHaveValue('')
  await expect(plate).toContainText('Key configured · model access verified')
  expect(calls).toBe(0)
  await plate.getByLabel('Activate central API access for members · allow paid requests').check()
  await plate.getByRole('button',{name:'Save configuration',exact:true}).click()
  await expect(plate).toContainText('Central Claude is active.')
  await wsEval(page,s=>s.setWorkspaceAI({...s.ai,onboarding:{startPageId:'start-fixture',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',mcpName:'aj-atlas',project:'CNSx',skipIntro:true}}))
  await plate.getByRole('button',{name:'Set Opus as workspace default'}).click()
  await expect(plate).toContainText('Claude Opus 5.5 is set as the shared default.')
  // Both workspaces have the same service, not copied credentials.
  const c1=(await owner.get(`/api/workspaces/${w1}/central-ai`)).body,c2=(await owner.get(`/api/workspaces/${w2}/central-ai`)).body
  expect(c1.id).toBe(c2.id);expect(c1.budgetUsd).toBe(100)
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[390,844]]){
   await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await page.setViewportSize({width,height});await page.mouse.move(width-15,50);if(width===390){await expect(page.getByRole('button',{name:'Open sidebar',exact:true})).toBeVisible();await expect(page.getByRole('complementary',{name:'Workspace sidebar'})).not.toBeInViewport();}await plate.getByRole('heading',{name:'Central Claude access',exact:true}).scrollIntoViewIfNeeded()
   await page.screenshot({path:`${OUT}/config-${theme}-${width}.png`,fullPage:true,animations:'disabled'})
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  await page.setViewportSize({width:1440,height:900})
  memberContext=await browser.newContext({serviceWorkers:'block'})
  await memberContext.addCookies([...member.cookies].map(([name,value])=>({name,value,url:app.url})))
  await memberContext.route('https://api.anthropic.com/**',r=>{direct.push(r.request().url());void r.abort()})
  const m=await memberContext.newPage();m.on('pageerror',e=>browserErrors.push(e.message))
  await m.goto(`${app.url}/app/?e2e&w=${w1}#/workspace/ai`);await waitForApp(m)
  await expect(m.getByTestId('central-ai-settings')).toContainText('Central Claude is active.')
  await expect(m.getByTestId('central-key-input')).toHaveCount(0)
  await expect(m.getByRole('button',{name:'Load / refresh log'})).toHaveCount(0)
  await wsEval(m,(s,classes)=>s.updateSettings({workspaceAI:{gen:6,default:[{p:'local',m:'one-shared/legacy-host'}],routes:Object.fromEntries(classes.filter(k=>k!=='gate').map(k=>[k,[{p:'local',m:'one-shared/legacy-host'}]])),allow:{local:['mcp']}}}),[...FEATURE_CLASSES])
  await m.goto(`${app.url}/app/?e2e&w=${w1}`);await waitForApp(m)
  await expect.poll(()=>m.evaluate(()=>(window as any).__one.workspace.getState().settings.workspaceAI?.default??null)).toBeNull()
  await openTerminal(m)
  await run(m,'Antworte mit einer kurzen Begrüßung. Verwende keine Werkzeuge und ändere keine Daten.')
  await expect(m.getByRole('region',{name:'AI terminal'})).toContainText('Central Claude answered through the ONE server.',{timeout:30000})
  expect(calls).toBeGreaterThan(0)
  expect(await m.evaluate(()=>JSON.stringify((window as any).__one.workspace.getState().settings).includes('sk-ant-'))).toBe(false)
  await page.getByTestId('central-ai-settings').getByRole('button',{name:'Load / refresh log'}).click()
  await expect(page.getByTestId('central-ai-settings')).toContainText('Complete')
  await page.getByTestId('central-ai-settings').getByRole('button',{name:'Inspect',exact:true}).first().click()
  await expect(page.locator('.central-ai__detail')).toContainText('message_start')
  await expect(page.locator('.central-ai__detail')).not.toContainText(KEY)
  await m.screenshot({path:`${OUT}/member-config.png`,fullPage:true,animations:'disabled'})
  const latest=(await owner.get(`/api/workspaces/${w1}/central-ai`)).body
  await owner.json('PUT',`/api/workspaces/${w1}/central-ai`,{version:latest.version,label:latest.label,workspaces:[w1,w2],budgetUsd:1,enabled:true})
  await m.reload();await waitForApp(m);await openTerminal(m)
  const before=calls
  await run(m,'Antworte kurz ohne Werkzeuge und Änderungen.')
  await expect(m.getByRole('region',{name:'AI terminal'})).toContainText('The shared Claude budget cannot cover this request’s safety reservation.',{timeout:30000})
  expect(calls).toBe(before)
  expect(direct).toEqual([]);expect(browserErrors).toEqual([])
 }finally{await memberContext?.close();await app.stop();await new Promise<void>(r=>fake.close(()=>r()))}
})
