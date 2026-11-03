import {test,expect,openApp,wsEval,MOD,createPage,gotoPage,editorOf,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
import {readFile} from 'node:fs/promises'
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
 test('page AI keeps many source receipts and a failed search inside the result scroll area',async({page},info)=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_search',inputSchema:{type:'object',properties:{q:{type:'string'}},required:['q']}}]}:{result:r.arguments.q==='bounded topic 2'?JSON.stringify({isError:true,content:[{type:'text',text:'invalid_query: unsupported operator'}]}):envelope({items:[{ref:100+Number(String(r.arguments.q).split(' ').at(-1)),title:'Observed source'}]})}
   let round=0;fake.onText=r=>{const n=round++;return {model:r.model,text:n>=3?Array.from({length:35},(_,i)=>'Paragraph '+i+': Source-backed review with a deliberately long source URL https://example.test/'+('section-'.repeat(18))).join('\n\n')+'\n\nEND OF REVIEW':'',calls:n===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_search'}}]:(n===1||n===2)?Array.from({length:6},(_,i)=>({id:'search-'+((n-1)*6+i),name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_search',arguments:{q:'bounded topic '+((n-1)*6+i)}}})):[],inputTokens:200,outputTokens:40,usd:0}}
   await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'local',m:LOCAL})
   await page.evaluate(()=>localStorage.setItem('one.popover.size:ai-menu',JSON.stringify({w:1300,h:820})))
   const id=await createPage(page,{title:'Search review layout fixture',content:doc(para('Observed requirements source.'),para(''))});await gotoPage(page,id)
   const ask=page.getByPlaceholder('Ask AI to write anything…'),panel=page.getByRole('dialog',{name:'Ask AI'})
   await expect(async()=>{await editorOf(page,id).locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space');try{await expect(ask).toBeFocused({timeout:2000})}catch(e){if(!(await ask.count()))await page.keyboard.press('Backspace');throw e}}).toPass({timeout:15000})
   await ask.fill('atlas: review the sources and identify gaps');await ask.press('Enter')
    await expect(panel.locator('.ai-out')).toHaveAttribute('data-phase','done')
    await expect(panel.locator('.ai-mcp__issues')).toContainText('1 failed · 12 succeeded')
    await expect(panel.locator('.worker-connection-help')).toContainText('Atlas rejected this search query')
    await expect(panel.locator('.ai-mcp__issues')).toContainText('bounded topic 2')
    await expect(panel.locator('.ai-mcp__issues')).not.toContainText('Start your existing worker')
    await expect(panel.locator('.ai-mcp__trace')).not.toHaveAttribute('open','')
    for(const theme of ['light','dark'])for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(t=>{document.documentElement.dataset.theme=t},theme)
      await expect(async()=>{const b=await panel.evaluate(el=>{const box=el.getBoundingClientRect(),out=el.querySelector('.ai-out')!,keys=el.querySelector('.ai-list[data-keys]')!,foot=el.querySelector('.ai-foot')!;return {right:box.right,bottom:box.bottom,scrollWidth:el.scrollWidth,width:el.clientWidth,outBottom:out.getBoundingClientRect().bottom,keyTop:keys.getBoundingClientRect().top,keyBottom:keys.getBoundingClientRect().bottom,footTop:foot.getBoundingClientRect().top,footBottom:foot.getBoundingClientRect().bottom,scrollable:out.scrollHeight>out.clientHeight}});expect(b.right).toBeLessThanOrEqual(width);expect(b.bottom).toBeLessThanOrEqual(width===390?844:900);expect(b.scrollWidth).toBeLessThanOrEqual(b.width+1);expect(b.outBottom).toBeLessThanOrEqual(b.keyTop+1);expect(b.keyBottom).toBeLessThanOrEqual(b.footTop+1);expect(b.footBottom).toBeLessThanOrEqual(b.bottom+1);expect(b.scrollable).toBe(true)}).toPass()
      await panel.locator('.ai-out').evaluate(el=>{el.scrollTop=0});await panel.screenshot({path:info.outputPath('page-ai-'+theme+'-'+width+'.png')})
      await panel.locator('.ai-mcp__trace > summary').click();await expect(panel.locator('.atlas-facts')).toHaveCount(12)
      await panel.locator('.ai-out').evaluate(el=>{el.scrollTop=el.scrollHeight});await expect(panel.getByText('END OF REVIEW',{exact:true})).toBeInViewport();await expect(panel.getByRole('button',{name:'Show failed calls'})).toBeInViewport();await panel.getByRole('button',{name:'Show failed calls'}).click();await expect(panel.locator('.ai-mcp__issues > summary')).toBeFocused();await expect(panel.locator('.ai-mcp__issues > summary')).toBeInViewport()
      await panel.locator('.ai-out').evaluate(el=>{el.scrollTop=0});await panel.locator('.ai-mcp__trace > summary').click()
    }
    await expect(panel.getByRole('option',{name:/Insert/})).toBeVisible()
  })

 test('page AI rejects Kristins invalid array comparison before dispatch and can complete a corrected read',async({page})=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_search',inputSchema:{type:'object',properties:{aql:{type:'string'},tenant:{type:'string'}},required:['aql']}}]}:{result:envelope({items:[{ref:42,title:'Observed requirement',tags:['requirement']}]})}
   let round=0;fake.onText=r=>{const n=round++;return {model:r.model,text:n>=3?'Observed requirement, Ref: 42. Tag: requirement.':'',calls:n===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_search'}}]:n===1?[{id:'invalid-aql',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_search',arguments:{aql:'project = flux-part-cnsx AND tags = "requirement"',tenant:'analytik-jena'}}}]:n===2?[{id:'corrected-aql',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_search',arguments:{aql:'project = flux-part-cnsx',tenant:'analytik-jena'}}}]:[],inputTokens:200,outputTokens:40,usd:0}}
   await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'local',m:LOCAL})
   const id=await createPage(page,{title:'Array query fixture',content:doc(para('Requirements review.'),para(''))});await gotoPage(page,id)
   const ask=page.getByPlaceholder('Ask AI to write anything…'),panel=page.getByRole('dialog',{name:'Ask AI'})
   await expect(async()=>{await editorOf(page,id).locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space');try{await expect(ask).toBeFocused({timeout:2000})}catch(e){if(!(await ask.count()))await page.keyboard.press('Backspace');throw e}}).toPass({timeout:15000})
   await ask.fill('atlas: Read requirements in project flux-part-cnsx, tenant analytik-jena. A bounded project read with explicit tag inspection is allowed. Read only.');await ask.press('Enter')
   await expect(panel.locator('.ai-out')).toHaveAttribute('data-phase','done');await expect(panel.locator('.ai-out__body')).toContainText('Observed requirement')
   await expect(panel.locator('.ai-mcp__issues')).toContainText('Held before server contact');await expect(panel.locator('.ai-mcp__issues')).toContainText('Tags are a list')
   expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.arguments)).toEqual([{aql:'project = flux-part-cnsx',tenant:'analytik-jena'}])
 })
 for(const provider of ['local','copilot'] as const){
  test(`${provider}: actual compiler receipt opens glass evidence, exact dimensions and a complete export without another call`,async({page},info)=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'Recorded test source'}})}
   let round=0;fake.onText=r=>{const n=round++;return {model:r.model,text:n>=2?'Ref: 42 gelesen.':'',calls:n===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_get'}}]:n===1?[{id:'read',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}}]:[],inputTokens:200,outputTokens:40,usd:0}}
   await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:COPILOT})
   await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await input.fill('Read Atlas ref 42.');await input.press('Enter');await expect(term.locator('.term-answer')).toContainText('Ref: 42 gelesen.')
   const facts=term.locator('.atlas-facts');await facts.locator('summary').click()
   const opener=facts.getByRole('button',{name:/Compiled dispatch check/});await opener.focus();await page.keyboard.press('Enter')
   const dialog=page.getByRole('dialog',{name:'Evidence cube · dispatch check'});await expect(dialog).toBeVisible()
   await expect(dialog.getByRole('button',{name:'Permission',exact:true})).toHaveAttribute('aria-pressed','true')
   const permissionPlane=await dialog.locator('.quantum-cube__plane[data-selected=true]').getAttribute('d')
   const bound=await dialog.locator('.quantum-cube__evidence').first().getAttribute('data-quantum-id')
   await dialog.getByRole('button',{name:'Provenance',exact:true}).click();await expect(dialog).toContainText('selected MCP origin')
   expect(await dialog.locator('.quantum-cube__plane[data-selected=true]').getAttribute('d')).not.toBe(permissionPlane)
   expect(await dialog.locator('.quantum-cube__evidence').first().getAttribute('data-quantum-id')).toBe(bound)
   await expect(dialog.locator('.quantum-cube__relations li')).toHaveCount(1)

   const before=await dialog.locator('svg[role=group] path').first().getAttribute('d');await dialog.getByRole('button',{name:'Rotate cube right'}).click();expect(await dialog.locator('svg[role=group] path').first().getAttribute('d')).not.toBe(before)
   await dialog.getByText('Bound values and dependencies',{exact:true}).click();await expect(dialog).toContainText('https://atlas.example.org');await expect(dialog).toContainText('atlas_get')
   for(const theme of ['light','dark'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await dialog.locator('.modal__body').evaluate(el=>el.scrollTop=0)
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await dialog.screenshot({path:info.outputPath(`quantum-${provider}-${theme}-${width}.png`),animations:'disabled'})
   }
   const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download compiler receipt as JSON'}).click();const file=await download
   const proof=JSON.parse(await readFile((await file.path())!,'utf8'))
   expect(proof.inspection.result.quanta[0].id).toBe(proof.quantumIds[0]);expect(proof.inspection.result.quanta[0].dimensions).toEqual(['permission','provenance']);expect(proof.inspection.request.snapshot.tool).toBe('atlas_get')
   expect(JSON.stringify(proof)).not.toContain('private-facts-token')
   expect(JSON.stringify(fake.textAsked)).not.toContain('dimension_definitions');expect(JSON.stringify(fake.textAsked)).not.toContain('state_revision')
   expect(fake.mcpAsked.map(r=>r.action)).toEqual(['search','call']);expect(fake.textAsked).toHaveLength(3)
   await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused()
  })
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
 test('passed dispatch evidence stays separate from an Atlas server failure',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:JSON.stringify({isError:true,content:[{type:'text',text:'Synthetic server failure'}]})}
  let round=0;fake.onText=r=>{const n=round++;return {model:r.model,text:n>=2?'Atlas request failed.':'',calls:n===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_get'}}]:n===1?[{id:'read',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Read Atlas ref 42.');await input.press('Enter');await expect(term.locator('.task-contract')).toContainText('Blocked');await expect(term.locator('.term-answer')).toHaveCount(0)
  const facts=term.locator('.atlas-facts');await expect(facts).toHaveAttribute('data-outcome','error');await facts.locator('summary').click();await facts.getByRole('button',{name:/Compiled dispatch check/}).click()
  const dialog=page.getByRole('dialog',{name:'Evidence cube · dispatch check'});await expect(dialog).toContainText('Dispatch check passed · recorded');await expect(dialog.locator('.quantum-inspector__facts').first()).toContainText('Failed')
  expect(fake.mcpAsked.map(r=>r.action)).toEqual(['search','call'])
 })
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
  expect(fake.textAsked).toHaveLength(5);expect(JSON.stringify(fake.textAsked[2].messages)).toContain('NOT executed');expect(JSON.stringify(fake.textAsked[4].messages)).toContain('read_back_matches');expect(JSON.stringify(fake.textAsked[4].messages)).toContain('one_mcp')
 })
 for(const provider of ['local','copilot','anthropic'] as const)for(const unavailable of [false,true])test(`${provider}: ${unavailable?'a refused read-back remains a real error':'translated read-back is a successful read with a visible content mismatch'}`,async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_create',inputSchema:{type:'object',properties:{kind:{type:'string'},project:{type:'string'},title:{type:'string'},body:{type:'string'}}}}]}:r.name==='atlas_create'?{result:envelope({item:{ref:42},translated:true})}:{result:unavailable?JSON.stringify({isError:true,content:[{type:'text',text:'403 Forbidden'}]}):envelope({item:{ref:42,title:'Sample types',body:'Translated text. Original: Probentypen.'}})}
  const requests=[{name:'one_mcp_search',input:{query:'atlas_create'}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_create',arguments:{kind:'doc',project:'fixture',title:'Probentypen',body:'Probentypen.'}}}]
  const answer=unavailable?'Record Ref: 42 wurde vom Server angenommen. Rücklesen nicht möglich; keine unabhängige Bestätigung.':'Record Ref: 42 wurde vom Server angenommen. Rücklesen erfolgreich; Text weicht ab. Inhaltliche Prüfung offen.'
  let round=0;fake.onText=r=>{const c=requests[round++];return{model:r.model,text:c?'':answer,calls:c?[{id:'c'+round,name:c.name,arguments:c.input}]:[],inputTokens:100,outputTokens:30,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...requests.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'c'+i,name:c.name,input:c.input}]})),text(answer)]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Create one Atlas doc in project fixture, title Probentypen and body Probentypen. Report any verification differences.');await input.press('Enter')
  await expect.poll(()=>fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_create','atlas_get'])
  if(unavailable){await expect(term.locator('.task-contract')).toContainText('Blocked',{timeout:20000});await expect(term).toContainText('Permission denied. Check project membership');await expect(term.locator('.term-error')).toBeVisible()}
  else {await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:20000});await expect(term.locator('.term-answer')).toContainText('Text weicht ab');await expect(term.locator('.term-error')).toHaveCount(0);await expect(term).not.toContainText('Tool error');await expect(term.locator('.atlas-facts summary').filter({hasText:'Read succeeded · stored content differs · review needed'})).toHaveCount(2)}
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(1)
  expect(JSON.stringify(host?.requests??fake.textAsked)).not.toContain('private-facts-token')
 })
 test('revoking the MCP connection while inference runs blocks the next dispatch',async({page})=>{
  fake.onText=async r=>{
   await wsEval(page,s=>s.updateSettings({mcpServers:[]}))
   return {model:r.model,text:'',calls:[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_get'}}],inputTokens:20,outputTokens:10,usd:0}
  }
  const result=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read my Atlas identity.',mcp:'fixed',route:{p:'local',m:model}}),LOCAL)
  expect(result).toMatchObject({ok:false});expect(fake.mcpAsked).toHaveLength(0)
 })
 for(const terminal of [false,true])test(`Claude ${terminal?'terminal':'completion'}: check before display and correct without MCP or write tools`,async({page})=>{
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_record_kinds',inputSchema:{type:'object'}}]}:{result:envelope({kinds:Array.from({length:36},(_,i)=>({name:'kind-'+i}))})}
  const host=await mockClaudeScript(page,[{blocks:[{type:'tool_use',id:'discover',name:'one_mcp_search',input:{query:'atlas_record_kinds'}}]},{blocks:[{type:'tool_use',id:'read-kinds',name:'one_mcp_call',input:{server:'atlas',name:'atlas_record_kinds',arguments:{}}}]},text('29 Record-Kinds erstellt.'),text('36 Record-Kinds gelesen.')])
  if(terminal){
   await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'anthropic',m:model}]),DEFAULT_CLAUDE_MODEL)
   await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await input.fill('List the Atlas record kinds.');await input.press('Enter');await expect(term.locator('.term-answer')).toContainText('36 Record-Kinds gelesen.');await expect(term).not.toContainText('29 Record-Kinds erstellt.')
   await expect(term.locator('.atlas-facts')).toHaveCount(1)
  }else{
   const answer=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'List the actual Atlas record kinds.',mcp:'fixed',route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
   expect(answer).toEqual({ok:true,text:'36 Record-Kinds gelesen.'})
  }
  expect(host.requests).toHaveLength(4);expect(host.requests[3].body.tools??[]).toEqual([]);expect(host.requests.every(r=>!r.body.mcp_servers)).toBe(true)
  expect(JSON.stringify(host.requests[3].body)).not.toContain('private-facts-token')
 })
 test('Claude structured fields with an invented Atlas ref are withheld',async({page})=>{
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'Approved fixture'}})}
  const host=await mockClaudeScript(page,[{blocks:[{type:'tool_use',id:'discover',name:'one_mcp_search',input:{query:'atlas_get'}}]},{blocks:[{type:'tool_use',id:'read',name:'one_mcp_call',input:{server:'atlas',name:'atlas_get',arguments:{ref:42}}}]},text('{"answer":"Ref: 999"}')])
  const answer=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas ref 42.',structured:true,pick:{server:'atlas',reads:['atlas_get']},route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
  expect(answer).toMatchObject({ok:false,detail:'features.ai.local.unverifiedFacts'});expect(host.requests).toHaveLength(3)
 })
 for(const provider of ['local','copilot','anthropic'] as const){
  test(`${provider}: a failed search plus successful identity cannot invent an empty project`,async({page},info)=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:r.query,inputSchema:{type:'object',properties:{q:{type:'string'}}}}]}:r.name==='atlas_search'?{result:JSON.stringify({isError:true,content:[{type:'text',text:'403 Forbidden: project permission denied'}]})}:{result:envelope({person:'Test Member'})}
   const requests=[{name:'one_mcp_search',input:{query:'atlas_search'}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_search',arguments:{q:'source'}}},{name:'one_mcp_search',input:{query:'atlas_whoami'}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_whoami',arguments:{}}}]
   let round=0
   fake.onText=r=>{const c=requests[round++];return{model:r.model,text:c?'':'Es gibt keine offenen Aufgaben in Atlas.',calls:c?[{id:'c'+round,name:c.name,arguments:c.input}]:[],inputTokens:100,outputTokens:20,usd:0}}
   const host=provider==='anthropic'?await mockClaudeScript(page,[...requests.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'c'+i,name:c.name,input:c.input}]})),text('Es gibt keine offenen Aufgaben in Atlas.'),text('Es gibt keine offenen Aufgaben in Atlas.')]):null
   if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
   await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
   await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await input.fill('Read Atlas tasks. If the search fails, report only that blocker.');await input.press('Enter')
   await expect(term.locator('.task-contract')).toContainText('Blocked',{timeout:20000})
   await expect(term.locator('.term-error')).toBeVisible()
   await expect(term.locator('.term-answer')).toHaveCount(0)
   await expect(term.getByTestId('worker-connection-help')).toHaveAttribute('data-problem','permission')
   await expect(term.getByTestId('worker-connection-help')).toContainText('does not prove an invalid token')
   await expect.poll(()=>fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_search','atlas_whoami'])
   const wire=host?.requests.map(r=>r.body)??fake.textAsked
   expect(wire.at(-1)?.tools??[]).toEqual([])
   for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const help=term.getByTestId('worker-connection-help');expect(await help.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await help.screenshot({path:info.outputPath(`permission-${provider}-${theme}-${width}.png`)})}
  })
  test(`${provider}: real nonempty results correct false absence without rerunning a query`,async({page})=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_search',inputSchema:{type:'object',properties:{q:{type:'string'}}}}]}:{result:envelope({items:[{ref:42,title:'Actual returned source'}],total:7})}
   const calls=[{name:'one_mcp_search',input:{query:'atlas_search'}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_search',arguments:{q:'source'}}}]
   let round=0;fake.onText=r=>{const n=round++,c=calls[n];return{model:r.model,text:c?'':n===2?'Keine Dokumente gefunden.':'Quelle Ref 42 wurde zurückgegeben.',calls:c?[{id:'q'+n,name:c.name,arguments:c.input}]:[],inputTokens:100,outputTokens:20,usd:0}}
   const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'q'+i,name:c.name,input:c.input}]})),text('Keine Dokumente gefunden.'),text('Quelle Ref 42 wurde zurückgegeben.')]):null
   if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
   const answer=await page.evaluate(async route=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Find actual Atlas source records.',mcp:'fixed',route}),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
   expect(answer).toEqual({ok:true,text:'Quelle Ref 42 wurde zurückgegeben.'})
   expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
   expect((host?.requests.map(r=>r.body)??fake.textAsked).at(-1)?.tools??[]).toEqual([])
  })
 }

 for(const provider of ['local','copilot','anthropic'] as const)for(const identityOnly of [true,false]){
  test(`${provider}: identity-only evidence ${identityOnly?'completes identity check':'cannot complete a content briefing'}`,async({page})=>{
   fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_whoami',inputSchema:{type:'object',properties:{}}}]}:{result:envelope({person:'Test Member'})}
   const calls=[{name:'one_mcp_search',input:{query:'atlas_whoami'}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_whoami',arguments:{}}}]
   let round=0;fake.onText=r=>{const c=calls[round++];return{model:r.model,text:c?'':'Atlas identity: Test Member.',calls:c?[{id:'identity'+round,name:c.name,arguments:c.input}]:[],inputTokens:100,outputTokens:20,usd:0}}
   const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'identity'+i,name:c.name,input:c.input}]})),text('Atlas identity: Test Member.')]):null
   if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
   const answer=await page.evaluate(async ({route,prompt})=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt,mcp:'fixed',route}),{route:{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL},prompt:identityOnly?'Check my Atlas identity. Read only.':'Read Atlas project tasks and provide a content briefing.'})
   expect(answer).toMatchObject({ok:identityOnly})
   if(identityOnly)expect(answer.text).toBe('Atlas identity: Test Member.')
   expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_whoami'])
  })
 }

})
