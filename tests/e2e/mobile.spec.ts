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

  test('app: RECENT | FREQUENT in the drawer starts folded, unfolds, fits, and its switch is tappable', async ({ page }) => {
    await openApp(page)
    const sb = page.locator('aside.sb')
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await sb.locator('section[aria-label="Pages"] .sb-row__link', { hasText: 'Team wiki' }).tap()
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const visited = sb.getByTestId('visited-section')
    await expect(visited).toBeVisible()
    await expect(visited.getByRole('tabpanel')).toHaveCount(0)
    await visited.getByRole('button', { name: 'Unfold recent and frequent' }).tap()
    await expect(visited.getByRole('tabpanel').locator('.sb-row__title').first()).toHaveText('Welcome to One')
    const tab = visited.getByRole('tab', { name: 'Frequent' })
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(28)
    await tab.tap()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const box = (await visited.boundingBox())!
    const drawer = (await sb.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(drawer.x + drawer.width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })

  test('app: the drawer — 36 px places, TOOLS folded, rows with ⋯ only, a toast above its foot', async ({ page }) => {
    await openApp(page)
    const sb = page.locator('aside.sb')
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    for (const name of [/^Search/, /^Home/, /^Inbox/, /^Today/]) expect(Math.round((await sb.locator('.sb-nav').getByRole('button', { name }).first().boundingBox())!.height)).toBeGreaterThanOrEqual(36)
    await expect(sb.locator('.sb-tools__fold')).toHaveAttribute('aria-expanded', 'false')
    // a tree row carries only its ⋯ (the star and "+" are in its menu): titles keep their room
    const rows = sb.locator('section[aria-label="Pages"] .sb-row')
    for (const i of [0, 1, 2]) {
      const shown = await rows.nth(i).locator('.sb-row__actions > button').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('aria-label')))
      expect(shown).toEqual(['More'])
    }
    // a toast (a reminder) sits above the drawer's foot, never on the trash
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { toast: (t: unknown) => void } } } }).__one.ui.getState().toast({ message: 'Reminder · Launch plan', kind: 'info', timeout: 20000 }))
    const toast = page.locator('.toast').first()
    await expect(toast).toBeVisible()
    const foot = (await sb.locator('.sb-foot').boundingBox())!
    await expect.poll(async () => { const t = (await toast.boundingBox())!; return Math.round(foot.y - (t.y + t.height)) }).toBeGreaterThanOrEqual(0)
    // the drawer closed: the toast goes back to its own place
    await page.locator('.sb-scrim').tap({ position: { x: 370, y: 300 } })
    await expect(sb).toHaveAttribute('data-state', 'drawer')
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--sb-foot'))).toBe('')
    await expect.poll(async () => Math.round(844 - ((await toast.boundingBox())!.y + (await toast.boundingBox())!.height))).toBeLessThan(foot.height)
  })

  test('app: a row’s ⋯ on touch starts with "Add a page inside", then the star', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const row = page.locator('aside.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Team wiki$/ }) })
    await row.getByRole('button', { name: 'More' }).tap()
    const items = page.getByRole('menuitem')
    await expect(items.nth(0)).toHaveText(/Add a page inside/)
    await expect(items.nth(1)).toHaveText(/favorites/)
    await items.nth(0).tap()
    await expect(page.locator('aside.sb')).toHaveAttribute('data-state', 'drawer')
    await expect(page.locator('#main .pv-title')).toBeFocused()
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

test.describe('mobile 390 px overlays', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  const fits = async (loc: import('@playwright/test').Locator, name: string) => {
    await expect(loc.first(), name).toBeVisible()
    const box = (await loc.first().boundingBox())!
    expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(391)
  }

  test('palette, settings, page menu, share and slash menu fit the screen', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await page.locator('aside.sb').getByRole('button', { name: /^Search/ }).tap()
    await fits(page.locator('.pal'), 'palette')
    // filters: chips wrap above the field, suggestions and the values line (with the database) stay inside
    await page.keyboard.type('status:done @')
    await expect(page.locator('.pal-chip')).toHaveCount(1)
    await fits(page.locator('.pal-chip'), 'chip')
    await fits(page.locator('.pal-item--sug'), 'suggestion row')
    await expect(page.locator('.pal-item--page .pal-prop--db').first()).toBeVisible()
    await fits(page.locator('.pal-item--page .pal-item__props'), 'values line')
    await fits(page.locator('.pal'), 'palette with filters')
    // the chip is a generous target on touch
    expect((await page.locator('.pal-chip').first().boundingBox())!.height).toBeGreaterThanOrEqual(32)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await page.keyboard.press('Escape')

    await page.locator('.tb').getByRole('button', { name: 'Page options' }).tap()
    await fits(page.locator('[data-popover][role="menu"]'), 'page menu')
    await page.getByRole('menuitem', { name: 'Share' }).tap()
    await fits(page.getByRole('dialog'), 'share modal')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await page.locator('aside.sb .sb-head__ws').tap()
    await page.getByRole('menuitem', { name: /^Settings/ }).tap()
    await fits(page.getByRole('dialog'), 'settings modal')
    await page.keyboard.press('Escape')

    await page.locator('#main .ProseMirror p').first().tap()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await fits(page.locator('.slash'), 'slash menu')
  })
})
