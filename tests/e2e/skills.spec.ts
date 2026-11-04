import {readFile} from 'node:fs/promises'
import {test,expect,openApp,wsEval,MOD,createPage,gotoPage,editorOf,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47501,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
test.describe('Instruction skills',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'skills-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  await openApp(page)
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','files','workspace','people','transcript'];const personal=['private','mail','memory','mcp'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({aiApiKey:'sk-ant-e2e-skills',ai:{allow:{local:personal,copilot:personal}}})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter');await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('skills-fixture');await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})
 for(const provider of ['local','copilot','anthropic'] as const)test(provider+': selected versions reach the model and receipt without granting effects',async({page},info)=>{
  const route={p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL};await page.evaluate(async r=>(await (window as any).__oneAI.rules()).setDeviceDefault([r]),route)
  fake.onText=r=>({model:r.model,text:'A concise proposal, ready for human review.',calls:[],inputTokens:200,outputTokens:40,usd:0})
  const host=provider==='anthropic'?await mockClaudeScript(page,[text('A concise proposal, ready for human review.'),text('A concise proposal, ready for human review.')]):null
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'})
  await term.getByRole('button',{name:'AI skills',exact:true}).click();const library=page.getByRole('dialog',{name:'AI skills'})
  await library.getByLabel('Skill name',{exact:true}).fill('clear-writing');await library.getByLabel('When to use it',{exact:true}).fill('For concise internal documents');await library.getByLabel('Instructions',{exact:true}).fill('STYLE_V1: separate verified facts from assumptions. Never run scripts automatically.')
  await library.getByRole('button',{name:'Save new version',exact:true}).click();await expect(library).toContainText('Version saved')
  if(provider==='anthropic')for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s:any,theme:any)=>s.updateSettings({theme}),theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);expect(await library.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`skills-${theme}-${width}.png`),animations:'disabled'})}
  await library.getByRole('button',{name:'Add to request',exact:true}).click();const input=term.getByRole('textbox',{name:'Task for the agent'});await expect(input).toHaveValue(/\$clear-writing@1/);expect(host?.requests??fake.textAsked).toHaveLength(0)
  await input.fill('Nur in ONE: Formuliere einen kurzen Vorschlag. $clear-writing@1');await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:20000})
  const first=JSON.stringify((host?.requests??fake.textAsked)[0]);expect(first).toContain('STYLE_V1');expect(first).toContain('SELECTED_SKILLS_SNAPSHOT');expect(first).toContain('not new tasks');expect(fake.mcpAsked).toHaveLength(0)
  const card=term.getByRole('region',{name:'Compiled task'});await card.locator('summary').first().click();await expect(card).toContainText('clear-writing V1')
  await term.getByRole('button',{name:'AI skills',exact:true}).click();await library.getByRole('button',{name:/clear-writing/}).click();await library.getByLabel('Instructions',{exact:true}).fill('STYLE_V2: later guidance must not replace pinned version one.');await library.getByRole('button',{name:'Save new version',exact:true}).click();await expect(library.getByLabel('Version',{exact:true})).toHaveValue('2');await page.keyboard.press('Escape')
  await term.getByRole('button',{name:'New task',exact:true}).click();await input.fill('Nur in ONE: Noch ein Vorschlag. $clear-writing@1');await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:20000});const second=JSON.stringify((host?.requests??fake.textAsked)[1]);expect(second).toContain('STYLE_V1');expect(second).not.toContain('STYLE_V2')
  await input.fill('Nur in ONE: Ein Vorschlag. $clear-writing@99');await input.press('Enter');await expect(term.getByRole('region',{name:'Task stopped'})).toContainText('requested skill version');expect(host?.requests??fake.textAsked).toHaveLength(2)
 })
 test('SKILL.md imports inert instructions, exports Markdown, and stays private to its scope',async({page})=>{
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'});await term.getByRole('button',{name:'AI skills',exact:true}).click();const library=page.getByRole('dialog',{name:'AI skills'})
  await library.getByLabel('Import SKILL.md',{exact:true}).setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:Buffer.from('---\nname: imported-guide\ndescription: Review existing material\nallowed-tools: shell\n---\n\nUse sources carefully. A relative scripts/run.sh link grants no execution.\n')})
  await expect(library).toContainText('Imported as an editable draft');expect(fake.textAsked).toHaveLength(0);await library.getByRole('button',{name:'Save new version',exact:true}).click();await expect(library.getByLabel('Version',{exact:true})).toHaveValue('1')
  await library.getByLabel('Instructions',{exact:true}).fill('Portable second version. No automatic execution.');await library.getByRole('button',{name:'Save new version',exact:true}).click();
  const download=page.waitForEvent('download');await library.getByRole('button',{name:'Export SKILL.md',exact:true}).click();const exported=await download;expect(exported.suggestedFilename()).toBe('imported-guide-v2-SKILL.md');const portable=await readFile((await exported.path())!)
  await page.evaluate(()=>(window as any).__one.workspace.setState({epoch:'another-skill-scope'}));await expect(library).toHaveCount(0);await term.getByRole('button',{name:'AI skills',exact:true}).click();await expect(library).toContainText('No skills yet');await library.getByLabel('Import SKILL.md',{exact:true}).setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:portable});await library.getByRole('button',{name:'Save new version',exact:true}).click();await expect(library.getByLabel('Version',{exact:true})).toHaveValue('2');expect(fake.mcpAsked).toHaveLength(0)
 })
 test('a context failure offers a fresh source-backed continuation without replaying an accepted write',async({page,errors},info)=>{
  errors.allow(/Failed to load resource: the server responded with a status of 400/u)
  await page.evaluate(async m=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'anthropic',m}]),DEFAULT_CLAUDE_MODEL)
  await wsEval(page,s=>s.updateSettings({mcpServers:[{id:'resume-fixture',name:'knowledge',codeword:'atlas',url:'https://atlas.example.org/mcp',scope:'free',token:'private-resume-token',enabled:true,prompt:'Use observed sources.',tools:['atlas_get','atlas_comment'],checkedAt:Date.now()}]}))
  const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
  const schema=(name:string)=>({server:'knowledge',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},body:{type:'string'}},required:['ref'],additionalProperties:false}})
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment'].map(schema)}:r.name==='atlas_get'?{result:envelope({item:{ref:42,body:'Actual source body with verified context.'}})}:{result:envelope({ok:true,ref:42,id:'accepted-once'})}
  const tool=(id:string,name:string,input:unknown)=>({blocks:[{type:'tool_use' as const,id,name,input:input as any}]})
  const host=await mockClaudeScript(page,[tool('s','one_mcp_search',{query:'record read comment'}),tool('g','one_mcp_call',{server:'knowledge',name:'atlas_get',arguments:{ref:42}}),tool('w','one_mcp_call',{server:'knowledge',name:'atlas_comment',arguments:{ref:42,body:'Confirmed decision.'}}),{status:400,json:{type:'error',error:{type:'invalid_request_error',message:'prompt is too long: 210000 tokens > 200000 maximum'}}},tool('s2','one_mcp_search',{query:'record read'}),tool('g2','one_mcp_call',{server:'knowledge',name:'atlas_get',arguments:{ref:42}}),text('Analysis resumed from current source 42. The earlier comment was not repeated.')])
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('atlas:Kommentiere in Record 42 die bestätigte Entscheidung und erläutere das Ergebnis.');await input.press('Enter')
  const resume=term.getByRole('button',{name:'Continue with compact context',exact:true});await expect(resume).toBeVisible({timeout:25000});expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_comment')).toHaveLength(1)
  await resume.click();await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});const request=host.requests[4].body;expect(request.messages).toHaveLength(1);expect(JSON.stringify(request)).toContain('historical_host_checkpoint');expect(JSON.stringify(request)).toContain('accepted-once');expect(JSON.stringify(request)).toContain('Nur lesen');expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_comment')).toHaveLength(1);expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_get')).toHaveLength(2)
  await term.screenshot({path:info.outputPath('context-resumed.png'),animations:'disabled'})
 })
 test('an inline context failure can resume in the terminal with a fresh bounded request',async({page,errors})=>{
  errors.allow(/Failed to load resource: the server responded with a status of 400/u)
  await page.evaluate(async m=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'anthropic',m}]),DEFAULT_CLAUDE_MODEL)
  const id=await createPage(page,{title:'Bounded recovery source',content:doc(para('Verified source for the analysis.'),para(''))});await gotoPage(page,id)
  const host=await mockClaudeScript(page,[{status:400,json:{type:'error',error:{type:'invalid_request_error',message:'prompt is too long: 210000 tokens > 200000 maximum'}}},{blocks:[{type:'tool_use',id:'fresh',name:'read_page',input:{id}}]},text('Analysis continued using the current ONE page.')])
  const ed=editorOf(page,id);await ed.locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space');const ask=page.getByRole('dialog',{name:'Ask AI'});await ask.getByRole('textbox').first().fill('Nur in ONE: Analysiere diese Seite.');await page.locator('#ai-row-custom').click()
  await page.locator('#ai-row-compact-recovery').click();const term=page.getByRole('region',{name:'AI terminal'});await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  expect(host.requests[1].body.messages).toHaveLength(1);expect(JSON.stringify(host.requests[1].body)).toContain('historical_host_checkpoint');expect(JSON.stringify(host.requests[1].body)).toContain('Nur lesen')
 })
 test('inline selection can add a skill and data rules reject private skill contents before inference',async({page})=>{
  await page.evaluate(async m=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m}]),LOCAL)
  const id=await createPage(page,{title:'Skill source',content:doc(para('Source for the draft.'),para(''))});await gotoPage(page,id);const ed=editorOf(page,id);await ed.locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space');const ask=page.getByRole('dialog',{name:'Ask AI'})
  await ask.getByRole('button',{name:'AI skills',exact:true}).click();const library=page.getByRole('dialog',{name:'AI skills'});await library.getByLabel('Skill name',{exact:true}).fill('private-guide');await library.getByLabel('When to use it',{exact:true}).fill('Private writing');await library.getByLabel('Instructions',{exact:true}).fill('PRIVATE_GUIDANCE must never reach a disallowed model.');await library.getByRole('button',{name:'Save new version',exact:true}).click();await library.getByRole('button',{name:'Add to request',exact:true}).click();await expect(ask.getByRole('textbox').first()).toHaveValue(/\$private-guide@1/)
  await wsEval(page,s=>s.updateSettings({ai:{narrow:{local:['private'],copilot:['private'],anthropic:['private'],openrouter:['private']}}}));await ask.getByRole('textbox').first().fill('Formuliere einen Vorschlag. $private-guide@1');await page.locator('#ai-row-custom').click();await expect(ask).toContainText(/data rules|not allow/);expect(fake.textAsked).toHaveLength(0)
 })
})
