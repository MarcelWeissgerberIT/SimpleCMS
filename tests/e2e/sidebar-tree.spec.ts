/**
 * The tree under the seam (shell/sidebar): sticky section heads, the reveal rule (the open page's top-level ancestor is
 * the first row under the stuck head; nothing moves when the open row shows already), "Collapse all" keeping the open
 * page's chain, no layout shift when a drag starts, and the visibleWithin drop rule (a row hidden under the fixed block
 * or a stuck head takes no drop). Slice 2: the entry peek (5 + "+N more" unfolding in place, kept, folded by Collapse
 * all, the open entry always shown, the key staying put when the list folds back), a calendar / timeline first view
 * listing newest first, and RECENT | FREQUENT starting folded where favourites exist.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, createPage, wsEval, sidebarRow, flush } from './fixtures'

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

/** A Nordlicht journal: a calendar first view (no sorts of its own; `type` 'timeline' for a timeline), a table second; `n` days 2026-10-01 …, created oldest first. */
async function journal(page: Page, n: number, type: 'calendar' | 'timeline' = 'calendar'): Promise<string> {
  const id = await wsEval(
    page,
    (s, a) => {
      const one = (window as unknown as { __one: { workspace: { getState: () => typeof s } } }).__one.workspace
      const id = s.createDatabase({ title: a.title, parentId: null, properties: [{ id: 'jTitle', name: 'Name', type: 'title' }, { id: 'jDate', name: 'Date', type: 'date' }] })
      const v0 = one.getState().databases[id].views[0]
      one.getState().updateDatabase(id, { views: [{ ...v0, id: 'jFirst', type: a.type, name: 'First', dateProperty: 'jDate', sorts: [] }, { ...v0, name: 'All' }] })
      for (let d = 1; d <= a.n; d++) one.getState().createRow(id, { title: `Day ${String(d).padStart(2, '0')}`, properties: { jDate: { start: `2026-10-${String(d).padStart(2, '0')}` } } })
      return id
    },
    { n, type, title: type === 'calendar' ? 'Nordlicht journal' : 'Tessera timeline' },
  )
  await flush(page)
  return id
}
/** The titles of a node's direct entries / sub-pages, in tree order. */
const kids = (r: Locator) => r.locator('xpath=..').locator(':scope > .sb-children > .sb-node > .sb-row .sb-row__title')
const peekOf = (r: Locator) => r.locator('xpath=..').locator(':scope > .sb-children > .sb-more [data-testid="tree-peek"]')
async function open(page: Page, r: Locator) {
  await r.scrollIntoViewIfNeeded()
  await r.hover()
  const toggle = r.locator('.sb-row__toggle')
  if ((await toggle.getAttribute('aria-label')) === 'Expand') await toggle.click()
  await expect(r.locator('.sb-row__link')).toHaveAttribute('aria-expanded', 'true')
}

