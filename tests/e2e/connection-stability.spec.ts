import { test, expect, openApp, wsEval, uiEval, flush } from './fixtures'
import { mockAgent, openTerminal, run, setKey, terminal } from './helpers/terminal'
import { ACCESS2, AUTH, MCP_URL, REFRESH2, mockOAuth } from './helpers/oauth'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
})

test('signing out while Atlas renews its login stays signed out when the answer arrives', async ({ page, context, errors }) => {
  errors.allow(/401|Failed to load resource/)
  await mockOAuth(context)
  const model = await mockAgent(context, [], { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' })
  await openApp(page)
  await setKey(page)
  await openTerminal(page)
  await run(page, `/connect ${MCP_URL}`)
  await expect(terminal(page).getByTestId('term-connect').last()).toHaveAttribute('data-phase', 'ok')
  await wsEval(page, s => s.updateSettings({ mcpServers: s.settings.mcpServers.map((v: any) => ({ ...v, oauth: { ...v.oauth, expiresAt: Date.now() + 1000 } })) }))
  let release!: () => void
  const pending = new Promise<void>(r => { release = r })
  let renewing = false
  await context.route(`${AUTH}/token`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    renewing = true
    await pending
    await route.fulfill({ json: { access_token: ACCESS2, refresh_token: REFRESH2, token_type: 'Bearer', expires_in: 3600 }, headers: { 'access-control-allow-origin': '*' } })
  })
  const before = model.checks.length
  await run(page, '/connect oauth')
  await expect.poll(() => renewing).toBe(true)
  await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
  const card = page.locator('.mcps-card[data-server="oauth"]')
  if (await card.getByTestId('mcp-signout').count() === 0) await card.locator('.mcps-card__toggle').click()
  await card.getByTestId('mcp-signout').click()
  expect(await wsEval(page, s => s.settings.mcpServers[0].token)).toBe('')
  release()
  await expect(terminal(page).getByTestId('term-connect').last()).not.toHaveAttribute('data-phase', 'testing')
  await expect.poll(() => wsEval(page, s => ({ token: s.settings.mcpServers[0].token, signed: !!s.settings.mcpServers[0].oauth?.at }))).toEqual({ token: '', signed: false })
  expect(model.checks.length).toBe(before)
  await expect(card.getByTestId('mcp-signout')).toHaveCount(0)
  expect(await wsEval(page, s => s.settings.mcpServers[0].checkedAt)).toBeUndefined()
})

test('a late connection check does not mark a changed server as tested', async ({ page, context }) => {
  let release!: () => void
  let started = false, answered = false
  const pending = new Promise<void>(r => { release = r })
  await mockAgent(context, [], { inspect: () => 'TOOLS: old_search\n---\nOld connection.' })
  await context.route('https://api.anthropic.com/v1/messages*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    started = true
    await pending
    await route.fallback()
    answered = true
  })
  await openApp(page)
  await setKey(page)
  await wsEval(page, s => s.updateSettings({ mcpServers: [{ id: 'changed', name: 'archive', url: 'https://before.example.test/mcp', token: 'test-token-before', enabled: true, prompt: 'Original connection.' }] }))
  await openTerminal(page)
  await run(page, '/connect archive')
  await expect.poll(() => started).toBe(true)
  await wsEval(page, s => s.updateSettings({ mcpServers: s.settings.mcpServers.map((v: any) => ({ ...v, url: 'https://after.example.test/mcp' })) }))
  release()
  await expect.poll(() => answered).toBe(true)
  await expect(terminal(page).getByTestId('term-connect').last()).not.toHaveAttribute('data-phase', 'testing')
  const server = await wsEval(page, s => s.settings.mcpServers[0])
  expect(server.checkedAt).toBeUndefined()
  expect(server.tools).toBeUndefined()
  expect(server.checkError).toBeUndefined()
})


