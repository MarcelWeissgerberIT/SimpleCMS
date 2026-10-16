/**
 * The tree under the seam (shell/sidebar): sticky section heads, the reveal rule (the open page's top-level ancestor is
 * the first row under the stuck head; nothing moves when the open row shows already), "Collapse all" keeping the open
 * page's chain, no layout shift when a drag starts, and the visibleWithin drop rule (a row hidden under the fixed block
 * or a stuck head takes no drop). Slice 2: the entry peek (5 + "+N more" unfolding in place, kept, folded by Collapse
 * all, the open entry always shown, the key staying put when the list folds back), a calendar / timeline first view
 * listing newest first, and RECENT | FREQUENT starting folded where favourites exist. Review fixes: a drag reads the live
 * pointer (auto-scroll keeps going up, the middle of a row means "inside" after the tree scrolled), the end of the tree
 * rests on whole rows, each section's rows snap under its own head's measured height (36 px on a coarse pointer), a
 * touch drag start moves no title, the RECENT | FREQUENT head stays one line at 220 px with the biggest text.
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

  test('a drag held near the top keeps the tree scrolling up — however far it scrolled already', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => {
      for (let i = 0; i < 80; i++) s.createPage({ title: `Tessera item ${String(i).padStart(2, '0')}`, parentId: null })
    })
    await flush(page)
    const box = scroller(page)
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.waitForTimeout(300)
    const b = (await box.boundingBox())!
    const start = await box.evaluate((el) => el.scrollTop)
    const y0 = b.y + b.height * 0.6
    await page.mouse.move(b.x + 60, y0)
    await page.mouse.down()
    await page.mouse.move(b.x + 60, y0 - 10, { steps: 3 })
    // 40 px under the tree's top edge, held for 2 s (the drag's own delta would stop it after ~40 px)
    await page.mouse.move(b.x + 60, b.y + 40, { steps: 12 })
    await page.waitForTimeout(2000)
    const now = await box.evaluate((el) => el.scrollTop)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(start - now).toBeGreaterThan(200)
  })

  test('after the tree scrolled during a drag, the middle of a row still means "inside" (and the drop nests)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => {
      for (let i = 0; i < 60; i++) s.createPage({ title: `Nordlicht item ${String(i).padStart(2, '0')}`, parentId: null })
    })
    await flush(page)
    const src = sidebarRow(page, 'Nordlicht item 00')
    await src.scrollIntoViewIfNeeded()
    const b = (await scroller(page).boundingBox())!
    const a = (await src.boundingBox())!
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 60, a.y + a.height / 2 + 8, { steps: 3 })
    // to the bottom edge: the tree scrolls
    const before = await scroller(page).evaluate((el) => el.scrollTop)
    await page.mouse.move(b.x + 60, b.y + b.height - 6, { steps: 10 })
    await page.waitForTimeout(700)
    await page.mouse.move(b.x + 60, b.y + b.height * 0.5, { steps: 6 })
    await page.waitForTimeout(200)
    expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 100)
    // the exact middle of the row under the pointer now
    const title = await page.evaluate((y) => document.elementFromPoint(120, y)?.closest('.sb-row')?.querySelector('.sb-row__title')?.textContent ?? '', b.y + b.height * 0.5)
    expect(title).toMatch(/^Nordlicht item/)
    const target = sidebarRow(page, title)
    const t = (await target.boundingBox())!
    await page.mouse.move(b.x + 60, t.y + t.height / 2, { steps: 3 })
    await page.mouse.move(b.x + 61, t.y + t.height / 2, { steps: 1 })
    await expect(target).toHaveAttribute('data-drop', 'inside')
    await page.mouse.up()
    const parent = await wsEval(page, (s) => {
      const p = (Object.values(s.pages) as Array<{ title: string; parentId: string | null }>).find((x) => x.title === 'Nordlicht item 00')!
      return p.parentId ? s.pages[p.parentId].title : null
    })
    expect(parent).toBe(title)
  })

  test('the end of the tree rests on whole rows: the last page opened or scrolled to never sits half under the stuck head', async ({ page }) => {
    await openApp(page)
    let last = ''
    await wsEval(page, (s) => {
      for (let i = 0; i < 40; i++) s.createPage({ title: `Mara note ${String(i).padStart(2, '0')}`, parentId: null })
    })
    last = await createPage(page, { title: 'Nordlicht last' })
    /** rows cut by the stuck head's foot (or the area's top when no head sticks) */
    const straddling = () =>
      scroller(page).evaluate((box) => {
        const b = box.getBoundingClientRect()
        const stuck = [...box.querySelectorAll<HTMLElement>(':scope > .sb-section > .sb-sect')].filter((h) => Math.abs(h.getBoundingClientRect().top - b.top) < 1 && h.parentElement!.getBoundingClientRect().top < b.top - 0.5)
        const line = stuck.length ? stuck[stuck.length - 1].getBoundingClientRect().bottom : b.top
        return [...box.querySelectorAll<HTMLElement>('.sb-row')].filter((r) => { const q = r.getBoundingClientRect(); return q.height > 0 && q.top < line - 0.5 && q.bottom > line + 0.5 }).map((r) => r.textContent)
      })
    const first = await createPage(page, { title: 'Polaris first' })
    for (const h of [900, 760]) {
      await page.setViewportSize({ width: 1440, height: h })
      await gotoPage(page, first)
      await scroller(page).evaluate((el) => (el.scrollTop = 0))
      await gotoPage(page, last)
      await expect(sidebarRow(page, 'Nordlicht last')).toHaveAttribute('data-active', /.*/)
      await page.waitForTimeout(300)
      expect(await scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(1)
      expect(await straddling()).toEqual([])
      await scroller(page).evaluate((el) => (el.scrollTop = 0))
      await page.mouse.move(150, 600)
      await page.mouse.wheel(0, 20000)
      await page.waitForTimeout(800)
      expect(await straddling()).toEqual([])
    }
  })
})

