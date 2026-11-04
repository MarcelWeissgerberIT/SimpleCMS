import {test,expect,openApp,wsEval,MOD,createPage,gotoPage,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47495,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
test.describe('Source and effect validation',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'atlas-facts-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  await openApp(page)
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','workspace'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-facts',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'private-facts-token',enabled:true,prompt:'Use observed sources only.',tools:['atlas_get','atlas_update','atlas_comment','atlas_create','atlas_whoami'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('atlas-facts-fixture')
  await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await expect(page.getByTestId('worker-model-settings')).toContainText(COPILOT);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})

 test('changing the prepared workspace Atlas access stops a running task before its next call',async({page})=>{
  await wsEval(page,s=>{const id=s.createPage({title:'Prepared Atlas access',parentId:null});s.setWorkspaceAI({...s.ai,onboarding:{startPageId:id,mcpName:'atlas',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',project:'Fixture'}});s.updateSettings({workspaceMcpServers:[{...s.settings.mcpServers[0],url:'https://aj-atlas.com/api/atlas/mcp'}]})})
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'Original source'}})}
  let release!:()=>void,waiting=false,n=0;const pending=new Promise<void>(resolve=>{release=resolve})
  fake.onText=async r=>{const step=n++;if(step===1){waiting=true;await pending}return{model:r.model,text:'',calls:step===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_get'}}]:[{id:'read',name:'one_remote_1',arguments:{ref:42}}],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Read Atlas Ref 42. Read only.');await input.press('Enter')
  await expect.poll(()=>waiting).toBe(true)
  await wsEval(page,s=>s.updateSettings({workspaceMcpServers:s.settings.workspaceMcpServers.map((v:any)=>({...v,token:'replacement-workspace-token'}))}))
  release()
  await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:25000})
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(0)
 })

 test('an Atlas application refusal is a failed source read even when the transport returns success',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({ok:false,error:'permission denied'})}
  let n=0;fake.onText=r=>{const step=n++;return{model:r.model,text:step>1?'The source could not be read.':'',calls:step===0?[{id:'discover',name:'one_mcp_search',arguments:{query:'atlas_get'}}]:step===1?[{id:'read',name:'one_remote_1',arguments:{ref:42}}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Read Atlas Ref 42. Read only.');await input.press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Error',{timeout:25000})
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(1)
  const results=(fake.textAsked.at(-1)?.messages??[]).flatMap((m:any)=>{try{return JSON.parse(m.content)}catch{return []}}).filter((b:any)=>b.type==='tool_result'&&b.tool_use_id==='read')
  expect(results).toHaveLength(1);expect(JSON.parse(results[0].content).isError).toBe(true)
  await expect(term).toContainText('permission')
 })

 for(const provider of ['local','copilot','anthropic'] as const)test(provider+': a generic catalogue-declared read works in the compiled task without Atlas naming',async({page})=>{
  await wsEval(page,s=>s.updateSettings({mcpServers:[{id:'calendar-fixture',name:'calendar',url:'https://calendar.example.org/mcp',scope:'all',token:'private-calendar-fixture',enabled:true,prompt:'Find events using the actual catalogue.',tools:['find'],checkedAt:Date.now()}]}))
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'calendar',name:'find',readOnly:true,inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}]}:{result:envelope({events:[{id:'event-42',title:'Design review',time:'10:00'}]})}
  const steps=[{blocks:[{type:'tool_use' as const,id:'discover-calendar',name:'one_mcp_search',input:{query:'calendar'}}]},{blocks:[{type:'tool_use' as const,id:'read-calendar',name:'one_remote_1',input:{query:'Design review'}}]},text('Design review is at 10:00.')]
  const host=provider==='anthropic'?await mockClaudeScript(page,steps):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  let n=0;fake.onText=r=>{const step=steps[n++];return{model:r.model,text:step&&'blocks' in step?step.blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(''):'',calls:step&&'blocks' in step?step.blocks.filter((b:any)=>b.type==='tool_use').map((b:any)=>({id:b.id,name:b.name,arguments:b.input})):[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Read the Design review event from my calendar connection and tell me its time. Read only.');await input.press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  await expect(term).toContainText('Design review is at 10:00.')
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>[r.server,r.name,r.arguments])).toEqual([['calendar','find',{query:'Design review'}]])
 })

 for(const provider of ['local','copilot','anthropic'] as const)for(const succeeds of [true,false])test(provider+': inline missing source '+(succeeds?'is read before returning':'stops with a useful error after one repair'),async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'History lists all versions.'}})}
  const steps=succeeds?[text('Premature answer without reading.'),{blocks:[{type:'tool_use' as const,id:'discover',name:'one_mcp_search',input:{query:'atlas_get'}}]},{blocks:[{type:'tool_use' as const,id:'read',name:'one_mcp_call',input:{server:'atlas',name:'atlas_get',arguments:{ref:42}}}]},text('The source requires a history of all versions.')]:[text('Premature answer without reading.'),text('Still no read.')]
  const host=provider==='anthropic'?await mockClaudeScript(page,steps):null
  let n=0;fake.onText=r=>{const step=steps[n++],calls=step&&'blocks' in step?step.blocks.filter((b:any)=>b.type==='tool_use').map((b:any)=>({id:b.id,name:b.name,arguments:b.input})):[];return{model:r.model,text:step&&'blocks' in step?step.blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(''):'',calls,inputTokens:200,outputTokens:40,usd:0}}
  if(provider==='anthropic')await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  const result=await page.evaluate(async route=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read the current Atlas record 42 and summarize its body. Do not change anything.',mcp:'free',route}),provider==='anthropic'?{p:'anthropic',m:DEFAULT_CLAUDE_MODEL}:{p:provider,m:provider==='local'?LOCAL:COPILOT})
  const requests=host?.requests??fake.textAsked
  expect(requests).toHaveLength(succeeds?4:2)
  if(succeeds){expect(result).toMatchObject({ok:true,text:'The source requires a history of all versions.'});expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_get'])}
  else{expect(result).toMatchObject({ok:false,code:'bad_request',detail:'features.ai.transfer.sourcesMissing'});expect(fake.mcpAsked).toHaveLength(0)}
 })

 test('reviewed ONE page can become a new Atlas record without a pre-existing target',async({page})=>{
  const source=await createPage(page,{title:'ONE calibration draft',content:doc(para('The history shall list all calibration versions.'))})
  await gotoPage(page,source)
  let created=false
  const schemas=[{server:'atlas',name:'atlas_constraints',inputSchema:{type:'object',properties:{project:{type:'string'},kind:{type:'string'}},required:['project','kind']}},{server:'atlas',name:'atlas_create',inputSchema:{type:'object',properties:{title:{type:'string'},body:{type:'string'}},required:['title','body']}}]
  fake.onModelMcp=r=>r.action==='search'?{tools:schemas}:r.name==='atlas_constraints'?{result:envelope({project:'new-project',kind:'doc',allowed:true,requiredFields:['title','body'],existingRecords:0})}:r.name==='atlas_create'?(created=true,{result:envelope({ok:true,ref:44})}):{result:envelope({item:{ref:44,title:'Calibration draft',body:'The history shall list all calibration versions.'}})}
  const calls=[{name:'read_page',input:{id:source}},{name:'one_mcp_search',input:{query:'atlas_constraints atlas_create'}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_constraints',arguments:{project:'new-project',kind:'doc'}}},{name:'one_mcp_call',input:{server:'atlas',name:'atlas_create',arguments:{title:'Calibration draft',body:'The history shall list all calibration versions.'}}}]
  let n=0;fake.onText=r=>{const c=calls[n++];return{model:r.model,text:c?'':'Ref: 44 created and read back.',calls:c?[{id:'from-one-'+n,name:c.name,arguments:c.input}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Erstelle aus dieser ONE-Seite einen neuen Atlas-Record im Projekt new-project als doc.');await input.press('Enter')
  await expect(page.getByRole('dialog',{name:'How should this go to Atlas?'})).toHaveCount(0)
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  expect(created).toBe(true);expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_constraints','atlas_create','atlas_get'])
  await expect(term.getByRole('region',{name:'Atlas transfer receipt'})).toContainText('1 confirmed by read-back')
 })

 test('partial failure keeps accepted comments visible and never retries a write automatically',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment'].map(name=>({server:'atlas',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},body:{type:'string'}},required:['ref']}}))}:r.name==='atlas_get'?{result:envelope({item:{ref:r.arguments.ref,body:'Existing record body'}})}:r.arguments.ref===42?{result:envelope({ok:true,ref:42,id:'confirmed-comment'})}:{result:JSON.stringify({isError:true,content:[{type:'text',text:'Synthetic write failure. The outcome must be checked.'}]})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get atlas_comment'}},...[42,43].flatMap(ref=>[{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref}}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_comment',arguments:{ref,body:'Confirmed decision'}}}])]
  let n=0;fake.onText=r=>{const call=calls[n++];return{model:r.model,text:call?'':'One comment was accepted; the other transfer failed.',calls:call?[{id:'partial-'+n,...call}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Kommentiere die bestätigte Entscheidung in Atlas Ref 42 und 43.');await input.press('Enter');await expect(page.getByRole('dialog',{name:'How should this go to Atlas?'})).toHaveCount(0)
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
 for(const provider of ['local','copilot','anthropic'] as const)test(provider+': personal follow-up receives a fresh verified identity before inference',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_whoami',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}:{result:envelope({person:'Kai Röther',memberships:[{tenant:'analytik-jena',role:'user'}]})}
  fake.onText=r=>({model:r.model,text:'Identität: Kai Röther. Nichts gespeichert.',calls:[],inputTokens:200,outputTokens:40,usd:0})
  const host=provider==='anthropic'?await mockClaudeScript(page,[text('Identität: Kai Röther. Nichts gespeichert.')]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  const result=await page.evaluate(async route=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Erledige das in meinem Namen',mcp:'free',route}),{p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL})
  expect(result.ok).toBe(true);expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_whoami'])
  const requests=host?.requests??fake.textAsked;expect(requests).toHaveLength(1);expect(JSON.stringify(requests[0])).toContain('oneCurrentIdentity');expect(JSON.stringify(requests[0])).toContain('Kai Röther')
 })
 for(const provider of ['local','copilot','anthropic'] as const)for(const surface of ['inline','terminal'] as const)test(provider+' '+surface+': missing original section is read through retained literal lookup before the answer',async({page})=>{
  const body='# Long source\n'+'Introductory text.\n'.repeat(900)+'\n## AC-17 Transport\nThe Type field carries only a number.\n\n## AC-20 Other\nNo change.\n'
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body}})}
  const call=(name:string,input:Record<string,unknown>)=>({blocks:[{type:'tool_use' as const,id:crypto.randomUUID(),name,input}]})
  const step=(messages:unknown,n:number)=>{
   const serialized=JSON.stringify(messages),id=serialized.match(/mcp-result-[a-f0-9]+-\d+/)?.[0]
   if(n===0)return call('one_mcp_search',{query:'atlas_get'})
   if(n===1)return call('one_mcp_call',{server:'atlas',name:'atlas_get',arguments:{ref:42}})
   if(n===2)return call('one_mcp_read_result',{result_id:id,path:'/item/body'})
   if(n===3)return text('Proposal for AC-17 in https://atlas.example.org/r/42: use a number.')
   if(n===4){expect(serialized).toContain('Required lookups');return call('one_mcp_find_result',{result_id:id,path:'/item/body',query:'AC-17'})}
   expect(serialized).toContain('The Type field carries only a number.');return text('AC-17 in https://atlas.example.org/r/42 requires the Type field to carry only a number. No changes saved.')
  }
  let n=0;fake.onText=r=>{const s=step(r.messages,n++);return{model:r.model,text:s.blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(''),calls:s.blocks.filter((b:any)=>b.type==='tool_use').map((b:any)=>({id:b.id,name:b.name,arguments:b.input})),inputTokens:200,outputTokens:40,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,Array.from({length:6},(_,i)=>(r:any)=>step(r.body.messages,i))):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test'}))
  const route={p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL}
  if(surface==='inline'){
   const result=await page.evaluate(async route=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas ref 42 and propose the wording for AC-17. Do not change anything.',mcp:'free',route}),route)
   expect(result).toMatchObject({ok:true})
  }else{
   await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),route)
   await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
   await input.fill('Read Atlas ref 42 and propose the wording for AC-17. Do not change anything.');await input.press('Enter')
   await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});await expect(term).toContainText('requires the Type field')
  }
  expect(host?.requests??fake.textAsked).toHaveLength(6)
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_get'])
 })
 test('a partial source cannot authorize replacing an entire Atlas body',async({page})=>{
  let body='Long original source.\n'.repeat(900)
  const schema=(name:string)=>({server:'atlas',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},replaceBody:{type:'string'},appendBody:{type:'string'}},required:['ref']}})
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_update'].map(schema)}:r.name==='atlas_get'?{result:envelope({item:{ref:42,body}})}:(body+=String(r.arguments.appendBody??''),{result:envelope({ok:true,ref:42})})
  let n=0;fake.onText=r=>{const id=JSON.stringify(r.messages).match(/mcp-result-[a-f0-9]+-\d+/)?.[0],calls=[{name:'one_mcp_search',arguments:{query:'atlas_get atlas_update'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},{name:'one_mcp_read_result',arguments:{result_id:id,path:'/item/body'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_update',arguments:{ref:42,replaceBody:'Destructive incomplete reconstruction'}}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_update',arguments:{ref:42,appendBody:'\nConfirmed answer.'}}}],c=calls[n++];return{model:r.model,text:c?'':'Ref: 42 answer appended; original content preserved.',calls:c?[{id:'unread-'+n,...c}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Bitte den Inhalt in Atlas aktualisieren.');await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  const writes=fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_update');expect(writes).toHaveLength(1);expect(writes[0].arguments).toEqual({ref:42,appendBody:'\nConfirmed answer.'});expect(body).toContain('Long original source.');expect(body).not.toContain('Destructive');expect(JSON.stringify(fake.textAsked)).toContain('only partially read')
 })

})
