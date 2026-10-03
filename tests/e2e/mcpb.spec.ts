/**
 * One MCP, the one-click way: "Add to Claude Desktop" downloads the Claude Desktop extension
 * (public/mcp/one.mcpb, packed by `npm run build:mcp`). The key comes first — on the landing page's
 * MCP section and in the app (Settings → Agents · MCP → Setup) — and the manual setup for other
 * clients is folded below it. The bundle's contents are tested in mcp/test/mcpb.test.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { unzip } from '../../mcp/src/zip'
import { test, expect, openApp, wsEval } from './fixtures'

const VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/package.json', import.meta.url)), 'utf8')) as { version: string }).version

async function openAgentsTab(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
}

test.describe('landing: Add to Claude Desktop', () => {
  test('the first step is the key; it downloads one.mcpb, which the site serves', async ({ page }) => {
    await page.goto('./?skip#mcp')
    const setup = page.locator('#mcp .mcp-setup')
    const key = setup.getByRole('link', { name: /Add to Claude Desktop/ })
    await expect(key).toBeVisible()
    await expect(key).toHaveAttribute('href', '/SimpleCMS/mcp/one.mcpb')
    await expect(key).toHaveAttribute('download', 'one.mcpb')
    await expect(key).toHaveAccessibleDescription('Open the downloaded file — Claude Desktop asks to install it.')
    // step 01, and the first link of the setup
    await expect(setup.locator('.mcp-steps > li').first().getByRole('link')).toHaveText(/Add to Claude Desktop/)
    await expect(setup.getByRole('link').first()).toHaveText(/Add to Claude Desktop/)

    // served under the site's base, a real bundle of this version
    const res = await page.request.get('mcp/one.mcpb')
    expect(res.status()).toBe(200)
    const body = await res.body()
    expect(body.length).toBeGreaterThan(100 * 1024)
    const files = unzip(body)
    expect([...files.keys()]).toEqual(['manifest.json', 'README.md', 'icon.png', 'server/one-mcp.mjs'])
    const manifest = JSON.parse(files.get('manifest.json')!.data.toString('utf8')) as { name: string; version: string; server: { type: string } }
    expect(manifest).toMatchObject({ name: 'one-mcp', version: VERSION, server: { type: 'node' } })

    // a click is a download named one.mcpb (no navigation)
    const download = page.waitForEvent('download')
    await key.click()
    expect((await download).suggestedFilename()).toBe('one.mcpb')
    await expect(page).toHaveURL(/#mcp$/)
  })

  test('the manual setup is folded below and opens from the keyboard', async ({ page }) => {
    await page.goto('./?skip#mcp')
    const setup = page.locator('#mcp .mcp-setup')
    const manual = setup.locator('details.mcp-manual')
    await expect(manual).not.toHaveAttribute('open')
    await expect(setup.getByRole('link', { name: /Download one-mcp\.mjs/ })).toBeHidden()
    await expect(setup.getByRole('button', { name: /Copy: Claude Desktop/ })).toBeHidden()

    // Tab from the key reaches the summary; Enter opens it
    await setup.getByRole('link', { name: /Add to Claude Desktop/ }).focus()
    const summary = manual.locator('summary')
    for (let i = 0; i < 6 && !(await summary.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(summary).toBeFocused()
    await expect(summary).toContainText('Other clients · manual setup')
    await page.keyboard.press('Enter')
    await expect(manual).toHaveAttribute('open', '')
    await expect(setup.getByRole('link', { name: /Download one-mcp\.mjs/ })).toHaveAttribute('href', '/SimpleCMS/mcp/one-mcp.mjs')
    await expect(setup.getByRole('button', { name: /Copy: Claude Desktop/ })).toBeVisible()
    await expect(setup.getByRole('button', { name: /Copy: Claude Code/ })).toBeVisible()
  })

  test('390px: the key fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./?skip#mcp')
    const key = page.locator('#mcp').getByRole('link', { name: /Add to Claude Desktop/ })
    await key.scrollIntoViewIfNeeded()
    const box = (await key.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test.describe('German visitor', () => {
    test.use({ locale: 'de-DE' })
    test('the key in German', async ({ page }) => {
      await page.goto('./?skip#mcp')
      const key = page.locator('#mcp').getByRole('link', { name: /Zu Claude Desktop hinzufügen/ })
      await expect(key).toBeVisible()
      await expect(key).toHaveAttribute('href', '/SimpleCMS/mcp/one.mcpb')
      await expect(key).toHaveAccessibleDescription(/Claude Desktop fragt, ob es sie installieren soll/)
      await expect(page.locator('#mcp details.mcp-manual summary')).toContainText('Andere Clients · manuelle Einrichtung')
    })
  })
})

test.describe('app: Settings → Agents · MCP → Setup', () => {
  test('Add to Claude Desktop comes first; the manual setup is folded below', async ({ page }) => {
    await openApp(page)
    await openAgentsTab(page)
    const key = page.getByTestId('mcp-add-desktop')
    await expect(key).toBeVisible()
    await expect(key).toHaveAccessibleName('Add to Claude Desktop')
    await expect(key).toHaveAttribute('href', '/SimpleCMS/mcp/one.mcpb')
    await expect(key).toHaveAttribute('download', 'one.mcpb')
    await expect(key).toHaveAccessibleDescription(/Claude Desktop asks to install it/)

    // the first link of the setup panel; the snippets wait folded below it
    const panel = page.locator('.mcp-panel').filter({ has: key })
    await expect(panel.getByRole('link').first()).toHaveAccessibleName('Add to Claude Desktop')
    const manual = panel.locator('details.mcp-manual')
    await expect(manual).not.toHaveAttribute('open')
    await expect(panel.getByRole('link', { name: 'one-mcp.mjs' })).toBeHidden()

    // keyboard: the summary opens the manual setup
    const summary = manual.locator('summary')
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(manual).toHaveAttribute('open', '')
    await expect(panel.getByRole('link', { name: 'one-mcp.mjs' })).toHaveAttribute('href', '/SimpleCMS/mcp/one-mcp.mjs')
    await expect(panel.getByLabel('claude_desktop_config.json')).toContainText('"command": "node"')
    await expect(panel.getByLabel('Command for Claude Code')).toHaveText('claude mcp add one -- node ~/one-mcp.mjs')

    // a click downloads the extension
    const download = page.waitForEvent('download')
    await key.click()
    expect((await download).suggestedFilename()).toBe('one.mcpb')
  })

  test('another port: the hint names the extension setting', async ({ page }) => {
    await openApp(page)
    await openAgentsTab(page)
    await expect(page.getByText(/set the same port in Claude Desktop/)).toHaveCount(0)
    const port = page.getByLabel('Port', { exact: true })
    await port.fill('47400')
    await port.press('Enter')
    await expect(page.getByText('Port 47400: set the same port in Claude Desktop → Settings → Extensions → SimpleCMS One → Configure.')).toBeVisible()
  })

  test('German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await openAgentsTab(page)
    await expect(page.getByTestId('mcp-add-desktop')).toHaveAccessibleName('Zu Claude Desktop hinzufügen')
    await expect(page.getByText('Claude Desktop — ein Klick')).toBeVisible()
    await expect(page.locator('details.mcp-manual summary')).toContainText('Andere Clients · manuelle Einrichtung')
  })
})
