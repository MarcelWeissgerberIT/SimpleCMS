import {test,expect,openApp,wsEval,MOD} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47434,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
test.describe('Atlas source facts in the real browser-owned harness',()=>{
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
 for(const provider of ['local','copilot'] as const){
  test(`${provider}: wrong count is corrected once without executing another tool`,async({page})=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_record_kinds',inputSchema:{type:'object',properties:{}}}]}:{result:envelope({kinds:Array.from({length:36},(_,i)=>({name:'kind-'+i}))})}
   let round=0;fake.onText=r=>{const n=round++;return {model:r.model,text:n===2?'29 Record-Kinds erstellt.':n===3?'36 Record-Kinds gelesen.':'',...(n<2?{calls:[n===0?{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_record_kinds'}}:{id:'read',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_record_kinds',arguments:{}}}]}:{}),inputTokens:200,outputTokens:40,usd:0}}
   const answer=await page.evaluate(async route=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'List the actual Atlas record kinds.',mcp:'fixed',route}),{p:provider,m:provider==='local'?LOCAL:COPILOT})
   expect(answer).toEqual({ok:true,text:'36 Record-Kinds gelesen.'});expect(fake.textAsked).toHaveLength(4)
   expect(fake.textAsked[3].tools??[]).toEqual([]);expect(JSON.stringify(fake.textAsked[3].messages)).toContain('only fact-correction attempt')
   expect(JSON.stringify(fake.textAsked[3].messages)).toContain('29 Record-Kinds erstellt.')
   expect(fake.mcpAsked.map(r=>r.action)).toEqual(['search','call']);expect(JSON.stringify(fake.textAsked)).not.toContain('private-facts-token')
  })
  test(`${provider}: stubborn invented refs are replaced by host facts; repair cannot execute tools`,async({page},info)=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_record_kinds',inputSchema:{type:'object',properties:{}}}]}:{result:envelope({kinds:Array.from({length:36},(_,i)=>({name:'kind-'+i}))})}
   let round=0;fake.onText=r=>{const n=round++;return {model:r.model,text:n>=2?'Ref-ID: 1234567890.':'',calls:n===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_record_kinds'}}]:n===1?[{id:'read',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_record_kinds',arguments:{}}}]:[],inputTokens:200,outputTokens:40,usd:0}}
   await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:COPILOT})
   await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await input.fill('List the Atlas record kinds.');await input.press('Enter')
   await expect(term.locator('.term-answer')).toContainText('could not be confirmed',{timeout:20000});await expect(term.locator('.term-answer')).not.toContainText('1234567890')
   expect(fake.textAsked).toHaveLength(4);expect(fake.textAsked[3].tools??[]).toEqual([]);expect(fake.mcpAsked.map(r=>r.action)).toEqual(['search','call'])
   const facts=term.locator('.atlas-facts');await expect(facts).toHaveCount(1);await facts.locator('summary').click();await expect(facts).toContainText('Record kinds: 36')
   for(const width of [1440,390]){await page.setViewportSize({width,height:900});expect(await facts.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`atlas-facts-${provider}-${width}.png`),animations:'disabled'})}
  })
 }
 test('target must be observed before writing; ONE reads back the actual changed fields',async({page})=>{
  let written=false
  fake.onModelMcp=r=>{
   if(r.action==='search')return{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}},{server:'atlas',name:'atlas_update',inputSchema:{type:'object',properties:{ref:{type:'integer'},replaceBody:{type:'string'}},required:['ref','replaceBody']}}]}
   if(r.name==='atlas_update'){written=true;return{result:envelope({ok:true,ref:42})}}
   return{result:envelope({item:{ref:42,body:written?'Expected':'Before'}})}
  }
  let round=0;fake.onText=r=>{const n=round++,call=n===0?{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_get atlas_update'}}:n===1||n===3?{id:'write-'+n,name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_update',arguments:{ref:42,replaceBody:'Expected'}}}:n===2?{id:'read',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}}:null;return{model:r.model,text:call?'':'Ref: 42 aktualisiert.',...(call?{calls:[call]}:{}),inputTokens:200,outputTokens:40,usd:0}}
  const result=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas ref 42 and replace its body with Expected.',mcp:'fixed',route:{p:'local',m:model}}),LOCAL)
  expect(result).toEqual({ok:true,text:'Ref: 42 aktualisiert.'})
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_get','atlas_update','atlas_get'])
  expect(fake.textAsked).toHaveLength(5);expect(JSON.stringify(fake.textAsked[2].messages)).toContain('NOT executed');expect(JSON.stringify(fake.textAsked[4].messages)).toContain('read_back_matches')
 })
 for(const terminal of [false,true])test(`Claude ${terminal?'terminal':'completion'}: check before display and correct without MCP or write tools`,async({page})=>{
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  const source=JSON.stringify({kinds:Array.from({length:36},(_,i)=>({name:'kind-'+i}))})
  const host=await mockClaudeScript(page,[{blocks:[{type:'mcp_tool_use',id:'read-kinds',server:'atlas',name:'atlas_record_kinds',input:{}},{type:'mcp_tool_result',id:'read-kinds',text:source},...text('29 Record-Kinds erstellt.').blocks]},text('36 Record-Kinds gelesen.')])
  if(terminal){
   await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'anthropic',m:model}]),DEFAULT_CLAUDE_MODEL)
   await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await input.fill('List the Atlas record kinds.');await input.press('Enter');await expect(term.locator('.term-answer')).toContainText('36 Record-Kinds gelesen.');await expect(term).not.toContainText('29 Record-Kinds erstellt.')
   await expect(term.locator('.atlas-facts')).toHaveCount(1)
  }else{
   const answer=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'List the actual Atlas record kinds.',mcp:'fixed',route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
   expect(answer).toEqual({ok:true,text:'36 Record-Kinds gelesen.'})
  }
  expect(host.requests).toHaveLength(2);expect(host.requests[1].body.tools??[]).toEqual([]);expect(host.requests[1].body.mcp_servers??[]).toEqual([])
  expect(JSON.stringify(host.requests[1].body)).not.toContain('private-facts-token')
 })
 test('Claude structured fields with an invented Atlas ref are withheld',async({page})=>{
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  const host=await mockClaudeScript(page,[{blocks:[{type:'mcp_tool_use',id:'read',server:'atlas',name:'atlas_get',input:{ref:42}},{type:'mcp_tool_result',id:'read',text:JSON.stringify({item:{ref:42,body:'Approved fixture'}})},...text('{"answer":"Ref: 999"}').blocks]}])
  const answer=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas ref 42.',structured:true,pick:{server:'atlas',reads:['atlas_get']},route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
  expect(answer).toMatchObject({ok:false,detail:'features.ai.local.unverifiedFacts'});expect(host.requests).toHaveLength(1)
 })
})
