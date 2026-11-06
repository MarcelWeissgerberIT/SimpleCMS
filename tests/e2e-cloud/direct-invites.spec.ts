import { test, expect, api, signIn, email, newPerson, openApp, waitOnline } from './fixtures'

test('direct invitation: readable form, no mail needed, membership persists after reload', async ({page,context})=>{
 await signIn(page,email('direct-owner'))
 const ws=(await api<{id:string}>(page,'POST','/api/workspaces',{name:'Workshop direct access'})).json.id
 await openApp(page,ws)
 await waitOnline(page)
 await page.locator('aside.sb .sb-head__ws').click()
 await page.getByRole('menuitem',{name:'Invite people…'}).click()
 const dialog=page.getByTestId('workspace-page')
 const form=dialog.getByTestId('invite-form')
 await form.getByRole('checkbox',{name:'Direct access without a sign-in email'}).check()
 await expect(form.getByLabel('Valid')).toHaveValue('1')
 await expect(form.getByLabel('Only addresses at')).toBeDisabled()
 await form.getByRole('button',{name:'Create invite link'}).click()
 const link=await dialog.getByTestId('invite-link').locator('input').inputValue()
 const guest=await newPerson(context)
 try {
  await guest.goto(link)
  await expect(guest.getByRole('button',{name:'Join directly',exact:true})).toBeVisible()
  await guest.getByLabel('Your name',{exact:true}).fill('Workshop Participant')
  const addr=email('direct-participant')
  await guest.locator('input[type=email]').fill(addr)
  for (const width of [1440,390]) for (const dark of [false,true]) {
   await guest.setViewportSize({width,height:width===390?844:900})
   await guest.evaluate(dark=>{document.documentElement.dataset.theme=dark?'dark':'light'},dark)
   await guest.screenshot({path:`.shots/direct-invite-${width}-${dark?'dark':'light'}.png`,fullPage:true})
   expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  await guest.getByRole('button',{name:'Join directly',exact:true}).click()
  await expect(guest).toHaveURL(new RegExp(`w=${ws}`))
  const me=await api<{user:{email:string;email_verified:boolean}}>(guest,'GET','/api/me')
  expect(me.json.user.email).toBe(addr);expect(me.json.user.email_verified).toBe(false)
  expect((await guest.request.get(`/api/dev/mailbox?to=${encodeURIComponent(addr)}`).then(r=>r.json())).length).toBe(0)
  await guest.reload()
  expect((await api(guest,'GET','/api/me')).status).toBe(200)
 } finally {await guest.context().close()}
})
