import {test,expect,email,signIn,openApp,waitForApp,waitOnline,createWorkspace,api,wsEval,newPerson,join} from './fixtures'
import {startFakeWorker} from '../e2e/helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
import {modelShareKey,sharedWorkerKey,openShared,sealShared} from '../../src/shared/ai/shared-model'
const guideId='first-start-guide',readiness='first-start-checks'
const promptDoc={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Ein Schritt nach dem anderen'}]},{type:'paragraph',content:[{type:'text',text:'Eigenes Konto → Worker → Atlas → Copilot → Atlas Flow → erste Arbeitsnotiz. Die Tests lesen nur die freigegebene Demo.'}]}]}
test('an invited member prepares both real routes from the illustrated guide; guests keep the read-only path',async({page:owner,context},info)=>{
 test.setTimeout(120000)
 const fake=await startFakeWorker(47428,{worker:'1.34.1',name:'Workshop-Laptop',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN];fake.textModels=[{provider:'copilot',model:'auto',context:32768,chat:true}]
 let timer:ReturnType<typeof setInterval>|undefined,polling=false
 const member=await newPerson(context),viewer=await newPerson(context)
 member.setDefaultTimeout(10000);viewer.setDefaultTimeout(10000)
 try{
  await openApp(owner);await signIn(owner,email('workshop-host'));await openApp(owner)
  const ws=await createWorkspace(owner,'ONE Workshop · Dev Hub Karlsruhe');await openApp(owner,ws);await waitOnline(owner)
  await wsEval(owner,s=>{const now=Date.now();for(const [id,title]of [['first-start-checks','Startampel'],['first-start-guide','Dein Erststart mit ONE und Atlas']]){s.createPage({id,title,content:{type:'doc',content:[{type:'paragraph'}]}})}s.updatePageSettings('first-start-guide',{locked:true,firstStart:{v:1,project:'one-webserver-demo',record:31503,readinessPage:'first-start-checks'}});s.setWorkspaceAI({policy:{restricted:[],providers:{local:{allow:['public','selection','page','structure','rows','workspace']},copilot:{allow:['public','selection','page','structure','rows','workspace']}}}})})
  await wsEval(owner,(s,doc)=>s.setContent('first-start-guide',doc,'e2e'),promptDoc)
  const {json:w}=await api<any>(owner,'POST',`/api/workspaces/${ws}/coding/workers`,{label:'Workshop Modellhost'})
  const origin=new URL(owner.url()).origin,keys=await modelShareKey(),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey)
  const host=async(data:any)=>{const r=await fetch(origin+'/api/coding/shared-model/poll',{method:'POST',headers:{authorization:'Bearer '+w.token,'Content-Type':'application/json'},body:JSON.stringify(data)});expect(r.ok).toBe(true);return r.json() as Promise<any>}
  const cfg=await fetch(origin+'/api/coding/shared-model/config',{method:'PUT',headers:{authorization:'Bearer '+w.token,'Content-Type':'application/json'},body:JSON.stringify({model:'atlas-flow:latest',label:'Atlas Flow · Workshop',enabled:true})});expect(cfg.ok).toBe(true)
  const poll={publicKey,dataFlow:true,tools:true,busy:false,available:true,active:null};await host(poll)
  await openApp(member);await signIn(member,email('teilnehmer'));await join(owner,member,ws,'member');await openApp(member,ws);await waitOnline(member)
  await wsEval(member,s=>s.updateSettings({language:'de',ai:{allow:{local:['mcp'],copilot:['mcp']}},mcpServers:[{id:'atlas-start',name:'atlas',url:'https://atlas.example.test/api/atlas/mcp',token:'test-only-not-a-user-token',enabled:true,prompt:'Use the approved demo only.',tools:['atlas_whoami','atlas_get'],checkedAt:Date.now()}]}))
  const entry=member.getByTestId('first-start-entry');await expect(entry).toContainText('Schritt für Schritt starten')
  await member.screenshot({path:info.outputPath('01-einstieg.png'),animations:'disabled'})
  await entry.getByRole('button',{name:'Schritt für Schritt starten'}).click()
  const panel=member.getByTestId('first-start-tools');await expect(panel).toContainText('Team · eigener Zugang')
  await expect(panel.getByRole('button',{name:'Copilot-Test vorbereiten'})).toBeDisabled()
  await panel.getByRole('button',{name:'Worker einrichten'}).click()
  await member.getByRole('radio',{name:'Cloud',exact:true}).click()
  await member.screenshot({path:info.outputPath('02-worker-cloud.png'),animations:'disabled'})
  await member.getByRole('radio',{name:'Lokal',exact:true}).click()
  await member.getByLabel('Port',{exact:true}).fill('47428');await member.getByLabel('Port',{exact:true}).press('Enter')
  await member.getByRole('switch',{name:'Mit einem Coding-Worker auf diesem Rechner verbinden'}).click()
  await expect(member.getByTestId('coding-conn')).toContainText('Workshop-Laptop')
  await member.keyboard.press('Escape')
  // Synthetic protected welcome card: no real participant link or token enters screenshots.
  await member.route(`**/api/workspaces/${ws}/welcome-access`,r=>r.fulfill({json:[{id:'fixture-access'}]}))
  await member.route(`**/api/workspaces/${ws}/welcome-access/fixture-access/open`,r=>r.fulfill({json:{name:'Workshop-Teilnehmer',atlasLink:'https://atlas.example.test/?token=synthetic-example-not-valid',atlasToken:''}}))
  await member.reload();await waitForApp(member);await waitOnline(member)
  await member.getByTestId('atlas-welcome').getByRole('button',{name:'Atlas-Zugang einrichten'}).click()
  await expect(member.getByRole('dialog')).toContainText('Dein persönlicher Atlas-Zugang')
  await member.screenshot({path:info.outputPath('03-persoenlicher-atlas-zugang.png'),animations:'disabled'})
  await member.keyboard.press('Escape')
  await panel.getByRole('button',{name:'Modelle und Atlas MCP'}).click()
  await member.getByTestId('mcp-servers').locator('.mcps-card[data-id="atlas-start"] button[aria-expanded]').click()
  await member.getByTestId('mcp-check-setup').scrollIntoViewIfNeeded()
  await member.screenshot({path:info.outputPath('04-atlas-mcp.png'),animations:'disabled'})
  await member.keyboard.press('Escape')
  await panel.screenshot({path:info.outputPath('08-erststart-1440.png'),animations:'disabled'})
  let copilotRound=0,flowRound=0
  const reply=(n:number,model:string)=>({model,text:n===4?'Atlas-Zugriff bestätigt. Projekt one-webserver-demo · Record 31503 · Demo-Auftrag. Nächster Schritt: eine kurze Arbeitsnotiz in ONE vorbereiten.':'',inputTokens:100,outputTokens:20,usd:0,...(n<4?{calls:[n%2===0?{id:'find-'+n,name:'one_mcp_search',arguments:{query:n===0?'atlas_whoami':'atlas_get'}}:{id:'call-'+n,name:'one_mcp_call',arguments:{server:'atlas',name:n===1?'atlas_whoami':'atlas_get',arguments:n===1?{}:{ref:31503}}}]}:{})})
  fake.onText=r=>reply(copilotRound++,r.model)
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:r.query,inputSchema:{type:'object',properties:r.query==='atlas_get'?{ref:{type:'integer'}}:{}}}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify(r.name==='atlas_get'?{item:{ref:31503,project:'one-webserver-demo',title:'Demo-Auftrag',body:'Approved workshop demo source.'}}:{name:'Workshop-Teilnehmer',tenant:'one'})}]})}
  const seen:any[]=[]
  timer=setInterval(()=>void(async()=>{if(polling)return;polling=true;try{const r=await host(poll);if(!r.job)return;const key=await sharedWorkerKey(r.job.box,keys.privateKey),input=await openShared<any>(r.job.box,key,w.id,r.job.id);seen.push(input);await host({...poll,outcome:{id:r.job.id,box:await sealShared({ok:true,result:reply(flowRound++,'atlas-flow:latest')},key,w.id,r.job.id)}})}finally{polling=false}})().catch(()=>{}),100)
  await expect(panel.getByRole('button',{name:'Copilot-Test vorbereiten'})).toBeEnabled()
  await panel.getByRole('button',{name:'Copilot-Test vorbereiten'}).click()
  const term=member.getByRole('region',{name:'KI-TERMINAL'}),input=term.getByRole('textbox',{name:'Aufgabe für den Agenten'})
  await expect(input).toHaveValue(/atlas_whoami.*atlas_get/)
  expect(fake.textAsked).toHaveLength(0)
  await expect(term.locator('.term-head')).toContainText('GitHub Copilot')
  await member.screenshot({path:info.outputPath('05-copilot-prompt.png'),animations:'disabled'})
  await input.press('Enter');await expect(term.locator('.term-answer')).toContainText('Atlas-Zugriff bestätigt',{timeout:20000})
  expect(fake.mcpAsked.filter(r=>r.action==='call').map(r=>r.name)).toEqual(['atlas_whoami','atlas_get'])
  await member.screenshot({path:info.outputPath('06-copilot-nachweis.png'),animations:'disabled'})
  await term.getByRole('button',{name:'Terminal ausblenden',exact:true}).click()
  await panel.getByRole('button',{name:'Atlas-Flow-Test vorbereiten'}).click()
  await expect(term.locator('.term-head')).toContainText('ATLAS FLOW')
  expect(seen).toHaveLength(0)
  await input.press('Enter');await expect.poll(()=>seen.length,{timeout:30000}).toBe(5);await expect(term.locator('.term-answer')).toHaveCount(2);await expect(term.locator('.term-answer').last()).toContainText('Atlas-Zugriff bestätigt',{timeout:25000})
  expect(seen).toHaveLength(5);expect(JSON.stringify(seen)).not.toContain('test-only-not-a-user-token');expect(fake.textAsked).toHaveLength(5)
  await member.screenshot({path:info.outputPath('07-atlas-flow-nachweis.png'),animations:'disabled'})
  // Existing work is never replaced by the guide, even for the other model.
  await input.fill('Mein bestehender Entwurf');await term.getByRole('button',{name:'Terminal ausblenden',exact:true}).click()
  await expect(panel.getByRole('button',{name:'Copilot-Test vorbereiten'})).toBeDisabled()
  for(const width of [1440,390]){await member.setViewportSize({width,height:1000});expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await member.screenshot({path:info.outputPath(`layout-${width}.png`),animations:'disabled'})}
  await openApp(viewer);await signIn(viewer,email('gast'));await join(owner,viewer,ws,'viewer');await openApp(viewer,ws);await waitOnline(viewer)
  await viewer.getByTestId('first-start-entry').getByRole('button',{name:'Start step by step'}).click()
  const guest=viewer.getByTestId('first-start-tools');await expect(guest).toContainText('Guest · read only');await expect(guest.getByRole('button',{name:'Prepare Copilot test'})).toHaveCount(0);await expect(guest.getByRole('button',{name:'Set up worker'})).toHaveCount(0)
  await viewer.screenshot({path:info.outputPath('09-gastpfad.png'),animations:'disabled'})
  await viewer.route(`**/api/workspaces/${ws}/welcome-access`,r=>r.fulfill({json:[{id:'guest-fixture'}]}))
  await viewer.route(`**/api/workspaces/${ws}/welcome-access/guest-fixture/open`,r=>r.fulfill({json:{name:'Workshop guest',atlasLink:'https://atlas.example.test/?token=guest-test-only',atlasToken:''}}))
  await viewer.reload();await waitForApp(viewer);await waitOnline(viewer)
  await viewer.getByTestId('atlas-welcome').getByRole('button',{name:'Set up Atlas access'}).click()
  await expect(viewer.getByRole('dialog')).toContainText('separate Atlas browser sign-in')
  await expect(viewer.getByRole('dialog').getByRole('button',{name:'Set up Atlas MCP'})).toHaveCount(0)
  await expect(viewer.getByRole('dialog').getByLabel('Atlas agent token',{exact:true})).toHaveCount(0)
  await member.reload();await waitForApp(member);await waitOnline(member);await expect(member.getByTestId('first-start-tools')).toBeVisible()
 }finally{if(timer)clearInterval(timer);while(polling)await new Promise(r=>setTimeout(r,20));await fake.close();await member.context().close();await viewer.context().close()}
})