test.describe('the entry peek and the journal order', () => {
  test('a long list shows its 5 first (a calendar-first database: newest first) and "+N more" — Enter / → / ← unfold and fold it in place, kept on this device', async ({ page }) => {
    await openApp(page)
    const id = await journal(page, 12)
    const db = sidebarRow(page, 'Nordlicht journal')
    await open(page, db)
    await expect(kids(db)).toHaveText(['Day 12', 'Day 11', 'Day 10', 'Day 09', 'Day 08'])
    const peek = peekOf(db)
    await expect(peek).toHaveText('+7 more')
    await expect(peek).toHaveAttribute('aria-expanded', 'false')
    await expect(peek).toHaveAccessibleName('Show 7 more entries of Nordlicht journal')
    await expect(page.locator('.sb section[aria-label="Pages"]').getByTestId('tree-show-all')).toHaveCount(0)
    // Enter unfolds in place: every day, newest first; the key now folds — the focus stays on it
    await peek.focus()
    await page.keyboard.press('Enter')
    await expect(kids(db)).toHaveCount(12)
    await expect(kids(db).last()).toHaveText('Day 01')
    await expect(peek).toHaveText('Show fewer')
    await expect(peek).toHaveAttribute('aria-expanded', 'true')
    await expect(peek).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(kids(db)).toHaveCount(5)
    await expect(peek).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(kids(db)).toHaveCount(12)
    // ↑ walks into the list it opened, like any tree row
    await page.keyboard.press('ArrowUp')
    await expect(db.locator('xpath=..').locator('.sb-row__link', { hasText: 'Day 01' })).toBeFocused()
    // kept on this device: the list's own key in the expanded state
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem('one.shell.expanded') ?? '{}')[k], `more:pages:${id}`)).toBe(true)
    await reloadApp(page)
    await expect(kids(sidebarRow(page, 'Nordlicht journal'))).toHaveCount(12)
  })

  test('the open entry always shows (past the peek too); Collapse all folds an unfolded list back to its peek', async ({ page }) => {
    await openApp(page)
    const id = await journal(page, 12)
    const day2 = await wsEval(page, (s, db) => Object.values(s.pages).find((p: { databaseId: string; title: string }) => p.databaseId === db && p.title === 'Day 02') as { id: string }, id)
    await gotoPage(page, day2.id)
    const db = sidebarRow(page, 'Nordlicht journal')
    await expect(kids(db)).toHaveText(['Day 12', 'Day 11', 'Day 10', 'Day 09', 'Day 08', 'Day 02'])
    await expect(sidebarRow(page, 'Day 02')).toHaveAttribute('data-active', 'true')
    await expect(peekOf(db)).toHaveText('+6 more')
    await peekOf(db).click()
    await expect(kids(db)).toHaveCount(12)
    const collapse = page.locator('.sb section[aria-label="Pages"]').getByRole('button', { name: 'Collapse all' })
    await expect(collapse).not.toHaveAttribute('aria-disabled', 'true')
    await collapse.click()
    // the open page's chain stays open — the list peeks again
    await expect(kids(db)).toHaveCount(6)
    await expect(peekOf(db)).toHaveText('+6 more')
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem('one.shell.expanded') ?? '{}')[k] ?? null, `more:pages:${id}`)).toBeNull()
  })

  test('folding back keeps the key where it was: the rows above it go, the tree follows', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => {
      for (let i = 0; i < 25; i++) s.createPage({ title: `Tessera log ${String(i).padStart(2, '0')}`, parentId: null })
    })
    await journal(page, 20)
    await wsEval(page, (s) => {
      for (let i = 0; i < 25; i++) s.createPage({ title: `Nordlicht log ${String(i).padStart(2, '0')}`, parentId: null })
    })
    const db = sidebarRow(page, 'Nordlicht journal')
    await open(page, db)
    await peekOf(db).click()
    await expect(kids(db)).toHaveCount(20)
    // the key in the middle of the scroll area, rows below it to scroll
    const box = page.locator('.sb .sb-scroll')
    await peekOf(db).evaluate((el) => {
      const sc = el.closest('.sb-scroll')!
      sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 2
    })
    await page.waitForTimeout(150)
    const before = (await peekOf(db).boundingBox())!.y
    const scrollBefore = await box.evaluate((el) => el.scrollTop)
    await peekOf(db).click()
    await expect(kids(db)).toHaveCount(5)
    expect(Math.abs((await peekOf(db).boundingBox())!.y - before)).toBeLessThanOrEqual(1)
    expect(await box.evaluate((el) => el.scrollTop)).toBeLessThan(scrollBefore - 300)
    // unfolding again: the rows come below the five, the key moves down with them
    await peekOf(db).click()
    await expect(kids(db)).toHaveCount(20)
    expect((await peekOf(db).boundingBox())!.y).toBeGreaterThan(before + 300)
  })

  test('a timeline first lists newest first too; sorts of its own decide; a moved date re-sorts; up to 7 entries show whole', async ({ page }) => {
    await openApp(page)
    const id = await journal(page, 9, 'timeline')
    const db = sidebarRow(page, 'Tessera timeline')
    await open(page, db)
    await expect(kids(db)).toHaveText(['Day 09', 'Day 08', 'Day 07', 'Day 06', 'Day 05'])
    // a date moved: the list re-sorts (the entry index re-sorts on the date it orders by)
    await wsEval(page, (s, db) => {
      const row = Object.values(s.pages).find((p: { databaseId: string; title: string }) => p.databaseId === db && p.title === 'Day 01') as { id: string }
      s.setRowProperty(row.id, 'jDate', { start: '2026-11-01' })
    }, id)
    await expect(kids(db).first()).toHaveText('Day 01')
    // sorts of its own: oldest first by the date
    await wsEval(page, (s, db) => s.updateView(db, 'jFirst', { sorts: [{ propertyId: 'jDate', direction: 'asc' }] }), id)
    await expect(kids(db)).toHaveText(['Day 02', 'Day 03', 'Day 04', 'Day 05', 'Day 06'])
    // a short list (≤ 7) has no peek
    const short = await journal(page, 7)
    const sdb = sidebarRow(page, 'Nordlicht journal')
    await open(page, sdb)
    await expect(kids(sdb)).toHaveCount(7)
    await expect(peekOf(sdb)).toHaveCount(0)
    expect(short).toBeTruthy()
  })

  test('German: "+N weitere" and "Weniger"', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await journal(page, 9)
    const db = page.locator('.sb section[aria-label="Seiten"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Nordlicht journal$/ }) })
    await db.hover()
    await db.getByRole('button', { name: 'Aufklappen' }).click()
    await expect(peekOf(db)).toHaveText('+4 weitere')
    await expect(peekOf(db)).toHaveAccessibleName('4 weitere Einträge von Nordlicht journal zeigen')
    await peekOf(db).click()
    await expect(peekOf(db)).toHaveText('Weniger')
    await expect(peekOf(db)).toHaveAccessibleName('Weniger Einträge von Nordlicht journal zeigen')
  })
})

