import {test,expect,openApp,wsEval,MOD,createPage,gotoPage,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text,type ClaudeTurn} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
import {typedTemplate} from '../../src/shared/quandprofile/typed-ai'
const PORT=47491,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
const RULE='Rule version 5 is the current applicable project rule. Missing specifications remain open.'
test.describe('Typed AI across task kinds and models',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker,rule:string
 test.beforeEach(async({page})=>{
  rule=RULE
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'typed-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  fake.onModelMcp=r=>r.action==='search'?{tools:[r.query==='atlas_search'?{server:'atlas',name:'atlas_search',inputSchema:{type:'object',properties:{q:{type:'string'},tenant:{type:'string'},limit:{type:'integer'}},required:['q','tenant'],additionalProperties:false}}:{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'},tenant:{type:'string'},parts:{type:'array',items:{type:'string'}}},required:['ref'],additionalProperties:false}}]}:r.name==='atlas_search'?{result:envelope({items:[{ref:42,title:'Project rules V5'}]})}:{result:envelope({item:{ref:r.arguments.ref,title:r.arguments.ref===42?'Project rules V5':'Measurement requirement',tenant:'aj',project:'flux',body:r.arguments.ref===42?rule:'The system shall record every completed measurement.'}})}
  await openApp(page)
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','workspace'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-typed',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'private-typed-token',enabled:true,prompt:'Use observed sources only.',tools:['atlas_get','atlas_search'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('typed-fixture')
  await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})
 const configure=async(page:any,recipe='BA analysis')=>{
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'});await term.getByRole('button',{name:'Edit cube profiles',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Edit cube profiles'}),typed=dialog.getByRole('region',{name:'Typed AI · task types and rules',exact:true})
  await dialog.getByLabel('Profile name',{exact:true}).fill('Typed '+recipe+' project review')
  await typed.getByRole('button',{name:recipe,exact:true}).click()
  await typed.getByText('Read and bind an Atlas rule / shadow',{exact:true}).click()
  await typed.getByLabel('Personal Atlas connection',{exact:true}).fill('atlas');await typed.getByLabel('Tenant',{exact:true}).fill('aj');await typed.getByRole('button',{name:'Find Atlas shadows / rules',exact:true}).click();await expect(typed).toContainText('Candidates only.');await typed.getByRole('button',{name:'Project rules V5 · Ref 42',exact:true}).click()
  await typed.getByRole('button',{name:'Read source',exact:true}).click();await expect(typed).toContainText('Project rules V5')
  await typed.getByLabel('Rule tag or shadow ID@version',{exact:true}).fill('rule:project-rules@5')
  await typed.getByRole('button',{name:'Bind this source version',exact:true}).click()
  await typed.getByRole('button',{name:'Check selection and missing prerequisites',exact:true}).click();await expect(typed.getByRole('status')).toContainText('Selection resolves exactly one')
  await dialog.getByRole('button',{name:'Save version and activate',exact:true}).click();await expect(dialog.getByRole('status').last()).toContainText('Version saved')
  await page.keyboard.press('Escape');return term
 }
 for(const provider of ['local','copilot','anthropic']as const)test(`${provider}: reads exact Atlas rule before inference and compiles typed evidence`,async({page})=>{
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:43,tenant:'aj',parts:['body']}}}]
  const answer='The actual requirement says that every completed measurement must be recorded. Missing specifications remain open for review.'
  let round=0;fake.onText=r=>{const c=calls[round++];return{model:r.model,text:c?'':answer,calls:c?[{id:'typed-'+round,...c}]:[],inputTokens:300,outputTokens:60,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'typed-'+i,name:c.name,input:c.arguments}]})),text(answer)]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  const term=await configure(page);expect(fake.textAsked.length).toBe(0);expect(host?.requests.length??0).toBe(0)
  await term.getByRole('textbox',{name:'Task for the agent'}).fill('Read Atlas ref 43 and analyse the measurement requirement. Only read; leave open questions for review.');await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
  await expect(term.locator('.term-answer')).toContainText(answer,{timeout:25000})
  const card=term.getByRole('region',{name:'Compiled task'});await card.locator('summary').first().click();await expect(card).toContainText('Ready for review')
  const report=JSON.parse(await card.locator('pre').last().textContent()??'{}')
  expect(report.compiled.findings.filter((f:any)=>f.id.startsWith('typed_')).every((f:any)=>f.status==='verified')).toBe(true)
  expect(report.evidence.typed_sources).toHaveLength(1);expect(report.evidence.atlas_records).toContain('43');expect(report.evidence.human_accepted).toBe(false)
  const wire=host?host.requests.map(r=>r.body):fake.textAsked
  expect(JSON.stringify(wire)).toContain('typed_work');expect(JSON.stringify(wire)).toContain('Rule version 5');expect(JSON.stringify(wire)).not.toContain('private-typed-token')
  expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.arguments.ref===42)).toHaveLength(2) // import + fresh preflight
  await card.getByRole('button',{name:'Save as executable program',exact:true}).click()
  const definition=page.getByRole('textbox',{name:'Executable JSON definition',exact:true})
  await expect(definition).toBeVisible();const captured=JSON.parse(await definition.inputValue());expect(captured.profile.spec.typedAI.tags.some((t:any)=>t.kind==='rule'&&t.version==='5')).toBe(true)
 })
 for(const role of ['ba','po','claude-ba']as const)test(role+': bounded analysis uses the same fresh Atlas rule preflight and typed compiler',async({page})=>{
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:role==='claude-ba'?'anthropic':'local',m:role==='claude-ba'?DEFAULT_CLAUDE_MODEL:LOCAL})
  if(role==='claude-ba')await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  const term=await configure(page,role==='po'?'PO specification':'BA analysis')
  const source=await createPage(page,{title:'Typed source requirement',content:doc(para('AICM-2065: When a measurement starts the logger records its start time.'))});await gotoPage(page,source)
  const ba=JSON.stringify({requirements:[{statement:'When a measurement starts, the logger shall record its start time.',source_refs:['T01'],checks:[{observation:'A measurement starts and its original start time is recorded.',conforms:true},{observation:'A measurement starts but no original start time is recorded.',conforms:false}]}],questions:[{question:'What timestamp precision is required?',reason:'No precision is specified by the actual source.',source_refs:['T01']}]})
  const po=JSON.stringify({reviews:[{requirement:'R1',support:'partial',check_support:'supported',finding:'The required start-time precision is unspecified; acceptance needs clarification.'}],contradictions:[],questions:['What timestamp precision must the team agree?']})
  let calls=0;fake.onText=r=>({model:r.model,text:calls++%2?po:ba,inputTokens:200,outputTokens:100,usd:0})
  const claude=role==='claude-ba'?await mockClaudeScript(page,[text(ba),text(po)]):null
  await term.getByRole('textbox',{name:'Task for the agent'}).fill('/'+(role==='po'?'po':'ba')+' measurement');await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  const card=term.getByRole('region',{name:'Compiled task'});await card.locator('summary').first().click();const report=JSON.parse(await card.locator('pre').last().textContent()??'{}')
  expect(report.evidence.typed_sources).toHaveLength(1);expect(report.evidence.one_pages).toContain(source);expect(claude?.requests.length??calls).toBe(2)
  expect(report.compiled.findings.filter((f:any)=>f.id.startsWith('typed_')).every((f:any)=>f.status==='verified')).toBe(true)
  expect(fake.textAsked.every(r=>!r.tools?.length)).toBe(true);expect(JSON.stringify(claude?.requests??fake.textAsked)).toContain('Rule version 5')
  if(claude)for(const request of claude.requests){const schema=request.body.output_config?.format?.schema;expect(schema).toBeTruthy();const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return}for(const key of ['maxItems','minLength','maxLength','minimum','maximum'])expect(node).not.toHaveProperty(key);if(node.minItems!==undefined)expect([0,1]).toContain(node.minItems);for(const[key,value]of Object.entries(node))if(['properties','$defs','definitions'].includes(key))Object.values(value as any).forEach(walk);else if(['items','anyOf','oneOf','allOf'].includes(key))walk(value)};walk(schema)}
 })
 test('a changed rule body stops before any paid model call',async({page})=>{
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'local',m:LOCAL})
  const term=await configure(page);rule='Rule version 6 has superseded version 5.'
  await term.getByRole('textbox',{name:'Task for the agent'}).fill('Read Atlas ref 43 and analyse the requirement.');await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
  await expect(term).toContainText('differs from the saved binding',{timeout:20000});expect(fake.textAsked).toHaveLength(0)
  expect(fake.mcpAsked.filter(r=>r.action==='call').every(r=>['atlas_get','atlas_search'].includes(r.name))).toBe(true)
 })
 test('a model answer without the required source body is held with a clear prompt-level explanation',async({page})=>{
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'local',m:LOCAL})
  fake.onText=r=>({model:r.model,text:'I think the requirements are complete.',inputTokens:100,outputTokens:20,usd:0})
  const term=await configure(page)
  await term.getByRole('textbox',{name:'Task for the agent'}).fill('Analyse the available requirement. Do not read Atlas content beyond the preflight rule and do not change anything.');await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
  await expect(term).toContainText('Typed AI has held this task',{timeout:20000})
  await expect(term).not.toContainText('Compiled result check blocked:')
  await expect(term).not.toContainText('ERR · UNKNOWN')
  await expect(term.getByRole('region',{name:'Compiled task'})).toContainText('Blocked')
  expect(fake.textAsked).toHaveLength(1)
 })
 test('ambiguity requires specification and all task recipes remain available in responsive themes',async({page},info)=>{
  await page.keyboard.press(`${MOD}+j`);await page.getByRole('region',{name:'AI terminal'}).getByRole('button',{name:'Edit cube profiles',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Edit cube profiles'}),typed=dialog.getByRole('region',{name:'Typed AI · task types and rules',exact:true})
  for(const label of ['BA analysis','PO specification','PM briefing','Research','Test analysis','UI mock','Coding']){await typed.getByRole('button',{name:label,exact:true}).click();await expect(typed.getByLabel('Typed tag chain',{exact:true})).toContainText('operation:')}
  await typed.getByRole('button',{name:'BA analysis',exact:true}).click();await dialog.getByLabel('Profile name',{exact:true}).fill('Typed profile preview')
  await typed.getByText('Shadow definitions and source bindings',{exact:true}).click()
  const shadow=typedTemplate('ba').shadows[0]!;await typed.getByLabel('Versioned shadow definitions · JSON',{exact:true}).fill(JSON.stringify([shadow,{...shadow,id:'second.ba'}]))
  await typed.getByRole('button',{name:'Check selection and missing prerequisites',exact:true}).click();await expect(typed.getByRole('alert')).toContainText('ambiguous')
  await expect(dialog.getByRole('button',{name:'Save version and activate',exact:true})).toBeDisabled()
  await typed.getByLabel('Versioned shadow definitions · JSON',{exact:true}).fill(JSON.stringify([shadow],null,2));await typed.getByRole('button',{name:'Check selection and missing prerequisites',exact:true}).click();await expect(typed.getByRole('status')).toContainText('Selection resolves exactly one')
  await typed.getByText('Shadow definitions and source bindings',{exact:true}).click()
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[390,844]]){await page.setViewportSize({width,height});await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await typed.getByRole('heading',{name:'Typed AI · task types and rules',exact:true}).scrollIntoViewIfNeeded();expect(await dialog.evaluate((el:any)=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`typed-${theme}-${width}.png`),animations:'disabled'})}
  expect(fake.textAsked.length).toBe(0);expect(fake.mcpAsked.length).toBe(0)
 })
})
