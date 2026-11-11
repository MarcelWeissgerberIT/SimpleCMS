import {createHash} from 'node:crypto'
import {test,expect,openApp,wsEval,MOD,reloadApp,createPage,gotoPage,editorOf,doc,para} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {mockClaudeScript,text,type ClaudeTurn} from './helpers/providers'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'
const PORT=47440,LOCAL='atlas-flow:latest',COPILOT='gpt-6.1-sol'
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
test.describe('Task splitting and source verification',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  // This suite uses a local workspace and a fake worker, including against the deployed frontend.
  await page.route('**/api/config',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Local workspace fixture</title>'}))
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


 const broad='Extract implemented features and associated requirements from the repos of Product A and Product B and describe them in EARS notation.'
 test('DE/EN suggestions only prepare an editable task and retain the original',async({page},info)=>{
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill(broad)
  const plan=term.getByRole('region',{name:'Split task',exact:true})
  await plan.locator('summary').click()
  await expect(plan.getByRole('button',{name:'Prepare step 2',exact:true})).toBeDisabled()
  await plan.getByRole('button',{name:'Prepare step 1',exact:true}).click()
  await expect(input).toHaveValue(/^Work stage 1\/4:/)
  expect(await input.inputValue()).toContain(broad)
  await plan.getByRole('button',{name:'Restore original request'}).click();await expect(input).toHaveValue(broad)
  await plan.getByLabel('Repository and feature for detailed work').fill('Product A · procedure release')
  await plan.getByRole('button',{name:'Prepare step 3',exact:true}).click()
  await expect(input).toHaveValue(/at most 5 EARS requirements/)
  expect(await input.inputValue()).toContain('Product A · procedure release')
  expect(fake.textAsked.length).toBe(0);expect(fake.mcpAsked.filter(r=>r.action==='call').length).toBe(0)
  await wsEval(page,s=>s.updateSettings({language:'de'}))
  const dePlan=page.getByRole('region',{name:'Auftrag aufteilen',exact:true})
  await expect(dePlan.locator('summary')).toHaveText('Auftrag in 4 Schritte aufteilen')
  await page.setViewportSize({width:390,height:844})
  expect(await dePlan.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
  await dePlan.screenshot({path:info.outputPath('task-plan-mobile-de.png')})
 })
 for(const stage of [false,true])test(`Anthropic: ${stage?'staged ONE page':'EARS requirements'} survives final verification`,async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:envelope({item:{ref:42,body:'When a record is updated, the application shall set its status to Draft.'}})}
  const calls=[{name:'one_mcp_search',arguments:{query:'atlas_get'}},{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:42}}},...(stage?[{name:'create_page',arguments:{title:'Requirements review fixture',markdown:'Feature: lifecycle. Source Ref 42. When a record is updated, the application shall set its status to Draft.'}}]:[])]
  const final=stage?'Die ONE-Seite wurde als Vorschlag angelegt; Übernahme noch offen. Quelle Ref 42.':'When a record is updated, the application shall set its status to Draft. Source Ref 42.'
  const host=await mockClaudeScript(page,[...calls.map((c,i):ClaudeTurn=>({blocks:[{type:'tool_use',id:'task-'+i,name:c.name,input:c.arguments}]})),text(final)])
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'anthropic',m:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill(stage?broad+' Prepare a ONE page for review.':'Read Atlas Ref 42 and write one EARS requirement here.');await input.press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  await expect(term.locator('.term-answer')).toContainText(final)
  expect(host.requests).toHaveLength(calls.length+1)
  if(stage){await expect(term.getByRole('region',{name:'Split task',exact:true})).toBeVisible();expect(JSON.stringify(host.requests)).toContain('Staged as change')}
 })
 test('a constraints-list lookup completes without a false MCP failure',async({page})=>{
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_constraints',inputSchema:{type:'object',properties:{}}}]}:{result:envelope({constraints:[{ref:42,title:'Mirror policy',body:'A mirror preserves the complete source. '+'x'.repeat(6000)}]})}
  const host=await mockClaudeScript(page,[
   {blocks:[{type:'tool_use',id:'lookup-1',name:'one_mcp_search',input:{query:'atlas_constraints'}}]},
   {blocks:[{type:'tool_use',id:'lookup-2',name:'one_mcp_call',input:{server:'atlas',name:'atlas_constraints',arguments:{}}}]},
   req=>{const results=req.body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((b:any)=>b.type==='tool_result');const raw=results.at(-1).content;const packed=JSON.parse(typeof raw==='string'?raw:raw[0].text);return{blocks:[{type:'tool_use',id:'lookup-3',name:'one_mcp_find_result',input:{result_id:packed.result_id,path:'/constraints',query:'mirror'}}]}},
   text('The mirror requires the complete source. No mirror has been created.'),
  ])
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'anthropic',m:DEFAULT_CLAUDE_MODEL})
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Read the Atlas constraints for a mirror and explain the rule.');await input.press('Enter')
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000})
  await expect(term.locator('.term-answer')).toContainText('The mirror requires the complete source.')
  expect(host.requests).toHaveLength(4)
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_constraints'])
  expect(JSON.stringify(host.requests.at(-1))).toContain('/constraints/0/body')
 })

 test('Polarion PDF stages retain originals in ONE and keep Atlas optional',async({page},info)=>{
  await page.keyboard.press(`${MOD}+j`)
  const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
  await input.fill('Export Polarion documents as PDFs into ONE and optionally transfer them to Atlas.')
  const plan=term.getByRole('region',{name:'Split task',exact:true})
  await plan.locator('summary').click()
  await expect(plan).toContainText('original PDF in ONE')
  await expect(plan).toContainText('Optional: transfer to Atlas')
  await plan.getByLabel('Polarion document or PDF attachment').fill('Security Configuration')
  await plan.getByRole('button',{name:'Prepare step 3',exact:true}).click()
  await expect(input).toHaveValue(/Do not transfer anything to Atlas/)
  await plan.getByRole('button',{name:'Restore original request'}).click()
  await wsEval(page,s=>s.updateSettings({language:'de'}))
  const dePlan=page.getByRole('region',{name:'Auftrag aufteilen',exact:true})
  await expect(dePlan).toContainText('Original-PDF in ONE')
  await page.setViewportSize({width:390,height:844})
  await dePlan.screenshot({path:info.outputPath('polarion-pdf-stages-de.png')})
  expect(fake.textAsked).toHaveLength(0);expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(0)
 })

 test('a read-only task reports a blocked sign-in without dispatch or a false connection error',async({page})=>{
  fake.onModelMcp=()=>({tools:[{server:'atlas',name:'atlas_polarion_connect',inputSchema:{type:'object',properties:{}} }]})
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
  const host=await mockClaudeScript(page,[
   {blocks:[{type:'tool_use',id:'boundary-1',name:'one_mcp_search',input:{query:'atlas_polarion_connect'}}]},
   {blocks:[{type:'tool_use',id:'boundary-2',name:'one_mcp_call',input:{server:'atlas',name:'atlas_polarion_connect',arguments:{}}}]},
   text('The requested task is read-only. No sign-in was started.'),
  ])
  const result=await page.evaluate(async model=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read only. Explain the Polarion connection status. Do not sign in.',mcp:'free',route:{p:'anthropic',m:model}}),DEFAULT_CLAUDE_MODEL)
  expect(result,JSON.stringify(result)).toMatchObject({ok:true})
  expect(host.requests).toHaveLength(3)
  expect(JSON.stringify(host.requests[2])).toContain('task_boundary')
  expect(JSON.stringify(host.requests[2])).toContain('oneNotExecuted')
  expect(fake.mcpAsked.filter(r=>r.action==='call')).toHaveLength(0)
 })

 for(const corrupt of [false,true])test(`native Polarion PDF file handoff ${corrupt?'rejects corrupt bytes':'saves verified original without inference'}`,async({page},info)=>{
  const job='11111111-1111-4111-8111-111111111111',bytes=Buffer.from('%PDF-1.4\noriginal native export fixture\n%%EOF'),pdf={name:'native-export.pdf',mime:'application/pdf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceUrl:'https://p2-polarion.pc-c.endress.com/polarion/#/project/CASE/wiki/Space/Document',exportedAt:'2026-11-11T15:00:00.000Z'};
  fake.onModelMcp=r=>r.action==='search'?{tools:['atlas_polarion_status','atlas_polarion_pdf_chunk'].map(name=>({server:'atlas',name,inputSchema:{type:'object',properties:{job:{type:'string'},index:{type:'integer'}}}}))}:{result:envelope(r.name==='atlas_polarion_status'?{job,status:'done',result:{status:'exported',source:'polarion-native-pdf',pdf}}:{job,index:0,chunkBytes:98304,pdf,data:(corrupt?Buffer.alloc(bytes.length):bytes).toString('base64')})};
  await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}));
  await page.evaluate(async route=>(await (window as any).__oneAI.rules()).setDeviceDefault([route]),{p:'anthropic',m:DEFAULT_CLAUDE_MODEL});
  const pageId=await createPage(page,'Polarion original source',doc(para('Keep this source.')));await gotoPage(page,pageId);
  const host=await mockClaudeScript(page,[{blocks:[{type:'tool_use',id:'pdf-1',name:'one_mcp_search',input:{query:'atlas_polarion_status'}}]},{blocks:[{type:'tool_use',id:'pdf-2',name:'one_mcp_call',input:{server:'atlas',name:'atlas_polarion_status',arguments:{job}}}]},text('The original PDF is ready for the file action.')]);
  await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'});
  await term.getByRole('textbox',{name:'Task for the agent'}).fill('Check the native Polarion PDF export status.');await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter');
  await expect(term.locator('.term-head__status')).toHaveText('Done',{timeout:25000});
  const card=term.getByRole('complementary',{name:'Polarion PDF'});await expect(card).toContainText('native-export.pdf');
  await card.getByRole('button',{name:'Save PDF in ONE'}).click();
  if(corrupt){await expect(card.getByRole('alert')).toContainText('validation failed');expect(await page.evaluate(()=>(window as any).__oneTerm.state.getState().changes.filter((c:any)=>c.kind==='media'))).toHaveLength(0)}
  else {
   await expect(card.getByRole('button',{name:'Saved in ONE · Review insertion'})).toBeDisabled();
   const media=await page.evaluate(()=>(window as any).__oneTerm.state.getState().changes.find((c:any)=>c.kind==='media').media[0]);
   expect(media.name).toBe(pdf.name);expect(media.caption).toContain(pdf.sha256);expect(media.caption).toContain(pdf.sourceUrl);
   const stored=await page.evaluate(async src=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('one-files');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});const rec:any=await new Promise((resolve,reject)=>{const q=db.transaction('files').objectStore('files').get(src.slice(8));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});return Array.from(new Uint8Array(await rec.blob.arrayBuffer()))},media.src);
   expect(Buffer.from(stored)).toEqual(bytes);
   await page.evaluate(async()=>{const term=(window as any).__oneTerm;await term.applyStaged([term.state.getState().changes.find((c:any)=>c.kind==='media').id])});
   await expect(card.getByRole('button',{name:'Saved and inserted in ONE'})).toBeDisabled();
   const content=await wsEval(page,(s,arg)=>s.pages[arg].content,pageId);expect(JSON.stringify(content)).toContain(media.src);expect(JSON.stringify(content)).toContain(pdf.sha256);
   await card.screenshot({path:info.outputPath('native-pdf-ready.png')});
   await wsEval(page,s=>s.updateSettings({language:'de'}));await page.setViewportSize({width:390,height:844});
   const german=page.getByRole('complementary',{name:'Polarion-PDF'});expect(await german.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await german.screenshot({path:info.outputPath('native-pdf-mobile-de.png')});
  }
  expect(host.requests).toHaveLength(3);expect(JSON.stringify(host.requests)).not.toContain(bytes.toString('base64'));
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_polarion_status','atlas_polarion_pdf_chunk']);
 });

})
