/**
 * Agenda (#/agenda): one calendar for every dated row, journal entry and date mention.
 * The clock is pinned to Wed 14 Oct 2026 so days and months are deterministic.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, uiEval, flush, createPage, doc, MOD } from './fixtures'

const NOW = new Date('2026-10-14T10:00:00')

interface Fixture {
  db: string
  due: string
  review: string
  status: string
  rows: Record<string, string>
}

/** A "Launch plan" database (Status + two date properties) with a few dated rows. */
async function seedLaunchPlan(page: Page, rows: Array<{ title: string; due?: object | null; review?: object | null; status?: 'todo' | 'done' }>): Promise<Fixture> {
  const out = await wsEval(
    page,
    (s, rows) => {
      const ids = { due: 'p_due', review: 'p_review', status: 'p_status' }
      const db = s.createDatabase({
        title: 'Launch plan',
        properties: [
          { id: 'p_title', name: 'Name', type: 'title' },
          {
            id: ids.status,
            name: 'Status',
            type: 'status',
            options: [
              { id: 'o_todo', name: 'Not started', color: 'gray', group: 'todo' },
              { id: 'o_done', name: 'Done', color: 'green', group: 'done' },
            ],
          },
          { id: ids.due, name: 'Due', type: 'date' },
          { id: ids.review, name: 'Review', type: 'date' },
        ],
      })
      const made: Record<string, string> = {}
      for (const r of rows) {
        const properties: Record<string, unknown> = { [ids.status]: r.status === 'done' ? 'o_done' : 'o_todo' }
        if (r.due) properties[ids.due] = r.due
        if (r.review) properties[ids.review] = r.review
        made[r.title] = s.createRow(db, { title: r.title, properties })
      }
      return { db, ...ids, rows: made }
    },
    rows,
  )
  await flush(page)
  return out
}

async function openAgenda(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/agenda'))
  await expect(page.locator('.ag')).toBeVisible()
}

/** Hide the demo projects (long ranges) so the month grid has room for the test rows. */
async function hideSource(page: Page, name: string) {
  const chip = page.locator('.ag-sources').getByRole('button', { name: new RegExp(name) })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
}

const bar = (page: Page, title: string) => page.locator('.ag-month .ag-bar', { hasText: title })
const cell = (page: Page, iso: string) => page.locator(`.ag-day[data-iso="${iso}"]`)

/** The bar's left edge sits inside the day cell's column. */
async function expectInColumn(page: Page, title: string, iso: string) {
  const b = await bar(page, title).first().boundingBox()
  const c = await cell(page, iso).boundingBox()
  expect(b && c, `${title} and ${iso} are on screen`).toBeTruthy()
  expect(b!.x).toBeGreaterThanOrEqual(c!.x - 1)
  expect(b!.x).toBeLessThan(c!.x + c!.width)
  expect(b!.y).toBeGreaterThan(c!.y)
  expect(b!.y).toBeLessThan(c!.y + c!.height)
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
})

