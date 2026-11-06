import { test, expect, openApp, waitForApp } from './fixtures'
import { startFakeWorker } from './helpers/fakeWorker'
import { appCsp } from '../../server/src/http/security'
import { createServer } from 'node:http'
const PORT=47443

test('the team-server CSP allows the paired Local worker and a granted workspace shows its fixed host without management rights',async({page,errors})=>{
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const port=47445
  const worker=await startFakeWorker(port,{worker:'1.33.1',name:'installed-host',repos:[{name:'demo',baseBranch:'main'}],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:true,version:'fixture'},managedHost:true,paired:true,via:'local'})
  // Serve real HTTP responses: Playwright route.fulfill marks synthetic responses
  // as public address space, introducing an unrelated Chrome device-access gate.
  const upstream=String(test.info().project.use.baseURL)
  const proxy=createServer(async(req,res)=>{
    try{
      const response=await fetch(new URL(req.url!,upstream),{redirect:'manual'})
      const headers=Object.fromEntries(response.headers)
      delete headers['content-encoding'];delete headers['content-length']
      const origin='http://127.0.0.1:'+String((proxy.address() as any).port)
      if(headers['content-type']?.includes('text/html'))headers['content-security-policy']=appCsp({publicUrl:origin} as any)
      res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()))
    }catch{res.writeHead(502);res.end()}
  })
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve))
  try{
    const url=new URL('app/?e2e',upstream);url.port=String((proxy.address() as any).port)
    await page.goto(url.href);await waitForApp(page)
    await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('tab',{name:/Coding worker|Coding-Worker/}).click()
    await page.getByLabel('Port',{exact:true}).fill(String(port));await page.getByLabel('Port',{exact:true}).press('Enter')
    await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
    await expect(page.getByTestId('coding-conn')).toContainText('Connected')
    await expect(page.getByTestId('coding-managed-host')).toContainText('v1.33.1')
    await expect(page.getByTestId('coding-install-existing')).toHaveCount(0)
    await expect(page.getByTestId('coding-managed-update')).toHaveCount(0)
  }finally{await worker.close();await new Promise<void>(resolve=>proxy.close(()=>resolve()))}
})

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


test('offline recovery uses an existing duplicate-named file, retries without downloading and requires explicit re-pairing',async({page,errors})=>{
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  await openApp(page)
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker|Coding-Worker/}).click()
  const downloads:any[]=[];page.on('download',d=>downloads.push(d))
  const [d]=await Promise.all([page.waitForEvent('download'),page.getByTestId('coding-download').click()])
  const fs=await import('node:fs/promises');const source=await fs.readFile((await d.path())!,'utf8')
  const recovery=page.getByTestId('coding-worker-recovery')
  await expect(recovery).toContainText('Downloading again neither starts nor updates')
  await recovery.getByTestId('coding-recovery-retry').click()
  await expect(page.getByTestId('coding-worker-recovery')).toBeVisible();expect(downloads).toHaveLength(1)
  await recovery.getByText('Not installed yet? Use the existing download').click()
  const upload=recovery.getByTestId('coding-recovery-file')
  await upload.setInputFiles({name:'one-worker (1).mjs',mimeType:'text/javascript',buffer:Buffer.from(source)})
  await expect(recovery.getByTestId('coding-selected-install')).toContainText('one-worker (1).mjs')
  await page.getByTestId('coding-os-posix').first().click()
  await expect(recovery.getByTestId('coding-selected-install-sh')).toContainText('node "$HOME/Downloads/one-worker (1).mjs" install')
  await page.getByTestId('coding-os-windows').first().click()
  await expect(recovery.getByTestId('coding-selected-install-powershell')).toContainText('node "$env:USERPROFILE\\Downloads\\one-worker (1).mjs" install')
  await upload.setInputFiles({name:'one-worker (2).mjs',mimeType:'text/javascript',buffer:Buffer.from(source.replace(/"workspace":"[^"]+"/,'"workspace":"local:wrong"'))})
  await expect(recovery.getByRole('alert')).toBeVisible();await expect(recovery.getByTestId('coding-selected-install')).toHaveCount(0)
  await page.getByTestId('coding-download').click();await expect(page.getByTestId('coding-repair-confirm')).toBeVisible();expect(downloads).toHaveLength(1)
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(downloads).toHaveLength(1)
})

test('a local socket that never opens leaves Connecting and exposes recovery without another download',async({page,errors})=>{
  errors.allow(/WebSocket connection|WebSocket is closed/)
  await page.addInitScript(()=>{
    const Native=window.WebSocket
    class Pending {
      static OPEN=1;static CONNECTING=0;static CLOSED=3
      readyState=0;onopen:any;onmessage:any;onclose:any
      close(code=1000,reason=''){this.readyState=3;queueMicrotask(()=>this.onclose?.({code,reason}))}
      send(){}
    }
    window.WebSocket=new Proxy(Native,{construct(target,args){return String(args[0]).includes(':47444')?new Pending():Reflect.construct(target,args)}})
  })
  await openApp(page)
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker|Coding-Worker/}).click()
  await page.getByLabel('Port',{exact:true}).fill('47444');await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.clock.install()
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
  await expect(page.getByTestId('coding-conn')).toContainText('Connecting')
  await page.clock.fastForward(12500)
  await expect(page.getByTestId('coding-conn')).not.toContainText('Connecting')
  await expect(page.getByTestId('coding-worker-recovery')).toBeVisible()
})
