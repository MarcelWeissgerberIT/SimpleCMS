/** Production build + real server/cookies/Yjs. Run after npm run build and npm --prefix server run build. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { signIn, startServer } from './helpers.ts'

const proof = resolve(process.env.ONE_TEST_ACCESS_PROOF || 'test-results/test-access')
mkdirSync(proof, { recursive:true })
test('production UI switches all tabs to isolated guest read-only mode, fails closed offline, and restores owner settings', {timeout:90000}, async()=>{
  const server=await startServer({APP_DIR:resolve('dist'),AUTH_IP_LIMIT:'1000'})
  const owner=await signIn(server,'marcel@browser.test')
  await owner.patch('/api/me',{name:'Marcel Test'})
  const ws=(await owner.post('/api/workspaces',{name:'Workshop test'})).body.id
  assert.equal((await owner.json('PUT',`/api/workspaces/${ws}/welcome`,{revision:0,title:'Workshop',notBefore:Date.now()+86400000,lang:'en',recipients:[{id:'guest',name:'Guest Example',email:'guest@browser.test',workspaceId:ws,role:'viewer',guest:true,note:''}]})).status,200)
  const browser=await chromium.launch({channel:'chrome',headless:true})
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}})
  const errors=[]
  const external=[]
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===server.url)return route.continue();external.push(route.request().url());return route.abort()})
  await context.addCookies([...owner.cookies].map(([name,value])=>({name,value,url:server.url,httpOnly:true,sameSite:'Lax'})))
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('CONSOLE',m.text())})
  const waitReady=async(p)=>{await p.waitForFunction(()=>window.__one?.workspace.getState().ready && window.__one?.cloud.useCloud.getState().status==='online',{},{timeout:15000})}
  try{
    await page.goto(`${server.url}/app/?w=${ws}&e2e#/workspace/people`);await waitReady(page)
    await page.evaluate(()=>window.__one.workspace.getState().updateSettings({language:'en',aiApiKey:'sk-ant-SYNTHETIC-OWNER-ONLY'}))
    await page.waitForFunction(()=>!window.__one.cloud.useCloudSync.getState().unsynced)
    await page.evaluate(()=>window.__one.workspace.getState().createPage({title:'Workshop shared page',parentId:null}))
    await page.waitForFunction(()=>!window.__one.cloud.useCloudSync.getState().unsynced)
    const ownerSettings=await page.evaluate(()=>JSON.stringify(window.__one.workspace.getState().settings))
    const second=await context.newPage();await second.goto(`${server.url}/app/?w=${ws}&e2e#/workspace/people`);await waitReady(second)
    const cache=await page.evaluate(()=>localStorage.getItem('one.cloud.session'))
    const button=page.getByRole('button',{name:'Test access …',exact:true});await button.click()
    const dialog=page.getByRole('dialog',{name:'Test access',exact:true})
    await dialog.getByRole('combobox').selectOption('welcome:guest')
    await page.screenshot({path:resolve(proof,'01-test-access-picker.png'),animations:'disabled'})
    await dialog.getByRole('button',{name:'Start test view',exact:true}).click()
    await page.waitForURL(/test-access=1/);await second.waitForURL(/test-access=1/)
    // ?e2e is deliberately dropped when switching. Add it without changing cookies to inspect the isolated state.
    for(const p of [page,second]) {const u=new URL(p.url());u.searchParams.set('e2e','1');await p.goto(u.href);await waitReady(p)}
    assert.equal(await page.evaluate(()=>window.__one.cloud.useCloud.getState().role),'viewer')
    const snapshot=await page.evaluate(()=>({user:window.__one.cloud.useCloud.getState().user,settings:window.__one.workspace.getState().settings,cache:localStorage.getItem('one.cloud.session')}))
    assert.match(snapshot.user.id,/^test_/);assert.equal(snapshot.user.name,'Guest Example (Test)')
    assert.ok(!JSON.stringify(snapshot.settings).includes('SYNTHETIC-OWNER-ONLY'));assert.equal(snapshot.cache,cache)
    await page.getByText('Workshop shared page',{exact:true}).first().waitFor()
    await page.evaluate(()=>window.__one.ui.getState().openModal({type:'settings'}))
    await page.getByRole('dialog',{name:'Test view · read-only'}).waitFor()
    await page.getByRole('dialog',{name:'Test view · read-only'}).getByRole('button',{name:'Close',exact:true}).last().click()
    await page.getByTestId('test-access-banner').waitFor();await page.screenshot({path:resolve(proof,'02-guest-test-view.png'),animations:'disabled'})
    // A preview reload while offline must never fall back to the owner's cached workspace.
    await context.route('**/api/config', route => route.abort())
    await page.reload({waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__one?.cloud.useCloud.getState().status==='signed-out')
    assert.equal(await page.evaluate(()=>Object.keys(window.__one.workspace.getState().pages).length),0)
    await context.unroute('**/api/config')
    const u=new URL(second.url());await page.reload();await waitReady(page)
    await page.getByTestId('test-access-banner').getByRole('button',{name:/Return to Marcel Test/}).click()
    await page.waitForURL(u=>!u.searchParams.has('test-access'));await second.waitForURL(u=>!u.searchParams.has('test-access'))
    await waitReady(page);await waitReady(second)
    assert.equal(await page.evaluate(()=>window.__one.cloud.useCloud.getState().role),'owner')
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__one.workspace.getState().settings)),ownerSettings)
    assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('one.cloud.session'))).user,JSON.parse(cache).user)
    await page.screenshot({path:resolve(proof,'03-owner-restored.png'),animations:'disabled'})
    assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  }catch(e){await page.screenshot({path:resolve(proof,'failure.png')}).catch(()=>{});console.error('PAGE',await page.locator('body').innerText().catch(()=>''));throw e}
  finally{await browser.close();await server.stop()}
})
