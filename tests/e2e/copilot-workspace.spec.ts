import { writeFile } from 'node:fs/promises'
import { test, expect, openApp, wsEval, createPage, gotoPage, doc, para, MOD } from './fixtures'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'

const PORT=47413,MODEL='claude-opus-5.5'
const ALL=['public','structure','selection','page','rows','files','workspace','people','transcript']
test.describe('Copilot across workspace features',()=>{
  test.describe.configure({mode:'serial'})
  let fake:FakeWorker
  test.beforeEach(async({page})=>{
    fake=await startFakeWorker(PORT,{worker:'1.25.0',name:'copilot-workspace-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true})
    fake.can=[...WORKER_CAN]
    fake.textModels=[{provider:'copilot',model:MODEL,context:32768,chat:true,maxOutput:8192}]
    await openApp(page)
    await wsEval(page,(s,allow)=>{s.setWorkspaceAI({policy:{providers:{copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{copilot:['mcp','memory']}}})},ALL)
    await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('tab',{name:/Coding worker/}).click()
    await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
    await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
    await expect(page.getByTestId('coding-conn')).toContainText('copilot-workspace-fixture')
    await page.getByRole('tab',{name:/AI$/}).click()
    await expect(page.getByTestId('worker-model-settings')).toContainText(MODEL)
    await page.keyboard.press('Escape')
  })
  test.afterEach(async()=>{await fake?.close()})
  test('structured actions and default rules use Copilot; older policy readers and unsupported pictures fail closed',async({page})=>{
    fake.onText=r=>({model:r.model,text:'{"answer":"Validated workspace answer"}',inputTokens:90,outputTokens:20,usd:null})
    const answer=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'setup.test',prompt:'Answer JSON',route:{p:'copilot',m:model},structured:true}),MODEL)
    expect(answer).toEqual({ok:true,text:'{"answer":"Validated workspace answer"}'})
    expect(fake.textAsked[0].schema).toMatchObject({type:'object'})
    const changed=await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'copilot',m:model}]),MODEL)
    expect(changed).toBe(true)
    expect(await page.evaluate(()=>(window as any).__oneAI.policyKnownAt(4))).toBe(false)
    const fail=await page.evaluate(model=>(window as any).__oneAI.precheck({purpose:'vision.image',sources:[{file:'upload'}],route:{p:'copilot',m:model}}),MODEL)
    expect(fail.ok).toBe(false);expect(fake.textAsked).toHaveLength(1)
  })
  test('terminal reads real page content and stages an append without changing the page automatically',async({page},info)=>{
    const id=await createPage(page,{title:'Copilot acceptance source',content:doc(para('Expected simulation result: 43.'))})
    await gotoPage(page,id)
    let round=0
    fake.onText=r=>{
      const calls=round++===0?[{id:'read-1',name:'read_page',arguments:{id}}]:round===2?[{id:'append-1',name:'append_to_page',arguments:{id,markdown:'## Reviewed\nSimulation result 43 confirmed.'}}]:[]
      return {model:r.model,text:calls.length?'':'Prepared the review for your approval.',calls,inputTokens:300,outputTokens:50,usd:null}
    }
    await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'copilot',m:model}]),MODEL)
    await page.keyboard.press(`${MOD}+j`)
    const term=page.getByRole('region',{name:'AI terminal'}),prompt=term.getByRole('textbox',{name:'Task for the agent'})
    await prompt.fill('Read this page and append a short review.');await prompt.press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Prepared the review',{timeout:20000})
    expect(fake.textAsked).toHaveLength(3)
    expect(JSON.stringify(fake.textAsked[1].messages)).toContain('Expected simulation result: 43')
    const content=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)
    expect(content).not.toContain('Simulation result 43 confirmed')
    await expect(term.locator('.term-step[data-tool="append_to_page"]')).toBeVisible()
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:info.outputPath(`copilot-terminal-${width}.png`),animations:'disabled'});expect(await term.locator('.term-head').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)}
    // Record the actual default terminal schema budget, so the worker's boundary can also be exercised locally.
    await writeFile(info.outputPath('copilot-terminal-request.json'),JSON.stringify(fake.textAsked[0]))
    await info.attach('copilot-terminal-request',{body:JSON.stringify(fake.textAsked[0]),contentType:'application/json'})
  })
  test('selected Atlas tools cooperate with a manual browser agent; credentials never enter model text',async({page})=>{
    const token='private-atlas-token-for-copilot-test'
    await wsEval(page,(s,token)=>s.updateSettings({mcpServers:[{id:'atlas-fixture',name:'atlas',url:'https://atlas.example.org/mcp',token,enabled:true,prompt:'Read the approved Atlas record.',tools:['atlas_get'],checkedAt:Date.now()}]}),token)
    fake.onModelMcp=r=>r.action==='search'?{tools:[{name:'atlas_get',server:'atlas',description:'Read record',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:JSON.stringify({content:[{type:'text',text:'Atlas requirement 43 is approved.'}]})}
    let round=0
    fake.onText=r=>{const n=round++;return {model:r.model,text:n===2?'Atlas requirement 43 reviewed.':'',...(n<2?{calls:[n===0?{id:'search-1',name:'one_mcp_search',arguments:{query:'atlas requirement'}}:{id:'atlas-1',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:43}}}]}:{}),inputTokens:300,outputTokens:50,usd:null}}
    await wsEval(page,(s,model)=>s.upsertAgent({id:'copilot-ba',name:'Copilot BA',instructions:'Read Atlas requirement 43 and report.',trigger:{type:'manual'},scope:{everything:true,pages:[],databases:[]},write:'none',output:null,mcpServers:['atlas'],mcpTools:{atlas:['atlas_get']},runner:'browser',model:null,route:[{p:'copilot',m:model}],effort:null,maxRunUsd:5,enabled:true,createdAt:Date.now(),updatedAt:Date.now()}),MODEL)
    const result=await page.evaluate(()=>(window as any).__oneAgents.run('copilot-ba'))
    expect(typeof result).toBe('string')
    const runs=await page.evaluate(()=>(window as any).__oneAgents.loadRuns('copilot-ba'))
    expect(fake.textAsked,JSON.stringify(runs)).toHaveLength(3)
    expect(JSON.stringify(fake.textAsked)).toContain('Atlas requirement 43 is approved')
    expect(JSON.stringify(fake.textAsked)).not.toContain(token)
    expect(fake.mcpAsked.find(r=>r.action==='call')).toMatchObject({server:'atlas',name:'atlas_get',arguments:{ref:43},servers:[{allow:['atlas_get']}]})
  })
  test('one-shot JSON planning can read only its explicitly selected Atlas tools',async({page})=>{
    const token='private-one-shot-atlas-fixture'
    await wsEval(page,(s,token)=>s.updateSettings({mcpServers:[{id:'atlas-once',name:'atlas',url:'https://atlas.example.org/mcp',token,enabled:true,prompt:'Read approved requirements.',tools:['atlas_get','atlas_send'],checkedAt:Date.now()}]}),token)
    fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:JSON.stringify({content:[{type:'text',text:'Requirement 43: approved fixture.'}]})}
    let round=0
    fake.onText=r=>{const n=round++;return {model:r.model,text:n===2?'{"answer":"Requirement 43 is ready"}':'',...(n<2?{calls:[n===0?{id:'s1',name:'one_mcp_search',arguments:{query:'atlas_get'}}:{id:'c1',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:43}}}]}:{}),inputTokens:200,outputTokens:30,usd:null}}
    const result=await page.evaluate(model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read requirement 43, then answer JSON.',route:{p:'copilot',m:model},structured:true,pick:{server:'atlas',reads:['atlas_get']}}),MODEL)
    expect(result).toEqual({ok:true,text:'{"answer":"Requirement 43 is ready"}'})
    expect(fake.textAsked).toHaveLength(3)
    expect(JSON.stringify(fake.textAsked)).not.toContain(token)
    expect(fake.mcpAsked.find(r=>r.action==='call')).toMatchObject({name:'atlas_get',servers:[{allow:['atlas_get']}]})
  })

})
