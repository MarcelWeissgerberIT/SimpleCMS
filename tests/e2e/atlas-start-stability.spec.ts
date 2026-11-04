import { test, expect, openApp, wsEval, createPage, gotoPage, doc, para } from './fixtures'
const URL = 'https://aj-atlas.com/api/atlas/mcp'
const identity = { result: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ person: 'Test Member', effectiveTenantScope: ['analytik-jena'] }) }] }) }
async function setup(page: any) {
  await page.route('**/api/config', (r: any) => r.fulfill({ json: { version: 'fixture', signup: { mode: 'open', domains: [] }, max_upload_mb: 20, dev_mode: false, source_url: '', schema_min: 2, supports: ['ai', 'providers'] } }))
  await page.route('**/api/session', (r: any) => r.fulfill({ json: { user: null, workspaces: [] } }))
  await page.route('**/api/workspaces/*/model-shares', (r: any) => r.fulfill({ json: [] }))
  await openApp(page)
  const id = await createPage(page, { title: 'Your Atlas start', content: doc(para('Connect your personal Atlas access.')) })
  await wsEval(page, (s, id) => s.setWorkspaceAI({ routes: { '*': [{ p: 'anthropic', m: 'claude-opus-5-5' }] }, onboarding: { startPageId: id, mcpName: 'aj-atlas', mcpUrl: 'https://aj-atlas.com/api/atlas/mcp', project: 'FeliX', tenant: 'analytik-jena', skipIntro: true } }), id)
  await gotoPage(page, id)
  await page.evaluate(() => (window as any).__oneCloud.set({ active: { kind: 'cloud', id: 'start-fixture' }, user: { id: 'member-fixture', email: 'member@example.test', name: 'Test Member' }, role: 'owner', readOnly: false, supports: ['atlas-mcp:1'] }))
  return page.getByTestId('atlas-team-start')
}
test('verified Atlas access explains the missing model and token replacement keeps one connection and its restrictions', async ({ page }) => {
  const calls: any[] = []
  await page.route('**/api/workspaces/*/atlas-mcp', r => { calls.push(r.request().postDataJSON()); return r.fulfill({ json: identity }) })
  const box = await setup(page)
  await wsEval(page, s => s.updateSettings({ workspaceMcpServers: [{ id: 'manually-added', name: 'aj-atlas', url: 'https://aj-atlas.com/api/atlas/mcp', token: 'old-synthetic-token', enabled: true, prompt: 'Keep the project-specific working guide.', promptSource: 'edited', tools: ['atlas_get'], checkedAt: Date.now() }] }))
  await expect(box.getByRole('button', { name: 'Start first Atlas task', exact: true })).toBeDisabled()
  await expect(box).toContainText('Atlas is connected. Before starting a briefing')
  await expect(box.getByTestId('ai-needs-open')).toBeVisible()
  await box.getByRole('button', { name: 'Change token', exact: true }).click()
  await box.getByLabel('Your personal Atlas token', { exact: true }).fill('new-synthetic-token')
  await box.getByRole('button', { name: 'Connect and check Atlas', exact: true }).click()
  await expect(box).toContainText('Connected as Test Member')
  const servers = await wsEval(page, s => s.settings.workspaceMcpServers)
  expect(servers).toHaveLength(1)
  expect(servers[0].id).toBe('manually-added')
  expect(servers[0].prompt).toBe('Keep the project-specific working guide.')
  expect(servers[0].scope).toBeUndefined()
  expect(servers[0].tools).toContain('atlas_get')
  expect(calls).toHaveLength(1)
  expect(calls[0].servers[0].token).toBe('new-synthetic-token')
  expect(calls[0].name).toBe('atlas_whoami')
  for (const dark of [false, true]) for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
    await wsEval(page, (s, dark) => s.updateSettings({ theme: dark ? 'dark' : 'light' }), dark)
    await box.screenshot({ path: `/tmp/one-atlas-start-${dark ? 'dark' : 'light'}-${mobile ? 'mobile' : 'desktop'}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
})
test('changing workspace during an Atlas check discards the old answer and leaves the new workspace usable', async ({ page }) => {
  let release!: () => void, started = false
  const wait = new Promise<void>(r => { release = r })
  await page.route('**/api/workspaces/*/atlas-mcp', async r => { started = true; await wait; await r.fulfill({ json: identity }).catch(() => {}) })
  const box = await setup(page)
  await box.getByLabel('Your personal Atlas token', { exact: true }).fill('old-workspace-synthetic-token')
  await box.getByRole('button', { name: 'Connect and check Atlas', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await page.evaluate(() => (window as any).__oneCloud.set({ active: { kind: 'cloud', id: 'different-workspace' } }))
  await expect(box.getByLabel('Your personal Atlas token', { exact: true })).toHaveValue('')
  release()
  await box.getByLabel('Your personal Atlas token', { exact: true }).fill('new-workspace-synthetic-token')
  await expect(box.getByRole('button', { name: 'Connect and check Atlas', exact: true })).toBeEnabled()
  expect(await wsEval(page, s => s.settings.workspaceMcpServers ?? [])).toHaveLength(0)
  await expect(box).not.toContainText('Connected as Test Member')
})


test('a failed optional saved-access copy leaves the verified workspace connected', async ({ page }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = function(name: string, version?: number) {
      if (name === 'one-personal-atlas') throw new DOMException('Synthetic storage unavailable', 'UnknownError')
      return version === undefined ? open(name) : open(name, version)
    }
  })
  await page.route('**/api/workspaces/*/atlas-mcp', r => r.fulfill({ json: identity }))
  const box = await setup(page)
  await box.getByLabel('Your personal Atlas token', { exact: true }).fill('synthetic-test-token')
  await box.getByRole('button', { name: 'Connect and check Atlas', exact: true }).click()
  await expect(box).toContainText('Connected as Test Member')
  await expect(box).toContainText('This workspace is connected. Saving the access for your other workspaces failed')
  await expect(box.getByRole('button', { name: 'Change token', exact: true })).toBeVisible()
  await expect(box.getByRole('button', { name: 'Remember this access for my other AJ workspaces', exact: true })).toBeVisible()
  const servers = await wsEval(page, s => s.settings.workspaceMcpServers)
  expect(servers).toHaveLength(1)
  expect(servers[0].checkedAt).toBeGreaterThan(0)
  expect(servers[0].checkError).toBeUndefined()
})
