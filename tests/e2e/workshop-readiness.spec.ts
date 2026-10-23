import { test, expect, openApp, gotoPage, wsEval, reloadApp } from './fixtures'

test('readiness plates persist checks, separate guests/later, and respect read-only on mobile', async ({ page }) => {
  await openApp(page)
  const id = await wsEval(page, s => {
    const checks = ['one','atlas','worker','copilot','repo']
    const db = s.createDatabase({title:'Start check fixture',properties:[
      {id:'name',name:'Name',type:'title'},
      ...checks.map(id=>({id,name:id,type:'select',options:['open','ready','blocked','na'].map(id=>({id,name:id,color:'gray'}))})),
      ...['role','participation'].map(id=>({id,name:id,type:'select'})),
      ...['blocker','next','owner','note','at','by','recipient','evidence'].map(id=>({id,name:id,type:'text'})),
    ]})
    s.updateDatabase(db,{readiness:{v:1,automation:{recipient:'recipient',evidence:'evidence',atlasProjects:['one-webserver']},checks:Object.fromEntries(checks.map(k=>[k,k])),role:'role',participation:'participation',blocker:'blocker',next:'next',owner:'owner',note:'note',changedAt:'at',changedBy:'by'},views:[{id:'plates',type:'gallery',name:'Plates',filter:null,sorts:[],visibleProperties:[],propertyWidths:{}}]})
    s.createRow(db,{title:'Team member',properties:{role:'team',one:'ready',evidence:JSON.stringify({one:{at:1700000000000,source:'session'}})}})
    s.createRow(db,{title:'Workshop guest',properties:{role:'guest',one:'ready',atlas:'ready'}})
    s.createRow(db,{title:'Later user',properties:{participation:'later'}})
    return db
  })
  await gotoPage(page,id)
  const tracker=page.getByTestId('workshop-start')
  await expect(tracker).toBeVisible()
  await expect(tracker.locator('.ws-start__count strong')).toHaveText('1/2')
  const member=tracker.locator('article').filter({hasText:'Team member'})
  await member.getByRole('button').click()
  await expect(member.locator('.ws-start__evidence')).toContainText('ONE session')
  await member.locator('select').first().selectOption('open')
  await expect(member.locator('.ws-start__evidence')).toHaveCount(0)
  await member.locator('select').nth(1).selectOption('blocked')
  await member.locator('textarea').first().fill('Atlas connection needs approval')
  await expect(member).toHaveAttribute('data-state','blocked')
  await reloadApp(page)
  await page.getByRole('button').filter({hasText:'Team member'}).click()
  await expect(member.locator('select').nth(1)).toHaveValue('blocked')
  await expect(member.locator('textarea').first()).toHaveValue('Atlas connection needs approval')
  for(const select of await member.locator('select').all())await select.selectOption('ready')
  await expect(tracker.locator('.ws-start__count strong')).toHaveText('2/2')
  const guest=tracker.locator('article').filter({hasText:'Workshop guest'})
  await guest.getByRole('button').click()
  await expect(guest.locator('select:disabled')).toHaveCount(3)
  const later=tracker.locator('article').filter({hasText:'Later user'})
  await later.getByRole('button').click()
  await expect(later.locator('select:disabled')).toHaveCount(5)
  await page.evaluate(()=>(window as any).__one.cloud.useCloud.setState({readOnly:true}))
  await expect(tracker.locator('textarea')).toHaveCount(0)
  await expect(tracker.locator('select:not(:disabled)')).toHaveCount(0)
  await page.setViewportSize({width:390,height:844})
  await expect(tracker).toBeVisible()
  expect(await tracker.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
})
