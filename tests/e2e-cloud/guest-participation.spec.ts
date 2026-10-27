import { test, expect, email, signIn, openApp, waitOnline, createWorkspace, api, newPerson } from './fixtures'

test('temporary guests see expiry and can set up their worker; revocation returns them to read only', async ({ page: owner, context }, info) => {
  await openApp(owner); await signIn(owner, email('owner'))
  const ws = await createWorkspace(owner, 'Workshop participation')
  const guest = await newPerson(context), address = email('guest')
  try {
    await openApp(guest); await signIn(guest, address)
    const invite = await api<{ link: string }>(owner, 'POST', `/api/workspaces/${ws}/invites`, { email: address, role: 'viewer', guest: true })
    expect(invite.status).toBe(201)
    expect((await api(guest, 'POST', '/api/invites/' + invite.json.link.split('#/invite/')[1] + '/accept', {})).status).toBe(200)
    const end = Date.now() + 3600_000
    expect((await api(owner, 'PUT', `/api/workspaces/${ws}/guest-participation`, { emails: [address], expiresAt: end })).status).toBe(200)
    await openApp(guest, ws); await waitOnline(guest)
    await expect(guest.getByTestId('guest-participation')).toContainText('Participation until')
    expect(await guest.evaluate(() => (window as any).__one.cloud.useCloud.getState().readOnly)).toBe(false)
    expect((await api(guest, 'POST', `/api/workspaces/${ws}/coding/workers`, {})).status).toBe(201)
    await guest.screenshot({ path: info.outputPath('guest-participation.png'), animations: 'disabled' })
    expect((await api(owner, 'PUT', `/api/workspaces/${ws}/guest-participation`, { emails: [address], expiresAt: null })).status).toBe(200)
    await expect(guest.getByTestId('view-only')).toBeVisible()
    await expect(guest.getByTestId('guest-participation')).toHaveCount(0)
    expect((await api(guest, 'POST', `/api/workspaces/${ws}/coding/workers`, {})).status).toBe(403)
  } finally { await guest.context().close() }
})
