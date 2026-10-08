/**
 * RECENT | FREQUENT (shell/lib/visits.ts, shell/sidebar/Visited.tsx): the sidebar section and ⌘K's empty
 * field. Visits are per device (localStorage one.shell.visits:local:local), counted after a moment on the
 * page, never in the workspace or a backup; the switch and the fold are kept per device; clearing works
 * per list and for both; trashed and template pages never show; another tab follows.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, createPage, wsEval, pageIdByTitle, MOD } from './fixtures'

const KEY = 'one.shell.visits:local:local'
const section = (page: Page) => page.getByTestId('visited-section')
const rows = (s: Locator) => s.locator('[role="tabpanel"] .sb-row__title')
const stored = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { v: number; e: Record<string, [number, number, number]> }) : null
  }, KEY)

test.describe('recent and frequent pages', () => {
  test('RECENT lists where you were (newest first, the open page left out) and survives a reload', async ({ page }) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Visit A' })
    const b = await createPage(page, { title: 'Visit B' })
    const c = await createPage(page, { title: 'Visit C' })
    for (const id of [a, b, c]) await gotoPage(page, id)
    const s = section(page)
    await expect(s.getByRole('tab', { name: 'Recent' })).toHaveAttribute('aria-selected', 'true')
    await expect(rows(s).first()).toHaveText('Visit B')
    await expect(rows(s).nth(1)).toHaveText('Visit A')
    await expect(rows(s).filter({ hasText: /^Visit C$/ })).toHaveCount(0)
    // the rows are the tree's rows (marked by their list)
    await expect(s.locator('.sb-row').first()).toHaveAttribute('data-section', 'recent')
    await reloadApp(page)
    await expect(rows(section(page)).first()).toHaveText('Visit B')
    // section numbers count what is shown: FAVORITES 01 · RECENT | FREQUENT 02 · PAGES 03 · TRASH 04
    await expect(section(page).locator('.sb-sect__n')).toHaveText('02')
    await expect(page.locator('.sb section[aria-label="Pages"] .sb-sect__n')).toHaveText('03')
    await expect(page.locator('.sb-trash .sb-sect__n')).toHaveText('04')
  })

  test('FREQUENT: a page opened on three occasions comes first; a quick hop does not count', async ({ page }) => {
    await page.clock.install()
    await openApp(page)
    const often = await createPage(page, { title: 'Often here' })
    const other = await createPage(page, { title: 'Somewhere else' })
    const quick = await createPage(page, { title: 'Just passing' })
    const landing = await createPage(page, { title: 'Landing here' })
    const stay = async (id: string) => {
      await gotoPage(page, id)
      await page.clock.runFor(1700)
    }
    // three occasions, another page in between each time
    for (let i = 0; i < 3; i++) {
      await stay(other)
      await stay(often)
      await page.clock.fastForward('16:00')
    }
    // in and out within 500 ms: nothing counted
    await gotoPage(page, quick)
    await page.clock.runFor(400)
    await stay(landing)
    const data = await stored(page)
    expect(data?.v).toBe(1)
    expect(data?.e[often]?.[2]).toBe(3)
    expect(data?.e[other]?.[2]).toBe(3)
    expect(data?.e[landing]?.[2]).toBe(1)
    expect(data?.e[quick]).toBeUndefined()
    // staying on (or coming straight back to) a page within the session does not count again
    await stay(landing)
    expect((await stored(page))?.e[landing]?.[2]).toBe(1)
    const s = section(page)
    await s.getByRole('tab', { name: 'Recent' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(s.getByRole('tab', { name: 'Frequent' })).toHaveAttribute('aria-selected', 'true')
    await expect(s.getByRole('tab', { name: 'Frequent' })).toBeFocused()
    await expect(rows(s).first()).toHaveText('Often here')
    // the switch is kept on this device
    await reloadApp(page)
    await expect(section(page).getByRole('tab', { name: 'Frequent' })).toHaveAttribute('aria-selected', 'true')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.shell.visited') ?? '{}'))).toMatchObject({ tab: 'frequent', open: true })
  })

  test('trashed pages leave both lists (FREQUENT has them back after Restore); template pages never show', async ({ page }) => {
    await openApp(page)
    const p = await createPage(page, { title: 'Soon in the trash' })
    const tpl = await createPage(page, { title: 'Template child' })
    const elsewhere = await createPage(page, { title: 'Elsewhere for now' })
    await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify({ v: 1, e: { [ids.p]: [5, Date.now(), 3], [ids.tpl]: [6, Date.now(), 4] } })), { key: KEY, ids: { p, tpl } })
    await gotoPage(page, p)
    // a page that turns into a template (features/templates) after it was visited
    await wsEval(page, (s, id) => s.touchRecent(id), tpl)
    await wsEval(page, (s, id) => s.updatePage(id, { template: { name: 'Kit' } }), tpl)
    await gotoPage(page, elsewhere)
    await reloadApp(page)
    const s = section(page)
    await s.getByRole('tab', { name: 'Frequent' }).click()
    await expect(rows(s)).toHaveText(['Soon in the trash'])
    await s.getByRole('tab', { name: 'Recent' }).click()
    await expect(rows(s).filter({ hasText: 'Template child' })).toHaveCount(0)
    await expect(rows(s).filter({ hasText: 'Soon in the trash' })).toHaveCount(1)
    await wsEval(page, (s, id) => s.trashPage(id), p)
    await expect(rows(s).filter({ hasText: 'Soon in the trash' })).toHaveCount(0)
    await s.getByRole('tab', { name: 'Frequent' }).click()
    await expect(rows(s).filter({ hasText: 'Soon in the trash' })).toHaveCount(0)
    await wsEval(page, (s, id) => s.restorePage(id), p)
    await expect(rows(s)).toHaveText(['Soon in the trash'])
  })

  test('fold, clear one list, clear both — and nothing of it is in the workspace', async ({ page }) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Kept apart A' })
    const b = await createPage(page, { title: 'Kept apart B' })
    await page.evaluate(({ key, a }) => localStorage.setItem(key, JSON.stringify({ v: 1, e: { [a]: [4, Date.now(), 3] } })), { key: KEY, a })
    await gotoPage(page, a)
    await gotoPage(page, b)
    await reloadApp(page)
    const s = section(page)
    // fold: kept across a reload
    const fold = s.getByRole('button', { name: 'Fold recent and frequent' })
    await fold.click()
    await expect(s.getByRole('tabpanel')).toHaveCount(0)
    await expect(s.getByRole('button', { name: 'Unfold recent and frequent' })).toHaveAttribute('aria-expanded', 'false')
    await reloadApp(page)
    await expect(section(page).getByRole('tabpanel')).toHaveCount(0)
    await section(page).getByRole('button', { name: 'Unfold recent and frequent' }).click()
    await expect(rows(section(page)).first()).toHaveText('Kept apart A')

    // right-click the head → Clear this list: only RECENT goes
    await section(page).locator('.sb-visited__head').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Clear this list/ }).click()
    await expect(page.getByText('Cleared on this device')).toBeVisible()
    expect(await wsEval(page, (s) => s.recent.length)).toBe(0)
    expect((await stored(page))?.e[a]).toBeTruthy()
    await section(page).getByRole('tab', { name: 'Frequent' }).click()
    await expect(rows(section(page))).toHaveText(['Kept apart A'])

    // the visits are this device's: not in the workspace, not in a backup
    expect(await wsEval(page, (s) => 'visits' in s)).toBe(false)
    const snapshot = await page.evaluate(() => JSON.stringify((window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> } } }).__one.workspace.getState(), (k, v) => (typeof v === 'function' ? undefined : v)))
    expect(snapshot).not.toContain('one.shell.visits')

    // ⌘K "Clear recent and frequent pages": both lists go (the section with them)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('Clear recent and frequent')
    await page.getByRole('option', { name: /Clear recent and frequent pages/ }).click()
    await expect(section(page)).toHaveCount(0)
    expect(await stored(page)).toBeNull()
  })

  test('⌘K with an empty field: RECENT, then FREQUENT, no page twice', async ({ page }) => {
    await openApp(page)
    const ids: string[] = []
    for (const t of ['Pal one', 'Pal two', 'Pal three']) ids.push(await createPage(page, { title: t }))
    // FREQUENT: the three (two of them are RECENT too, one is open) and a page never opened here
    const reading = await pageIdByTitle(page, 'Reading list')
    await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify({ v: 1, e: Object.fromEntries(ids.map((id, i) => [id, [5 - i, Date.now(), 3]])) })), { key: KEY, ids: [...ids, reading] })
    for (const id of ids) await gotoPage(page, id)
    await reloadApp(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.locator('.pal-group > span:first-child').nth(0)).toHaveText('Recent')
    await expect(pal.locator('.pal-group > span:first-child').nth(1)).toHaveText('Frequent')
    const names = await pal.locator('.pal-item--page .pal-item__title').allInnerTexts()
    expect(new Set(names).size).toBe(names.length)
    // the open page (Pal three) is in neither list; Pal one / two are RECENT, so FREQUENT shows the rest
    expect(names).not.toContain('Pal three')
    expect(names.filter((n) => n === 'Pal one')).toHaveLength(1)
    const frequent = pal.locator('[cmdk-group]').filter({ has: page.locator('.pal-group', { hasText: 'Frequent' }) })
    await expect(frequent.locator('.pal-item__title')).toHaveText(['Reading list'])
  })

  test('another tab follows (storage event)', async ({ page, context, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Shared between tabs' })
    const other = await context.newPage()
    errors.watch(other)
    await openApp(other)
    await expect.poll(() => wsEval(other, (s, id) => !!s.pages[id], id)).toBe(true)
    await page.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ v: 1, e: { [id]: [4, Date.now(), 3] } })), { key: KEY, id })
    const s = section(other)
    await s.getByRole('tab', { name: 'Frequent' }).click()
    await expect(rows(s)).toHaveText(['Shared between tabs'])
  })
})
