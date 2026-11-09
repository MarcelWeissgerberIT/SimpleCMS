import {test,expect,openApp,wsEval,MOD,createPage,gotoPage,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47518,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
test.describe('MCP read argument correction',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'atlas-facts-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  await openApp(page)
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','workspace'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-facts',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'private-facts-token',enabled:true,prompt:'Use observed sources only.',tools:['atlas_code_repos','atlas_code_search','atlas_code_versions','atlas_update'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('atlas-facts-fixture')
  await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await expect(page.getByTestId('worker-model-settings')).toContainText(COPILOT);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})


 const searchSchema={type:'object',properties:{repo:{type:'string'},snapshot:{type:'string'},query:{type:'string'}},required:['repo','snapshot','query'],additionalProperties:false}
 const call=(id:string,name:string,input:Record<string,unknown>)=>({blocks:[{type:'tool_use' as const,id,name,input}]})
 for(const native of [false,true])test('inline Claude corrects malformed '+(native?'native':'wrapper')+' code search without sending invalid arguments',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_code_search',inputSchema:searchSchema}]}:{result:envelope(r.name==='atlas_code_repos'?{items:[{id:'repo-icm',modelProcessing:true}],next:null}:{hits:[{path:'Parameters.cs',line:10,text:'BlowoutVolume'}],next:null})}
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  const args={repo:'repo-icm',snapshot:'snapshot-icm',query:'BlowoutVolume'}
  const invoke=(id:string,input:Record<string,unknown>)=>call(id,native?'one_remote_1':'one_mcp_call',native?input:{server:'atlas',name:'atlas_code_search',arguments:input})
  const host=await mockClaudeScript(page,[call('discover','one_mcp_search',{query:'atlas_code_search'}),invoke('invalid',{version:'snapshot-icm',query:'BlowoutVolume'}),invoke('corrected',args),text('The search found BlowoutVolume in Parameters.cs, line 10; this is a search hit, not a verified citation.')])
  const result=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Search Atlas code for BlowoutVolume in repository repo-icm, snapshot snapshot-icm. Read only.',mcp:'free',route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
  expect(result).toMatchObject({ok:true})
  expect(host.requests).toHaveLength(4)
  const correction=JSON.stringify(host.requests[2])
  expect(correction).toContain('oneNotExecuted')
  expect(correction).toContain('missing')
  expect(correction).toContain('inputSchema')
  expect(correction).toContain('unsupported arguments')
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_code_search').map(r=>r.arguments)).toEqual([args])
 })
 test('repeated malformed reads stop after two corrections without any dispatch',async({page})=>{
  fake.onModelMcp=()=>({tools:[{server:'atlas',name:'atlas_code_search',inputSchema:searchSchema}]})
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  const host=await mockClaudeScript(page,[call('discover','one_mcp_search',{query:'atlas_code_search'}),...['bad1','bad2','bad3'].map(id=>call(id,'one_remote_1',{version:'snapshot-icm',query:'BlowoutVolume'}))])
  const result=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Search Atlas code for BlowoutVolume. Read only.',mcp:'free',route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
  expect(result).toMatchObject({ok:false,code:'mcp'})
  expect(host.requests).toHaveLength(4)
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(0)
 })
 test('invalid writes stop without offering model retry',async({page})=>{
  fake.onModelMcp=()=>({tools:[{server:'atlas',name:'atlas_update',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref'],additionalProperties:false}}]})
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  const host=await mockClaudeScript(page,[call('discover','one_mcp_search',{query:'atlas_update'}),call('bad-write','one_remote_1',{version:'42'})])
  const result=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Update the requested Atlas record 42.',mcp:'free',route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
  expect(result).toMatchObject({ok:false})
  expect(host.requests).toHaveLength(2)
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(0)
 })
})
