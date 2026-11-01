import {test,expect,openApp,wsEval,MOD} from './fixtures'
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

 for(const provider of ['local','copilot','anthropic'] as const)test(`${provider}: reads sources before one decision, rebinds the answer and stages only afterwards`,async({page},info)=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'Project choice remains open; ask the person after checking ONE.'}})}
  const calls:Array<{name:string;arguments:Record<string,unknown>}>=[]
  const one=(name:string,args:Record<string,unknown>)=>{if(provider==='local'){calls.push({name:'one_workspace_search',arguments:{query:name}},{name:'one_workspace_call',arguments:{name,arguments:args}})}else calls.push({name,arguments:args})}
  one('search_pages',{query:'Compiler project decision fixture'})
  calls.push({name:'one_mcp_search',arguments:{query:'atlas_get'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_task_question',arguments:{question:'Which project should this proposal address?',needed_for:'Stage the project-specific proposal',options:[{label:'Project A',effect:'Draft for Project A'},{label:'Project B',effect:'Draft for Project B'}]}})
  one('create_page',{title:'Compiler decision fixture',markdown:'Draft for Project A; source Atlas Ref 42. Human acceptance remains open.'})
  const final='Draft for Project A prepared for review.'
  let round=0
  fake.onText=r=>{const call=calls[round++];return {model:r.model,text:call?'':final,calls:call?[{id:'call-'+round,...call}]:[],inputTokens:300,outputTokens:60,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'call-'+i,name:c.name,input:c.arguments}]})),text(final)]):null
  if(provider==='anthropic')await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Prepare a proposal from Atlas ref 42. Find the project in ONE and Atlas; ask if it remains unspecified.');await input.press('Enter')
  const card=term.getByRole('region',{name:'Compiled task'}),question=card.getByRole('heading',{name:'Your decision is needed'})
  await expect(question).toBeVisible({timeout:25000});await expect(card).toContainText('Which project should this proposal address?')
  expect(await page.evaluate(()=>(window as any).__one.workspace.getState().pages&&Object.values((window as any).__one.workspace.getState().pages).some((p:any)=>p.title==='Compiler decision fixture'))).toBe(false)
  const rawBefore=await card.locator('pre').last().textContent(),before=JSON.parse(rawBefore!)
  expect(before.questions[0].state).toBe('open');expect(before.evidence.one_checked).toBe(true);expect(before.evidence.atlas_checked).toBe(true)
  for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`decision-${provider}-${theme}-${width}.png`),animations:'disabled'})}
  await card.getByRole('button',{name:'Project A',exact:false}).click();await expect(term.locator('.term-answer')).toContainText(final,{timeout:25000})
  await expect(card).toContainText('Ready for review');const after=JSON.parse((await card.locator('pre').last().textContent())!)
  expect(after.compiled.contract_hash).not.toBe(before.compiled.contract_hash);expect(after.compiled.contract.decisions[0].answer).toContain('Project A');expect(after.evidence.human_accepted).toBe(false);expect(after.evidence.staged_changes).toBe(1)
  await card.getByRole('button',{name:'I reviewed the result'}).click();await expect(card).toContainText('Reviewed by person')
  const wire=host?host.requests.map(r=>r.body):fake.textAsked
  expect(wire.every(r=>!('mcp_servers' in r))).toBe(true);expect(JSON.stringify(wire.at(-1))).toContain('human_decisions');expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
 })
 for(const provider of ['local','copilot','anthropic'] as const)test(`${provider}: a premature decision request repairs into a source-backed analysis without interrupting the person`,async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'UI warns above 80. API warns at or above 80. The team has not decided.'}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_task_question',arguments:{question:'Which threshold is authoritative?',needed_for:'A later implementation'}}]
  const final='The actual Atlas Ref 42 contains a conflict at 80. Open question for the team: which threshold is authoritative? This analysis makes no decision and no changes.'
  let round=0;fake.onText=r=>{const c=calls[round++];return{model:r.model,text:c?'':final,calls:c?[{id:'repair-'+round,...c}]:[],inputTokens:300,outputTokens:60,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'repair-'+i,name:c.name,input:c.arguments}]})),text(final)]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Read Atlas ref 42, analyse the conflict and formulate an open question for the team. Only read; do not make a decision.');await input.press('Enter')
  await expect(term.locator('.term-answer')).toContainText(final,{timeout:25000})
  const card=term.getByRole('region',{name:'Compiled task'});await expect(card).toContainText('Ready for review');await expect(card.getByRole('heading',{name:'Your decision is needed'})).toHaveCount(0)
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
  const wire=host?host.requests.map(r=>r.body):fake.textAsked;expect(JSON.stringify(wire.at(-1))).toContain('oneNotExecuted');expect(JSON.stringify(wire.at(-1))).toContain('without pausing')
 })

})
