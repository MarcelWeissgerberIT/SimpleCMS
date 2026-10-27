import {test,expect,openApp,wsEval,gotoPage,createPage,doc,para,MOD} from './fixtures'
import {startFakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
const token='synthetic-personal-atlas-token-handoff'
test('Copilot reads Atlas and large ONE sources, stages a coding handoff, and forwards only an explicit personal read grant',async({page},info)=>{
 test.setTimeout(120000)
 const fake=await startFakeWorker(47430,{worker:'1.34.1',name:'Participant Windows worker',repos:[{name:'demo',baseBranch:'main'}],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true,personalSecrets:true})
 fake.can=[...WORKER_CAN];fake.textModels=[{provider:'copilot',model:'auto',context:32768,chat:true}]
 try{
  await openApp(page)
  await wsEval(page,(s,token)=>{s.setWorkspaceAI({policy:{restricted:[],providers:{copilot:{allow:['public','page','selection','structure','rows','workspace']}}}});s.updateSettings({ai:{allow:{copilot:['mcp']},default:[{p:'copilot',m:'auto'}]},mcpServers:[{id:'own-atlas',name:'atlas',url:'https://eh-atlas.com/api/atlas/mcp',token,enabled:true,prompt:'Use actual sources; the team decides.',tools:['atlas_whoami','atlas_get'],checkedAt:Date.now()}]})},token)
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill('47430');await page.getByLabel('Port',{exact:true}).press('Enter');await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('Participant Windows worker');await page.keyboard.press('Escape')
  const seed=await page.evaluate(()=>(window as any).__oneCodingWrites.create('Atlas-based implementation','coding','demo'))
  await gotoPage(page,seed)
  await page.getByTestId('coding-agent-select').selectOption('copilot')
  const secret=page.getByTestId('task-personal-secrets');await secret.locator('summary').click()
  const readGrant=secret.getByTestId('task-configured-atlas').getByRole('checkbox')
  for(const agent of ['codex','local','minimax','ollama','copilot']){
   await page.getByTestId('coding-agent-select').selectOption(agent)
   await readGrant.check();await expect(readGrant).toBeChecked()
   expect(await wsEval(page,(s,p)=>s.settings.ai.allow[p].includes('mcp'),agent)).toBe(true)
   if(agent!=='copilot')await readGrant.uncheck()
  }
  await secret.screenshot({path:info.outputPath('atlas-task-grant.png')})
  // No automatic execution or sharing with the workspace merely because Atlas is configured.
  expect(fake.handed()).toHaveLength(0)
  expect(await wsEval(page,s=>JSON.stringify({pages:s.pages,databases:s.databases}))).not.toContain(token)
  await wsEval(page,(s,id)=>{const row=s.pages[id],db=s.databases[row.databaseId],stage=db.properties.find((p:any)=>p.name==='Stage'),plan=db.pipeline.find((p:any)=>p.kind==='plan');s.setRowProperty(id,stage.id,plan.optionId??plan.id)},seed)
  await expect.poll(()=>fake.handed().length).toBe(1)
  const job=fake.handed()[0];expect(job.agent).toBe('copilot');expect(job.personalMcp).toEqual([{id:'task-atlas-read',name:'atlas-task-read',url:'https://eh-atlas.com/api/atlas/mcp',token,tools:['atlas_whoami','atlas_get','atlas_search','atlas_context']}]);expect(job.text).not.toContain(token)
  await fake.finish(job,{ok:true,summary:'Atlas source checked; implementation ready for review.',turns:1,spent:0})
  // Read the kind of long onboarding source that previously overflowed the worker.
  const source=await createPage(page,{title:'Workshop source',content:doc(para('Verified constraint: do not change the protocol. '+('Prüfung 🤖 – belegte Information. '.repeat(1600))))})
  await gotoPage(page,source)
  let round=0
  fake.onText=r=>{
   const bytes=Buffer.byteLength(JSON.stringify([r.messages,r.tools,r.schema]));expect(Math.ceil(bytes/1.5)+Math.min(r.maxTokens,8192)+2048).toBeLessThanOrEqual(32768)
   expect(JSON.stringify(r.messages)).not.toContain(token)
   const calls=[{id:'search',name:'one_mcp_search',arguments:{query:'atlas_whoami'}},{id:'who',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_whoami',arguments:{}}},{id:'read',name:'read_page',arguments:{id:source}},{id:'plan',name:'list_pipelines',arguments:{}},{id:'handoff',name:'create_task',arguments:{kind:'coding',title:'Preserve protocol behavior',repo:'demo',goal:'Implement only the confirmed requirement; see Atlas 31503.',criteria:['Regression passes; source remains traceable.'],start:false}}][round++]
   return {model:r.model,text:calls?'':'Prepared your Atlas-based coding task for review.',...(calls?{calls:[calls]}:{}),inputTokens:100,outputTokens:30,usd:null}
  }
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_whoami',inputSchema:{type:'object',properties:{}}}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify({person:'Participant',tenant:'one'})}]})}
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Use Atlas to verify my identity, read this page and propose a coding task for demo. Do not start it.');await input.press('Enter')
  await expect(term.locator('.term-answer')).toContainText('Prepared your Atlas-based coding task',{timeout:30000})
  expect(fake.mcpAsked.some(r=>r.action==='call'&&r.name==='atlas_whoami')).toBe(true)
  expect(fake.textAsked.some(r=>JSON.stringify(r.messages).includes('Harness context excerpt'))).toBe(true)
  await expect(term.locator('.term-step[data-tool="create_task"]')).toBeVisible()
  expect(await wsEval(page,s=>Object.values(s.pages).some((p:any)=>p.title==='Preserve protocol behavior'))).toBe(false)
  // Removing provider consent blocks an explicitly addressed Atlas request before inference.
  const before=fake.textAsked.length
  await wsEval(page,s=>s.updateSettings({ai:{...s.settings.ai,narrow:{copilot:['mcp']}}}))
  await input.fill('atlas whoami');await input.press('Enter')
  await expect(term).toContainText('this provider may not receive its results')
  expect(fake.textAsked).toHaveLength(before)
 }finally{await fake.close()}
})
