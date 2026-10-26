import {test,expect,email,signIn,openApp,waitOnline,createWorkspace,api,wsEval} from './fixtures'
import {modelShareKey,sharedWorkerKey,openShared,sealShared,SHARED_PREFIX} from '../../src/shared/ai/shared-model'

test('shared local model appears and answers without a participant worker; settings remain bounded',async({page},info)=>{
 await openApp(page);await signIn(page,email('share-ui'));await openApp(page)
 const ws=await createWorkspace(page,'Workshop local model test');await openApp(page,ws);await waitOnline(page)
 const {json:w}=await api<any>(page,'POST',`/api/workspaces/${ws}/coding/workers`,{label:'Synthetic host'})
 const origin=new URL(page.url()).origin,keys=await modelShareKey(),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey)
 const worker=async(path:string,data:unknown,method='POST')=>{const r=await fetch(origin+'/api/coding/shared-model/'+path,{method,headers:{authorization:'Bearer '+w.token,'Content-Type':'application/json'},body:JSON.stringify(data)});expect(r.ok).toBe(true);return r.json() as Promise<any>}
 await worker('config',{model:'fixture-local',label:'Workshop · Marcels Modell',enabled:true},'PUT')
 await worker('poll',{publicKey,busy:false,available:true,active:null})
 await wsEval(page,s=>s.setWorkspaceAI({policy:{restricted:[],providers:{local:{allow:['public','selection','page','structure','rows','workspace']}}}}))
 await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
 await page.getByRole('tab',{name:/AI$/}).click()
 const settings=page.getByTestId('shared-model-settings')
 await expect(settings).toContainText('Workshop · Marcels Modell');await expect(settings).toContainText('ONLINE')
 await expect(settings).toContainText('Using someone else’s shared model does not require your own worker')
 await settings.scrollIntoViewIfNeeded()
 await page.screenshot({path:info.outputPath('shared-local-model-desktop.png'),animations:'disabled'})
 await page.setViewportSize({width:390,height:844})
 expect(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.setViewportSize({width:1440,height:900})
 await page.keyboard.press('Escape')
 const blocked=await page.evaluate(m=>(window as any).__oneAI.precheck({purpose:'palette.ask',sources:[],carries:['memory'],route:{p:'local',m}}),SHARED_PREFIX+w.id)
 expect(blocked.ok).toBe(false)
 let calls=0,seen:any
 const timer=setInterval(()=>void worker('poll',{publicKey,busy:false,available:true,active:null}).then(async r=>{
  if(!r.job)return
  calls++;const key=await sharedWorkerKey(r.job.box,keys.privateKey);seen=await openShared(r.job.box,key,w.id,r.job.id)
  await worker('poll',{publicKey,busy:false,available:true,active:null,outcome:{id:r.job.id,box:await sealShared({ok:true,result:{model:'fixture-local',text:'Shared result verified',inputTokens:80,outputTokens:4,usd:0}},key,w.id,r.job.id)}})
 }).catch(()=>{}),100)
 try{
  const answer=await page.evaluate(async m=>(window as any).__oneAI.ask({purpose:'setup.test',prompt:'Synthetic demo review',route:{p:'local',m}}),SHARED_PREFIX+w.id)
  expect(answer).toMatchObject({ok:true,text:'Shared result verified'});expect(calls).toBe(1);expect(seen.model).toBe('fixture-local');expect(seen.messages.some((m:any)=>m.content.includes('Synthetic demo review'))).toBe(true)
 }finally{clearInterval(timer)}
 await api(page,'DELETE',`/api/workspaces/${ws}/model-shares/${w.id}`)
})

