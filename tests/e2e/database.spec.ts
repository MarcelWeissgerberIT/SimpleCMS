import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush, reloadApp, createPage, pageIdByTitle, editorOf } from './fixtures'

/**
 * A small database with one property of each kind the tests edit. Property and option ids
 * are fixed so assertions can read values straight from the store.
 */
async function createTestDb(page: Page): Promise<string> {
  const id = await wsEval(page, (s) => {
    const dbId = s.createDatabase({
      title: 'E2E DB',
      properties: [
        { id: 'pName', name: 'Name', type: 'title' },
        { id: 'pNotes', name: 'Notes', type: 'text' },
        { id: 'pKind', name: 'Kind', type: 'select', options: [{ id: 'oApple', name: 'Apple', color: 'red' }, { id: 'oBanana', name: 'Banana', color: 'yellow' }] },
        { id: 'pDue', name: 'Due', type: 'date' },
        { id: 'pScore', name: 'Score', type: 'number' },
        {
          id: 'pStatus',
          name: 'Status',
          type: 'status',
          options: [
            { id: 'sTodo', name: 'Todo', color: 'gray', group: 'todo' },
            { id: 'sDoing', name: 'Doing', color: 'blue', group: 'in_progress' },
            { id: 'sDone', name: 'Finished', color: 'green', group: 'done' },
          ],
        },
      ],
    })
    s.createRow(dbId, { title: 'Alpha', properties: { pScore: 10, pStatus: 'sTodo', pDue: { start: '2026-10-05' } } })
    s.createRow(dbId, { title: 'Beta', properties: { pScore: 30, pStatus: 'sTodo', pDue: { start: '2026-10-08' } } })
    s.createRow(dbId, { title: 'Gamma', properties: { pScore: 20, pStatus: 'sDoing', pDue: { start: '2026-10-12' } } })
    return dbId
  })
  await flush(page)
  return id
}

async function rowByTitle(page: Page, title: string): Promise<{ id: string; props: Record<string, unknown> } | null> {
  return wsEval(
    page,
    (s, title) => {
      const p = (Object.values(s.pages) as Array<Record<string, any>>).find((x) => x.databaseId && x.title === title && !x.trashed)
      return p ? { id: p.id, props: JSON.parse(JSON.stringify(p.properties)) } : null
    },
    title,
  )
}

const db = (page: Page) => page.locator('#main section.db').first()
const tableRow = (page: Page, title: string): Locator =>
  db(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: new RegExp(`^${title}`) }) })

async function titlesInTable(page: Page): Promise<string[]> {
  return db(page)
    .locator('.dbt-body .dbt-row[role="row"]')
    .evaluateAll((rows) => rows.map((r) => (r.querySelector('.dbt-cell--title')?.textContent ?? '').replace(/OPEN|ÖFFNEN/g, '').trim()))
}

