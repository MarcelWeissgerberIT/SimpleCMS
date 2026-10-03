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

