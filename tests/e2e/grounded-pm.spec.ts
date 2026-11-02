import {test,expect,openApp,wsEval,createPage,gotoPage,doc,para,MOD} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
const PORT=47497,source='Customer-specific entries must not be overwritten by an AJ update. The database can be updated independently of the ICM and FluX release cycle.'
test.describe('Fixed source-bound PM brief',()=>{
 test.describe.configure({mode:'serial'});let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.5',name:'pm-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN];fake.textModels=[{provider:'local',model:'atlas-flow:latest',context:32768,chat:true,maxOutput:8192}]
  await page.route('**/api/config',r=>r.fulfill({json:{version:'fixture',signup:{mode:'open',domains:[]},max_upload_mb:20,dev_mode:false,source_url:'',schema_min:1,supports:['ai','providers'],coding_relay:false}}));await page.route('**/api/session',r=>r.fulfill({json:{user:null,workspaces:[]}}));await openApp(page)
  await wsEval(page,s=>{s.setWorkspaceAI({policy:{restricted:[],providers:{local:{allow:['public','structure','selection','page','rows','workspace']}}}});s.updateSettings({ai:{allow:{local:['mcp']}},mcpServers:[{id:'pm-atlas',name:'atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:'synthetic-pm-token-not-real',enabled:true,tools:['atlas_get'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter');await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('pm-fixture');await page.keyboard.press('Escape')
  const id=await createPage(page,{title:'PM source card',content:doc(para('Steering, not a PO decision.'))});await gotoPage(page,id)
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:r.query,inputSchema:{type:'object',properties:r.query==='atlas_get'?{ref:{type:'integer'},parts:{type:'array',items:{type:'string'}}}:{},...(r.query==='atlas_get'?{required:['ref']}:{}),additionalProperties:false}}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify(r.name==='atlas_whoami'?{person:'Synthetic PM'}:{item:{ref:9602,title:'Labware database',body:source}})}]})}
  await page.evaluate(async()=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:'atlas-flow:latest'}]))
 })
 test.afterEach(async()=>fake.close())
 const start=async(page:any)=>{await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'});await input.fill('/pm 9602 Prepare a small PM brief with sources and open questions. Do not write or decide.');await input.press('Enter');return term}
 test('host reads identity and requested record; one tool-free model response produces a cited PM proposal',async({page})=>{
  fake.onText=r=>{expect(r.schema).toBeTruthy();expect(r.tools??[]).toHaveLength(0);return {model:r.model,text:JSON.stringify({observations:[{source:'S1',quote:source,interpretation:'Independent updates must preserve customer entries.'}],questions:[{source:'S1',question:'Which labware properties need PM definition?',reason:'The source does not define the full property set.'}],next_step:'Propose a short clarification with PM and application; no decision made.'}),inputTokens:200,outputTokens:150,usd:0}}
  const term=await start(page);await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:30000});await expect(term).toContainText('Actually connected as Synthetic PM');await expect(term).toContainText(source);await term.getByRole('region',{name:'Compiled task'}).locator('summary').first().click();await expect(term.getByRole('button',{name:'Save as executable program',exact:true})).toHaveCount(1);expect(fake.textAsked).toHaveLength(1);expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_whoami','atlas_get']);expect(JSON.stringify(fake.textAsked)).not.toContain('synthetic-pm-token-not-real');await expect(term.getByText('Apply all',{exact:true})).toHaveCount(0)
  await expect(term).toContainText('Compiled task and result saved')
  await term.getByRole('button',{name:'Saved compiled programs'}).click();const library=page.getByRole('dialog',{name:'Saved compiled programs'})
  await library.getByRole('button',{name:/^\/pm 9602/}).click();await expect(library).toContainText('PM · Refresh analysis');await library.getByRole('checkbox',{name:/Run this task again/}).check();await library.getByRole('button',{name:'Run this version'}).click()
  await expect(term).toContainText('Program run receipt saved');expect(fake.textAsked).toHaveLength(2);expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_whoami','atlas_get','atlas_whoami','atlas_get'])
 })
 test('repeated fabricated quote is held after one correction without writing',async({page})=>{
  fake.onText=r=>({model:r.model,text:JSON.stringify({observations:[{source:'S1',quote:'The whole release has already been approved.',interpretation:'Invented approval.'}],questions:[],next_step:'This must remain a proposal.'}),inputTokens:200,outputTokens:100,usd:0});const term=await start(page);await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:30000});expect(fake.textAsked).toHaveLength(2);await expect(term).toContainText('PM draft held');await expect(term.getByText('Apply all',{exact:true})).toHaveCount(0)
 })
 test('valid quotes cannot turn an unverified project hint into an action target',async({page})=>{
  const body='Change value from abort to ignore'
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:r.query,inputSchema:{type:'object',properties:r.query==='atlas_get'?{ref:{type:'integer'},parts:{type:'array',items:{type:'string'}}}:{},...(r.query==='atlas_get'?{required:['ref']}:{}),additionalProperties:false}}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify(r.name==='atlas_whoami'?{person:'Synthetic PM'}:{item:{ref:9602,title:'Default value',project:'flux-part-cnsx',body}})}]})}
  fake.onText=r=>({model:r.model,text:JSON.stringify({observations:[{source:'S1',quote:body,interpretation:'The source requests abort to become ignore.'}],questions:[],next_step:'Check the implementation in the FeliX systems.'}),inputTokens:200,outputTokens:100,usd:0})
  const term=await start(page);await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:30000});expect(fake.textAsked).toHaveLength(2);await expect(term).toContainText('No read source establishes a FeliX relationship');await expect(term.getByText('Apply all',{exact:true})).toHaveCount(0)
 })

})