test('availability probe uses real encrypted FIFO, fixed content only, and distinguishes missing model, success, cancellation and bad answer',async({page},info)=>{
 await openApp(page);await signIn(page,email('share-probe'));await openApp(page)
 const ws=await createWorkspace(page,'Probe workshop');await openApp(page,ws);await waitOnline(page)
 const {json:w}=await api<any>(page,'POST',`/api/workspaces/${ws}/coding/workers`,{label:'Probe host'})
 const origin=new URL(page.url()).origin,keys=await modelShareKey(),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey)
 const worker=async(path:string,data:unknown,method='POST')=>{const r=await fetch(origin+'/api/coding/shared-model/'+path,{method,headers:{authorization:'Bearer '+w.token,'Content-Type':'application/json'},body:JSON.stringify(data)});expect(r.ok).toBe(true);return r.json() as Promise<any>}
 await worker('config',{model:'probe-local',label:'Atlas Flow test host',enabled:true},'PUT')
 let available=false,hold=false,bad=false,calls=0,queued:string|undefined,polling=false
 const seen:any[]=[]
 const tick=async()=>{
  if(polling)return;polling=true
  try{
   const r=await worker('poll',{publicKey,dataFlow:true,busy:hold,available,active:null})
   if(!r.job)return
   queued=r.job.id;calls++;const key=await sharedWorkerKey(r.job.box,keys.privateKey),request:any=await openShared(r.job.box,key,w.id,r.job.id);seen.push(request)
   await worker('poll',{publicKey,dataFlow:true,busy:false,available,active:null,outcome:{id:r.job.id,box:await sealShared({ok:true,result:{model:'probe-local',text:bad?'Not a test confirmation':'ATLAS_FLOW_READY',inputTokens:12,outputTokens:4,usd:0}},key,w.id,r.job.id)}})
  }finally{polling=false}
 }
 await tick();const timer=setInterval(()=>void tick().catch(()=>{}),200)
 try{
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/AI$/}).click()
  const probe=page.getByTestId('shared-model-probe-'+w.id)
  await expect(probe).toBeVisible();expect(calls).toBe(0)
  await probe.getByRole('button',{name:'Test availability'}).click();await expect(probe.getByRole('status')).toContainText('Ollama or the selected model is unavailable');expect(calls).toBe(0)
  available=true;await tick()
  await expect(probe.locator('.model-share__checks>span').nth(1)).toHaveAttribute('data-pass','true')
  await probe.getByRole('button',{name:'Test availability'}).click();await expect(probe.getByRole('status')).toContainText('Available · response',{timeout:20000});expect(calls).toBe(1)
  expect(seen[0]).toEqual({model:'probe-local',messages:[{role:'user',content:'Connection test only. Reply with ATLAS_FLOW_READY. Do not call tools.'}],maxTokens:32})
  await page.screenshot({path:info.outputPath('availability-confirmed.png'),animations:'disabled'})
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});await probe.scrollIntoViewIfNeeded();expect(await probe.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)}
  // Losing model availability immediately removes the green response confirmation.
  available=false;await tick();await expect(probe.locator('.model-share__checks>span').nth(2)).toHaveAttribute('data-pass','false');await expect(probe.getByRole('status')).toContainText('Last response')
  available=true;hold=true;await tick();await expect(probe.locator('.model-share__checks>span').nth(1)).toHaveAttribute('data-pass','true')
  await probe.getByRole('button',{name:'Test availability'}).click();await expect(probe.getByRole('status')).toContainText('Test waiting')
  await probe.getByRole('button',{name:'Cancel test'}).click();await expect(probe.getByRole('status')).toContainText('Test cancelled');expect(calls).toBe(1)
  hold=false;bad=true;await tick();await probe.getByRole('button',{name:'Test availability'}).click();await expect(probe.getByRole('status')).toContainText('No confirmed test response',{timeout:20000});expect(calls).toBe(2)
  // A cancelled POST may have reached the server even when its response never reached the browser.
  // The probe must stop promptly and cancel that id, without waiting for the lost acknowledgement.
  hold=true;await tick()
  let posted='',release:()=>void=()=>{}
  const gate=new Promise<void>(r=>{release=r})
  await page.route(`**/api/workspaces/${ws}/model-shares/${w.id}/jobs`,async route=>{
   const response=await route.fetch();posted=route.request().postDataJSON().id
   await gate;await route.fulfill({response}).catch(()=>{})
  })
  try{
   await probe.getByRole('button',{name:'Test availability'}).click();await expect.poll(()=>posted).not.toBe('')
   await probe.getByRole('button',{name:'Cancel test'}).click();await expect(probe.getByRole('status')).toContainText('Test cancelled',{timeout:3000})
   await expect.poll(async()=>(await api<any>(page,'GET',`/api/workspaces/${ws}/model-jobs/${posted}`)).json.state).toBe('cancelled')
   expect(calls).toBe(2)
  }finally{release();await page.unrouteAll({behavior:'wait'})}
  expect(queued).toBeTruthy()
 }finally{clearInterval(timer);while(polling)await new Promise(r=>setTimeout(r,20));await api(page,'DELETE',`/api/workspaces/${ws}/model-shares/${w.id}`)}
})
