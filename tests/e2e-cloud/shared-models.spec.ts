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
