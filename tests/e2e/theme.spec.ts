/**
 * Dark theme ("Carbon") coverage: every surface that opens on top of the page must follow
 * the theme tokens. A component with a hard-coded light colour shows up as a bright box.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, doc, para, pageIdByTitle, editorOf, selectText, wsEval, MOD } from './fixtures'

/** Relative luminance of the first opaque background at/above the element. */
async function surfaceLuminance(loc: Locator): Promise<number> {
  return loc.first().evaluate((el) => {
    let cur: Element | null = el
    while (cur) {
      const bg = getComputedStyle(cur).backgroundColor
      const m = bg.match(/rgba?\(([^)]+)\)/)
      if (m) {
        const [r, g, b, a = 1] = m[1].split(',').map((x) => Number(x.trim()))
        if (a > 0.5) {
          const lin = (c: number) => {
            const v = c / 255
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        }
      }
      cur = cur.parentElement
    }
    return 1
  })
}

/** Close an overlay with Escape (a second press if focus sat in a nested field) and wait until it is gone. */
async function close(page: Page, loc: Locator) {
  await page.keyboard.press('Escape')
  if (await loc.first().isVisible()) {
    await page.waitForTimeout(300)
    if (await loc.first().isVisible()) await page.keyboard.press('Escape')
  }
  await expect(loc.first()).toBeHidden()
}

async function expectDark(page: Page, name: string, loc: Locator) {
  await expect(loc.first(), name).toBeVisible()
  const l = await surfaceLuminance(loc)
  expect(l, `${name} background luminance in dark mode`).toBeLessThan(0.2)
}

test.describe('dark theme surfaces', () => {
  test.use({ colorScheme: 'dark' })

  test('app chrome, menus, modals, palette, peek and editor popovers are dark', async ({ page }) => {
    await openApp(page)
    // "system" theme follows the OS (dark here)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expectDark(page, 'body', page.locator('body'))
    await expectDark(page, 'sidebar', page.locator('aside.sb'))
    await expectDark(page, 'topbar', page.locator('header.tb'))

    await page.keyboard.press(`${MOD}+k`)
    await expectDark(page, 'palette', page.locator('.pal'))
    await close(page, page.locator('.pal'))

    await page.keyboard.press(`${MOD}+,`)
    await expectDark(page, 'settings modal', page.getByRole('dialog'))
    await close(page, page.getByRole('dialog'))

    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await expectDark(page, 'page menu', page.locator('.pm[data-popover]'))
    await close(page, page.locator('.pm[data-popover]'))

    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    await expectDark(page, 'share modal', page.getByRole('dialog'))
    await close(page, page.getByRole('dialog'))

    const id = await createPage(page, { title: 'Dark editor', content: doc(para('select me please'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()
    await page.waitForTimeout(150)
    await page.keyboard.type('/')
    await expectDark(page, 'slash menu', page.locator('.slash'))
    await close(page, page.locator('.slash'))
    await selectText(page, ed, 'select me please')
    await expectDark(page, 'bubble toolbar', page.locator('[aria-label="Formatting"]'))

    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    const dbEl = page.locator('#main section.db').first()
    await dbEl.getByRole('tab').filter({ hasText: 'All projects' }).click()
    const row = dbEl.locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: 'Brand refresh' }) })
    await row.locator('[role="gridcell"][data-type="date"]').click()
    await expectDark(page, 'date picker', page.locator('.db-date-pop'))
    await close(page, page.locator('.db-date-pop'))
    await row.hover()
    await row.locator('.db-open').click()
    await expectDark(page, 'peek', page.locator('.peek'))
    await close(page, page.locator('.peek'))

    await page.locator('.sb').getByRole('button', { name: /^Templates/ }).click()
    await expectDark(page, 'templates modal', page.getByRole('dialog'))
    await close(page, page.getByRole('dialog'))
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    await expectDark(page, 'import modal', page.getByRole('dialog'))
    await close(page, page.getByRole('dialog'))
    await page.locator('.sb-trash').click()
    await expectDark(page, 'trash popover', page.getByRole('dialog', { name: 'Trash' }))
    await close(page, page.getByRole('dialog', { name: 'Trash' }))
    await page.locator('.sb').getByRole('button', { name: /^Graph/ }).click()
    await expectDark(page, 'graph', page.locator('.graph'))
  })
})

test.describe('a workspace look keeps the themes', () => {
  test.use({ colorScheme: 'dark' })

  test('Carbon stays dark and Paper stays light with a look (Ochre)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, p) => s.setLook({ ...p, updatedAt: 0 }), { preset: 'ochre', colors: { paper: '#f3eee2', ink: '#1c1912', signal: '#e0a000' }, fonts: { ui: 'archivo', text: 'ui', headings: 'expanded' }, corners: 'standard' })
    await expect(page.locator('html')).toHaveAttribute('data-look', /.+/)
    await expectDark(page, 'body', page.locator('body'))
    await expectDark(page, 'sidebar', page.locator('aside.sb'))
    await expectDark(page, 'topbar', page.locator('header.tb'))
    await page.keyboard.press(`${MOD}+k`)
    await expectDark(page, 'palette', page.locator('.pal'))
    await close(page, page.locator('.pal'))
    await page.keyboard.press(`${MOD}+,`)
    await expectDark(page, 'settings modal', page.getByRole('dialog'))
    await close(page, page.getByRole('dialog'))
    await wsEval(page, (s) => s.updateSettings({ theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await surfaceLuminance(page.locator('body'))).toBeGreaterThan(0.75)
  })
})
