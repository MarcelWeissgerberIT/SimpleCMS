import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openApp, waitForApp, wsEval } from './fixtures'
import { makeCodingRepo, startDownloadedWorker, fakeOpener, type RunningWorker } from './helpers/coding'
import type { Page } from '@playwright/test'

async function settings(page: Page) {
  await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker$/ }).click()
}

test('allow a new local workspace on the running device worker; switching back retains the original pairing and personal settings', async ({ page, context, errors }) => {
  test.setTimeout(120000)
  errors.allow(/WebSocket.*47866.*ERR_CONNECTION_REFUSED/)
  const repo = makeCodingRepo()
  let worker: RunningWorker | null = null
  try {
    await openApp(page)
    await wsEval(page, s => s.updateSettings({ workspaceName: 'Original', aiApiKey: 'private-fixture-not-sent-12345' }))
    await settings(page)
    const port = page.getByLabel('Port', { exact: true })
    await port.fill('47866'); await port.press('Enter')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('coding-download').click()])
    const file = join(repo.root, 'one-worker.mjs'); await download.saveAs(file)
    const home = join(repo.root, 'home'), config = join(home, '.config', 'one')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'worker.json'), JSON.stringify({ name: 'device-worker', pollSec: 2, repos: [{ name: 'website', path: repo.path, pr: 'none' }] }))
    worker = await startDownloadedWorker(file, home, repo, fakeOpener(repo).program)
    await expect(page.getByTestId('coding-multiple-workspaces')).toBeVisible({ timeout: 20000 })
    const originalPairs = await page.evaluate(() => JSON.parse(localStorage.getItem('one.coding')!).pairs)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    const originalUrl = page.url()
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: 'New local workspace…' }).click()
    await page.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('TestSpace')
    await page.getByRole('button', { name: 'Create and open', exact: true }).click()
    await page.waitForURL(/w=local%3A/); await waitForApp(page)
    await settings(page)
    await expect(page.getByTestId('coding-workspace-grant')).toBeVisible({ timeout: 20000 })
    await page.waitForFunction(() => !!(window as any).__onePreflight?.stores?.coding)
    await page.evaluate(() => (window as any).__onePreflight.stores.coding.setState({ refusedWorkspaceNonce: 'x'.repeat(43) }))
    await page.getByTestId('coding-workspace-grant').click()
    await expect(page.getByTestId('coding-multiple-workspaces')).toBeVisible({ timeout: 30000 })
    const paired = await page.evaluate(() => JSON.parse(localStorage.getItem('one.coding')!).pairs)
    expect(Object.keys(paired)).toHaveLength(2)
    for (const [id, value] of Object.entries(originalPairs)) expect(paired[id]).toEqual(value)
    expect(new Set(Object.values(paired).map((p: any) => p.secret)).size).toBe(2)
    expect(await wsEval(page, s => s.settings.aiApiKey)).toMatch(/^(?:vault:[^:]+:|private-fixture-not-sent-)12345$|^vault:[^:]+:2345$/)
    const second = await context.newPage(); errors.watch(second)
    await second.goto(originalUrl); await waitForApp(second); await settings(second)
    await expect(second.getByTestId('coding-multiple-workspaces')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('coding-multiple-workspaces')).toBeVisible()
    expect(await second.locator('aside.sb .sb-head__name').textContent()).toBe('Original')
    expect(await page.locator('aside.sb .sb-head__name').textContent()).toBe('TestSpace')
  } finally { await worker?.stop(); repo.cleanup() }
})
