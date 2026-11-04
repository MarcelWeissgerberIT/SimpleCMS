import { test, expect, openApp, wsEval } from './fixtures'

// Run with E2E_ROOT=1: this journey exercises the cloud transport.
test('Atlas can be tested without a model; authentication and permissions stay separate from the One login', async ({ page, errors }) => {
  errors.allow(/502|Failed to load resource/)
  await page.route('**/api/config', r => r.fulfill({ json: { version: 'fixture', signup: { mode: 'open', domains: [] }, max_upload_mb: 20, dev_mode: false, source_url: '', schema_min: 2, supports: ['ai', 'providers'] } }))
  await page.route('**/api/session', r => r.fulfill({ json: { user: null, workspaces: [] } }))
  await page.route('**/api/workspaces/*/model-shares', r => r.fulfill({ json: [] }))
  let outcome: 'ok' | 'auth' | 'permission' | 'timeout' = 'ok'
  let release!: () => void
  const delayed = new Promise<void>(resolve => { release = resolve })
  const calls: any[] = []
  await page.route('**/api/workspaces/*/atlas-mcp', async r => {
    calls.push(r.request().postDataJSON())
    if (outcome === 'timeout') { await delayed; return r.fulfill({ json: { tools: [] } }).catch(() => {}) }
    return r.fulfill(outcome === 'ok'
      ? { json: { tools: [{ server: 'aj-atlas', tool: 'atlas_get', name: 'remote_mcp_0', description: 'Read records', parameters: { type: 'object', properties: {} } }] } }
      : { status: 502, json: { error: { code: `mcp_${outcome}`, message: `mcp_${outcome}` } } })
  })
  let models = 0
  await page.route('https://api.anthropic.com/**', r => { models++; return r.abort() })
  await openApp(page)
  await wsEval(page, s => {
    s.setWorkspaceAI({ onboarding: { startPageId: 'fixture-start', mcpName: 'aj-atlas', mcpUrl: 'https://aj-atlas.com/api/atlas/mcp', project: 'FeliX', tenant: 'analytik-jena', skipIntro: true } })
    s.updateSettings({ workspaceMcpServers: [{ id: 'aj-direct', name: 'aj-atlas', url: 'https://aj-atlas.com/api/atlas/mcp', token: 'synthetic-personal-token-only', enabled: true, prompt: '' }] })
  })
  await page.evaluate(() => (window as any).__oneCloud.set({ active: { kind: 'cloud', id: 'fixture' }, user: { id: 'synthetic-user', email: 'test@example.test', name: 'Test' }, role: 'owner', readOnly: false, supports: ['atlas-mcp:1'] }))
  await page.evaluate(() => { location.hash = '#/mcp' })
  const row = page.locator('[data-row="one"][data-server="aj-atlas"]')
  const check = row.getByTestId('mcpc-test')
  await expect(check).toBeVisible()
  expect(calls).toHaveLength(0)
  await check.click()
  await expect(row).toHaveAttribute('data-state', 'ok')
  expect(calls).toHaveLength(1)
  expect(calls[0].action).toBe('list')
  outcome = 'auth'
  await check.click()
  await expect(row).toHaveAttribute('data-state', 'refusedTest')
  expect(await page.evaluate(() => (window as any).__oneCloud.state.getState().user?.id)).toBe('synthetic-user')
  outcome = 'permission'
  await check.click()
  await expect(row).toHaveAttribute('data-state', 'failed')
  await expect(row).toContainText('Access denied')
  expect(await page.evaluate(() => (window as any).__oneCloud.state.getState().user?.id)).toBe('synthetic-user')
  outcome = 'ok'
  await check.click()
  await expect(row).toHaveAttribute('data-state', 'ok')
  expect(calls).toHaveLength(4)
  await page.clock.install()
  outcome = 'timeout'
  await check.click()
  await expect.poll(() => calls.length).toBe(5)
  await page.clock.fastForward(31_000)
  await expect(row).toHaveAttribute('data-state', 'failed')
  await expect(row).toContainText('The connection test took too long')
  await expect(check).toBeEnabled()
  release()
  outcome = 'ok'
  await check.click()
  await expect(row).toHaveAttribute('data-state', 'ok')
  expect(calls).toHaveLength(6)
  expect(models).toBe(0)
  expect(await wsEval(page, s => s.settings.workspaceMcpServers[0].checkError)).toBeUndefined()
})
