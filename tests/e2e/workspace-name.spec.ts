/**
 * The workspace name — named once, shown everywhere: renamed in place from the sidebar header (menu
 * "Rename workspace", a double click on the name, F2 on the header) or in Workspace settings → Overview; the
 * sidebar, the switcher and the window title follow. 1–60 characters, trimmed, no control
 * characters. Team workspaces (cloud state through the ?e2e hook, calls mocked): admins rename on the
 * server, everyone else sees the name read-only. The MCP side (agents see the new name) is in
 * tests/e2e/mcp.spec.ts.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'

const WS = [
  { id: 'ws_acme123', name: 'Acme Studio', icon: null, role: 'owner' },
  { id: 'ws_field456', name: 'Field Notes', icon: null, role: 'member' },
]

/** Cloud state by hand; renameWorkspace recorded (and applied to the list, like the server would). */
async function mockTeam(page: Page, state: Record<string, unknown>) {
  await page.evaluate((state) => {
    const w = window as unknown as {
      __oneCloud: { mock: (o: object) => void; set: (s: object) => void; state: { getState: () => { workspaces: Array<{ id: string; name: string }> }; setState: (s: object) => void } }
      __calls: unknown[][]
    }
    w.__calls = []
    w.__oneCloud.mock({
      renameWorkspace: async (id: string, name: string) => {
        w.__calls.push(['renameWorkspace', id, name])
        const s = w.__oneCloud.state
        s.setState({ workspaces: s.getState().workspaces.map((x) => (x.id === id ? { ...x, name } : x)) })
      },
    })
    w.__oneCloud.set(state)
  }, state)
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls)

test.describe('workspace name', () => {
  test('rename in the sidebar header: menu, F2, leaving the field; cleaned and checked; title, switcher and Settings follow', async ({ page }) => {
    await openApp(page)
    const head = page.locator('aside.sb .sb-head__ws')
    const name = page.locator('aside.sb .sb-head__name')
    const field = page.getByRole('textbox', { name: 'Workspace name' })
    await expect(page).toHaveTitle(/ — One$/)

    await head.click()
    const item = page.getByRole('menuitem', { name: /Rename workspace/ })
    await expect(item).toContainText('F2')
    await item.click()
    await expect(field).toBeFocused()
    // whitespace and control characters never make it into the name
    await field.fill('  North\u0007   Star  ')
    await field.press('Enter')
    await expect(name).toHaveText('North Star')
    expect(await wsEval(page, (s) => s.settings.workspaceName)).toBe('North Star')
    await expect(page).toHaveTitle(/^Welcome to One — North Star$/)

    // at most 60 characters; empty is refused and Esc keeps the old name
    await head.press('F2')
    await field.fill('x'.repeat(80))
    await expect(field).toHaveValue('x'.repeat(60))
    await expect(page.locator('.sb-head__edit .sb-head__sub')).toContainText('60/60')
    await field.fill('')
    await field.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'A name is needed' })).toBeVisible()
    await field.press('Escape')
    await expect(name).toHaveText('North Star')

    // leaving the field saves a valid name
    await head.press('F2')
    await field.fill('North Star Labs')
    await page.locator('#main').click({ position: { x: 600, y: 600 } })
    await expect(name).toHaveText('North Star Labs')

    // the switcher names the local workspace; the name survives a reload
    await head.click()
    await expect(page.getByRole('menuitem', { name: /North Star Labs · This browser \(local\)/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await reloadApp(page)
    await expect(name).toHaveText('North Star Labs')

    // Workspace settings → Overview: the same name, max 60, an emptied field falls back to "One" when left
    await page.evaluate(() => (window.location.hash = '#/workspace'))
    const setting = page.getByTestId('workspace-page').getByLabel('Workspace name')
    await expect(setting).toHaveValue('North Star Labs')
    await expect(setting).toHaveAttribute('maxlength', '60')
    await setting.fill('  Polar   ')
    await setting.press('Tab')
    await expect(setting).toHaveValue('Polar')
    await setting.fill('')
    await setting.press('Tab')
    await expect(setting).toHaveValue('One')
    await expect(name).toHaveText('One')
  })

  test('German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: /Workspace umbenennen/ }).click()
    const field = page.getByRole('textbox', { name: 'Name des Workspace' })
    await expect(field).toBeFocused()
    await expect(page.locator('.sb-head__edit .sb-head__sub')).toContainText('↵ sichern · esc abbrechen')
    await field.fill(' ')
    await field.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'Ein Name ist nötig' })).toBeVisible()
    await field.press('Escape')
  })

  test('team workspace: an admin renames it on the server; members see it read-only', async ({ page }) => {
    await openApp(page)
    await mockTeam(page, { available: true, user: { id: 'u1', email: 'ada@acme.studio', name: 'Ada' }, workspaces: WS, active: { kind: 'cloud', id: 'ws_acme123' }, role: 'owner', readOnly: false, status: 'online' })
    const head = page.locator('aside.sb .sb-head__ws')
    const name = page.locator('aside.sb .sb-head__name')
    await expect(name).toHaveText('Acme Studio')
    await head.press('F2')
    const field = page.getByRole('textbox', { name: 'Workspace name' })
    await field.fill('Acme   Studio Berlin ')
    await field.press('Enter')
    await expect(name).toHaveText('Acme Studio Berlin')
    expect(await calls(page)).toEqual([['renameWorkspace', 'ws_acme123', 'Acme Studio Berlin']])
    await expect(page).toHaveTitle(/ — Acme Studio Berlin$/)

    // a member: the menu entry says who may, F2 does nothing
    await mockTeam(page, { active: { kind: 'cloud', id: 'ws_field456' }, role: 'member', readOnly: false })
    await expect(name).toHaveText('Field Notes')
    await head.click()
    const item = page.getByRole('menuitem', { name: /Rename workspace/ })
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expect(item).toContainText('ADMINS ONLY')
    await item.click({ force: true })
    await expect(field).toHaveCount(0)
    await page.keyboard.press('Escape')
    await head.press('F2')
    await expect(field).toHaveCount(0)
    expect(await calls(page)).toEqual([])
  })

})

test.describe('workspace name at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('the field fits the drawer', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await page.locator('aside.sb .sb-head__ws').tap()
    await page.getByRole('menuitem', { name: /Rename workspace/ }).tap()
    const field = page.getByRole('textbox', { name: 'Workspace name' })
    await expect(field).toBeFocused()
    const box = (await page.locator('.sb-head__edit').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await field.fill('Pocket')
    await field.press('Enter')
    await expect(page.locator('aside.sb .sb-head__name')).toHaveText('Pocket')
  })
})