test.describe('the tree on a coarse pointer (a docked iPad)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })

  test('a long press that starts a drag moves no title: the chevron keeps its slot', async ({ page }) => {
    await openApp(page)
    await createPage(page, { title: 'Tessera touch' })
    if ((await page.locator('aside.sb').getAttribute('data-state')) !== 'docked') await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const titles = () => page.evaluate(() => [...document.querySelectorAll('.sb section[aria-label="Pages"] .sb-row .sb-row__title')].slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left)))
    const row = sidebarRow(page, 'Tessera touch')
    await row.scrollIntoViewIfNeeded()
    const before = await titles()
    const r = (await row.boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    const x0 = r.x + 80
    const y0 = r.y + r.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    await page.waitForTimeout(400)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0, y: y0 - 4 }] })
    await expect.poll(() => page.evaluate(() => document.body.dataset.dragging ?? null)).toBe('tree')
    expect(await titles()).toEqual(before)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  })

  test('RECENT | FREQUENT (a 36 px head here): the rows snap whole under it', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => Object.values(s.pages).forEach((p: { id: string; favorite: boolean }) => p.favorite && s.toggleFavorite(p.id)))
    const ids: string[] = []
    for (const t of ['Mara Lind', 'Launch plan', 'Tessera brief', 'Nordlicht notes', 'Polaris']) ids.push(await createPage(page, { title: t }))
    for (const id of ids) await gotoPage(page, id)
    await reloadApp(page)
    if ((await page.locator('aside.sb').getAttribute('data-state')) !== 'docked') await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const head = page.getByTestId('visited-section').locator('.sb-visited__head')
    await expect(page.getByTestId('visited-section').getByRole('tabpanel')).toBeVisible()
    expect(Math.round((await head.boundingBox())!.height)).toBe(36)
    for (const top of [40, 72, 104]) {
      await scroller(page).evaluate((el, t) => (el.scrollTop = t), top)
      await page.waitForTimeout(700)
      const cut = await scroller(page).evaluate((box) => {
        const h = box.querySelector<HTMLElement>('.sb-visited__head')!.getBoundingClientRect()
        if (h.top - box.getBoundingClientRect().top > 1) return []
        return [...box.querySelectorAll<HTMLElement>('.sb-row')].filter((r) => { const q = r.getBoundingClientRect(); return q.top < h.bottom - 0.5 && q.bottom > h.bottom + 0.5 }).map((r) => r.textContent)
      })
      expect(cut, `scrollTop ${top}`).toEqual([])
    }
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

  test('its head stays one line at 220 px with the biggest text (the leader and count give way, the keys sit closer)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await openApp(page)
    for (const t of ['Mara Lind', 'Launch plan']) await gotoPage(page, await createPage(page, { title: t }))
    await page.evaluate(() => localStorage.setItem('one.shell.visited', JSON.stringify({ open: true, tab: 'recent' })))
    await reloadApp(page)
    await expect(visited(page).getByRole('tabpanel')).toBeVisible()
    for (const lang of ['en', 'de']) {
      await wsEval(page, (s, a) => s.updateSettings({ sidebarWidth: 220, language: a }), lang)
      const head = visited(page).locator('.sb-visited__head')
      await expect(head).toHaveAttribute('data-fit', /tight/)
      await expect(head).not.toHaveAttribute('data-fit', /wrap/)
      expect(Math.round((await head.boundingBox())!.height)).toBe(28)
      // the fold key on the same line as the switch
      const sw = (await head.locator('.sb-switch').boundingBox())!
      const fold = (await head.locator('.sb-sect__fold').boundingBox())!
      expect(Math.abs(fold.y + fold.height / 2 - (sw.y + sw.height / 2))).toBeLessThan(2)
    }
    await wsEval(page, (s) => s.updateSettings({ sidebarWidth: 264, language: 'en' }))
  })

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
