import {test,expect,openApp,wsEval,createPage,gotoPage,doc,para,MOD} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {mockClaudeScript,text} from './helpers/providers'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47489,URL='https://example.org/ears/',QUOTE='When a trigger occurs, the system shall provide the required response.'
const good=`## EARS applied to AICM-2065\n\nDraft for human review; not an approved specification.\n\n### Rule\nEvent requirements name the trigger, system and required response.\n\n### Concrete requirement\nWhen a measurement starts, the logger shall record its start time.\n\n### Acceptance check\nStart a measurement; check that its original start timestamp is recorded. Timestamp precision is open.\n\n### Status\nExisting implementation remains not merged and not verified.\n\n[Source](${URL})`
const result=(markdown:string,quote=QUOTE)=>JSON.stringify({markdown,source_quotes:[{url:URL,quote}],requirements:markdown===good?[{statement:'When a measurement starts, the logger shall record its start time.',target_quote:'AICM-2065: When a measurement starts the logger records its start time.',acceptance_check:'Start a measurement; check that its original start timestamp is recorded.'}]:[]})
test.describe('Source-grounded existing-page rewrite',()=>{
 test.skip(process.env.E2E_ROOT!=='1','URL fetch uses the real root-server transport; run with E2E_ROOT=1.')
 test.describe.configure({mode:'serial'})
 let fake:FakeWorker,target:string,fetches:number
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.5',name:'grounded-rewrite-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN];fake.textModels=[{provider:'local',model:'atlas-flow:latest',context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:'auto',context:32768,chat:true,maxOutput:8192}]
  await page.route('**/api/config',r=>r.fulfill({json:{version:'fixture',signup:{mode:'open',domains:[]},max_upload_mb:20,dev_mode:false,source_url:'',schema_min:1,supports:['ai','providers'],coding_relay:false}}))
  await page.route('**/api/session',r=>r.fulfill({json:{user:null,workspaces:[]}}))
  await page.route('**/api/workspaces/grounded-fixture/model-hosts',r=>r.fulfill({json:{hosts:[]}}))
  await openApp(page);await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','workspace'];s.setWorkspaceAI({policy:{restricted:[],providers:{local:{allow},copilot:{allow}}}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}}})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter');await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('grounded-rewrite-fixture');await page.keyboard.press('Escape')
  target=await createPage(page,{title:'CNSx grounded rewrite target',content:doc(para('AICM-2065: When a measurement starts the logger records its start time. Implementation not merged and not verified.'))});await gotoPage(page,target)
  await page.evaluate(()=>(window as any).__oneCloud.set({active:{kind:'cloud',id:'grounded-fixture'},available:true,status:'online',readOnly:false,role:'owner',user:{id:'lead',name:'Test Lead',email:'lead@example.org'},workspaces:[{id:'grounded-fixture',name:'Grounded task fixture',role:'owner',icon:null}]}))
  await page.evaluate(()=>(window as any).__one.workspace.setState({epoch:'cloud:grounded-fixture'}))
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/Coding worker/}).click();await expect(page.getByTestId('coding-conn')).toContainText('grounded-rewrite-fixture');await page.keyboard.press('Escape')
  fetches=0;await page.route('**/api/workspaces/grounded-fixture/sources/preview',async route=>{fetches++;expect(route.request().postDataJSON()).toEqual({url:URL});await route.fulfill({json:{url:URL,mime:'text/html',text:`<html><title>EARS source</title><main><h1>EARS notation</h1><p>${QUOTE}</p><p>External references do not approve project requirements.</p></main></html>`,fetchedAt:new Date().toISOString(),sha256:'synthetic-bytes-hash',size:300}})})
 })
 test.afterEach(async()=>fake.close())
 for(const provider of ['local','copilot','anthropic'] as const)test(`${provider}: reads actual source and pinned page, repairs a flat draft once and stages only the original-page edit`,async({page},info)=>{
  let calls=0;fake.onText=r=>{expect(r.tools??[]).toHaveLength(0);expect(JSON.stringify(r.messages)).toContain(QUOTE);expect(JSON.stringify(r.messages)).toContain('AICM-2065');return {model:r.model,text:result(calls++===0?'EARS has many benefits.\n[Source]('+URL+')':good),inputTokens:200,outputTokens:100,usd:0}}
  const native=provider==='anthropic'?await mockClaudeScript(page,[text(result('EARS has many benefits.\n[Source]('+URL+')')),text(result(good))]):null
  if(native)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-grounded'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?'atlas-flow:latest':provider==='copilot'?'auto':DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Rewrite this page using the EARS description at '+URL);await input.press('Enter')
  await expect(term.locator('.term-answer')).toContainText('original page rewrite is staged',{timeout:25000})
  expect(fetches).toBe(1);expect(native?.requests.length??fake.textAsked.length).toBe(2);expect(fake.mcpAsked).toHaveLength(0)
  await expect(term.locator('.term-step[data-tool="read_requested_source"]')).toContainText('EARS source')
  await expect(term.locator('.term-step[data-tool="edit_page"]')).toHaveCount(1);await expect(term.locator('#term-review-title')).toHaveText('1 proposed change')
  expect(await wsEval(page,(s,id)=>s.pages[id].plain,target)).toContain('not merged and not verified')
  expect(await wsEval(page,s=>Object.values(s.pages).some((p:any)=>p.title==='EARS guide'))).toBe(false)
  await expect(term.getByRole('region',{name:'Compiled task'})).toContainText('Ready for review')
  await term.screenshot({path:info.outputPath('grounded-draft.png')})
 })
 test('a failed URL read stops before inference and stages no remembered substitute',async({page,errors})=>{
  errors.allow(/502|Failed to load resource/)
  await page.unroute('**/api/workspaces/grounded-fixture/sources/preview');await page.route('**/api/workspaces/grounded-fixture/sources/preview',r=>r.fulfill({status:502,json:{error:{code:'source_fetch_failed',message:'The selected source could not be read.'}}}))
  await page.evaluate(async()=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:'atlas-flow:latest'}]));await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Rewrite this page using EARS at '+URL);await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:20000});expect(fake.textAsked).toHaveLength(0);await expect(term.locator('.term-step[data-tool="edit_page"]')).toHaveCount(0)
 })
 test('a repeated invalid source quote produces a failure after two drafts, never a staged edit',async({page})=>{
  fake.onText=r=>({model:r.model,text:result(good,'This invented quotation never occurred in the source.'),inputTokens:200,outputTokens:100,usd:0});await page.evaluate(async()=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:'atlas-flow:latest'}]));await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Rewrite this page using EARS at '+URL);await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:20000});expect(fake.textAsked).toHaveLength(2);expect(fetches).toBe(1);await expect(term.getByRole('region',{name:'Compiled task'})).toContainText('Blocked');await expect(term.locator('.term-step[data-tool="edit_page"]')).toHaveCount(0)
 })
 test('a concurrent target edit blocks the stale draft before staging',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve})
  fake.onText=async r=>{await held;return {model:r.model,text:result(good),inputTokens:200,outputTokens:100,usd:0}}
  await page.evaluate(async()=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:'atlas-flow:latest'}]));await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Rewrite this page using EARS at '+URL);await input.press('Enter');await expect.poll(()=>fake.textAsked.length).toBe(1)
  await wsEval(page,(s,id)=>s.setContent(id,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A teammate changed the actual requirement during drafting.'}]}]},'e2e'),target)
  release();await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:20000});await expect(term.locator('.term-step[data-tool="edit_page"][data-state="staged"]')).toHaveCount(0)
  expect(await wsEval(page,(s,id)=>s.pages[id].plain,target)).toContain('teammate changed');await expect(term.getByRole('region',{name:'Compiled task'})).toContainText('Blocked')
 })

})
