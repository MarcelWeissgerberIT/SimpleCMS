import {test,expect,openApp,wsEval,MOD} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {mockClaudeScript,text as claudeText} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
const PORT=47441,MODEL='atlas-flow:latest',schema={type:'object',properties:{ref:{type:'integer'}},required:['ref']}
test.describe('Saved executable compiled programs',()=>{
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'program-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN];fake.textModels=[{provider:'local',model:MODEL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:'gpt-6.1-sol',context:65536,chat:true,maxOutput:8192}]
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:schema}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify({item:{ref:42,body:'Fresh project source. Audience remains open.'}})}]})}
  fake.onText=r=>({model:r.model,text:'Fresh source briefing for the current audience.',inputTokens:200,outputTokens:40,usd:0})
  await openApp(page)
  await wsEval(page,s=>{s.setWorkspaceAI({policy:{providers:{local:{allow:['public','structure','selection','page','rows','workspace']},copilot:{allow:['public','structure','selection','page','rows','workspace']}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-fixture',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'fixture-private-token',enabled:true,tools:['atlas_get'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter');await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('program-fixture');await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(MODEL);await page.keyboard.press('Escape')
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'local',m:MODEL});await page.keyboard.press(`${MOD}+j`)
 })
 test.afterEach(async()=>{await fake?.close()})
 test('same saved artifact survives reload, refreshes sources and decisions, rejects changed MCP schema before effects',async({page},info)=>{
  const term=page.getByRole('region',{name:'AI terminal'})
  await term.getByRole('button',{name:'Saved compiled programs'}).click();let dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'New program',exact:true}).click()
  const editor=dialog.getByRole('textbox',{name:'Executable JSON definition'}),p=JSON.parse(await editor.inputValue()),pageId=await page.evaluate(()=>Object.keys((window as any).__one.workspace.getState().pages)[0])
  p.goal='Read ONE and Atlas fresh, then ask the audience and summarize.';p.parameters.page_id.default=pageId;p.parameters.ref={schema:{type:'integer'},default:42}
  p.steps.splice(1,0,{id:'atlas',kind:'tool',server:'atlas',endpoint:'https://atlas.example.org/mcp',tool:'atlas_get',schema,effect:'read',args:{object:{ref:{input:'ref'}}}},{id:'audience',kind:'decision',question:'Who is this briefing for?',neededFor:'Generate the final briefing'})
  p.steps.at(-1).context={object:{one:{result:'page',path:[]},atlas:{result:'atlas',path:[]},audience:{result:'audience',path:[]}}}
  await editor.fill(JSON.stringify(p,null,2));await dialog.getByLabel('Name',{exact:true}).fill('Fresh compiled briefing');await dialog.getByRole('button',{name:'Compile and save'}).click();await expect(dialog.getByRole('button',{name:'Run this version'})).toBeVisible()
  for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:info.outputPath(`program-${theme}-${width}.png`),animations:'disabled'});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)}
  await page.setViewportSize({width:1440,height:900})
  for(const audience of ['AUDIENCE_FIRST','AUDIENCE_SECOND']){
   await dialog.getByRole('button',{name:'Run this version'}).click();const card=term.getByRole('region',{name:'Compiled task'}).last();await expect(card.getByRole('heading',{name:'Your decision is needed'})).toBeVisible({timeout:25000});await expect(card.getByText('Who is this briefing for?',{exact:true})).toBeVisible();await card.getByRole('textbox').fill(audience);await card.getByRole('button',{name:'Bind answer and continue'}).click();await expect(term.locator('.term-answer').last()).toContainText('Fresh source briefing',{timeout:25000});await expect(term).toContainText('Program run receipt saved')
   await term.getByRole('button',{name:'Saved compiled programs'}).click();dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:/Fresh compiled briefing/}).click()
  }
  await dialog.getByRole('button',{name:'Run receipts',exact:true}).click();const receipts=await dialog.locator('.programs__history pre').allTextContents(),runs=receipts.map(r=>JSON.parse(r));expect(runs).toHaveLength(2);expect(runs[0].hash).toBe(runs[1].hash);expect(runs[0].id).not.toBe(runs[1].id);expect(runs.every(r=>r.status==='done'&&r.steps.length===4)).toBe(true)
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(2);const wire=JSON.stringify(fake.textAsked.at(-1));expect(wire).toContain('AUDIENCE_SECOND');expect(wire).not.toContain('AUDIENCE_FIRST');expect(fake.textAsked.every(r=>!r.tools?.length)).toBe(true)
  await page.reload();await expect(page.getByRole('main')).toBeVisible();await page.keyboard.press(`${MOD}+j`);await term.getByRole('button',{name:'Saved compiled programs'}).click();dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:/Fresh compiled briefing/}).click();await expect(dialog.locator('code')).toContainText(runs[0].hash)
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{...schema,properties:{ref:{type:'string'}}}}]}:{result:'{"isError":true}'}
  await dialog.getByRole('button',{name:'Run this version'}).click();await expect(term).toContainText('MCP tool schema changed or unavailable',{timeout:25000});expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(2)
 })
 test('capture is reviewable; a fixed generation step can stage fresh content without reusing the old answer',async({page})=>{
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'});let round=0
  const calls=[{name:'one_workspace_search',arguments:{query:'search_pages'}},{name:'one_workspace_call',arguments:{name:'search_pages',arguments:{query:'Welcome'}}},{name:'one_workspace_search',arguments:{query:'create_page'}},{name:'one_workspace_call',arguments:{name:'create_page',arguments:{title:'Old adaptive draft',markdown:'OLD GENERATED CONTENT'}}}]
  fake.onText=r=>{const c=calls[round++];return {model:r.model,text:c?'':'Draft prepared.',calls:c?[{id:'c'+round,...c}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await input.fill('Read ONE and prepare a page proposal.');await input.press('Enter');await expect(term.locator('.term-answer')).toContainText('Draft prepared.',{timeout:25000});const card=term.getByRole('region',{name:'Compiled task'});await card.locator('summary').first().click();await card.getByRole('button',{name:'Save as executable program'}).click()
  const dialog=page.getByRole('dialog',{name:'Saved compiled programs'}),editor=dialog.getByRole('textbox',{name:'Executable JSON definition'}),p=JSON.parse(await editor.inputValue())
  expect(JSON.stringify(p)).not.toContain('OLD GENERATED CONTENT');const write=p.steps.find((s:any)=>s.tool==='create_page');expect(write).toBeTruthy();expect(p.parameters.args_2.default).toBeUndefined();delete p.parameters.args_2
  p.steps.splice(p.steps.indexOf(write),0,{id:'fresh_draft',kind:'generate',instruction:'Draft a title and markdown using only the current source.',context:{result:p.steps[0].id,path:[]},schema:{type:'object',properties:{title:{type:'string'},markdown:{type:'string'}},required:['title','markdown'],additionalProperties:false}})
  write.args={object:{title:{result:'fresh_draft',path:['title']},markdown:{result:'fresh_draft',path:['markdown']}}}
  await editor.fill(JSON.stringify(p,null,2));await dialog.getByLabel('Name',{exact:true}).fill('Fresh staged proposal');await dialog.getByRole('button',{name:'Compile and save'}).click()
  await expect(dialog.getByRole('button',{name:'Run this version'})).toBeDisabled();await dialog.getByRole('checkbox').check()
  fake.onText=r=>({model:r.model,text:r.schema?JSON.stringify({title:'Fresh compiled draft',markdown:'FRESH COMPILED CONTENT'}):'Fresh proposal staged.',inputTokens:200,outputTokens:40,usd:0})
  await dialog.getByRole('button',{name:'Run this version'}).click();await expect(term.locator('.term-answer').last()).toContainText('Fresh proposal staged.',{timeout:25000});await expect(term).toContainText('Program run receipt saved');expect(fake.textAsked.at(-2).schema).toBeTruthy();expect(fake.textAsked.slice(round).every(r=>!r.tools?.length)).toBe(true)
  const staged=await page.evaluate(()=>(window as any).__oneTerm.state.getState().changes);expect(staged.some((s:any)=>s.title==='Fresh compiled draft'&&s.status==='pending')).toBe(true);expect(await page.evaluate(()=>Object.values((window as any).__one.workspace.getState().pages).some((p:any)=>p.title==='Fresh compiled draft'))).toBe(false)
 })

 for(const provider of ['copilot','anthropic']as const)test(provider+': saved ONE program uses a tool-free bounded model step',async({page})=>{
  const host=provider==='anthropic'?await mockClaudeScript(page,[claudeText('Bounded program answer.')]):null
  if(provider==='anthropic')await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='copilot'?'gpt-6.1-sol':DEFAULT_CLAUDE_MODEL})
  fake.onText=r=>({model:r.model,text:'Bounded program answer.',inputTokens:200,outputTokens:40,usd:0})
  const term=page.getByRole('region',{name:'AI terminal'});await term.getByRole('button',{name:'Saved compiled programs'}).click();const dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'New program',exact:true}).click();const editor=dialog.getByRole('textbox',{name:'Executable JSON definition'}),p=JSON.parse(await editor.inputValue());p.parameters.page_id.default=await page.evaluate(()=>Object.keys((window as any).__one.workspace.getState().pages)[0]);await editor.fill(JSON.stringify(p,null,2));await dialog.getByLabel('Name',{exact:true}).fill('Bounded '+provider);await dialog.getByRole('button',{name:'Compile and save'}).click();await dialog.getByRole('button',{name:'Run this version'}).click();await expect(term.locator('.term-answer').last()).toContainText('Bounded program answer.',{timeout:25000});await expect(term).toContainText('Program run receipt saved');expect(fake.mcpAsked).toHaveLength(0)
  const wire=host?host.requests.map(r=>r.body):fake.textAsked;expect(wire).toHaveLength(1);expect(wire.every(r=>!r.tools?.length)).toBe(true);expect(await page.evaluate(()=>(window as any).__oneTerm.state.getState().usage.requests)).toBe(1)
 })

 test('a large fresh Atlas response reaches fixed generation as source text, without another model tool or old result IDs',async({page})=>{
  const body='RECORDED SOURCE START '+('Bounded current source. '.repeat(260))+' RECORDED SOURCE END'
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:schema}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify({item:{ref:42,body}})}]})}
  const term=page.getByRole('region',{name:'AI terminal'});await term.getByRole('button',{name:'Saved compiled programs'}).click();const dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'New program',exact:true}).click()
  const editor=dialog.getByRole('textbox',{name:'Executable JSON definition'}),p=JSON.parse(await editor.inputValue())
  p.goal='Summarize the current Atlas source without making decisions.';p.parameters={ref:{schema:{type:'integer'},default:42}};p.steps=[{id:'atlas',kind:'tool',server:'atlas',endpoint:'https://atlas.example.org/mcp',tool:'atlas_get',schema,effect:'read',args:{object:{ref:{input:'ref'}}}},{id:'answer',kind:'generate',instruction:'Use only the fresh Atlas source.',context:{result:'atlas',path:[]}}];p.output={result:'answer',path:[]}
  await editor.fill(JSON.stringify(p,null,2));await dialog.getByLabel('Name',{exact:true}).fill('Large fresh source');await dialog.getByRole('button',{name:'Compile and save'}).click();await dialog.getByRole('button',{name:'Run this version'}).click()
  await expect(term.locator('.term-answer').last()).toContainText('Fresh source briefing',{timeout:25000});await expect(term).toContainText('Program run receipt saved')
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1);expect(fake.textAsked).toHaveLength(1);expect(fake.textAsked[0].tools??[]).toHaveLength(0)
  const wire=JSON.stringify(fake.textAsked[0]);expect(wire).toContain('RECORDED SOURCE START');expect(wire).toContain('RECORDED SOURCE END');expect(wire).not.toContain('mcp-result-')
 })

})
