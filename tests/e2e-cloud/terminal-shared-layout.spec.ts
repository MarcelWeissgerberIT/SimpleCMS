import { test,expect,email,signIn,openApp,waitOnline,createWorkspace,api,wsEval } from './fixtures'
import { modelShareKey,sharedWorkerKey,sealShared,SHARED_PREFIX } from '../../src/shared/ai/shared-model'

test('shared-model queue and model controls stay inside the terminal header while idle, queued and running',async({page},info)=>{
 await signIn(page,email('terminal-layout'))
 const ws=await createWorkspace(page,'Shared terminal layout')
 await openApp(page,ws);await waitOnline(page)
 const {json:w}=await api<any>(page,'POST',`/api/workspaces/${ws}/coding/workers`,{label:'Layout fixture host'})
 const origin=new URL(page.url()).origin,keys=await modelShareKey(),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey)
 const worker=async(path:string,data:unknown,method='POST')=>{
  const r=await fetch(origin+'/api/coding/shared-model/'+path,{method,headers:{authorization:'Bearer '+w.token,'Content-Type':'application/json'},body:JSON.stringify(data)})
  expect(r.ok).toBe(true);return r.json() as Promise<any>
 }
 const poll={publicKey,dataFlow:true,tools:true,busy:true,available:true,active:null}
 await worker('config',{model:'fixture-local',label:'Atlas Flow · Workshop local model',enabled:true},'PUT')
 await worker('poll',poll)
 await wsEval(page,s=>s.setWorkspaceAI({policy:{restricted:[],providers:{local:{allow:['public','structure','selection','page','rows','workspace']}}}}))
 await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
 await page.getByRole('tab',{name:/AI$/}).click()
 await expect(page.getByTestId('shared-model-settings')).toContainText('Atlas Flow · Workshop local model')
 await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'local',m:model}]),SHARED_PREFIX+w.id)
 await page.keyboard.press('Escape');await page.keyboard.press(`${process.platform==='darwin'?'Meta':'Control'}+j`)
 const term=page.getByRole('region',{name:'AI terminal'}),head=term.locator('.term-head')
 const checkBounds=async(state:string)=>{
  for(const width of [1440,800,390]){
   await page.setViewportSize({width,height:900})
   const geometry=await head.evaluate(el=>{
    const h=el.getBoundingClientRect(),inside=(r:DOMRect)=>r.top>=h.top&&r.bottom<=h.bottom&&r.left>=h.left&&r.right<=h.right
    const nodes=[...el.querySelectorAll('.route-controls button,.route-chip__queue,.term-key')].filter(n=>(n as HTMLElement).getBoundingClientRect().height>0)
    return {overflow:el.scrollWidth>el.clientWidth,outside:nodes.filter(n=>!inside(n.getBoundingClientRect())).map(n=>n.className)}
   })
   expect(geometry,`${state} at ${width}px`).toEqual({overflow:false,outside:[]})
   await page.screenshot({path:info.outputPath(`terminal-${state}-${width}.png`),animations:'disabled'})
  }
 }
 try{
  await checkBounds('idle')
  const prompt=term.getByRole('textbox',{name:'Task for the agent'})
  await prompt.fill('Synthetic layout check. Reply only Layout OK. Use no tools.');await prompt.press('Enter')
  const queue=term.locator('.route-chip__queue')
  await expect(queue).toContainText('Queue · position')
  await expect(page.getByTestId('term-route-chip')).toBeDisabled()
  await checkBounds('queued')
  const claimed=await worker('poll',{...poll,busy:false})
  expect(claimed.job).toBeTruthy()
  await expect(queue).toContainText('PROCESSING')
  await checkBounds('running')
  const key=await sharedWorkerKey(claimed.job.box,keys.privateKey)
  await worker('poll',{...poll,busy:false,outcome:{id:claimed.job.id,box:await sealShared({ok:true,result:{model:'fixture-local',text:'Layout OK',inputTokens:12,outputTokens:4,usd:0}},key,w.id,claimed.job.id)}})
  await expect(term.locator('.term-answer')).toContainText('Layout OK')
 }finally{
  const stop=term.getByRole('button',{name:'Stop',exact:true});if(await stop.isVisible())await stop.click()
  await api(page,'DELETE',`/api/workspaces/${ws}/model-shares/${w.id}`)
 }
})