test.describe('RECENT | FREQUENT with favourites', () => {
  const visited = (page: Page) => page.getByTestId('visited-section')

  test('starts folded while favourites exist; unfolded once, it stays so on this device', async ({ page }) => {
    // the demo stars two pages
    await openApp(page)
    const a = await createPage(page, { title: 'Mara Lind' })
    const b = await createPage(page, { title: 'Launch plan' })
    await gotoPage(page, a)
    await gotoPage(page, b)
    await reloadApp(page)
    await expect(visited(page)).toBeVisible()
    await expect(visited(page).getByRole('tabpanel')).toHaveCount(0)
    const unfold = visited(page).getByRole('button', { name: 'Unfold recent and frequent' })
    await expect(unfold).toHaveAttribute('aria-expanded', 'false')
    // the numbers do not change: it is there, folded
    await expect(visited(page).locator('.sb-sect__n')).toHaveText('02')
    await unfold.click()
    await expect(visited(page).getByRole('tabpanel')).toBeVisible()
    await reloadApp(page)
    await expect(visited(page).getByRole('tabpanel')).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.shell.visited') ?? '{}'))).toMatchObject({ open: true })
  })

  test('without favourites it starts open; a first star later does not fold it under the pointer', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => Object.values(s.pages).forEach((p: { id: string; favorite: boolean }) => p.favorite && s.toggleFavorite(p.id)))
    const a = await createPage(page, { title: 'Mara Lind' })
    const b = await createPage(page, { title: 'Launch plan' })
    await gotoPage(page, a)
    await gotoPage(page, b)
    await reloadApp(page)
    await expect(visited(page).getByRole('tabpanel')).toBeVisible()
    await wsEval(page, (s, id) => s.toggleFavorite(id), a)
    await expect(page.locator('.sb section[aria-label="Favorites"] .sb-row__title', { hasText: 'Mara Lind' })).toBeVisible()
    await expect(visited(page).getByRole('tabpanel')).toBeVisible()
    // nothing stored: on the next start it is folded
    expect(await page.evaluate(() => localStorage.getItem('one.shell.visited'))).toBeNull()
    await reloadApp(page)
    await expect(visited(page).getByRole('tabpanel')).toHaveCount(0)
  })
})
