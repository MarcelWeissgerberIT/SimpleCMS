import { writeFile } from 'node:fs/promises'
import { test, expect, openApp, wsEval, createPage, gotoPage, doc, para, MOD } from './fixtures'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'

const PORT=47421,MODEL='atlas-flow:latest'
const ALL=['public','structure','selection','page','rows','files','workspace','people','transcript']
test.describe('Atlas Flow across workspace features',()=>{
  test.describe.configure({mode:'serial'})
  let fake:FakeWorker
  test.beforeEach(async({page})=>{
    fake=await startFakeWorker(PORT,{worker:'1.34.0',name:'local-workspace-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true})
    fake.can=[...WORKER_CAN]
    fake.textModels=[{provider:'local',model:MODEL,context:32768,chat:true,maxOutput:8192}]
    await openApp(page)
    await wsEval(page,(s,allow)=>{s.setWorkspaceAI({policy:{providers:{local:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp','memory']}}})},ALL)
    await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('tab',{name:/Coding worker/}).click()
    await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
    await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
    await expect(page.getByTestId('coding-conn')).toContainText('local-workspace-fixture')
    await page.getByRole('tab',{name:/AI$/}).click()
    await expect(page.getByTestId('worker-model-settings')).toContainText(MODEL)
    await page.keyboard.press('Escape')
  })
  test.afterEach(async()=>{await fake?.close()})
  test('terminal reads real page content and stages an append without changing the page automatically',async({page},info)=>{
    const id=await createPage(page,{title:'Atlas Flow acceptance source',content:doc(para('Expected simulation result: 43.'))})
    await gotoPage(page,id)
    let round=0
    fake.onText=r=>{
      const n=round++
      const calls=n===0?[{id:'discover-read',name:'one_workspace_search',arguments:{query:'read_page'}}]:n===1?[{id:'read-1',name:'one_workspace_call',arguments:{name:'read_page',arguments:{id}}}]:n===2?[{id:'discover-write',name:'one_workspace_search',arguments:{query:'append_to_page'}}]:n===3?[{id:'append-1',name:'one_workspace_call',arguments:{name:'append_to_page',arguments:{id,markdown:'## Reviewed\nSimulation result 43 confirmed.'}}}]:[]
      return {model:r.model,text:calls.length?'':'Prepared the review for your approval.',calls,inputTokens:300,outputTokens:50,usd:0}
    }
    await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),MODEL)
    await page.keyboard.press(`${MOD}+j`)
    const term=page.getByRole('region',{name:'AI terminal'}),prompt=term.getByRole('textbox',{name:'Task for the agent'})
    await prompt.fill('Read this page and append a short review.');await prompt.press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Prepared the review',{timeout:20000})
    expect(fake.textAsked).toHaveLength(5)
    expect(Buffer.byteLength(JSON.stringify(fake.textAsked[0]))).toBeLessThan(22000)
    expect(JSON.stringify(fake.textAsked[2].messages)).toContain('Expected simulation result: 43')
    const content=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)
    expect(content).not.toContain('Simulation result 43 confirmed')
    await expect(term.locator('.term-step[data-tool="append_to_page"]')).toBeVisible()
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:info.outputPath(`local-terminal-${width}.png`),animations:'disabled'});expect(await term.locator('.term-head').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)}
    // Record the actual default terminal schema budget, so the worker's boundary can also be exercised locally.
    await writeFile(info.outputPath('local-terminal-request.json'),JSON.stringify(fake.textAsked[0]))
    await info.attach('local-terminal-request',{body:JSON.stringify(fake.textAsked[0]),contentType:'application/json'})
  })
  test('selected Atlas tools cooperate with a manual browser agent; credentials never enter model text',async({page})=>{
    const token='private-atlas-token-for-local-test'
    await wsEval(page,(s,token)=>s.updateSettings({mcpServers:[{id:'atlas-fixture',name:'atlas',url:'https://atlas.example.org/mcp',token,enabled:true,prompt:'Read the approved Atlas record.',tools:['atlas_get'],checkedAt:Date.now()}]}),token)
    fake.onModelMcp=r=>r.action==='search'?{tools:[{name:'atlas_get',server:'atlas',description:'Read record',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:JSON.stringify({content:[{type:'text',text:'Atlas requirement 43 is approved.'}]})}
    let round=0
    fake.onText=r=>{const n=round++;return {model:r.model,text:n===2?'Atlas requirement 43 reviewed.':'',...(n<2?{calls:[n===0?{id:'search-1',name:'one_mcp_search',arguments:{query:'atlas requirement'}}:{id:'atlas-1',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:43}}}]}:{}),inputTokens:300,outputTokens:50,usd:0}}
    await wsEval(page,(s,model)=>s.upsertAgent({id:'local-ba',name:'Atlas Flow BA',instructions:'Read Atlas requirement 43 and report.',trigger:{type:'manual'},scope:{everything:true,pages:[],databases:[]},write:'none',output:null,mcpServers:['atlas'],mcpTools:{atlas:['atlas_get']},runner:'browser',model:null,route:[{p:'local',m:model}],effort:null,maxRunUsd:5,enabled:true,createdAt:Date.now(),updatedAt:Date.now()}),MODEL)
    const result=await page.evaluate(()=>(window as any).__oneAgents.run('local-ba'))
    expect(typeof result).toBe('string')
    const runs=await page.evaluate(()=>(window as any).__oneAgents.loadRuns('local-ba'))
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
    fake.onText=r=>{const n=round++;return {model:r.model,text:n===2?'{"answer":"Requirement 43 is ready"}':'',...(n<2?{calls:[n===0?{id:'s1',name:'one_mcp_search',arguments:{query:'atlas_get'}}:{id:'c1',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:43}}}]}:{}),inputTokens:200,outputTokens:30,usd:0}}
    const result=await page.evaluate(model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read requirement 43, then answer JSON.',route:{p:'local',m:model},structured:true,pick:{server:'atlas',reads:['atlas_get']}}),MODEL)
    expect(result).toEqual({ok:true,text:'{"answer":"Requirement 43 is ready"}'})
    expect(fake.textAsked).toHaveLength(3)
    expect(JSON.stringify(fake.textAsked)).not.toContain(token)
    expect(fake.mcpAsked.find(r=>r.action==='call')).toMatchObject({name:'atlas_get',servers:[{allow:['atlas_get']}]})
  })

  test('a large Atlas result fits the next local terminal round without losing the task or executing a tool twice',async({page})=>{
    const id=await createPage(page,{title:'Local Atlas context source',content:doc(para('Approved workshop source. '.repeat(100)))})
    await gotoPage(page,id)
    await wsEval(page,s=>s.updateSettings({mcpServers:[{id:'atlas-context',name:'atlas',url:'https://atlas.example.org/mcp',token:'private-context-test-token',enabled:true,prompt:'Use approved Atlas sources.',tools:['atlas_whoami'],checkedAt:Date.now()}]}))
    fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_whoami',description:'Read identity. '+ 'Known permission description. '.repeat(100),inputSchema:{type:'object',properties:{},additionalProperties:false}}]}:{result:JSON.stringify({content:[{type:'text',text:'Active tenant: one. '+ 'Ö🙂'.repeat(3000)}]})}
    let round=0
    fake.onText=r=>{const n=round++;return {model:r.model,text:n===2?'Atlas identity confirmed; active tenant one.':'',...(n<2?{calls:[n===0?{id:'find-identity',name:'one_mcp_search',arguments:{query:'atlas_whoami'}}:{id:'read-identity',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_whoami',arguments:{}}}]}:{}),inputTokens:200,outputTokens:30,usd:0}}
    await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),MODEL)
    await page.keyboard.press(`${MOD}+j`)
    const term=page.getByRole('region',{name:'AI terminal'}),prompt=term.getByRole('textbox',{name:'Task for the agent'})
    const task='Use atlas_whoami and report the active tenant. Do not change anything.'
    await prompt.fill(task);await prompt.press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Atlas identity confirmed',{timeout:20000})
    expect(fake.textAsked).toHaveLength(3)
    expect(JSON.stringify(fake.textAsked[2].messages)).toContain('Harness context excerpt')
    expect(JSON.stringify(fake.textAsked[2].messages)).toContain(task)
    for(const request of fake.textAsked)expect(Buffer.byteLength(JSON.stringify([request.messages,request.tools,request.schema]))+request.maxTokens+2048).toBeLessThan(32768)
    expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
    expect(JSON.stringify(fake.textAsked)).not.toContain('private-context-test-token')
    expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).toContain('Approved workshop source.')
  })

  test('terminal repairs a printed MCP tag once, records discovery and never executes the printed call',async({page})=>{
    await wsEval(page,s=>s.updateSettings({mcpServers:[{id:'atlas-format',name:'atlas',url:'https://atlas.example.org/mcp',token:'private-format-token',enabled:true,prompt:'Use approved sources.',tools:['atlas_whoami'],checkedAt:Date.now()}]}))
    fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_whoami',inputSchema:{type:'object',properties:{}}}]}:{result:JSON.stringify({content:[{type:'text',text:'Identity verified from real tool receipt.'}]})}
    let round=0
    fake.onText=r=>{const n=round++;return {model:r.model,text:n===0?'Cannot find atlas_whoami.<tool_call>':n===3?'Atlas access verified.':'',...(n===1?{calls:[{id:'find',name:'one_mcp_search',arguments:{query:'atlas_whoami'}}]}:n===2?{calls:[{id:'identity',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_whoami',arguments:{}}}]}:{}),inputTokens:100,outputTokens:20,usd:0}}
    await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),MODEL)
    await page.keyboard.press(`${MOD}+j`)
    const term=page.getByRole('region',{name:'AI terminal'}),prompt=term.getByRole('textbox',{name:'Task for the agent'})
    await prompt.fill('atlas_whoami');await prompt.press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Atlas access verified.',{timeout:20000})
    await expect(term).not.toContainText('Cannot find atlas_whoami.')
    await expect(term).toContainText('one_mcp_search')
    expect(fake.textAsked).toHaveLength(4)
    expect(JSON.stringify(fake.textAsked[1].messages)).toContain('only format-correction retry')
    expect(fake.mcpAsked.map(r=>r.action)).toEqual(['search','call'])
    await expect(term).toContainText('2/40')
  })

  test('a second printed tool call is a visible failure, with no execution or unbounded retry',async({page})=>{
    fake.onText=r=>({model:r.model,text:'<tool_call>append_to_page</tool_call>',inputTokens:100,outputTokens:20,usd:0})
    await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),MODEL)
    await page.keyboard.press(`${MOD}+j`)
    const term=page.getByRole('region',{name:'AI terminal'}),prompt=term.getByRole('textbox',{name:'Task for the agent'})
    await prompt.fill('Read a page.');await prompt.press('Enter')
    await expect(term).toContainText('even after one correction',{timeout:20000})
    expect(fake.textAsked).toHaveLength(2)
    expect(fake.mcpAsked).toHaveLength(0)
    await expect(term.locator('.term-answer')).toHaveCount(0)
  })

  test('text completion repairs one malformed native call and stops a second malformed response',async({page})=>{
    await wsEval(page,s=>s.updateSettings({mcpServers:[{id:'atlas-once-format',name:'atlas',url:'https://atlas.example.org/mcp',token:'private-format-once',enabled:true,prompt:'Read sources.',tools:['atlas_whoami'],checkedAt:Date.now()}]}))
    fake.onText=r=>({model:r.model,text:'<function=one_mcp_search>',inputTokens:100,outputTokens:20,usd:0})
    const result=await page.evaluate(model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas identity.',mcp:'free',route:{p:'local',m:model}}),MODEL)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('features.ai.local.toolFormat')
    expect(fake.textAsked).toHaveLength(2)
    expect(fake.mcpAsked).toHaveLength(0)
  })

  test('a local model cannot skip workspace discovery to stage a write',async({page})=>{
    const id=await createPage(page,{title:'Untouched source',content:doc(para('Keep this exact source.'))})
    await gotoPage(page,id)
    fake.onText=r=>({model:r.model,text:'',calls:[{id:'invented',name:'one_workspace_call',arguments:{name:'append_to_page',arguments:{id,markdown:'Unauthorized staged text'}}}],inputTokens:100,outputTokens:20,usd:0})
    await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),MODEL)
    await page.keyboard.press(`${MOD}+j`)
    const term=page.getByRole('region',{name:'AI terminal'}),prompt=term.getByRole('textbox',{name:'Task for the agent'})
    await prompt.fill('Read this source.');await prompt.press('Enter')
    await expect(term).toContainText('Discover the permitted tool before calling it.')
    expect(fake.textAsked).toHaveLength(1)
    expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),id)).not.toContain('Unauthorized staged text')
    await expect(term.locator('.term-step[data-tool="append_to_page"]')).toHaveCount(0)
  })

  test('personal Atlas connections can be tested with a local model and no Claude key',async({page})=>{
    fake.onModelMcp=r=>({tools:[{name:'remote_mcp_0',server:'atlas',tool:'atlas_get',description:'Read approved source',parameters:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]})
    await wsEval(page,(s,model)=>s.updateSettings({ai:{allow:{local:['mcp']},routes:{'mcp-setup':[{p:'local',m:model}]}},mcpServers:[{id:'test-atlas',name:'atlas',url:'https://atlas.example.org/mcp',token:'local-test-credential',enabled:true,prompt:'Existing instructions.',checkedAt:Date.now()}]}),MODEL)
    await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('tab',{name:/AI$/}).click()
    await expect(page.getByTestId('device-row-mcp')).toHaveValue('local:'+MODEL)
    const servers=page.getByTestId('mcp-servers')
    await servers.locator('.mcps-card[data-id="test-atlas"] button[aria-expanded]').click()
    const check=servers.getByRole('button',{name:'Test connection',exact:true})
    await expect(check).toBeEnabled();await check.click()
    await expect.poll(()=>fake.mcpAsked.length).toBe(1)
    expect(fake.mcpAsked[0].action).toBe('list')
    expect(fake.textAsked).toHaveLength(0)
  })

  test('MCP setup exposes model choice and a separate personal consent beside the connection test',async({page})=>{
    await wsEval(page,s=>s.updateSettings({ai:{allow:{local:['memory']}},mcpServers:[{id:'inline-atlas',name:'atlas',url:'https://atlas.example.org/mcp',token:'private-inline-test',enabled:true,prompt:'Read approved records.'}]}))
    fake.onModelMcp=()=>({tools:[{name:'remote_mcp_0',server:'atlas',tool:'atlas_get',description:'Read approved record',parameters:{type:'object',properties:{}}}]})
    const policy=await wsEval(page,s=>JSON.stringify(s.ai))
    await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('tab',{name:/AI$/}).click()
    const servers=page.getByTestId('mcp-servers')
    await servers.locator('.mcps-card[data-id="inline-atlas"] button[aria-expanded]').click()
    const setup=servers.getByTestId('mcp-check-setup')
    await setup.getByTestId('mcp-check-model').selectOption('local:'+MODEL)
    const check=servers.getByRole('button',{name:'Test connection',exact:true})
    await expect(check).toBeDisabled()
    expect(fake.mcpAsked).toHaveLength(0)
    await setup.getByRole('switch',{name:/Allow MCP connections/}).click()
    await expect(check).toBeEnabled()
    expect(await wsEval(page,s=>s.settings.ai?.allow?.local)).toEqual(['memory','mcp'])
    expect(await wsEval(page,s=>JSON.stringify(s.ai))).toBe(policy)
    // Enabling a provider starts the existing first check for an unchecked server.
    await expect.poll(()=>fake.mcpAsked.length).toBe(1)
    await expect(check).toBeEnabled()
    await check.click()
    await expect.poll(()=>fake.mcpAsked.length).toBe(2)
    expect(fake.mcpAsked.every(r=>r.action==='list')).toBe(true)
    expect(fake.textAsked).toHaveLength(0)
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});expect(await setup.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)}
  })

})
