/**
 * Shell regressions: the palette runs what the query names, "Move to" never offers a
 * trashed subtree (nor moves database rows), Settings focuses and labels what it shows,
 * every page view has exactly one h1.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, pageIdByTitle, pageById, MOD } from './fixtures'

async function palette(page: Page, query: string) {
  await page.keyboard.press(`${MOD}+k`)
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  await expect(pal.getByRole('combobox')).toBeFocused()
  await page.keyboard.type(query)
  return pal
}

test.describe('palette: Enter runs what the query names', () => {
  test('a command word runs the command, not "Create page"', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    const pal = await palette(page, 'dark')
    await expect(pal.locator('[role="option"][aria-selected="true"]')).toContainText('Toggle dark mode')
    await page.keyboard.press('Enter')
    await expect(pal).toBeHidden()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before)
  })

  test('"settings" opens Settings even though the welcome page mentions it', async ({ page }) => {
    await openApp(page)
    const pal = await palette(page, 'settings')
    await expect(pal.locator('[role="option"][aria-selected="true"]')).toContainText('Settings')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: /General/ })).toBeVisible()
  })

  test('a page title still wins over keyword-only commands; unknown words create a page', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    let pal = await palette(page, 'welcome')
    await expect(pal.locator('[role="option"][aria-selected="true"]')).toContainText('Welcome to One')
    await page.keyboard.press('Enter')
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')

    pal = await palette(page, 'Zebra crossing plan')
    // "Create page" is always the last row
    await expect(pal.getByRole('option').last()).toContainText('Create page “Zebra crossing plan”')
    await page.keyboard.press('Enter')
    await expect(page.locator('#main .pv-title')).toHaveValue('Zebra crossing plan')
  })

  test('Escape closes the palette before a menu left open underneath', async ({ page }) => {
    await openApp(page)
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row', { hasText: 'Team wiki' }).first()
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    const pal = await palette(page, 'wel')
    await page.keyboard.press('Escape')
    await expect(pal).toBeHidden()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
    await expect(page.locator('.sb-row__rename')).toHaveCount(0)
  })
})

test.describe('move and trash', () => {
  test('"Move to" never offers a page inside a trashed parent; the palette does not find it', async ({ page }) => {
    await openApp(page)
    const old = await createPage(page, { title: 'Old project' })
    await createPage(page, { title: 'Archive folder', parentId: old })
    const thesis = await createPage(page, { title: 'My thesis' })
    await wsEval(page, (s, id) => s.trashPage(id), old)
    await gotoPage(page, thesis)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Move to…' }).click()
    const dialog = page.getByRole('dialog', { name: /Move/ })
    await dialog.getByPlaceholder('Find a destination page…').fill('Archive')
    await expect(dialog.getByRole('option')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    const pal = await palette(page, 'Archive folder')
    await expect(pal.getByRole('option')).toHaveCount(1) // only "Create page …"
    await expect(pal.getByRole('option')).toContainText('Create page')
    expect((await pageById(page, thesis)).parentId).toBeNull()
  })

  test('a database row has no "Move to" (page menu, palette)', async ({ page }) => {
    await openApp(page)
    const row = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ id: string; databaseId: string | null; trashed: boolean }>).find((p) => p.databaseId && !p.trashed && s.pages[p.databaseId]?.title === 'Projects')!.id)
    await gotoPage(page, row)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Move to…' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const pal = await palette(page, '>move')
    await expect(pal.getByRole('option', { name: 'Move page to…' })).toHaveCount(0)
  })
})

test.describe('settings and headings', () => {
  test('Settings focuses the tab it opens on, and every input has a name', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('tab', { name: /Claude AI/ })).toBeFocused()
    await expect(dialog.getByLabel('Anthropic API key')).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: 'Model' })).toBeVisible()
    await expect(dialog.getByText('database autofill')).toHaveCount(0)
    await dialog.getByRole('tab', { name: /General/ }).click()
    await expect(dialog.getByRole('textbox', { name: 'Workspace name' })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Your name' })).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: 'Start page' })).toBeVisible()
    await expect(dialog.getByRole('radiogroup', { name: 'Language' })).toBeVisible()
    await dialog.getByRole('tab', { name: /Data/ }).click()
    await expect(dialog.getByRole('combobox', { name: 'Version snapshots' })).toBeVisible()
  })

  test('a page and a database page each have exactly one h1: the title', async ({ page }) => {
    await openApp(page)
    for (const title of ['Welcome to One', 'Projects']) {
      await gotoPage(page, await pageIdByTitle(page, title))
      await expect(page.locator('#main .pv-title')).toHaveValue(title)
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('h1 .pv-title')).toHaveValue(title)
    }
  })
})
