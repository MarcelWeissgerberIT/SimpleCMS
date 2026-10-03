import { test, expect, openApp } from './fixtures'

test.describe('mobile 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('app: sidebar drawer opens, navigates, page renders without sideways scroll', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
    const sb = page.locator('aside.sb')
    await expect(sb).toHaveAttribute('data-state', 'drawer')
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await expect(sb).toHaveAttribute('data-state', 'drawer-open')
    await expect(sb.locator('.sb-row__title', { hasText: 'Reading list' }).first()).toBeInViewport()
    await sb.locator('section[aria-label="Pages"] .sb-row__link', { hasText: 'Team wiki' }).tap()
    await expect(sb).toHaveAttribute('data-state', 'drawer')
    await expect(page.locator('#main .pv-title')).toHaveValue('Team wiki')
    await expect(page.locator('#main .ProseMirror')).toContainText('Everything the team needs')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('app: a database page is usable at 390 px', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await page.locator('aside.sb section[aria-label="Pages"] .sb-row__link', { hasText: 'Projects' }).tap()
    await expect(page.locator('#main section.db')).toBeVisible()
    await expect(page.locator('#main section.db').getByText('Website relaunch').first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('landing: site fits the screen', async ({ page }) => {
    await page.goto('./?skip')
    await expect(page.locator('#site').getByRole('link', { name: /Open/ }).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
