/** Real cloud receipt persistence, fake provider and gateway; no paid model calls. */
import {resolve} from 'node:path'
import {createServer} from 'node:http'
import {test,expect} from '@playwright/test'
import {startServer,signIn} from '../../server/test/helpers'
import {waitForApp} from './fixtures'
import {openTerminal,run} from './helpers/terminal'

test('gateway failure retries only the immutable receipt and never repeats inference',async({page,context})=>{
 let providerCalls=0,gatewayCalls=0
 const fake=createServer((req,res)=>{if(req.method!=='GET')providerCalls++;res.writeHead(200,{'content-type':'application/json'}).end('{"id":"claude-opus-5-5"}')})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 const app=await startServer({APP_DIR:resolve('dist'),ANTHROPIC_BASE_URL:'http://127.0.0.1:'+(fake.address()as any).port})
 try{
  const owner=await signIn(app,'recovery@test.invalid'),w=(await owner.post('/api/workspaces',{name:'Recovery test'})).body.id
  const endpoint=`/api/workspaces/${w}/central-ai`,config={label:'Test Claude',workspaces:[w],budgetUsd:100,enabled:false}
  let service=(await owner.json('PUT',endpoint,{...config,version:0})).body
  service=(await owner.post(endpoint+'/key',{version:service.version,key:'sk-ant-fictional-recovery-key-1234567890'})).body
  service=(await owner.json('PUT',endpoint,{...config,version:service.version,enabled:true})).body
  await owner.post(endpoint+'/defaults',{version:service.version})
  await context.addCookies([...owner.cookies].map(([name,value])=>({name,value,url:app.url})))
  const direct:string[]=[]
  await context.route('https://api.anthropic.com/**',r=>{direct.push(r.request().url());return r.abort()})
  await context.route(app.url+endpoint+'/messages',r=>{gatewayCalls++;return r.fulfill({status:502,body:''})})
  const receipts:string[]=[]
  await context.route(`${app.url}/api/workspaces/${w}/programs/runs`,r=>{
   if(r.request().method()!=='POST')return r.continue()
   receipts.push(r.request().postData()!)
   return receipts.length<=2?r.fulfill({status:502,body:''}):r.continue()
  })
  await page.goto(`${app.url}/app/?e2e&w=${w}#/workspace/ai`);await waitForApp(page)
  await expect(page.getByTestId('central-ai-settings')).toContainText('Central Claude is active.')
  await openTerminal(page)
  await run(page,'Inspect this interruption without repeating work.')
  const term=page.getByRole('region',{name:'AI terminal'})
  await expect(term).toContainText('The connection to the One server was interrupted')
  await expect.poll(()=>receipts.length).toBe(3)
  await expect(term).toContainText('Personal run receipt saved.')
  expect(new Set(receipts).size).toBe(1)
  expect(gatewayCalls).toBe(1);expect(providerCalls).toBe(0);expect(direct).toEqual([])
  const receipt=JSON.parse(receipts[0]),saved=(await owner.get(`/api/workspaces/${w}/programs/runs`)).body.runs
  expect(saved.filter((r:any)=>r.id===receipt.id)).toHaveLength(1)
  expect(saved.find((r:any)=>r.id===receipt.id).status).toBe('failed')
 }finally{await page.goto('about:blank');await app.stop();fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))}
})
