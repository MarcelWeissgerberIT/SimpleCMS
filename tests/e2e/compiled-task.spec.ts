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

 for(const [provider,restore] of [['local',false],['copilot',false],['anthropic',false],['anthropic',true]] as const)test(provider+': inline question '+(restore?'recovers after reload':'waits for a real human answer before continuing'),async({page},info)=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'Some questions remain open. Ticket status is new.'}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_task_question',arguments:{question:'Should only the questions be closed, or also the ticket?',needed_for:'Prepare the requested reply with the correct meaning',options:[]}}]
  const final='Reply draft: close the questions only; keep the ticket status.'
  let n=0;fake.onText=r=>{const c=calls[n++];return{model:r.model,text:c?'':final,calls:c?[{id:'inline-'+n,...c}]:[],inputTokens:200,outputTokens:40,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'inline-'+i,name:c.name,input:c.arguments}]})),text(final)]):null
  if(provider==='anthropic')await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  const id=await createPage(page,{title:'Kai clarification fixture',content:doc(para('Questions 1–3 are still open.'),para(''))});await gotoPage(page,id)
  const ed=editorOf(page,id),ask=page.getByPlaceholder('Ask AI to write anything…')
  await expect(async()=>{await ed.locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space');try{await expect(ask).toBeFocused({timeout:1500})}catch(e){if(!(await ask.count()))await page.keyboard.press('Backspace');throw e}}).toPass({timeout:15000})
  await ask.fill('Prepare a proposed reply for Atlas ref 42. Read its body and ask me whether closing means the questions or the ticket before preparing the reply. Do not change records.');await page.locator('#ai-row-custom').click()
  const panel=page.getByRole('dialog',{name:'Ask AI'}),card=panel.getByRole('region',{name:'Compiled task'})
  await expect(card.getByRole('button',{name:'Bind answer and continue',exact:true})).toBeVisible({timeout:20000})
  await expect(card).toContainText('This request is waiting for your answer')
  expect(host?.requests??fake.textAsked).toHaveLength(3)
  if(restore){
   // Persist a genuinely waiting run, then reload: no old waiter is resurrected and no request repeats.
   await reloadApp(page);await gotoPage(page,id);await page.getByTestId('ai-runs').getByRole('button').click()
   const restored=page.getByRole('dialog',{name:'Ask AI'}),closed=restored.getByRole('region',{name:'Compiled task'})
   await expect(closed).toContainText('The previous run has ended')
   await closed.getByLabel('Your specification').fill('Only the questions. The ticket status stays unchanged.')
   for(const width of [1440,390])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s,x)=>s.updateSettings(x),{theme,language:'de'})
    expect(await page.locator('.task-contract').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
    await page.locator('.task-contract').screenshot({path:info.outputPath(`closed-question-${theme}-${width}.png`),animations:'disabled'})
   }
   await wsEval(page,s=>s.updateSettings({language:'en'}))
   await closed.getByRole('button',{name:'Prepare answer as a new request',exact:true}).click()
   const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await expect(input).toHaveValue(/Only the questions. The ticket status stays unchanged./)
   await expect(input).toHaveValue(/do not blindly repeat previous writes/)
   await expect(term).toContainText('Kai clarification fixture');expect(host!.requests).toHaveLength(3);expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
   await term.screenshot({path:info.outputPath('recovered-answer.png'),animations:'disabled'});return
  }
  await card.getByLabel('Your specification').fill('Only the questions. The ticket status stays unchanged.')
  await card.getByRole('button',{name:'Bind answer and continue',exact:true}).click()
  await expect(panel.locator('.ai-out__body')).toContainText(final,{timeout:20000})
  expect(host?.requests??fake.textAsked).toHaveLength(4);expect(JSON.stringify((host?.requests??fake.textAsked)[3])).toContain('Only the questions. The ticket status stays unchanged.')
  await expect(card).not.toContainText('no longer active')
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_get'])
 })

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
  await term.getByRole('button',{name:'Edit cube profiles',exact:true}).click()
  const profiles=page.getByRole('dialog',{name:'Edit cube profiles'})
  await profiles.getByLabel('Profile name',{exact:true}).fill('Source review '+provider)
  await profiles.getByLabel('Read at least one actual Atlas record body').check()
  await profiles.getByLabel('Required sources: global Atlas refs',{exact:true}).fill('42')
  await profiles.getByRole('button',{name:'Save version and activate',exact:true}).click()
  await expect(profiles.getByRole('status')).toContainText('Version saved')
  await page.keyboard.press('Escape')
  await input.fill('Prepare a proposal from Atlas ref 42. Find the project in ONE and Atlas; ask if it remains unspecified.');await input.press('Enter')
  const card=term.getByRole('region',{name:'Compiled task'}),question=card.getByRole('heading',{name:'Your decision is needed'})
  await expect(question).toBeVisible({timeout:25000});await expect(card).toContainText('Which project should this proposal address?')
  expect(await page.evaluate(()=>(window as any).__one.workspace.getState().pages&&Object.values((window as any).__one.workspace.getState().pages).some((p:any)=>p.title==='Compiler decision fixture'))).toBe(false)
  const rawBefore=await card.locator('pre').last().textContent(),before=JSON.parse(rawBefore!)
  expect(before.compiled.contract.review_profile.spec.name).toBe('Source review '+provider);expect(before.evidence.atlas_records).toEqual(['42']);expect(before.questions[0].state).toBe('open');expect(before.evidence.one_checked).toBe(true);expect(before.evidence.atlas_checked).toBe(true)
  await term.getByRole('button',{name:'Maximise',exact:true}).click()
  await card.getByText('Decision cube and compiled dimensions',{exact:true}).click()
  const modelRequests=host?host.requests.length:fake.textAsked.length,mcpRequests=fake.mcpAsked.length
  const cube=card.locator('.quantum-cube')
  const refs=cube.locator('.quantum-cube__relations li')
  await cube.getByRole('button',{name:'Data permission',exact:true}).click()
  await expect(refs).toHaveCount(1)
  await expect(refs.first()).toHaveAttribute('data-reference','task_provider_checked')
  await cube.screenshot({path:info.outputPath(`cube-privacy-${provider}.png`),animations:'disabled'})
  const privacyPlane=await cube.locator('.quantum-cube__plane[data-selected=true]').getAttribute('d')
  const privacyRef=before.compiled.quanta.find((q:any)=>q.obligation_id==='task_provider_checked')
  await expect(cube.locator('.quantum-cube__evidence[data-reference=task_provider_checked]').first()).toHaveAttribute('data-quantum-id',privacyRef.id)
  await cube.getByRole('button',{name:'Interpretation',exact:true}).click()
  await expect(refs).toHaveCount(3)
  expect(await cube.locator('.quantum-cube__plane[data-selected=true]').getAttribute('d')).not.toBe(privacyPlane)
  await expect(cube.locator('.quantum-cube__evidence[data-reference=task_decisions_resolved]').first()).toHaveAttribute('data-status','open')
  await expect(cube.locator('.quantum-cube__evidence[data-reference=task_decisions_resolved]').first()).not.toHaveAttribute('data-quantum-id')
  expect(await cube.locator('.quantum-cube__binding').count()).toBe(3)
  for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);const labels=await term.locator('.term-key--label').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,contained:el.scrollWidth<=el.clientWidth}}));expect(labels.every(r=>r.contained)).toBe(true);expect(labels[0].right<=labels[1].left||labels[0].bottom<=labels[1].top).toBe(true);await page.screenshot({path:info.outputPath(`decision-${provider}-${theme}-${width}.png`),animations:'disabled'});await cube.screenshot({path:info.outputPath(`cube-${provider}-${theme}-${width}.png`),animations:'disabled'})}
  expect(host?host.requests.length:fake.textAsked.length).toBe(modelRequests);expect(fake.mcpAsked.length).toBe(mcpRequests)
  await card.getByRole('button',{name:'Project A',exact:false}).click();await expect(term.locator('.term-answer')).toContainText(final,{timeout:25000})
  await expect(card).toContainText('Ready for review');const after=JSON.parse((await card.locator('pre').last().textContent())!)
  expect(after.compiled.contract_hash).not.toBe(before.compiled.contract_hash);expect(after.compiled.contract.decisions[0].answer).toContain('Project A');expect(after.evidence.human_accepted).toBe(false);expect(after.evidence.staged_changes).toBe(1)
  await card.getByRole('button',{name:'I reviewed the result'}).click();await expect(card).toContainText('Reviewed by person')
  await expect(cube.locator('.quantum-cube__evidence[data-reference=task_decisions_resolved]').first()).toHaveAttribute('data-status','verified')
  await expect(cube.locator('.quantum-cube__evidence[data-reference=task_human_acceptance]').first()).toHaveAttribute('data-status','verified')
  await expect(cube.locator('.quantum-cube__evidence[data-reference=task_human_acceptance]').first()).toHaveAttribute('data-quantum-id',/^[a-f0-9]{64}$/)
  await cube.screenshot({path:info.outputPath(`cube-accepted-${provider}.png`),animations:'disabled'})

  const wire=host?host.requests.map(r=>r.body):fake.textAsked
  expect(wire.every(r=>!('mcp_servers' in r))).toBe(true);expect(JSON.stringify(wire.at(-1))).toContain('human_decisions');expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
 })
 for(const provider of ['local','copilot','anthropic'] as const)test(`${provider}: a premature decision request repairs into a source-backed analysis without interrupting the person`,async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'UI warns above 80. API warns at or above 80. The team has not decided.'}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_task_question',arguments:{question:'Which threshold is authoritative?',needed_for:'A later implementation'}}]
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
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1);expect(fake.mcpAsked.find(r=>r.action==='search')?.query).toBe('atlas_get')
  const wire=host?host.requests.map(r=>r.body):fake.textAsked;expect(JSON.stringify(wire.at(-1))).toContain('oneNotExecuted');expect(JSON.stringify(wire.at(-1))).toContain('without pausing')
 })

 for(const goal of ['verbinde dich mit polarion','melde dich bei polarion an','polarion anmelden','Kannst du mich bitte wieder bei Polarion anmelden? Nur lesen.','Please reconnect me to Polarion. Read only.','Could you log me back in to Polarion?'])for(const provider of ['local','copilot','anthropic'] as const)test(`${provider}: explicit Polarion authentication (${goal}) dispatches without granting content writes`,async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_polarion_connect',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}:{result:envelope({job:{id:'auth-job-fixture',status:'running'},interaction:{url:'https://atlas.example.org/secure-input/fixture'}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_polarion_connect'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_polarion_connect',arguments:{}}}]
  const final='Sign-in started; use the protected link. This is not a successful Polarion read.'
  let round=0;fake.onText=r=>{const c=calls[round++];return{model:r.model,text:c?'':final,calls:c?[{id:'auth-'+round,...c}]:[],inputTokens:200,outputTokens:60,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'auth-'+i,name:c.name,input:c.arguments}]})),text(final)]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'});await term.getByRole('textbox',{name:'Task for the agent'}).fill(goal);await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_polarion_connect'])
  const card=term.getByRole('region',{name:'Compiled task'});await card.locator('summary').first().click();const raw=JSON.parse((await card.locator('pre').last().textContent())!);expect(raw.compiled.contract.authenticate).toBe(true);expect(raw.compiled.contract.external_write).toBe(false);expect(raw.compiled.contract.execute).toBe(false);await expect(card.getByRole('button',{name:'Save as executable program',exact:true})).toHaveCount(0)
 })

 test('profile editor explains compilation, exposes cross-dimension edges and keeps immutable versions',async({page},info)=>{
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'})
  await term.getByRole('button',{name:'Edit cube profiles',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Edit cube profiles'})
  await dialog.getByLabel('Profile name',{exact:true}).fill('Private source review')
  await dialog.getByLabel('Required sources: ONE page IDs',{exact:true}).fill('specific-page')
  const cube=dialog.locator('.quantum-cube')
  await cube.getByRole('button',{name:'Data permission',exact:true}).click()
  await cube.locator('.quantum-cube__legend-button').first().click()
  await expect(cube.locator('.quantum-cube__edge[data-focused=true]')).toHaveCount(1)
  const edge=cube.locator('.quantum-cube__links li').first()
  await edge.getByRole('button',{name:/Allowed effect/}).click()
  await expect(cube).toHaveAttribute('data-dimension','permission')
  await dialog.getByLabel('Read only: no ONE proposals, external writes or execution').check()
  await dialog.getByRole('button',{name:'Save version and activate',exact:true}).click()
  await expect(dialog.getByRole('status')).toContainText('Version saved')
  await dialog.getByLabel('Profile name',{exact:true}).fill('Private source review v2')
  await dialog.getByRole('button',{name:'Save version only',exact:true}).click()
  await expect(dialog.locator('.programs__version').filter({hasText:'Private source review'})).toHaveCount(2)
  await expect(dialog.locator('aside')).toContainText('Active Private source review')
  const flow=dialog.getByRole('region',{name:'How compilation works'})
  for(const name of ['Task + profile','Compile contract','Check tool call','Bind evidence','Check result','Human acceptance']){await flow.getByRole('button',{name,exact:false}).click();await expect(flow.locator('.cube-flow__explanation h4')).toHaveText(name)}
  expect(fake.textAsked.length).toBe(0);expect(fake.mcpAsked.length).toBe(0)
  for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await dialog.screenshot({path:info.outputPath(`profiles-${theme}-${width}.png`),animations:'disabled'})}
  await dialog.getByRole('button',{name:'Disable additional profile',exact:true}).click()
  await expect(dialog.locator('aside')).toContainText('Active: base checks without additional profile')
  await page.keyboard.press('Escape');await reloadApp(page);await page.keyboard.press(`${MOD}+j`)
  await page.getByRole('button',{name:'Edit cube profiles',exact:true}).click()
  await expect(page.getByRole('dialog').locator('.programs__version').filter({hasText:'Private source review'})).toHaveCount(2)
 })
 test('latest failure stays by the prompt without scrolling or automatically repeating effects',async({page})=>{
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'local',m:LOCAL})
  await page.keyboard.press(`${MOD}+j`)
  await page.getByRole('button',{name:'Home',exact:true}).click()
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Rewrite this page using clear language.');await input.press('Enter')
  const dock=term.getByRole('region',{name:'Task stopped'})
  await expect(dock).toBeVisible();await expect(dock).toContainText('no target page was selected')
  expect(fake.textAsked.length).toBe(0)
  const prompt=await input.boundingBox(),failure=await dock.boundingBox()
  expect(failure!.y+failure!.height).toBeLessThanOrEqual(prompt!.y)
  await dock.getByRole('button',{name:'Edit stopped task',exact:true}).click()
  await expect(input).toHaveValue('Rewrite this page using clear language.')
  expect(fake.textAsked.length).toBe(0)
 })

})