test('cancelling while the sign-in code is exchanged does not save a late login', async ({ page, context, errors }) => {
  errors.allow(/401|Failed to load resource/)
  await mockOAuth(context)
  const model = await mockAgent(context, [], { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' })
  let release!: () => void
  let exchanging = false
  let answered = false
  const pending = new Promise<void>(r => { release = r })
  await context.route(`${AUTH}/token`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    exchanging = true
    await pending
    await route.fallback()
    answered = true
  })
  await openApp(page)
  await setKey(page)
  await wsEval(page, s => s.updateSettings({ mcpServers: [{ id: 'pending-login', name: 'oauth', url: 'https://mcp.oauth.test/mcp', token: '', enabled: true, prompt: 'Read records.', checkedAt: Date.now() }] }))
  await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
  const card = page.locator('.mcps-card[data-server="oauth"]')
  if (await card.getByTestId('mcp-oauth-signin').count() === 0) await card.locator('.mcps-card__toggle').click()
  await card.getByTestId('mcp-oauth-signin').click()
  await expect.poll(() => exchanging).toBe(true)
  await card.getByRole('button', { name: 'Cancel', exact: true }).click()
  release()
  await expect.poll(() => answered).toBe(true)
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  await expect(card.getByTestId('mcp-oauth-signin')).toHaveText('Sign in')
  await expect.poll(() => wsEval(page, s => ({ token: s.settings.mcpServers[0].token, signed: !!s.settings.mcpServers[0].oauth?.at }))).toEqual({ token: '', signed: false })
  await expect(card.getByTestId('mcp-oauth-error')).toHaveCount(0)
  expect(model.checks).toHaveLength(0)
})


test('blocked pop-up in settings completes the OAuth return in the same tab', async ({ page, context, errors }) => {
  errors.allow(/401|Failed to load resource/)
  const auth = await mockOAuth(context)
  await mockAgent(context, [], { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' })
  await openApp(page)
  await setKey(page)
  await wsEval(page, s => s.updateSettings({ mcpServers: [{ id: 'same-tab-login', name: 'oauth', url: 'https://mcp.oauth.test/mcp', token: '', enabled: true, prompt: 'Read records.', checkedAt: Date.now() }] }))
  await flush(page)
  await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
  const card = page.locator('.mcps-card[data-server="oauth"]')
  if (await card.getByTestId('mcp-oauth-signin').count() === 0) await card.locator('.mcps-card__toggle').click()
  await page.evaluate(() => { window.open = () => null })
  await card.getByTestId('mcp-oauth-signin').click()
  await expect(page.getByTestId('mcp-oauth-screen')).toHaveAttribute('data-phase', 'done', { timeout: 30000 })
  expect(auth.token.filter(p => p.get('grant_type') === 'authorization_code')).toHaveLength(1)
  expect(page.url()).not.toContain('code=')
  expect(page.url()).not.toContain('state=')
})


test('closing the sign-in window during discovery leaves the current page in place', async ({ page, context, errors }) => {
  errors.allow(/401|Failed to load resource/)
  const auth = await mockOAuth(context)
  let release!: () => void
  let discovering = false
  const delayed = new Promise<void>(resolve => { release = resolve })
  await context.route(`${AUTH}/.well-known/oauth-authorization-server`, async route => {
    discovering = true
    await delayed
    await route.fallback()
  })
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ mcpServers: [{ id: 'closed-login', name: 'oauth', url: 'https://mcp.oauth.test/mcp', token: '', enabled: true, prompt: 'Read records.', checkedAt: Date.now() }] }))
  await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
  const card = page.locator('.mcps-card[data-server="oauth"]')
  if (await card.getByTestId('mcp-oauth-signin').count() === 0) await card.locator('.mcps-card__toggle').click()
  const currentUrl = page.url()
  const popup = context.waitForEvent('page')
  await card.getByTestId('mcp-oauth-signin').click()
  const window = await popup
  await expect.poll(() => discovering).toBe(true)
  await window.close()
  release()
  await expect(card.getByTestId('mcp-oauth-signin')).toHaveText('Sign in')
  expect(page.url()).toBe(currentUrl)
  expect(auth.authorize).toHaveLength(0)
  expect(auth.token).toHaveLength(0)
  expect(await wsEval(page, s => s.settings.mcpServers[0].token)).toBe('')
})
