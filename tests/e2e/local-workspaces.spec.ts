import { test, expect, openApp, waitForApp, wsEval, flush, mockClaude } from './fixtures'
import type { Page } from '@playwright/test'

async function newWorkspace(page: Page, name: string, packet?: object) {
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: 'New local workspace…' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  if (packet) await page.getByLabel('Optional: workspace package').setInputFiles({ name: 'example.one-workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)) })
  await page.getByRole('textbox', { name: 'Workspace name', exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create and open', exact: true }).click()
  await page.waitForURL(/w=local%3A/)
  await waitForApp(page)
  await expect(page.locator('aside.sb .sb-head__name')).toHaveText(name)
}
async function original(page: Page) {
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: /Original.*This browser/i }).click()
  await page.waitForURL(/w=local(?:&|#|$)/)
  await waitForApp(page)
}

test('local workspaces keep content and workspace rules apart, retain personal connections, and keep two tabs pinned', async ({ page, context, errors }) => {
  const modelCalls = await mockClaude(context, () => 'No inference expected')
  await openApp(page)
  const originalPage = await wsEval(page, s => {
    s.updateSettings({ workspaceName: 'Original', userName: 'Test User', aiApiKey: 'test-key-never-send-0123', aiModel: 'claude-sonnet-4-6', costDisplay: { currency: 'EUR', eurPerUsd: 0.9 }, mcpServers: [{ id: 'mock_mcp', name: 'atlas', url: 'https://example.invalid/mcp', token: '', enabled: false }] })
    const id = s.createPage({ title: 'Only in original' })
    return id
  })
  const first = await wsEval(page, (s, id) => ({ id, key: s.settings.aiApiKey, epoch: s.epoch, pages: Object.keys(s.pages).length }), originalPage)
  await flush(page)
  const secondTab = await context.newPage()
  errors.watch(secondTab)
  await secondTab.goto(page.url().replace(/\?.*/, '?e2e&w=local'))
  await waitForApp(secondTab)
  await newWorkspace(page, 'Client B')
  expect(await wsEval(page, s => Object.keys(s.pages))).toEqual([])
  expect(await wsEval(page, s => s.settings.aiApiKey)).toBe(first.key)
  expect(await wsEval(page, s => ({ name: s.settings.userName, model: s.settings.aiModel, cost: s.settings.costDisplay.currency, mcp: s.settings.mcpServers[0].name }))).toEqual({ name: 'Test User', model: 'claude-sonnet-4-6', cost: 'EUR', mcp: 'atlas' })
  await wsEval(page, s => { s.createPage({ title: 'Only in B' }); s.updateSettings({ spellcheck: false }) })
  await flush(page)
  await expect.poll(() => wsEval(secondTab, s => s.settings.spellcheck)).toBe(false)
  await wsEval(secondTab, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved after other tab switched' }] }] }, 'e2e'), first.id)
  await flush(secondTab)
  expect(await wsEval(page, s => Object.values(s.pages).map((p: any) => p.title))).toEqual(['Only in B'])
  await secondTab.close()
  await wsEval(page, s => s.updateSettings({ mcpServers: undefined }))
  await original(page)
  expect(await wsEval(page, s => s.settings.mcpServers)).toBeUndefined()
  expect(await wsEval(page, s => s.epoch)).toBe(first.epoch)
  expect(await wsEval(page, s => Object.keys(s.pages).length)).toBe(first.pages)
  expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), first.id)).toContain('Saved after other tab switched')
  expect(modelCalls).toHaveLength(0)
})

test('workspace package excludes personal settings and credentials and imports as separate paused content with new attachment ownership', async ({ page }) => {
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ workspaceName: 'Original', userName: 'Private Name', theme: 'dark', aiModel: 'claude-sonnet-4-6', mcpServers: [{ id: 'secret_mcp', name: 'atlas', url: 'https://private.example.invalid/mcp', token: '', enabled: false }] }))
  await page.evaluate(async () => {
    const one = (window as any).__one
    const ref = await one.files.saveFile(new Blob(['attachment-content'], { type: 'text/plain' }), 'readme.txt')
    const s = one.workspace.getState()
    const id = s.createPage({ title: 'Portable brief' })
    s.setContent(id, { type: 'doc', content: [{ type: 'fileBlock', attrs: { src: ref, name: 'readme.txt', size: 18 } }] }, 'e2e')
  })
  await page.evaluate(() => { location.hash = '#/workspace/data' })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace package', exact: true }).click()
  const file = await download
  const path = await file.path()
  const { readFile } = await import('node:fs/promises')
  const packet = JSON.parse(await readFile(path!, 'utf8'))
  const json = JSON.stringify(packet)
  expect(json).not.toContain('Private Name')
  expect(json).not.toContain('private.example.invalid')
  expect(packet.backup.workspace.settings.ai).toBeUndefined()
  expect(packet.backup.workspace.settings.aiKeys).toBeUndefined()
  expect(packet.backup.workspace.fuseSignoffs).toBeUndefined()
  const oldRef = packet.backup.files[0].ref
  // Even a package edited to include somebody else's preferences never takes over this device.
  packet.backup.workspace.settings = { ...packet.backup.workspace.settings, userName: 'Attacker', theme: 'light', mcpServers: [], aiApiKey: 'foreign-key' }
  packet.backup.workspace.agents = { testagent001: { id: 'testagent001', name: 'Packaged agent', instructions: 'Read and report', trigger: { kind: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', mcpServers: [], enabled: true, budgetUsd: 0.5, createdAt: Date.now(), updatedAt: Date.now() } }
  await newWorkspace(page, 'Imported client', packet)
  expect(await wsEval(page, s => ({ name: s.settings.userName, theme: s.settings.theme, mcp: s.settings.mcpServers[0].name, key: s.settings.aiApiKey }))).toEqual({ name: 'Private Name', theme: 'dark', mcp: 'atlas', key: '' })
  expect(await wsEval(page, s => s.agents.testagent001.enabled)).toBe(false)
  const imported = await wsEval(page, s => ({ epoch: s.epoch, text: JSON.stringify(Object.values(s.pages).find((p: any) => p.title === 'Portable brief')) }))
  expect(imported.text).not.toContain(oldRef)
  const freshRef = JSON.parse(imported.text).content.content[0].attrs.src
  const stamp = await page.evaluate(async (ref) => (await (window as any).__one.files.getFile(ref))?.ws, freshRef)
  expect(stamp).toBe(`local:${imported.epoch}`)
  await original(page)
  expect(await wsEval(page, s => s.settings.userName)).toBe('Private Name')
  packet.backup.files = []
  await newWorkspace(page, 'Missing file payload', packet)
  const missing = await wsEval(page, s => Object.values(s.pages).find((p: any) => p.title === 'Portable brief') as any)
  const missingRef = missing.content.content[0].attrs.src
  expect(missingRef).not.toBe(oldRef)
  expect(await page.evaluate(async ref => (await (window as any).__one.files.getFile(ref))?.name, missingRef)).toBeUndefined()
})

test('reset clears only the selected local workspace and preserves personal settings and the original workspace', async ({ page }) => {
  await openApp(page)
  const first = await wsEval(page, s => {
    s.updateSettings({ workspaceName: 'Original', userName: 'Remain here', mcpServers: [{ id: 'mock_mcp', name: 'atlas', url: 'https://example.invalid/mcp', token: '', enabled: false }] })
    return s.createPage({ title: 'Preserved original' })
  })
  await newWorkspace(page, 'Disposable')
  const id = await wsEval(page, s => s.createPage({ title: 'Remove this one' }))
  await flush(page)
  await page.evaluate(() => { location.hash = '#/workspace/danger' })
  await page.getByTestId('reset-workspace').getByRole('button', { name: 'Reset workspace', exact: true }).click()
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Erase & restart', exact: true }).click()])
  await waitForApp(page)
  expect(await wsEval(page, (s, id) => s.pages[id], id)).toBeUndefined()
  expect(await wsEval(page, s => s.settings.userName)).toBe('Remain here')
  expect(await wsEval(page, s => s.settings.mcpServers[0].name)).toBe('atlas')
  await original(page)
  expect(await wsEval(page, (s, id) => s.pages[id].title, first)).toBe('Preserved original')
})
