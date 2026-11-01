import {test,expect,openApp,wsEval,signIn,email,createWorkspace,waitOnline} from './fixtures'
import {readFile} from 'node:fs/promises'

test('lead cost overview is opt-in, separate from token billing, exportable and responsive',async({page},info)=>{
 await openApp(page);await signIn(page,email('cost-lead'));const WS=await createWorkspace(page,'Frankfurt cost fixture');await openApp(page,WS);await waitOnline(page)
 const start=Date.UTC(2026,10,1,6),report={schema:'one.host-costs.v1',basis:'estimate',window:{from:start,to:start+3600000,kind:'current-vm-boot'},rate:{currency:'EUR',asOf:'2026-11-01',source:'Synthetic UI test rate',computePerHour:.6,diskPerMonth:8},totals:{computeEUR:.6,diskEUR:.0111,estimatedEUR:.6111,allocatedComputeEUR:.06,unallocatedComputeEUR:.54,busyMs:360000,rounds:3,incompleteRounds:1,overlapMs:0},workspaces:[{workspace:WS,tasks:1,rounds:3,failedRounds:1,occupancyMs:360000,allocatedMs:360000,queueMs:30000,computeEUR:.06}],tasks:[{workspace:WS,user:'synthetic-lead',task:'task-11111111-1111-4111-8111-111111111111',rounds:3,failedRounds:1,occupancyMs:360000,allocatedMs:360000,queueMs:30000,computeEUR:.06}],excludes:['ipv4','snapshots','egress','tax'],method:'Synthetic test fixture'}
 let reads=0,unavailable=false
 await page.route('**/api/workspaces/'+WS+'/**',route=>{
  const u=new URL(route.request().url())
  if(u.pathname.endsWith('/model-shares'))return route.fulfill({json:[]})
  if(u.pathname.endsWith('/model-audit')){
   if(u.searchParams.has('status'))return route.fulfill({json:{enabled:true}})
   if(u.searchParams.has('costs')){reads++;return unavailable?route.fulfill({status:503,json:{error:'host unavailable'}}):route.fulfill({json:report})}
   return route.fulfill({json:{entries:[]}})
  }
  return route.continue()
 })
 await wsEval(page,s=>s.setWorkspaceAI({routes:{'*':[{p:'local',m:'one-shared/fixture'}]},onboarding:{startPageId:'welcome',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',mcpName:'aj-atlas',project:'CNSx',skipIntro:true}}))
 await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}));await page.getByRole('tab',{name:/AI$/}).click()
 const box=page.getByTestId('frankfurt-audit');await box.getByRole('button',{name:'My complete test log'}).click();expect(reads).toBe(0)
 await box.getByRole('button',{name:'Operating costs',exact:true}).click();const costs=page.getByTestId('frankfurt-costs')
 await expect(costs).toContainText('Since this VM boot');await expect(costs).toContainText('Frankfurt cost fixture');await expect(costs).toContainText('No user charges');expect(reads).toBe(1)
 await costs.locator('summary').filter({hasText:'Tasks and requests'}).click();await expect(costs).toContainText(report.tasks[0].task);await expect(costs).toContainText('1 failed / cancelled')
 const download=page.waitForEvent('download');await costs.getByRole('button',{name:'Download cost snapshot (.json)'}).click();const d=await download;await d.saveAs(info.outputPath('costs.json'));expect(JSON.parse(await readFile(info.outputPath('costs.json'),'utf8'))).toEqual(report)
 await wsEval(page,s=>s.updateSettings({language:'de'}));await expect(costs).toContainText('Seit diesem VM-Start');await expect(costs).toContainText('Keine Nutzerbelastung')
 for(const theme of ['light','dark']){
  await wsEval(page,(s,arg)=>s.updateSettings({theme:arg}),theme)
  for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await costs.evaluate(el=>el.scrollIntoView({block:'start'}));expect(await costs.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`costs-${theme}-${width}.png`)})}
 }
 await page.setViewportSize({width:1440,height:900});await wsEval(page,s=>s.updateSettings({theme:'light'}));await costs.scrollIntoViewIfNeeded()
 await costs.screenshot({path:info.outputPath('costs-panel.png')})
 unavailable=true;await costs.getByRole('button',{name:'Kosten aktualisieren'}).click();await expect(costs.getByRole('alert')).toContainText('unbekannte Kosten sind nicht null');await expect(costs).not.toContainText('0,6111')
})