test.describe('database', () => {
  test('add a row and edit text / select / date / number cells', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await gotoPage(page, dbId)
    await expect(db(page)).toHaveAttribute('data-view', 'table')
    await expect(db(page).locator('.dbt-body .dbt-row[role="row"]')).toHaveCount(3)

    // New → title editor on the new row
    await db(page).locator('.db-newbtn__main').click()
    const titleEdit = page.locator('.db-textedit__area')
    await expect(titleEdit).toBeFocused()
    await page.keyboard.type('Delta')
    await page.keyboard.press('Enter')
    await expect(tableRow(page, 'Delta')).toBeVisible()
    await expect.poll(() => rowByTitle(page, 'Delta')).not.toBeNull()

    const row = tableRow(page, 'Delta')
    // text
    await row.locator('[role="gridcell"][data-type="text"]').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('some notes')
    await page.keyboard.press('Enter')
    await expect(row.locator('[role="gridcell"][data-type="text"]')).toHaveText('some notes')

    // select
    await row.locator('[role="gridcell"][data-type="select"]').click()
    const picker = page.locator('.db-picker')
    await expect(picker).toBeVisible()
    await picker.locator('.db-opt', { hasText: 'Banana' }).click()
    if (await picker.isVisible()) await page.keyboard.press('Escape')
    await expect(row.locator('[role="gridcell"][data-type="select"]')).toHaveText('Banana')

    // date
    await row.locator('[role="gridcell"][data-type="date"]').click()
    const datePop = page.locator('.db-date-pop')
    await expect(datePop).toBeVisible()
    await datePop.locator('.db-date-pop__day[aria-label*="15th"]').first().click()
    if (await datePop.isVisible()) await page.keyboard.press('Escape')
    await expect(datePop).toBeHidden()

    // number
    await row.locator('[role="gridcell"][data-type="number"]').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('42')
    await page.keyboard.press('Enter')
    await expect(row.locator('[role="gridcell"][data-type="number"]')).toHaveText('42')

    const delta = await rowByTitle(page, 'Delta')
    expect(delta!.props.pNotes).toBe('some notes')
    expect(delta!.props.pKind).toBe('oBanana')
    expect(delta!.props.pScore).toBe(42)
    expect((delta!.props.pDue as { start: string }).start).toMatch(/^\d{4}-\d{2}-15$/)

    // survives a reload
    await reloadApp(page)
    await expect(tableRow(page, 'Delta').locator('[role="gridcell"][data-type="text"]')).toHaveText('some notes')
  })

  test('switch through all 7 view types', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await gotoPage(page, dbId)
    const marker: Record<string, string> = { board: '.dbb', list: '.dbl', gallery: '.dbg', calendar: '.dbcal', timeline: '.dbtl', chart: '.dbch' }
    const labels: Record<string, string> = { board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar', timeline: 'Timeline', chart: 'Chart' }
    for (const type of Object.keys(marker)) {
      await db(page).getByRole('button', { name: 'Add view' }).click()
      await page.getByRole('menuitem', { name: new RegExp(`^${labels[type]}`) }).click()
      await expect(db(page)).toHaveAttribute('data-view', type)
      await expect(db(page).locator(marker[type]).first()).toBeVisible()
    }
    // rows show up in the card / line views
    const tabs = db(page).getByRole('tab')
    await expect(tabs).toHaveCount(7)
    for (const [type, name] of [['board', 'Board'], ['list', 'List'], ['gallery', 'Gallery']] as const) {
      await tabs.filter({ hasText: name }).click()
      await expect(db(page)).toHaveAttribute('data-view', type)
      for (const t of ['Alpha', 'Beta', 'Gamma']) await expect(db(page).getByText(t, { exact: true }).first()).toBeVisible()
    }
    await tabs.filter({ hasText: 'Table' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'table')
    const views = await wsEval(page, (s, id) => s.databases[id].views.map((v: { type: string }) => v.type), dbId)
    expect(views.sort()).toEqual(['board', 'calendar', 'chart', 'gallery', 'list', 'table', 'timeline'])
  })

  test('filter and sort the table', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await gotoPage(page, dbId)
    await expect(db(page).locator('.dbt-body .dbt-row[role="row"]')).toHaveCount(3)

    // sort by Score, descending
    await db(page).getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Sort' }).click()
    const sortPanel = page.locator('.db-panel')
    await sortPanel.getByRole('button', { name: 'Add sort' }).click()
    await page.getByRole('menuitem', { name: 'Score' }).click()
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha', 'Gamma', 'Beta'])
    await sortPanel.locator('.db-sortrule').getByText('Desc', { exact: true }).click()
    await expect.poll(() => titlesInTable(page)).toEqual(['Beta', 'Gamma', 'Alpha'])
    await page.keyboard.press('Escape')

    // filter on the title
    await db(page).getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Filter' }).click()
    const fpop = page.locator('.db-filterpop')
    await fpop.getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByRole('menuitem', { name: 'Name' }).click()
    await fpop.getByPlaceholder('Value').fill('Gam')
    await expect.poll(() => titlesInTable(page)).toEqual(['Gamma'])
    await expect(db(page).locator('.db-counter__num')).toHaveText('1/3')
    const view = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].views[0])), dbId)
    expect(view.sorts).toEqual([{ propertyId: 'pScore', direction: 'desc' }])
    expect(view.filter.items).toHaveLength(1)
    expect(view.filter.items[0].propertyId).toBe('pName')
  })

  test('open a row in the side peek and edit a property there', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await gotoPage(page, dbId)
    const row = tableRow(page, 'Beta')
    await row.hover()
    await row.locator('.db-open').click()
    const peek = page.getByRole('dialog', { name: 'Peek' }).or(page.locator('.peek')).first()
    await expect(peek).toBeVisible()
    await expect(peek.locator('.pv-title')).toHaveValue('Beta')
    const notes = peek.locator('.db-prow', { has: page.locator('.db-prow__name', { hasText: 'Notes' }) })
    await notes.locator('.db-prow__value').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('edited in peek')
    await page.keyboard.press('Enter')
    await expect(notes.locator('.db-prow__value')).toContainText('edited in peek')
    // the table behind it updates live
    await expect(tableRow(page, 'Beta').locator('[role="gridcell"][data-type="text"]')).toHaveText('edited in peek')
    // the peek has a working editor for the row's page content
    await peek.locator('.ProseMirror').click()
    await page.keyboard.type('Row body text')
    await expect.poll(async () => (await wsEval(page, (s) => (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.title === 'Beta')?.plain ?? ''))).toContain('Row body text')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('.peek')).toHaveCount(0)
  })

  test('board: drag a card to another column', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await wsEval(page, (s, id) => s.addView(id, { type: 'board', name: 'Board', groupBy: 'pStatus' }), dbId)
    await gotoPage(page, dbId)
    await db(page).getByRole('tab').filter({ hasText: 'Board' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'board')
    const todo = db(page).locator('section.dbb-col[aria-label="Todo"]')
    const done = db(page).locator('section.dbb-col[aria-label="Finished"]')
    await expect(todo.locator('.dbc', { hasText: 'Alpha' })).toBeVisible()
    await expect(done.locator('.dbc')).toHaveCount(0)

    const card = todo.locator('.dbc', { hasText: 'Alpha' })
    const from = (await card.boundingBox())!
    const to = (await done.locator('.dbb-col__body').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 4, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 20 })
    await page.waitForTimeout(150)
    await page.mouse.up()

    await expect(done.locator('.dbc', { hasText: 'Alpha' })).toBeVisible()
    await expect(todo.locator('.dbc', { hasText: 'Alpha' })).toHaveCount(0)
    expect((await rowByTitle(page, 'Alpha'))!.props.pStatus).toBe('sDone')
  })

  test('a view whose code is gone (a tab left open across an update): the block says so, offers Reload, the app offers the new version', async ({ page, errors }) => {
    // the server no longer has this (older) build's calendar view
    errors.allow(/404 \(Not Found\)|Failed to fetch dynamically imported module|CalendarView/)
    await openApp(page)
    await page.route(/\/assets\/CalendarView-[^/]+\.js$/, (r) => r.fulfill({ status: 404, body: 'gone' }))
    const pageId = await createPage(page, { title: 'Stale view' })
    await gotoPage(page, pageId)
    const ed = editorOf(page, pageId)
    await ed.click()
    await page.keyboard.type('/Calendar view')
    await expect(page.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Calendar view')
    await page.keyboard.press('Enter')
    const failed = ed.locator('.database-block__missing')
    await expect(failed).toContainText('Database could not be displayed')
    await expect(failed.getByRole('button', { name: 'Reload' })).toBeVisible()
    const toast = page.locator('.toast', { hasText: 'A new version of One is ready.' })
    await expect(toast).toHaveCount(1)
    // the reload brings the view back (the code is there again)
    await page.unroute(/\/assets\/CalendarView-[^/]+\.js$/)
    await failed.getByRole('button', { name: 'Reload' }).click()
    await expect(editorOf(page, pageId).locator('section.db.db--inline')).toBeVisible()
    await expect(page.locator('.database-block__missing')).toHaveCount(0)
  })

  test('inline database block: create from the slash menu and add a row', async ({ page }) => {
    await openApp(page)
    const pageId = await createPage(page, { title: 'Page with inline DB' })
    await gotoPage(page, pageId)
    const ed = editorOf(page, pageId)
    await ed.click()
    await page.keyboard.type('/Table view')
    await expect(page.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Table view')
    await page.keyboard.press('Enter')
    const inline = ed.locator('section.db.db--inline')
    await expect(inline).toBeVisible()
    const inlineDbId = await wsEval(
      page,
      (s, pid) => (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.kind === 'database' && p.parentId === pid)?.id ?? null,
      pageId,
    )
    expect(inlineDbId).toBeTruthy()
    await expect.poll(() => wsEval(page, (s, pid) => JSON.stringify(s.pages[pid].content ?? {}), pageId)).toContain(inlineDbId!)

    await inline.locator('.db-newbtn__main').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('Inline row')
    await page.keyboard.press('Enter')
    await expect(inline.locator('.dbt-cell--title', { hasText: 'Inline row' })).toBeVisible()
    const r = await rowByTitle(page, 'Inline row')
    expect(r).not.toBeNull()

    await reloadApp(page)
    await expect(editorOf(page, pageId).locator('section.db.db--inline .dbt-cell--title', { hasText: 'Inline row' })).toBeVisible()
  })

  test('the seeded welcome page renders its inline Projects database', async ({ page }) => {
    await openApp(page)
    const welcome = await pageIdByTitle(page, 'Welcome to One')
    await gotoPage(page, welcome)
    const inline = editorOf(page, welcome).locator('section.db.db--inline')
    await inline.scrollIntoViewIfNeeded()
    await expect(inline).toBeVisible()
    await expect(inline.getByText('Website relaunch').first()).toBeVisible()
  })
})