test.describe('agenda', () => {
  test('sidebar entry and command palette open the agenda', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Agenda/ }).click()
    await expect(page).toHaveURL(/#\/agenda$/)
    await expect(page.locator('.ag-title')).toContainText('October')
    await expect(page.locator('.tb')).toContainText('Agenda')
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>agenda')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/agenda$/)
  })

  test('rows with dates appear in the month view on the right day', async ({ page }) => {
    await openApp(page)
    await seedLaunchPlan(page, [
      { title: 'Kickoff call', due: { start: '2026-10-16' } },
      { title: 'Two-date row', due: { start: '2026-10-20' }, review: { start: '2026-10-22' } },
      { title: 'Timed sync', due: { start: '2026-10-15T14:30', includeTime: true } },
      { title: 'Launch window', due: { start: '2026-10-26', end: '2026-10-28' } },
    ])
    await openAgenda(page)
    await expect(page.locator('.ag')).toHaveAttribute('data-view', 'month')
    await hideSource(page, 'Projects')

    await expect(bar(page, 'Kickoff call')).toHaveAttribute('data-start', '2026-10-16')
    await expectInColumn(page, 'Kickoff call', '2026-10-16')
    // today is marked
    await expect(cell(page, '2026-10-14')).toHaveAttribute('data-today', 'true')

    // one item per date property, labelled with the property name
    const two = bar(page, 'Two-date row')
    await expect(two).toHaveCount(2)
    await expect(two.nth(0)).toHaveAttribute('aria-label', /Launch plan · Due/)
    await expect(two.nth(1)).toHaveAttribute('aria-label', /Launch plan · Review/)
    await expectInColumn(page, 'Two-date row', '2026-10-20')

    // times and ranges
    await expect(bar(page, 'Timed sync')).toContainText('2:30pm')
    await expectInColumn(page, 'Timed sync', '2026-10-15')
    const range = bar(page, 'Launch window')
    await expect(range).toHaveAttribute('data-end', '2026-10-28')
    const rb = (await range.boundingBox())!
    const c26 = (await cell(page, '2026-10-26').boundingBox())!
    expect(rb.width).toBeGreaterThan(c26.width * 2.5)

    // the demo seed is in there too: a content calendar post 5 days from now
    await expect(page.locator('.ag-month .ag-bar[data-start="2026-10-19"]', { hasText: '5 n8n automations' })).toBeVisible()
  })

  test('list view groups by day and shows overdue rows', async ({ page }) => {
    await openApp(page)
    await seedLaunchPlan(page, [
      { title: 'Late report', due: { start: '2026-10-10' } },
      { title: 'Finished report', due: { start: '2026-10-09' }, status: 'done' },
      { title: 'Upcoming review', due: { start: '2026-10-16' } },
      { title: 'Same day A', due: { start: '2026-10-17T09:00', includeTime: true } },
      { title: 'Same day B', due: { start: '2026-10-17' } },
    ])
    await openAgenda(page)
    await page.keyboard.press('l')
    await expect(page.locator('.ag')).toHaveAttribute('data-view', 'list')
    await expect(page.locator('.ag-title')).toContainText('Upcoming')

    const overdue = page.locator('.ag-group[data-overdue]')
    await expect(overdue.locator('.ag-group__head')).toContainText('Overdue')
    await expect(overdue).toContainText('Late report')
    await expect(overdue.locator('.ag-row', { hasText: 'Late report' })).toContainText('Due 10 OCT')
    await expect(overdue).not.toContainText('Finished report')

    // groups in day order with mono day heads; today first
    const heads = page.locator('.ag-group:not([data-overdue]) .ag-group__stamp')
    await expect(heads.first()).toHaveText('WED 14 OCT')
    const fri = page.locator('.ag-group', { has: page.locator('.ag-group__stamp', { hasText: 'FRI 16 OCT' }) })
    await expect(fri.locator('.ag-row', { hasText: 'Upcoming review' })).toHaveCount(1)
    await expect(fri).not.toContainText('Late report')
    const sat = page.locator('.ag-group', { has: page.locator('.ag-group__stamp', { hasText: 'SAT 17 OCT' }) })
    await expect(sat.locator('.ag-row', { hasText: 'Same day' })).toHaveCount(2)
    await expect(sat.locator('.ag-row', { hasText: 'Same day A' })).toContainText('9:00am')
    // day heads stick while scrolling
    expect(await page.locator('.ag-group__head').first().evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
  })

  test('keyboard: M / W / L switch views, arrows move, T returns to today', async ({ page }) => {
    await openApp(page)
    await openAgenda(page)
    const ag = page.locator('.ag')
    await page.keyboard.press('w')
    await expect(ag).toHaveAttribute('data-view', 'week')
    await expect(page.locator('.ag-seg').getByRole('button', { name: /Week/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.ag-wk__dh')).toHaveCount(7)
    await expect(page.locator('.ag-title')).toContainText('11 OCT – 17 OCT')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.ag-title')).toContainText('18 OCT – 24 OCT')
    await page.keyboard.press('l')
    await expect(ag).toHaveAttribute('data-view', 'list')
    await page.keyboard.press('m')
    await expect(ag).toHaveAttribute('data-view', 'month')
    await expect(page.locator('.ag-title')).toContainText('October')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.ag-title')).toContainText('November')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.ag-title')).toContainText('September')
    await page.keyboard.press('t')
    await expect(page.locator('.ag-title')).toContainText('October')
    // the chosen view is remembered
    await page.keyboard.press('w')
    await reloadApp(page)
    await expect(page.locator('.ag')).toHaveAttribute('data-view', 'week')
  })

  test('dragging a row to another day moves its date (time and range length kept)', async ({ page }) => {
    await openApp(page)
    const fx = await seedLaunchPlan(page, [{ title: 'Move me', due: { start: '2026-10-15T09:00', end: '2026-10-16T10:30', includeTime: true } }])
    await openAgenda(page)
    await hideSource(page, 'Projects')
    const item = bar(page, 'Move me')
    await expect(item).toHaveAttribute('data-start', '2026-10-15')
    const from = (await item.boundingBox())!
    const to = (await cell(page, '2026-10-20').boundingBox())!
    // grab the first day of the two-day bar, drop it on Tue 20
    await page.mouse.move(from.x + 12, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 12, { steps: 12 })
    await page.mouse.up()
    await expect
      .poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.prop], { row: fx.rows['Move me'], prop: fx.due }))
      .toEqual({ start: '2026-10-20T09:00', end: '2026-10-21T10:30', includeTime: true })
    await expect(bar(page, 'Move me')).toHaveAttribute('data-start', '2026-10-20')
    // the move can be undone from the toast
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
    await expect
      .poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.prop].start, { row: fx.rows['Move me'], prop: fx.due }))
      .toBe('2026-10-15T09:00')
  })

  test('Alt+arrow moves a focused row a day', async ({ page }) => {
    await openApp(page)
    const fx = await seedLaunchPlan(page, [{ title: 'Nudge me', due: { start: '2026-10-21' } }])
    await openAgenda(page)
    await hideSource(page, 'Projects')
    await bar(page, 'Nudge me').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.prop].start, { row: fx.rows['Nudge me'], prop: fx.due })).toBe('2026-10-22')
    await expect(bar(page, 'Nudge me')).toBeFocused()
  })

  test('clicking an item opens it in the side peek', async ({ page }) => {
    await openApp(page)
    const fx = await seedLaunchPlan(page, [{ title: 'Peek at me', due: { start: '2026-10-16' } }])
    await openAgenda(page)
    await hideSource(page, 'Projects')
    await bar(page, 'Peek at me').click()
    const peek = page.locator('.peek')
    await expect(peek).toBeVisible()
    await expect(peek.locator('.pv-title')).toHaveValue('Peek at me')
    expect(await uiEval(page, (s) => s.peekPageId)).toBe(fx.rows['Peek at me'])
    // the agenda stays where it was
    await expect(page).toHaveURL(/#\/agenda$/)
    await page.keyboard.press('Escape')
    await expect(peek).toBeHidden()
  })

  test('a date mention inside a page shows up on its day', async ({ page }) => {
    await openApp(page)
    await createPage(page, {
      title: 'Offsite planning',
      content: doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Venue walkthrough on ' },
          { type: 'mention', attrs: { id: '2026-10-23', label: 'October 23, 2026', kind: 'date' } },
          { type: 'text', text: ' with the team' },
        ],
      }),
    })
    await openAgenda(page)
    await hideSource(page, 'Projects')
    const m = bar(page, 'Offsite planning')
    await expect(m).toHaveAttribute('data-start', '2026-10-23')
    await expect(m).toHaveAttribute('aria-label', /Mentions/)
    await expectInColumn(page, 'Offsite planning', '2026-10-23')
    // the list shows the line it was mentioned in
    await page.keyboard.press('l')
    await expect(page.locator('.ag-row', { hasText: 'Offsite planning' }).locator('.ag-row__excerpt')).toHaveText('Venue walkthrough on October 23, 2026 with the team')
  })

  test('source filter hides a database and remembers it', async ({ page }) => {
    await openApp(page)
    await seedLaunchPlan(page, [{ title: 'Filter me', due: { start: '2026-10-16' } }])
    await openAgenda(page)
    await hideSource(page, 'Projects')
    await expect(bar(page, 'Filter me')).toBeVisible()
    await hideSource(page, 'Launch plan')
    await expect(bar(page, 'Filter me')).toHaveCount(0)
    await reloadApp(page)
    await expect(page.locator('.ag-sources').getByRole('button', { name: /Launch plan/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(bar(page, 'Filter me')).toHaveCount(0)
    await page.locator('.ag-sources').getByRole('button', { name: /Launch plan/ }).click()
    await expect(bar(page, 'Filter me')).toBeVisible()
  })

  test('clicking an empty day creates a journal entry or a dated row', async ({ page }) => {
    await openApp(page)
    const fx = await seedLaunchPlan(page, [])
    await openAgenda(page)
    await hideSource(page, 'Projects')
    // a row in a chosen database, dated that day
    await cell(page, '2026-10-29').click({ position: { x: 60, y: 70 } })
    const menu = page.locator('[data-popover][role="menu"]')
    await expect(menu).toContainText('THU 29 OCT')
    await menu.getByRole('menuitem', { name: 'Launch plan · Due' }).click()
    await expect(page.locator('.peek')).toBeVisible()
    const rowId = await uiEval(page, (s) => s.peekPageId)
    expect(await wsEval(page, (s, a) => s.pages[a.row].properties[a.prop], { row: rowId, prop: fx.due })).toEqual({ start: '2026-10-29' })
    expect(await wsEval(page, (s, id) => s.pages[id].databaseId, rowId)).toBe(fx.db)
    await page.keyboard.press('Escape')
    // a journal entry for another day (the journal database is created on demand)
    await cell(page, '2026-10-30').click({ position: { x: 60, y: 70 } })
    await page.locator('[data-popover][role="menu"]').getByRole('menuitem', { name: 'Journal entry' }).click()
    await expect(page.locator('.peek .pv-title')).toHaveValue('Friday, 30 October 2026')
    await expect(page.locator('.ag-sources').getByRole('button', { name: /Journal/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.ag-month .ag-bar[data-start="2026-10-30"]', { hasText: 'Friday, 30 October 2026' })).toBeVisible()
  })

  test('Home shows the next 7 days and opens the agenda', async ({ page }) => {
    await openApp(page)
    await seedLaunchPlan(page, [
      { title: 'Soon thing', due: { start: '2026-10-15T08:15', includeTime: true } },
      { title: 'Far thing', due: { start: '2026-10-30' } },
      { title: 'Old thing', due: { start: '2026-10-01' } },
    ])
    await page.evaluate(() => (window.location.hash = '#/'))
    const panel = page.getByRole('region', { name: 'Next 7 days' })
    await expect(panel).toContainText('Soon thing')
    await expect(panel.locator('.nx-row', { hasText: 'Soon thing' })).toContainText('8:15am')
    await expect(panel).not.toContainText('Far thing')
    expect(await panel.locator('.nx-row').count()).toBeLessThanOrEqual(6)
    // overdue rows are counted, and lead into the list
    await panel.getByRole('button', { name: /overdue/ }).click()
    await expect(page).toHaveURL(/#\/agenda$/)
    await expect(page.locator('.ag')).toHaveAttribute('data-view', 'list')
    await expect(page.locator('.ag-group[data-overdue]')).toContainText('Old thing')
  })
})

test.describe('agenda on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('opens as a list; the month grid becomes a day picker', async ({ page }) => {
    await openApp(page)
    await seedLaunchPlan(page, [{ title: 'Phone item', due: { start: '2026-10-22' } }])
    await openAgenda(page)
    await expect(page.locator('.ag')).toHaveAttribute('data-view', 'list')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.locator('.ag-seg').getByRole('button', { name: 'Month' }).click()
    await expect(page.locator('.ag-cgrid')).toBeVisible()
    await page.locator('.ag-cday[data-day]').filter({ hasText: /^22/ }).first().click()
    await expect(page.locator('.ag-cmonth .ag-group')).toContainText('THU 22 OCT')
    await expect(page.locator('.ag-cmonth .ag-row', { hasText: 'Phone item' })).toBeVisible()
    await page.locator('.ag-cmonth .ag-row', { hasText: 'Phone item' }).click()
    await expect(page.locator('.peek .pv-title')).toHaveValue('Phone item')
  })
})
