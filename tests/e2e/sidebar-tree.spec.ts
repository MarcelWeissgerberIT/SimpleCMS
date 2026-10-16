/**
 * The tree under the seam (shell/sidebar): sticky section heads, the reveal rule (the open page's top-level ancestor is
 * the first row under the stuck head; nothing moves when the open row shows already), "Collapse all" keeping the open
 * page's chain, no layout shift when a drag starts, and the visibleWithin drop rule (a row hidden under the fixed block
 * or a stuck head takes no drop).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, sidebarRow } from './fixtures'

const scroller = (page: Page) => page.locator('.sb .sb-scroll')
const pagesHead = (page: Page) => page.locator('.sb section[aria-label="Pages"] > .sb-sect')

/** 30 top-level pages, a chain of five (top-level first), 30 more — the chain sits mid-tree, out of sight. */
async function longTree(page: Page): Promise<string[]> {
  await wsEval(page, (s) => {
    for (let i = 0; i < 30; i++) s.createPage({ title: `Tessera log ${String(i).padStart(2, '0')}`, parentId: null })
  })
  const chain: string[] = []
  for (const title of ['Launch plan', 'Phase one', 'Step one', 'Checklist', 'Material list']) chain.push(await createPage(page, { title, parentId: chain.at(-1) ?? null }))
  await wsEval(page, (s) => {
    for (let i = 0; i < 30; i++) s.createPage({ title: `Nordlicht log ${String(i).padStart(2, '0')}`, parentId: null })
  })
  return chain
}

test.describe('the tree under the seam', () => {
  test('the reveal: the top-level ancestor is the first row right under the stuck head; nothing moves when the row shows', async ({ page }) => {
    await openApp(page)
    const chain = await longTree(page)
    await gotoPage(page, chain[4])
    const top = sidebarRow(page, 'Launch plan')
    await expect(page.locator('.sb section[aria-label="Pages"] .sb-row[data-active]')).toBeInViewport({ ratio: 1 })
    await expect
      .poll(async () => {
        const head = (await pagesHead(page).boundingBox())!
        const row = (await top.boundingBox())!
        return Math.round(row.y - (head.y + head.height))
      })
      .toBe(0)
    await expect(pagesHead(page)).toHaveAttribute('data-stuck', '')
    // a page that shows already: the rows stay where they are (scrollTop may follow RECENT growing above — anchoring)
    const before = (await top.boundingBox())!.y
    await gotoPage(page, chain[2])
    await page.waitForTimeout(300)
    expect((await top.boundingBox())!.y).toBe(before)
  })

  test('"Collapse all" folds the tree but the open page’s chain — always in the head, aria-disabled when nothing folds', async ({ page }) => {
    await openApp(page)
    const chain = await longTree(page)
    const other = await createPage(page, { title: 'Tessera folder' })
    await createPage(page, { title: 'Tessera child', parentId: other })
    await gotoPage(page, chain[3])
    const folder = sidebarRow(page, 'Tessera folder')
    await folder.scrollIntoViewIfNeeded()
    await folder.locator('.sb-row__toggle').click()
    await expect(sidebarRow(page, 'Tessera child')).toHaveCount(1)
    // open the open page's own children too
    const open = sidebarRow(page, 'Checklist')
    await open.locator('.sb-row__toggle').click()
    await expect(sidebarRow(page, 'Material list')).toBeVisible()
    const key = page.locator('.sb section[aria-label="Pages"]').getByRole('button', { name: 'Collapse all' })
    await expect(key).not.toHaveAttribute('aria-disabled', 'true')
    await key.click()
    await expect(sidebarRow(page, 'Tessera child')).toHaveCount(0)
    // the chain and the open page's own expansion stay
    for (const t of ['Phase one', 'Step one', 'Checklist', 'Material list']) await expect(sidebarRow(page, t)).toHaveCount(1)
    await expect(key).toHaveAttribute('aria-disabled', 'true')
    await key.click({ force: true })
    await expect(sidebarRow(page, 'Material list')).toHaveCount(1)
  })

  test('a drag start moves nothing: every row keeps its box after pointerdown + 6 px', async ({ page }) => {
    await openApp(page)
    await createPage(page, { title: 'Mara Lind' })
    const rows = page.locator('.sb .sb-row, .sb .sb-sect, .sb .sb-favs__slot, .sb .sb-favs')
    const boxes = () => rows.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)].join(':') }))
    const src = sidebarRow(page, 'Mara Lind')
    await src.scrollIntoViewIfNeeded()
    const before = await boxes()
    const a = (await src.boundingBox())!
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 60, a.y + a.height / 2 - 6, { steps: 3 })
    await expect(src).toHaveAttribute('data-dragging', 'true')
    expect(await boxes()).toEqual(before)
    await page.mouse.up()
  })

  test('a row out of sight takes no drop: under the fixed block (FAVORITES takes it) and under a stuck head', async ({ page }) => {
    await openApp(page)
    const chain = await longTree(page)
    const src = await createPage(page, { title: 'Drop probe' })
    await gotoPage(page, chain[0])
    // scroll so rows sit under the fixed block (above the scroll area's top)
    await scroller(page).evaluate((el) => (el.scrollTop = 600))
    await page.waitForTimeout(200)
    const hidden = await scroller(page).evaluate((el) => {
      const top = el.getBoundingClientRect().top
      const row = [...el.querySelectorAll<HTMLElement>('.sb-row[data-section="pages"]')].find((r) => r.getBoundingClientRect().bottom < top && r.getBoundingClientRect().bottom > top - 140)
      return row ? { title: row.querySelector('.sb-row__title')!.textContent!, y: row.getBoundingClientRect().top + 10 } : null
    })
    expect(hidden).not.toBeNull()
    const probe = sidebarRow(page, 'Drop probe')
    await probe.scrollIntoViewIfNeeded()
    const a = (await probe.boundingBox())!
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 60, a.y + a.height / 2 - 8, { steps: 3 })
    await page.mouse.move(a.x + 60, hidden!.y, { steps: 12 })
    await page.mouse.move(a.x + 62, hidden!.y, { steps: 2 })
    await expect(sidebarRow(page, hidden!.title)).not.toHaveAttribute('data-drop', /.*/)
    // the stuck PAGES head: no row under it takes the drop either
    const head = (await pagesHead(page).boundingBox())!
    await page.mouse.move(a.x + 60, head.y + head.height / 2, { steps: 6 })
    await expect(page.locator('.sb section[aria-label="Pages"] .sb-row[data-drop]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await wsEval(page, (s, id) => [s.pages[id].parentId, s.pages[id].favorite], src)).toEqual([null, false])
  })
})
