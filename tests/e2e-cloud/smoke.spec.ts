import { test, expect, api, email, signIn } from './fixtures'

test.describe('cloud server smoke', () => {
  test('the server serves the app and the API; magic-link sign-in works', async ({ page }) => {
    const health = await page.request.get('/api/health')
    expect(health.ok()).toBe(true)
    await page.goto('/app/')
    await expect(page.locator('#root')).not.toBeEmpty()
    const me = await api(page, 'GET', '/api/me')
    expect(me.status).toBe(401)
    const address = email('ada')
    await signIn(page, address)
    const ws = await api<{ id: string; name: string }>(page, 'POST', '/api/workspaces', { name: 'Acme' })
    expect(ws.status).toBe(201)
    const list = await api<{ workspaces: Array<{ id: string; role: string }> }>(page, 'GET', '/api/me')
    expect(list.json.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: ws.json.id, role: 'owner' })]))
  })
})
