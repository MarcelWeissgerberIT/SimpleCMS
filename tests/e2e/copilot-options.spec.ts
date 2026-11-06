import { test, expect, openApp, wsEval, gotoPage } from './fixtures'
import { test as unit } from '@playwright/test'
import { mockClaudeScript } from './helpers/providers'
import { startFakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'
import { orderExecution, sanitizeOrderConfig } from '../../src/app/features/coding/orders/config'
import { orderPlanHash } from '../../src/app/features/coding/orders/plan'

unit('role models and repair routing are validated and bound to exact plan confirmation',async()=>{
 const base={v:1,status:{draft:'d',plan:'p',ready:'r',running:'a',halted:'h',done:'x'},kinds:['spec','coding','qa'],server:null,checkpoint:false,agents:{spec:'copilot',coding:'copilot',qa:'copilot'},qaRepairs:1,copilot:{spec:{model:'gpt-6.1-sol'},coding:{model:'gpt-6.1-sol'},qa:{model:'claude-opus-5.5',reasoningEffort:'high'}}}
 const read=sanitizeOrderConfig(base);expect(read.kind).toBe('ok');if(read.kind!=='ok')return
 expect(orderExecution(read.config,'qa')).toMatchObject({copilotRole:base.copilot.qa,repair:{agent:'copilot',copilot:base.copilot.coding}})
 const plan={v:1,summary:'Work',context:null,steps:[],questions:[],refused:null} as const
 const resolved={...orderExecution(read.config,'qa'),project:'p',park:'park',start:'start'}
 const before=await orderPlanHash(plan as never,[resolved],'none')
 expect(await orderPlanHash(plan as never,[{...resolved,copilotRole:{model:'gpt-6.1-sol'}}],'none')).not.toBe(before)
 expect(sanitizeOrderConfig({...base,copilot:{coding:{model:'github_pat_do_not_save'}}}).kind).toBe('unreadable')
 expect(sanitizeOrderConfig({...base,copilot:{coding:{contextTokens:99999999}}}).kind).toBe('unreadable')
})

test('role snapshots, per-task override and observed receipts survive a browser run and reload',async({page,errors})=>{
 test.setTimeout(120000)
 errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
 const port=47867
 const fake=await startFakeWorker(port,{worker:'1.27.0',name:'copilot-options-fixture',repos:[{name:'demo',baseBranch:'main',branches:['main'],mcp:[]}],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true,mcp:[]})
 fake.can=[...WORKER_CAN]
 fake.textModels=[{provider:'copilot',model:'gpt-6.1-sol',context:65536,chat:true},{provider:'copilot',model:'claude-opus-5.5',context:200000,chat:true,reasoningEfforts:['low','high']}]
 fake.auto=task=>{
  const now=Date.now(),receipt={provider:'copilot',requestedModel:task.stage.copilot?.model??'auto',source:task.stage.copilotSource,...(task.stage.copilot?.reasoningEffort?{requestedEffort:task.stage.copilot.reasoningEffort}:{}),contextTokens:65536,startedAt:now-1000,finishedAt:now,rounds:2,usageReports:2,models:[task.stage.copilot?.model??'gpt-6.1-sol'],reasoningEfforts:[],inputTokens:100,outputTokens:40,nanoAiu:null,quotas:[{name:'premium',remainingPercentage:75}],stageKind:task.stage.kind,status:'ok'}
  return {status:'ok',summary:'Fixed timeout.',plan:'Reviewed timeout.',branch:'one/demo',copilotReceipts:[receipt],...(task.stage.kind==='doc'?{test:{ok:true,output:'1 regression passed',ms:12,code:0}}:{})}
 }
 const call=(name:string,...args:unknown[])=>page.evaluate(([name,args])=>(window as any).__oneOrders[name](...args),[name,args] as const)
 try{
  await page.addInitScript(port=>{localStorage.setItem('one.coding',JSON.stringify({enabled:true,port}));localStorage.setItem('one.coding.approvals','none');localStorage.setItem('one.tour','{"off":true}')},port)
  const delivery={requirements:[{id:'R1',text:'Preserve the timeout.'}],acceptance:['Regression passes.']}
  const proposal={v:1,summary:'Fix timeout then review.',assumptions:[],delivery,context:null,steps:['coding','qa'].map((kind,i)=>({kind,title:kind==='coding'?'Fix timeout':'Verify timeout',goal:'Verify the real result.',criteria:['Regression passes'],repo:'demo',branch:null,refs:[],priority:'medium',why:'Small package',needs:i?[1]:[],covers:['R1']})),questions:[],refused:null}
  await mockClaudeScript(page.context(),[{blocks:[{type:'text',text:JSON.stringify(proposal)}]}])
  await openApp(page)
  await wsEval(page,s=>s.updateSettings({language:'en',aiApiKey:'sk-ant-e2e-fixture-key'}))
  await expect.poll(()=>page.evaluate(()=>(window as any).__onePreflight.stores.coding.getState().conn)).toBe('connected')
  for(const kind of ['coding','qa']){
   const seed=await page.evaluate(k=>(window as any).__oneCodingWrites.create('seed',k,'demo'),kind)
   await wsEval(page,(s,a)=>{const dbId=s.pages[a.seed].databaseId,db=s.databases[dbId],prop=db.properties.find((p:any)=>p.name==='Stage');s.updateDatabase(dbId,{pipeline:[{id:`${a.kind}Back`,kind:'queue',auto:false},{id:`${a.kind}Ready`,kind:'queue',auto:true},{id:`${a.kind}Run`,kind:a.kind==='coding'?'implement':'doc',auto:true},{id:`${a.kind}Done`,kind:'done',auto:false}],properties:db.properties.map((p:any)=>p.id!==prop.id?p:{...p,options:[{id:`${a.kind}Back`,name:'Backlog',color:'gray'},{id:`${a.kind}Ready`,name:'Ready',color:'blue'},{id:`${a.kind}Run`,name:'Work',color:'orange'},{id:`${a.kind}Done`,name:'Done',color:'green'}]})});s.deletePagePermanently(a.seed)},{seed,kind})
  }
  const db=await page.evaluate(()=>(window as any).__oneOrderEntries.ensure())
  await wsEval(page,(s,db)=>s.updateDatabase(db,{orders:{...s.databases[db].orders,agents:{coding:'copilot',qa:'copilot'},copilot:{coding:{model:'gpt-6.1-sol'},qa:{model:'claude-opus-5.5',reasoningEffort:'high'}},checkpoint:false}}),db)
  const row=await wsEval(page,(s,db)=>s.createRow(db,{}),db)
  await gotoPage(page,row)
  await page.getByTestId('order-settings-key').click()
  const roleCoding=page.getByTestId('copilot-options-role-coding'),roleQa=page.getByTestId('copilot-options-role-qa')
  await expect(roleCoding.locator('select').first()).toHaveValue('gpt-6.1-sol')
  await roleCoding.locator('select').nth(2).selectOption('65536')
  await roleQa.locator('select').nth(1).selectOption('high')
  await expect.poll(()=>wsEval(page,(s,db)=>s.databases[db].orders.copilot.coding.contextTokens,db)).toBe(65536)
  await page.keyboard.press('Escape')
  await page.getByTestId('guided-goal').fill('Fix the timeout in the demo simulator and prove it with the configured regression test.')
  await page.getByTestId('guided-plan').click()
  await expect.poll(async()=>(await call('record',row))?.draft?.plan?.steps?.length).toBe(2)
  await expect(page.locator('.orc-step__meta').first()).toContainText('Copilot · gpt-6.1-sol')
  expect((await call('start',row)).ok).toBe(true)
  await call('countFor',row,120000)
  const rec=await call('record',row),coding=rec.chain.steps[0].id,qa=rec.chain.steps[1].id
  await gotoPage(page,coding)
  const options=page.getByTestId(`copilot-options-task-${coding}`)
  await expect(options.locator('select').first()).toHaveValue('gpt-6.1-sol')
  await options.locator('select').first().selectOption('claude-opus-5.5')
  await options.locator('select').nth(1).selectOption('high')
  await options.locator('select').nth(2).selectOption('65536')
  await page.getByRole('button',{name:'Use role / worker default again'}).click()
  await expect(options.locator('select').first()).toHaveValue('gpt-6.1-sol')
  await options.locator('select').first().selectOption('claude-opus-5.5')
  await options.locator('select').nth(1).selectOption('high')
  // Later role edits cannot silently retarget already-confirmed tasks.
  await wsEval(page,(s,db)=>s.updateDatabase(db,{orders:{...s.databases[db].orders,copilot:{coding:{model:'auto'},qa:{model:'auto'}}}}),db)
  await page.reload()
  await expect(options.locator('select').first()).toHaveValue('claude-opus-5.5')
  await call('startNow',row)
  await expect.poll(async()=>(await call('record',row))?.state,{timeout:40000}).toBe('done')
  const tasks=fake.handed().filter(t=>['implement','doc'].includes(t.stage.kind))
  expect(tasks.find(t=>t.id===coding)?.stage).toMatchObject({copilot:{model:'claude-opus-5.5',reasoningEffort:'high',contextTokens:65536},copilotSource:'task'})
  expect(tasks.find(t=>t.id===qa)?.stage).toMatchObject({copilot:{model:'claude-opus-5.5',reasoningEffort:'high'},copilotSource:'role'})
  const history=page.getByTestId('copilot-run-history')
  await history.locator(':scope > summary').click();await history.locator('.copilot-run > summary').first().click()
  await expect(history).toContainText('claude-opus-5.5');await expect(history).toContainText('75 %');await expect(history).toContainText('Unknown');await expect(history).toContainText('No test receipt')
  for(const close of await page.locator('.toast__close').all())await close.click().catch(()=>{})
  await history.screenshot({path:test.info().outputPath('copilot-run-receipt.png')})
  await gotoPage(page,qa)
  await page.getByTestId('copilot-run-history').locator(':scope > summary').click();await page.locator('.copilot-run > summary').first().click()
  await expect(page.getByTestId('copilot-run-history')).toContainText('exit 0')
  await gotoPage(page,row)
  await expect(page.getByTestId('guided-accept')).toBeEnabled()
  await page.getByTestId('guided-accept').click()
  await expect.poll(()=>wsEval(page,(s,row)=>JSON.stringify(s.pages[row].content),row)).toContain('Copilot · ONE')
  await gotoPage(page,qa)
  await page.reload()
  await expect(page.getByTestId('copilot-run-history')).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 }finally{await fake.close()}
})
