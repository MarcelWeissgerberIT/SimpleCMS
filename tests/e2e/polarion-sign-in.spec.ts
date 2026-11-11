import {test,expect,openApp,wsEval,MOD,reloadApp,createPage,gotoPage,editorOf,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text,type ClaudeTurn} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47439,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
test.describe('Compiled tasks and human decision cube',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  // This suite uses a local workspace and a fake worker, including against the deployed frontend.
  await page.route('**/api/config',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Local workspace fixture</title>'}))
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'atlas-facts-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  await openApp(page)
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','workspace'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-facts',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'private-facts-token',enabled:true,prompt:'Use observed sources only.',tools:['atlas_record_kinds','atlas_get','atlas_update'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('atlas-facts-fixture')
  await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await expect(page.getByTestId('worker-model-settings')).toContainText(COPILOT);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})

 for(const goal of ['Bitte in Polarion anmelden','Please sign in to Polarion'])for(const provider of ['local','copilot','anthropic'] as const)test(`${provider}: protected sign-in window and clickable fallback (${goal})`,async({page})=>{
  const signInUrl='https://aj-atlas.com/mcp/secure-input/69d0c649-a59e-4c4a-9982-64501b528b6e'
  await page.context().route('https://aj-atlas.com/mcp/secure-input/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Protected sign-in fixture</h1>'}))
  const allowPopup=provider==='local' && goal.startsWith('Please')
  await page.evaluate(allow=>{(window as any).__signInOpens=[];const open=window.open.bind(window);window.open=(...args:Parameters<typeof window.open>)=>{(window as any).__signInOpens.push(args);return allow?open(...args):null}},allowPopup)
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_polarion_connect',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}:{result:envelope({job:{id:'auth-job-fixture',status:'running'},result:{interaction:{type:'url',purpose:'authentication',url:signInUrl}}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_polarion_connect'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_polarion_connect',arguments:{}}}]
  const final='Open this link: '+signInUrl+'. This is not a successful Polarion read.'
  let round=0;fake.onText=r=>{const c=calls[round++];return{model:r.model,text:c?'':final,calls:c?[{id:'auth-'+round,...c}]:[],inputTokens:200,outputTokens:60,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'auth-'+i,name:c.name,input:c.arguments}]})),text(final)]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'});await term.getByRole('textbox',{name:'Task for the agent'}).fill(goal);await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_polarion_connect'])
  const login=page.locator('.term-sign-in')
  await expect(login.getByRole('link',{name:'Open sign-in'})).toHaveAttribute('href',signInUrl)
  await expect(term.locator('.term-answer').getByRole('link',{name:signInUrl,exact:true})).toHaveAttribute('href',signInUrl)
  expect(await page.evaluate(()=>(window as any).__signInOpens)).toEqual(allowPopup ? [['','_blank','popup=yes,width=560,height=760']] : [['','_blank','popup=yes,width=560,height=760'],[signInUrl,'_blank','noopener,noreferrer,popup=yes,width=560,height=760']])
  await page.context().route('https://aj-atlas.com/mcp/secure-input/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Protected sign-in fixture</h1>'}))
  if(allowPopup){const automatic=page.context().pages().find(p=>p!==page)!;await expect(automatic.getByRole('heading')).toHaveText('Protected sign-in fixture');await automatic.close()}
  const popupWait=page.context().waitForEvent('page');await login.getByRole('link').click();const popup=await popupWait;await expect(popup.getByRole('heading')).toHaveText('Protected sign-in fixture');await popup.close()
  await wsEval(page,s=>s.updateSettings({language:'de'}))
  await expect(page.getByRole('link',{name:'Anmeldung öffnen'})).toBeVisible()
  await page.setViewportSize({width:390,height:844});expect(await login.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
  await wsEval(page,s=>s.updateSettings({language:'en'}))
  const card=term.getByRole('region',{name:'Compiled task'});await card.locator('summary').first().click();const raw=JSON.parse((await card.locator('pre').last().textContent())!);expect(raw.compiled.contract.authenticate).toBe(true);expect(raw.compiled.contract.external_write).toBe(false);expect(raw.compiled.contract.execute).toBe(false);await expect(card.getByRole('button',{name:'Save as executable program',exact:true})).toHaveCount(0)
 })

})
