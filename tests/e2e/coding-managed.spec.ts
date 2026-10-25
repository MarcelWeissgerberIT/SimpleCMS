import { test, expect, openApp } from './fixtures'
import { startFakeWorker } from './helpers/fakeWorker'
const PORT=47443

test('fixed installation separates update, waiting, cancel, rollback and re-pairing; responsive plate',async({page,errors})=>{
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const worker=await startFakeWorker(PORT,{worker:'1.32.0',name:'workshop-laptop',repos:[{name:'demo',baseBranch:'main',branches:['main'],mcp:[],push:false,pr:'none'}],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:true,version:'fixture'},managed:true,paired:true,setup:true,via:'local'})
  let phase='running';const actions:string[]=[]
  worker.onManage=action=>{actions.push(action);if(action==='update')phase='waiting-for-idle';if(action==='cancel')phase='running';return {installed:true,version:'1.32.0',previous:'1.31.0',phase}}
  try{
    await openApp(page)
    await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('tab',{name:/Coding worker|Coding-Worker/}).click()
    await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
    await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
    const plate=page.getByTestId('coding-managed');await expect(plate).toBeVisible();await expect(plate).toContainText('v1.32.0')
    await expect(page.getByTestId('coding-download')).toHaveText(/New pairing/)
    await plate.getByTestId('coding-managed-update').click();await expect(plate).toContainText('New work is paused')
    await expect(plate.getByTestId('coding-managed-update')).toBeDisabled()
    await plate.getByRole('button',{name:'Update later · resume work'}).click();await expect(plate.getByTestId('coding-managed-update')).toBeEnabled()
    await plate.getByTestId('coding-managed-rollback').click();expect(actions).toContain('rollback')
    for(const width of [1440,390]){await page.setViewportSize({width,height:950});await plate.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath(`managed-${width}.png`)});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)}
  }finally{await worker.close()}
})
