import {test,expect,openApp,wsEval,MOD} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
import {readFile} from 'node:fs/promises'
const PORT=47495,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
test.describe('Guided Atlas transfer',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'atlas-facts-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  await openApp(page)
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','workspace'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-facts',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'private-facts-token',enabled:true,prompt:'Use observed sources only.',tools:['atlas_get','atlas_update','atlas_comment','atlas_create'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('atlas-facts-fixture')
  await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await expect(page.getByTestId('worker-model-settings')).toContainText(COPILOT);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})

 for(const provider of ['local','copilot','anthropic'] as const)for(const mode of ['comment','update'] as const)test(provider+': natural transfer chooses '+mode+' and keeps source/readback receipts',async({page},info)=>{
  let stored=false
  const schema=(name:string)=>({server:'atlas',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},body:{type:'string'},replaceBody:{type:'string'}},required:['ref'],additionalProperties:false}})
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment','atlas_update'].map(schema)}:r.name==='atlas_get'?{result:envelope({item:{ref:42,body:stored&&mode==='update'?'Confirmed decision':'Current source body'}})}:(stored=true,{result:envelope({ok:true,ref:42,id:'comment-1'})})
  const op=mode==='comment'?'atlas_comment':'atlas_update',args=mode==='comment'?{ref:42,body:'Confirmed decision'}:{ref:42,replaceBody:'Confirmed decision'}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get atlas_comment atlas_update'}},{name:'one_mcp_call',arguments:{server:'atlas',name:op,arguments:args}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_mcp_call',arguments:{server:'atlas',name:op,arguments:args}}]
  if(mode==='comment')calls.splice(1,0,{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_update',arguments:{ref:42,replaceBody:'Wrong mode'}}})
  let n=0;fake.onText=r=>{const call=calls[n++];return{model:r.model,text:call?'':'Ref: 42 processed; see the actual transfer receipt.',calls:call?[{id:'transfer-'+n,...call}]:[],inputTokens:200,outputTokens:40,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'transfer-'+i,name:c.name,input:c.arguments}]})),text('Ref: 42 processed; see the actual transfer receipt.')]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-transfer'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Bitte trage die getroffenen Entscheidungen in die betreffenden Atlas-Tickets ein.');await input.press('Enter')
  const dialog=page.getByRole('dialog',{name:'How should this go to Atlas?'});await expect(dialog).toBeVisible();expect(fake.textAsked).toHaveLength(0);expect(host?.requests??[]).toHaveLength(0);expect(fake.mcpAsked).toHaveLength(0)
  if(provider==='local'&&mode==='comment')for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(await dialog.locator('.modal__body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`transfer-choice-${theme}-${width}.png`),animations:'disabled'})}
  await dialog.getByRole('button',{name:mode==='comment'?/Add comments/:/Update existing content/}).click()
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  const summary=term.getByRole('region',{name:'Atlas transfer receipt'});await expect(summary).toContainText('1 writes accepted by Atlas');await expect(summary).toContainText(mode==='update'?'1 confirmed by read-back':'0 confirmed by read-back')
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(mode==='update'?['atlas_get','atlas_update','atlas_get']:['atlas_get','atlas_comment'])
  expect(JSON.stringify(host?.requests??fake.textAsked)).toContain('write was not executed')
  await expect(term.locator('.term-turn__task')).toHaveText('Bitte trage die getroffenen Entscheidungen in die betreffenden Atlas-Tickets ein.')
  if(provider==='local'&&mode==='update'){await term.getByRole('button',{name:'Show transfer receipt',exact:true}).click();await expect(summary).toBeFocused();await page.screenshot({path:info.outputPath('transfer-receipt.png'),animations:'disabled'})}
 })
 test('new-record choice creates once after reading context and shows verified target',async({page})=>{
  let created=false
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}},{server:'atlas',name:'atlas_create',inputSchema:{type:'object',properties:{title:{type:'string'},body:{type:'string'}},required:['title','body']}}]}:r.name==='atlas_create'?(created=true,{result:envelope({ok:true,ref:43})}):{result:envelope({item:{ref:r.arguments.ref,title:created&&r.arguments.ref===43?'Confirmed decision':'Source',body:created&&r.arguments.ref===43?'Confirmed content':'Existing project context'}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get atlas_create'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_create',arguments:{title:'Confirmed decision',body:'Confirmed content'}}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_create',arguments:{title:'Confirmed decision',body:'Confirmed content'}}}]
  let n=0;fake.onText=r=>{const call=calls[n++];return{model:r.model,text:call?'':'Ref: 43 created and read back.',calls:call?[{id:'create-'+n,...call}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Bitte nach Atlas übertragen.');await input.press('Enter');await page.getByRole('dialog',{name:'How should this go to Atlas?'}).getByRole('button',{name:/Create new records/}).click()
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});const summary=term.getByRole('region',{name:'Atlas transfer receipt'});await expect(summary).toContainText('1 writes accepted by Atlas');await expect(summary).toContainText('1 confirmed by read-back');await expect(summary).toContainText('Ref 43');expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_get','atlas_create','atlas_get'])
 })
 test('partial failure keeps accepted comments visible and never retries a write automatically',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment'].map(name=>({server:'atlas',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},body:{type:'string'}},required:['ref']}}))}:r.name==='atlas_get'?{result:envelope({item:{ref:r.arguments.ref,body:'Existing record body'}})}:r.arguments.ref===42?{result:envelope({ok:true,ref:42,id:'confirmed-comment'})}:{result:JSON.stringify({isError:true,content:[{type:'text',text:'Synthetic write failure. The outcome must be checked.'}]})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get atlas_comment'}},...[42,43].flatMap(ref=>[{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref}}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_comment',arguments:{ref,body:'Confirmed decision'}}}])]
  let n=0;fake.onText=r=>{const call=calls[n++];return{model:r.model,text:call?'':'One comment was accepted; the other transfer failed.',calls:call?[{id:'partial-'+n,...call}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Bitte nach Atlas übertragen.');await input.press('Enter');await page.getByRole('dialog',{name:'How should this go to Atlas?'}).getByRole('button',{name:/Add comments/}).click()
  await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:25000});const summary=term.getByRole('region',{name:'Atlas transfer receipt'});await expect(summary).toContainText('1 writes accepted by Atlas');await expect(summary).toContainText('Failed or not confirmed');await expect(summary).toContainText('not repeated automatically');expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_comment')).toHaveLength(2)
 })
 test('a clear polite comment request uses its stated mode without asking again',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment'].map(name=>({server:'atlas',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},body:{type:'string'}},required:['ref']}}))}:r.name==='atlas_get'?{result:envelope({item:{ref:42,body:'Current target'}})}:{result:envelope({ok:true,ref:42})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get atlas_comment'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_comment',arguments:{ref:42,body:'Confirmed decision'}}}]
  let n=0;fake.onText=r=>{const call=calls[n++];return{model:r.model,text:call?'':'Ref: 42 comment accepted.',calls:call?[{id:'clear-'+n,...call}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Kannst du die Entscheidung in Atlas kommentieren?');await input.press('Enter');await expect(page.getByRole('dialog',{name:'How should this go to Atlas?'})).toHaveCount(0);await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});await expect(term.getByRole('region',{name:'Atlas transfer receipt'})).toContainText('1 writes accepted by Atlas');expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_get','atlas_comment'])
 })
 test('cancel keeps the original request and executes nothing',async({page})=>{
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Kannst du das nach Atlas bringen?');await input.press('Enter');const dialog=page.getByRole('dialog',{name:'How should this go to Atlas?'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(input).toHaveValue('Kannst du das nach Atlas bringen?');expect(fake.textAsked).toHaveLength(0);expect(fake.mcpAsked).toHaveLength(0)
 })
})
