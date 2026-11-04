import {test,expect,openApp,wsEval,MOD,createPage,gotoPage,editorOf,doc,para,selectText} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47497,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
const schema=(name:string)=>({server:'knowledge',name,inputSchema:{type:'object',properties:{ref:{type:'integer'},body:{type:'string'},replaceBody:{type:'string'},status:{type:'string'},project:{type:'string'},kind:{type:'string'}},additionalProperties:false}})
test.describe('Contextual tool requests',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'context-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.textModels=[{provider:'local',model:LOCAL,context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:COPILOT,context:65536,chat:true,maxOutput:8192}]
  await openApp(page)
  // Captured editor references require a provider allowed to see unfiltered page-derived text.
  await wsEval(page,s=>{const allow=['public','structure','selection','page','rows','files','workspace','people','transcript'];const personal=['private','mail','memory','mcp'];s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}});s.updateSettings({ai:{allow:{local:personal,copilot:personal}},mcpServers:[{id:'knowledge-fixture',name:'knowledge',codeword:'atlas',url:'https://atlas.example.org/mcp',scope:'free',token:'private-fixture-token',enabled:true,prompt:'Use actual schemas and sources.',tools:['atlas_get','atlas_comment','atlas_update','atlas_constraints'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/Coding worker/}).click();await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter');await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('context-fixture');await page.getByRole('tab',{name:/AI$/}).click();await expect(page.getByTestId('worker-model-settings')).toContainText(LOCAL);await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})
 for(const provider of ['local','copilot','anthropic'] as const)for(const kind of ['comment','update'] as const)test(provider+': codeword '+kind+' uses selected context and discovered functions without a fixed picker',async({page})=>{
  const chosen='Confirmed decision Z17: use the agreed Type field. Target https://atlas.example.org/r/42',other='UNSELECTED_OTHER_CONTENT must not become the comment.'
  const id=await createPage(page,{title:'Context source',content:doc(para(chosen),para(other))});await gotoPage(page,id)
  let stored='Current target body'
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment','atlas_update'].map(schema)}:r.name==='atlas_get'?{result:envelope({item:{ref:42,status:'new',body:stored}})}:(stored=kind==='update'?'Confirmed decision Z17: use the agreed Type field.':stored,{result:envelope({ok:true,ref:42,id:'comment-1'})})
  const op=kind==='comment'?'atlas_comment':'atlas_update',arg=kind==='comment'?{ref:42,body:'Confirmed decision Z17: use the agreed Type field.'}:{ref:42,replaceBody:'Confirmed decision Z17: use the agreed Type field.'}
  const calls=[{name:'one_mcp_search',arguments:{query:'record read update comment'}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_get',arguments:{ref:42}}},...(kind==='comment'?[{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_update',arguments:{ref:42,status:'done'}}}]:[]),{name:'one_mcp_call',arguments:{server:'knowledge',name:op,arguments:arg}}]
  let n=0;fake.onText=r=>{const c=calls[n++];return{model:r.model,text:c?'':'Record 42: requested change accepted.',calls:c?[{id:'context-'+n,...c}]:[],inputTokens:200,outputTokens:40,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'context-'+i,name:c.name,input:c.arguments}]})),text('Record 42: requested change accepted.')]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-context'}))
  const route={p:provider,m:provider==='local'?LOCAL:provider==='copilot'?COPILOT:DEFAULT_CLAUDE_MODEL};await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),route)
  const ed=editorOf(page,id);await ed.locator('p').first().click();await selectText(page,ed,chosen);await page.locator('[aria-label="Formatting"]').first().getByRole('button',{name:/^Ask AI$/}).click()
  const ask=page.getByRole('dialog',{name:'Ask AI'}).getByRole('textbox').first();await expect(ask).toBeVisible();await ask.fill(kind==='comment'?'atlas:comment einfügen':'atlas:record updaten');await page.locator('#ai-row-custom').click()
  const term=page.getByRole('region',{name:'AI terminal'});await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  await expect(page.getByRole('dialog',{name:/How should this go to Atlas|What should be closed/})).toHaveCount(0)
  const first=JSON.stringify((host?.requests??fake.textAsked)[0]);expect(first).toContain('Confirmed decision Z17');expect(first).not.toContain(other);expect(first).not.toContain('Atlas delivery:')
  expect(fake.mcpAsked.filter(r=>r.action==='call'&&['atlas_update','atlas_comment'].includes(r.name)).map(r=>({name:r.name,args:r.arguments}))).toEqual([{name:op,args:arg}])
 })
 for(const provider of ['local','anthropic'] as const)test(provider+': page and subpages resolve context, then the model asks which target to update',async({page},info)=>{
  const root=await createPage(page,{title:'Parent context',content:doc(para('Decisions are on the child page.'),para(''))})
  const child=await createPage(page,{parentId:root,title:'Decision details',content:doc(para('Decision C44: store the confirmed answer. Two possible targets: https://atlas.example.org/r/42 and https://atlas.example.org/r/43.'))});await gotoPage(page,root)
  const bodies:Record<number,string>={42:'Target A untouched',43:'Target B original'}
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_update'].map(schema)}:r.name==='atlas_get'?{result:envelope({item:{ref:r.arguments.ref,status:'new',body:bodies[r.arguments.ref as number]}})}:(bodies[r.arguments.ref as number]=String(r.arguments.replaceBody),{result:envelope({ok:true,ref:r.arguments.ref})})
  const calls=[{name:'read_page',arguments:{id:root}},{name:'read_page',arguments:{id:child}},{name:'one_mcp_search',arguments:{query:'record get update'}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_get',arguments:{ref:42}}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_get',arguments:{ref:43}}},{name:'one_task_question',arguments:{question:'Auf welchen der beiden verlinkten Records soll die bestätigte Entscheidung?',needed_for:'Genau einen der tatsächlich gelesenen Ziel-Records aktualisieren',options:[{label:'Record 42',effect:'Nur den Inhalt von Record 42 aktualisieren'},{label:'Record 43',effect:'Nur den Inhalt von Record 43 aktualisieren'}]}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_update',arguments:{ref:43,status:'done'}}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_update',arguments:{ref:43,replaceBody:'Decision C44: confirmed answer.'}}}]
  let n=0;fake.onText=r=>{const c=calls[n++];return{model:r.model,text:c?'':'Record 43 updated; record 42 and ticket status unchanged.',calls:c?[{id:'tree-'+n,...c}]:[],inputTokens:200,outputTokens:40,usd:0}}
  const host=provider==='anthropic'?await mockClaudeScript(page,[...calls.map((c,i)=>({blocks:[{type:'tool_use' as const,id:'tree-'+i,name:c.name,input:c.arguments}]})),text('Record 43 updated; record 42 and ticket status unchanged.')]):null
  if(host)await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-context'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:provider,m:provider==='local'?LOCAL:DEFAULT_CLAUDE_MODEL})
  // The page dialog and terminal share the same explicit subtree choice.
  const ed=editorOf(page,root);await ed.locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Space')
  const panel=page.getByRole('dialog',{name:'Ask AI'});await page.getByTestId('ai-reads').click();await panel.getByRole('option',{name:/This page and subpages/}).click();await expect(page.getByTestId('ai-reads')).toContainText('page + subpages')
  await page.getByPlaceholder('Ask AI to write anything…').fill('atlas:record updaten');await page.locator('#ai-row-custom').click()
  const term=page.getByRole('region',{name:'AI terminal'}),card=term.getByRole('region',{name:'Compiled task'})
  await expect(card.getByRole('button',{name:'Bind answer and continue',exact:true})).toBeVisible({timeout:25000});expect(bodies).toEqual({42:'Target A untouched',43:'Target B original'})
  await expect(card.locator('.task-contract__decision p strong')).toBeInViewport()
  expect(await page.evaluate(()=>window.scrollY)).toBe(0)
  const first=JSON.stringify((host?.requests??fake.textAsked)[0]);expect(first).toContain('Selected ONE source scope: this page and its subpages');expect(first).not.toContain('Atlas delivery:');expect(JSON.stringify(host?.requests??fake.textAsked)).toContain('Decision C44')
  if(provider==='local')for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s:any,theme:any)=>s.updateSettings({theme}),theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await card.locator('.task-contract__decision').evaluate(el=>{const scroll=el.closest<HTMLElement>('.term-scroll');if(scroll)scroll.scrollTop+=el.getBoundingClientRect().top-scroll.getBoundingClientRect().top});expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`context-question-${theme}-${width}.png`),animations:'disabled'})}
  await card.getByLabel('Your specification').fill('Record 43 updaten. Ticketstatus unverändert.');await card.getByRole('button',{name:'Bind answer and continue',exact:true}).click();await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  expect(bodies).toEqual({42:'Target A untouched',43:'Decision C44: confirmed answer.'});expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_update').map(r=>r.arguments)).toEqual([{ref:43,replaceBody:'Decision C44: confirmed answer.'}])
 })
 test('a different configured codeword works without Atlas-specific routing',async({page})=>{
  await wsEval(page,s=>s.updateSettings({mcpServers:s.settings.mcpServers.map((c:any)=>({...c,codeword:'wissen'}))}))
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_get','atlas_comment'].map(schema)}:r.name==='atlas_get'?{result:envelope({item:{ref:42,body:'Existing content'}})}:{result:envelope({ok:true,ref:42})}
  const calls=[{name:'one_mcp_search',arguments:{query:'record read comment'}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_get',arguments:{ref:42}}},{name:'one_mcp_call',arguments:{server:'knowledge',name:'atlas_comment',arguments:{ref:42,body:'Confirmed context answer'}}}]
  let n=0;fake.onText=r=>{const c=calls[n++];return{model:r.model,text:c?'':'Record 42: comment accepted.',calls:c?[{id:'alias-'+n,...c}]:[],inputTokens:200,outputTokens:40,usd:0}}
  await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),LOCAL)
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('wissen:comment einfügen in Record 42: Confirmed context answer');await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  expect(fake.mcpAsked.filter(r=>r.action==='call'&&r.name==='atlas_comment')).toHaveLength(1);expect(JSON.stringify(fake.textAsked[0])).toContain('The person addressed knowledge by its codeword')
 })
})