test.describe('database: more', () => {
  test('board: move a card to another column with the keyboard', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await wsEval(page, (s, id) => s.addView(id, { type: 'board', name: 'Board', groupBy: 'pStatus' }), dbId)
    await gotoPage(page, dbId)
    await db(page).getByRole('tab').filter({ hasText: 'Board' }).click()
    const card = db(page).locator('section.dbb-col[aria-label="Todo"] .dbc', { hasText: 'Beta' })
    await card.focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
    await page.keyboard.press('Space')
    await expect(db(page).locator('section.dbb-col[aria-label="Doing"] .dbc', { hasText: 'Beta' })).toBeVisible()
    expect((await rowByTitle(page, 'Beta'))!.props.pStatus).toBe('sDoing')
  })

  test('calendar: rows sit on their dates and "+" on a day creates a dated row', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    // put the rows into the current month (relative to the browser clock)
    const iso = await page.evaluate(() => {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      return [10, 20].map((day) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(day)}`)
    })
    await wsEval(
      page,
      (s, { id, iso }) => {
        const rows = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === id)
        s.setRowProperty(rows.find((r) => r.title === 'Alpha')!.id, 'pDue', { start: iso[0] })
        s.setRowProperty(rows.find((r) => r.title === 'Beta')!.id, 'pDue', { start: iso[1] })
        s.addView(id, { type: 'calendar', name: 'Cal', dateProperty: 'pDue' })
      },
      { id: dbId, iso },
    )
    await gotoPage(page, dbId)
    await db(page).getByRole('tab').filter({ hasText: 'Cal' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'calendar')
    const week = (day: string) => db(page).locator('.dbcal-week', { has: page.locator(`.dbcal-day[data-day="${day}"]`) })
    await expect(week(iso[0]).locator('.dbcal-events')).toContainText('Alpha')
    await expect(week(iso[1]).locator('.dbcal-events')).toContainText('Beta')

    const target = iso[0].replace(/-10$/, '-14')
    const day = db(page).locator(`.dbcal-day[data-day="${target}"]`)
    await day.hover()
    await day.getByRole('button', { name: `New row on ${target}` }).click()
    // a new row opens (peek) — give it a title there
    const peek = page.locator('.peek')
    await expect(peek).toBeVisible()
    await peek.locator('.pv-title').fill('Dated row')
    await page.keyboard.press('Escape')
    await expect(week(target).locator('.dbcal-events')).toContainText('Dated row')
    const r = await rowByTitle(page, 'Dated row')
    expect((r!.props.pDue as { start: string }).start).toBe(target)
  })

  test('table: keyboard navigation and editing', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await gotoPage(page, dbId)
    const grid = db(page).locator('.dbt[role="grid"]')
    await grid.focus()
    await page.keyboard.press('ArrowDown') // → first cell (Alpha / Name)
    await page.keyboard.press('ArrowRight') // → Notes
    await page.keyboard.press('Enter')
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('typed via keyboard')
    await page.keyboard.press('Enter')
    await expect(page.locator('.db-textedit__area')).toHaveCount(0)
    await expect(tableRow(page, 'Alpha').locator('[role="gridcell"][data-type="text"]')).toHaveText('typed via keyboard')
    // Esc also commits (Notion semantics, see cells/TextEditor.tsx) and hands focus back to the grid
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second row note')
    await page.keyboard.press('Escape')
    await expect(page.locator('.db-textedit__area')).toHaveCount(0)
    await expect(tableRow(page, 'Beta').locator('[role="gridcell"][data-type="text"]')).toHaveText('second row note')
    // keyboard keeps working: → Kind (select) → Enter opens the option picker
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.locator('.db-picker')).toBeVisible()
    await page.keyboard.type('Apple')
    await page.keyboard.press('Enter')
    await expect(tableRow(page, 'Beta').locator('[role="gridcell"][data-type="select"]')).toHaveText('Apple')
    expect((await rowByTitle(page, 'Alpha'))!.props.pNotes).toBe('typed via keyboard')
    expect((await rowByTitle(page, 'Beta'))!.props).toMatchObject({ pNotes: 'second row note', pKind: 'oApple' })
  })

  test('peek: editing the row title updates the table', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await gotoPage(page, dbId)
    const row = tableRow(page, 'Gamma')
    await row.hover()
    await row.locator('.db-open').click()
    const peek = page.locator('.peek')
    await expect(peek.locator('.pv-title')).toHaveValue('Gamma')
    await peek.locator('.pv-title').fill('Gamma ray')
    await expect(tableRow(page, 'Gamma ray')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.peek')).toHaveCount(0)
    expect(await rowByTitle(page, 'Gamma ray')).not.toBeNull()
  })

  test('import a CSV file as a database', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const csv = 'Name,Amount,Due,Done\nInvoice 1,120.5,2026-11-01,true\nInvoice 2,80,2026-11-15,false\nInvoice 3,42,,false\n'
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'invoices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }])
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/Import complete/)).toBeVisible()
    await dialog.getByRole('button', { name: 'View import' }).click()
    const info = await wsEval(page, (s) => {
      const dbPage = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.kind === 'database' && /invoices/i.test(p.title))
      if (!dbPage) return null
      const db = s.databases[dbPage.id]
      const rows = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === dbPage.id)
      return { id: dbPage.id, types: db.properties.map((p: { name: string; type: string }) => `${p.name}:${p.type}`), titles: rows.map((r) => r.title).sort(), amount: rows.find((r) => r.title === 'Invoice 1')?.properties[db.properties.find((p: { name: string }) => p.name === 'Amount').id] }
    })
    expect(info, 'a database named after the CSV').not.toBeNull()
    expect(info!.titles).toEqual(['Invoice 1', 'Invoice 2', 'Invoice 3'])
    expect(info!.types).toEqual(['Name:title', 'Amount:number', 'Due:date', 'Done:checkbox'])
    expect(info!.amount).toBe(120.5)
    await gotoPage(page, info!.id)
    await expect(db(page).locator('.dbt-body .dbt-row[role="row"]')).toHaveCount(3)
  })
})

test.describe('database: dragging dates', () => {
  test('calendar: drag an event to another day changes its date', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    const iso = await page.evaluate(() => {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-10`, `${d.getFullYear()}-${p(d.getMonth() + 1)}-12`]
    })
    await wsEval(
      page,
      (s, { id, iso }) => {
        const rows = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === id)
        s.setRowProperty(rows.find((r) => r.title === 'Alpha')!.id, 'pDue', { start: iso[0] })
        s.addView(id, { type: 'calendar', name: 'Cal', dateProperty: 'pDue' })
      },
      { id: dbId, iso },
    )
    await gotoPage(page, dbId)
    await db(page).getByRole('tab').filter({ hasText: 'Cal' }).click()
    const ev = db(page).locator('.dbcal-ev', { hasText: 'Alpha' }).first()
    await expect(ev).toBeVisible()
    const from = (await ev.boundingBox())!
    const to = (await db(page).locator(`.dbcal-day[data-day="${iso[1]}"]`).boundingBox())!
    await page.mouse.move(from.x + 10, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 20, from.y + from.height / 2 + 2, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
    await page.mouse.up()
    await expect.poll(async () => ((await rowByTitle(page, 'Alpha'))!.props.pDue as { start: string }).start).toBe(iso[1])
  })
})

