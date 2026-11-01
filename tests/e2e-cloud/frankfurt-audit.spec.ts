import {test,expect,openApp,wsEval,signIn,email,createWorkspace,waitOnline} from './fixtures'
const ID='1793533177421-11111111-1111-4111-8111-111111111111',START=1793533177421

test('live test viewer polls real trace endpoints, separates requested from actual tools and downloads full run',async({page},info)=>{
 await openApp(page);await signIn(page,email('audit-lead'));const WS=await createWorkspace(page,'Frankfurt audit fixture');await openApp(page,WS);await waitOnline(page)
 let reads=0,finished=false
 const callId='22222222-2222-4222-8222-222222222222'
 const detail=()=>({run:{auditId:ID,receivedAt:START,finishedAt:finished?START+2000:null,state:finished?'done':'running',trace:{workspace:WS,user:'lead'},request:{model:'one-shared/fixture',prompt:'Read my actual Atlas identity',purpose:'test'},events:[{id:'call',type:'tool-call',callId,server:'atlas',name:'atlas_whoami',arguments:{},receivedAt:START+100,clientAt:START+100,source:'one-browser-harness'},...(finished?[{id:'result',type:'tool-result',callId,server:'atlas',name:'atlas_whoami',result:{result:JSON.stringify({content:[{type:'text',text:'Synthetic Ada'}]})},receivedAt:START+1000,source:'one-browser-harness'}]:[])],...(finished?{answer:[{type:'text',text:'Synthetic Ada'}]}:{})},rounds:[{auditId:'round1',receivedAt:START,processingAt:START,finishedAt:START+50,state:'processed',status:200,request:{messages:[{role:'user',content:'Read my actual Atlas identity'}]},modelInput:{messages:[{role:'user',content:'Exact model context'}]},response:JSON.stringify({message:{content:'',tool_calls:[{function:{name:'one_mcp_call',arguments:{server:'atlas',name:'atlas_whoami',arguments:{}}}}]}})}]})
 await page.route('**/api/workspaces/'+WS+'/**',route=>{
  const url=new URL(route.request().url())
  if(url.pathname.endsWith('/model-shares'))return route.fulfill({json:[]})
  if(url.pathname.endsWith('/model-audit')){
   if(url.searchParams.has('status'))return route.fulfill({json:{enabled:true}})
   if(url.searchParams.has('run')){reads++;return route.fulfill({json:detail()})}
   return route.fulfill({json:{entries:[{auditId:ID,receivedAt:START,state:'running',prompt:'Read my actual Atlas identity',model:'fixture',events:1}]}})
  }
  return route.continue()
 })
 await wsEval(page,s=>s.setWorkspaceAI({routes:{'*':[{p:'local',m:'one-shared/fixture'}]},onboarding:{startPageId:'welcome',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',mcpName:'aj-atlas',project:'CNSx',skipIntro:true}}))
 await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
 await page.getByRole('tab',{name:/AI$/}).click()
 const box=page.getByTestId('frankfurt-audit');await box.getByRole('button',{name:'My complete test log'}).click()
 await box.getByRole('button',{name:/Read my actual Atlas identity/}).click()
 await expect(box).toContainText('Call started · result not yet recorded');await expect(box).toContainText('Model response / requested tools')
 finished=true
 await expect(box).toContainText('Tool result received',{timeout:8000});await expect(box).toContainText('Synthetic Ada');expect(reads).toBeGreaterThan(1)
 await expect(box.locator('.frankfurt-live__event[data-kind=tool] pre').last()).toContainText('\"result\": {')
 await expect(box.locator('.frankfurt-live__event[data-kind=tool] pre').last()).not.toContainText('\\\"content')
 await box.getByRole('checkbox',{name:/Follow live/}).uncheck();const stopped=reads;await page.waitForTimeout(2300);expect(reads).toBe(stopped)
 const [download]=await Promise.all([page.waitForEvent('download'),box.getByRole('button',{name:'Download this entire test'}).click()]);expect(download.suggestedFilename()).toBe('atlas-flow-test-'+ID+'.json')
 await download.saveAs(info.outputPath('trace.json'))
 const {readFile}=await import('node:fs/promises'),exported=JSON.parse(await readFile(info.outputPath('trace.json'),'utf8'));expect(exported.run.events).toHaveLength(2);expect(exported.rounds[0].modelInput.messages[0].content).toBe('Exact model context')
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});expect(await box.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath('live-trace-'+width+'.png')})}
})
