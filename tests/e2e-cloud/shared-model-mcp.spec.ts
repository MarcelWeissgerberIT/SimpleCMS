import {test,expect,email,signIn,openApp,waitOnline,createWorkspace,api,wsEval} from './fixtures'
import {modelShareKey,sharedWorkerKey,openShared,sealShared,SHARED_PREFIX} from '../../src/shared/ai/shared-model'
import {startFakeWorker} from '../e2e/helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'

test('shared inference cooperates with the requesting member’s personal Atlas worker, without model-host credentials',async({page},info)=>{
 const fake=await startFakeWorker(47422,{worker:'1.34.0',name:'personal-mcp-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true})
 fake.can=[...WORKER_CAN]
 let timer:ReturnType<typeof setInterval>|undefined,polling=false
 try{
  await openApp(page);await signIn(page,email('share-atlas'));await openApp(page)
  const ws=await createWorkspace(page,'Shared Atlas inference');await openApp(page,ws);await waitOnline(page)
  const {json:w}=await api<any>(page,'POST',`/api/workspaces/${ws}/coding/workers`,{label:'Inference host'})
  const origin=new URL(page.url()).origin,keys=await modelShareKey(),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey)
  const worker=async(path:string,data:unknown,method='POST')=>{const r=await fetch(origin+'/api/coding/shared-model/'+path,{method,headers:{authorization:'Bearer '+w.token,'Content-Type':'application/json'},body:JSON.stringify(data)});expect(r.ok).toBe(true);return r.json() as Promise<any>}
  await worker('config',{model:'fixture-local',label:'Atlas Flow shared',enabled:true},'PUT')
  const poll={publicKey,dataFlow:true,tools:true,busy:false,available:true,active:null}
  await worker('poll',poll)
  await wsEval(page,s=>{s.setWorkspaceAI({policy:{restricted:[],providers:{local:{allow:['public','selection','page','structure','rows','workspace']}}}});s.updateSettings({ai:{allow:{local:['mcp']}},mcpServers:[{id:'atlas-fixture',name:'atlas',url:'https://atlas.example.org/mcp',token:'requester-only-private-token',enabled:true,prompt:'Use approved project sources.',tools:['atlas_get'],checkedAt:Date.now()}]})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click()
  await page.getByLabel('Port',{exact:true}).fill('47422');await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
  await expect(page.getByTestId('coding-conn')).toContainText('personal-mcp-fixture')
  await page.getByRole('tab',{name:/AI$/}).click()
  await expect(page.getByTestId('shared-model-settings')).toContainText('Atlas Flow shared')
  await page.keyboard.press('Escape')
  fake.onModelMcp=r=>r.action==='search'?{tools:[{server:'atlas',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}}]}:{result:JSON.stringify({content:[{type:'text',text:'Requirement 43: approved fixture.'}]})}
  let rounds=0
  const seen:any[]=[]
  const tick=async()=>{
   if(polling)return;polling=true
   try{
    const r=await worker('poll',poll);if(!r.job)return
    const key=await sharedWorkerKey(r.job.box,keys.privateKey),request:any=await openShared(r.job.box,key,w.id,r.job.id);seen.push(request)
    const n=rounds++,result={model:'fixture-local',text:n===0?'Tool unavailable.<tool_call>':n===3?JSON.stringify({answer:'Requirement 43 verified from Atlas.'}):'',inputTokens:200,outputTokens:30,usd:0,...(n>0&&n<3?{calls:[n===1?{id:'s1',name:'one_mcp_search',arguments:{query:'atlas_get'}}:{id:'c1',name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_get',arguments:{ref:43}}}]}:{})}
    await worker('poll',{...poll,outcome:{id:r.job.id,box:await sealShared({ok:true,result},key,w.id,r.job.id)}})
   }finally{polling=false}
  }
  timer=setInterval(()=>void tick().catch(()=>{}),100)
  const answer=await page.evaluate(async m=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas requirement 43.',structured:true,route:{p:'local',m},pick:{server:'atlas',reads:['atlas_get']}}),SHARED_PREFIX+w.id)
  expect(answer,JSON.stringify(seen)).toEqual({ok:true,text:'{"answer":"Requirement 43 verified from Atlas."}'})
  expect(seen).toHaveLength(4);expect(JSON.stringify(seen[1].messages)).toContain('only format-correction retry');expect(JSON.stringify(seen)).toContain('Requirement 43: approved fixture')
  expect(JSON.stringify(seen)).not.toContain('requester-only-private-token')
  expect(fake.textAsked).toHaveLength(0)
  expect(fake.mcpAsked.find(r=>r.action==='call')).toMatchObject({name:'atlas_get',servers:[{allow:['atlas_get'],token:'requester-only-private-token'}]})
  // A shared inference host cannot replace the requesting member's personal MCP worker.
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click()
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
  await page.keyboard.press('Escape')
  const offline=await page.evaluate(async m=>(window as any).__oneAI.ask({purpose:'palette.ask',prompt:'Read Atlas identity.',structured:true,route:{p:'local',m},pick:{server:'atlas',reads:['atlas_get']}}),SHARED_PREFIX+w.id)
  expect(offline.ok).toBe(false)
  expect(JSON.stringify(offline)).toContain('features.ai.local.mcpWorker')
  expect(seen).toHaveLength(4)
  // Even a capable shared host still cannot receive private memory automatically.
  const privateMemory=await page.evaluate(m=>(window as any).__oneAI.precheck({purpose:'palette.ask',sources:[],carries:['memory'],route:{p:'local',m}}),SHARED_PREFIX+w.id)
  expect(privateMemory.ok).toBe(false)
  await info.attach('shared-tool-inference',{body:JSON.stringify(seen),contentType:'application/json'})
 }finally{if(timer)clearInterval(timer);while(polling)await new Promise(r=>setTimeout(r,20));await fake.close()}
})