test.describe('database: schema changes', () => {
  test('change a text column to number and a select column to text (with undo)', async ({ page }) => {
    await openApp(page)
    const dbId = await createTestDb(page)
    await wsEval(page, (s, id) => {
      const rows = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === id)
      s.setRowProperty(rows.find((r) => r.title === 'Alpha')!.id, 'pNotes', '42')
      s.setRowProperty(rows.find((r) => r.title === 'Beta')!.id, 'pNotes', 'not a number')
      s.setRowProperty(rows.find((r) => r.title === 'Alpha')!.id, 'pKind', 'oApple')
    }, dbId)
    await gotoPage(page, dbId)

    await db(page).locator('.dbt-hcell[data-hcol="pNotes"] .dbt-hcell__btn').click()
    await page.getByRole('menuitem', { name: /^Type/ }).hover()
    await page.getByRole('menuitem', { name: /^Number/ }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].properties.find((p: { id: string }) => p.id === 'pNotes').type, dbId)).toBe('number')
    expect((await rowByTitle(page, 'Alpha'))!.props.pNotes).toBe(42)
    await expect(tableRow(page, 'Alpha').locator('[role="gridcell"][data-type="number"]').first()).toHaveText('42')
    // undo puts the text back
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].properties.find((p: { id: string }) => p.id === 'pNotes').type, dbId)).toBe('text')
    expect((await rowByTitle(page, 'Beta'))!.props.pNotes).toBe('not a number')

    await page.keyboard.press('Escape')
    await db(page).locator('.dbt-hcell[data-hcol="pKind"] .dbt-hcell__btn').click()
    await page.getByRole('menuitem', { name: /^Type/ }).hover()
    await page.getByRole('menuitem', { name: /^Text/ }).click()
    await expect.poll(async () => (await rowByTitle(page, 'Alpha'))!.props.pKind).toBe('Apple')
  })

  test('multi-select: create a new option from the picker', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    await db(page).getByRole('tab').filter({ hasText: 'All projects' }).click()
    const row = db(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: 'Brand refresh' }) })
    await row.locator('[role="gridcell"][data-type="multi_select"]').click()
    const picker = page.locator('.db-picker')
    await picker.locator('input').fill('Design')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(row.locator('[role="gridcell"][data-type="multi_select"]')).toContainText('Design')
    const opt = await wsEval(page, (s, id) => s.databases[id].properties.find((p: { name: string }) => p.name === 'Tags').options.find((o: { name: string }) => o.name === 'Design') ?? null, projects)
    expect(opt).not.toBeNull()
    // the tag existed before stays
    await expect(row.locator('[role="gridcell"][data-type="multi_select"]')).toContainText('Marketing')
  })
})
