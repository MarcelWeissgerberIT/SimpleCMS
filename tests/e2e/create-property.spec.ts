/**
 * Properties created on the fly (database/create): the "link as relation?" offer next to a page
 * mention in a row, "Create property “X”" in the property pickers (filters, sorts, grouping, the
 * formula editor), meeting action items sent to a database without person / date properties, and
 * CSV rows taken into an existing database. Locked databases never offer to create anything.
 * Claude is mocked (never reaches api.anthropic.com).
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush, reloadApp, pageIdByTitle, editorOf, createPage, doc, mockClaude } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const db = (page: Page) => page.locator('#main section.db').first()
const toolbar = (page: Page) => db(page).getByRole('toolbar', { name: 'Database toolbar' })
const offer = (page: Page) => page.getByTestId('relation-offer')
const dialog = (page: Page) => page.getByRole('dialog')

async function propsOf(page: Page, dbId: string): Promise<AnyState[]> {
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].properties)), dbId)
}

async function propByName(page: Page, dbId: string, name: string): Promise<AnyState | undefined> {
  return (await propsOf(page, dbId)).find((p) => p.name === name)
}

async function valueOf(page: Page, rowId: string, propId: string): Promise<unknown> {
  return wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.pages[a.rowId]?.properties[a.propId] ?? null)), { rowId, propId })
}

/** Type "@query" at the end of a row page and pick the first page hit. */
async function mention(page: Page, rowId: string, query: string): Promise<void> {
  const ed = editorOf(page, rowId)
  await ed.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.type(` @${query}`)
  await expect(page.locator('.suggest-menu [role="option"]').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(ed.locator('.mention--page').last()).toBeVisible()
}

/** Open the menu of a menu item's submenu and pick an entry in it. */
async function pickType(page: Page, entry: Locator, type: string): Promise<void> {
  await entry.click()
  await page.getByRole('menuitem', { name: type, exact: true }).click()
}

test.describe('create properties on the fly', () => {
  test('mention a Projects row in a Reading-list row → offer → relation dialog → two-way relation with the value on both sides', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    const projects = await pageIdByTitle(page, 'Projects')
    const book = await pageIdByTitle(page, 'Shape Up')
    const site = await pageIdByTitle(page, 'Website relaunch')
    await gotoPage(page, book)

    await mention(page, book, 'Website relaunch')
    await expect(offer(page)).toBeVisible()
    await expect(offer(page)).toContainText('Link as relation to Projects?')
    await offer(page).getByRole('button', { name: /^Link/ }).click()

    const dlg = dialog(page)
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('heading')).toHaveText('Create relation to Projects')
    await expect(dlg.getByRole('textbox').first()).toHaveValue('Projects')
    await expect(dlg.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await expect(dlg.getByRole('textbox').nth(1)).toHaveValue('Reading list')
    await dlg.getByRole('button', { name: 'Create' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(offer(page)).toHaveCount(0)

    // both databases: the forward relation here, its partner on Projects; the link on both rows
    const fwd = await propByName(page, reading, 'Projects')
    expect(fwd).toMatchObject({ type: 'relation', relationDatabaseId: projects })
    const back = await propByName(page, projects, 'Reading list')
    expect(back).toMatchObject({ type: 'relation', relationDatabaseId: reading, id: `${fwd!.id}.2way` })
    expect(await valueOf(page, book, fwd!.id)).toEqual([site])
    expect(await valueOf(page, site, back!.id)).toEqual([book])
    await expect(page.locator('#main .db-prow', { hasText: 'Projects' })).toContainText('Website relaunch')

    // the reverse side shows on the project's own page
    await gotoPage(page, site)
    await expect(page.locator('#main .db-prow', { hasText: 'Reading list' })).toContainText('Shape Up')

    // saved like any other change
    await reloadApp(page)
    expect(await propByName(page, reading, 'Projects')).toBeTruthy()
    expect(await valueOf(page, site, back!.id)).toEqual([book])
  })

  test('a relation that already exists: the offer just adds the row; × stops asking for that pair', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    const projects = await pageIdByTitle(page, 'Projects')
    const relId = await wsEval(page, (s, a) => s.addProperty(a.reading, { type: 'relation', name: 'Project', relationDatabaseId: a.projects }), { reading, projects })
    const book = await pageIdByTitle(page, 'Shape Up')
    const site = await pageIdByTitle(page, 'Website relaunch')
    await flush(page)
    await gotoPage(page, book)

    await mention(page, book, 'Website relaunch')
    await expect(offer(page)).toContainText('Add to “Project”?')
    await offer(page).getByRole('button', { name: /^Add/ }).click()
    await expect(offer(page)).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(0)
    expect(await valueOf(page, book, relId)).toEqual([site])
    await expect(page.locator('.toast').filter({ hasText: '“Website relaunch” added to Project' })).toBeVisible()

    // mentioning a linked row again offers nothing
    await mention(page, book, 'Website relaunch')
    await page.waitForTimeout(300)
    await expect(offer(page)).toHaveCount(0)

    // another database: dismiss → never asked again for Reading list → Content calendar
    const calRow = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId && s.pages[p.databaseId]?.title === 'Content calendar')!.title)
    await mention(page, book, calRow)
    await expect(offer(page)).toContainText('Link as relation to Content calendar?')
    await offer(page).getByRole('button', { name: 'Don’t ask again for Content calendar' }).click()
    await expect(offer(page)).toHaveCount(0)
    const other = await pageIdByTitle(page, 'Working in Public')
    await gotoPage(page, other)
    await mention(page, other, calRow)
    await page.waitForTimeout(400)
    await expect(offer(page)).toHaveCount(0)
    // …while Projects still is
    await mention(page, other, 'Website relaunch')
    await expect(offer(page)).toContainText('Add to “Project”?')
  })

  test('keyboard only: Alt+Enter into the offer, Enter, one-way relation with the switch off, Enter creates', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    const projects = await pageIdByTitle(page, 'Projects')
    const book = await pageIdByTitle(page, 'Less, but better')
    await gotoPage(page, book)
    await mention(page, book, 'Website relaunch')
    await expect(offer(page)).toBeVisible()
    await page.keyboard.press('Alt+Enter')
    await expect(offer(page).getByRole('button', { name: /^Link/ })).toBeFocused()
    // Esc goes back to writing, the offer stays
    await page.keyboard.press('Escape')
    await expect(editorOf(page, book)).toBeFocused()
    await page.keyboard.press('Alt+Enter')
    await page.keyboard.press('Enter')
    const dlg = dialog(page)
    await expect(dlg).toBeVisible()
    const name = dlg.getByRole('textbox').first()
    await expect(name).toBeFocused()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Projects read for')
    // Tab to the two-way switch, turn it off
    await page.keyboard.press('Tab')
    await expect(dlg.getByRole('switch')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(dlg.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect(dlg).toHaveCount(0)
    const fwd = await propByName(page, reading, 'Projects read for')
    expect(fwd).toMatchObject({ type: 'relation', relationDatabaseId: projects })
    expect((await propsOf(page, projects)).some((p) => p.id === `${fwd!.id}.2way`)).toBe(false)
    // focus is back in the text
    await expect(editorOf(page, book)).toBeFocused()

    // Esc cancels the dialog: nothing created
    await mention(page, book, 'Website relaunch')
    await page.waitForTimeout(300)
    await expect(offer(page)).toContainText('Add to “Projects read for”?')
  })

  test('filter picker: "Create property “Budget”" → Number → the filter is on it', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    await gotoPage(page, reading)
    await db(page).getByRole('tab').filter({ hasText: 'Table' }).click()
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    const fpop = page.locator('.db-filterpop')
    await fpop.getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByPlaceholder('Filter by…').fill('Budget')
    const create = page.getByRole('menuitem', { name: 'Create property “Budget”' })
    await expect(create).toBeVisible()
    await pickType(page, create, 'Number')
    const budget = await propByName(page, reading, 'Budget')
    expect(budget?.type).toBe('number')
    const view = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].views.find((v: AnyState) => v.type === 'table'))), reading)
    expect(view.filter.items).toHaveLength(1)
    expect(view.filter.items[0].propertyId).toBe(budget!.id)
    await expect(fpop.locator('.db-frule__prop')).toHaveText('Budget')
    // an existing name offers no creation; undo from the toast removes the property and its rule
    await page.keyboard.press('Escape')
    await page.locator('.toast').filter({ hasText: 'Property “Budget” created' }).getByRole('button', { name: 'Undo' }).click()
    expect(await propByName(page, reading, 'Budget')).toBeUndefined()
    const after = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].views.find((v: AnyState) => v.type === 'table').filter ?? null)), reading)
    expect(after).toBeNull()
  })

  test('sort and group pickers create too; a relation from a picker goes through the dialog', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, reading)
    await db(page).getByRole('tab').filter({ hasText: 'Table' }).click()

    // sort: "Pages" as a number
    await toolbar(page).getByRole('button', { name: 'Sort' }).click()
    await page.locator('.db-panel').getByRole('button', { name: 'Add sort' }).click()
    await page.getByRole('menu').getByRole('textbox').fill('Pages')
    await pickType(page, page.getByRole('menuitem', { name: 'Create property “Pages”' }), 'Number')
    const pages = await propByName(page, reading, 'Pages')
    expect(pages?.type).toBe('number')
    const tableView = () => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].views.find((v: AnyState) => v.type === 'table'))), reading)
    expect((await tableView()).sorts).toEqual([{ propertyId: pages!.id, direction: 'asc' }])
    await page.keyboard.press('Escape')

    // group by a new select
    await toolbar(page).getByRole('button', { name: 'Group' }).click()
    await page.locator('.db-panel .db-select').first().click()
    await page.getByRole('menu').getByRole('textbox').fill('Shelf')
    await pickType(page, page.getByRole('menuitem', { name: 'Create property “Shelf”' }), 'Select')
    const shelf = await propByName(page, reading, 'Shelf')
    expect(shelf?.type).toBe('select')
    expect((await tableView()).groupBy).toBe(shelf!.id)
    await page.keyboard.press('Escape')

    // filter on a new relation: the panel closes, the relation dialog asks for the database
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    await page.locator('.db-filterpop').getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByPlaceholder('Filter by…').fill('Initiative')
    await pickType(page, page.getByRole('menuitem', { name: 'Create property “Initiative”' }), 'Relation')
    await expect(page.locator('.db-filterpop')).toHaveCount(0)
    const dlg = dialog(page)
    await expect(dlg.getByRole('textbox').first()).toHaveValue('Initiative')
    await expect(dlg.getByRole('button', { name: 'Create' })).toBeDisabled()
    await dlg.getByRole('button', { name: 'Database' }).click()
    await page.getByRole('menuitem', { name: 'Projects' }).click()
    await expect(dlg.getByRole('heading')).toHaveText('Create relation to Projects')
    await dlg.getByRole('button', { name: 'Create' }).click()
    const rel = await propByName(page, reading, 'Initiative')
    expect(rel).toMatchObject({ type: 'relation', relationDatabaseId: projects })
    expect((await tableView()).filter.items.map((f: AnyState) => f.propertyId)).toEqual([rel!.id])
  })

  test('formula editor: prop("…") of a missing name → create it from the error and from the reference search', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    const fx = await wsEval(page, (s, id) => s.addProperty(id, { type: 'formula', name: 'Reading time', formula: '' }), reading)
    await flush(page)
    await gotoPage(page, reading)
    await db(page).getByRole('tab').filter({ hasText: 'Table' }).click()
    await db(page).locator(`[data-hcol="${fx}"] .dbt-hcell__btn`).click()
    await page.getByRole('menuitem', { name: 'Edit formula' }).click()
    const modal = page.locator('.db-fx')
    await modal.locator('textarea').fill('prop("Pages") / 40')
    await expect(modal.locator('.db-fx__error')).toContainText('There is no property called “Pages”')
    await modal.getByRole('button', { name: 'Create property “Pages”' }).click()
    await page.getByRole('menuitem', { name: 'Number', exact: true }).click()
    await expect(modal.locator('.db-fx__error')).toHaveCount(0)
    expect((await propByName(page, reading, 'Pages'))?.type).toBe('number')

    // the reference search: a new name → create → prop("Hours") goes into the source
    await modal.locator('textarea').fill('')
    await modal.getByPlaceholder('Search functions & properties…').fill('Hours')
    await modal.getByRole('button', { name: 'Create property “Hours”' }).click()
    await page.getByRole('menuitem', { name: 'Number', exact: true }).click()
    await expect(modal.locator('textarea')).toHaveValue('prop("Hours")')
    expect((await propByName(page, reading, 'Hours'))?.type).toBe('number')
  })

  test('meeting notes → a database without person / date: the dialog creates Owner + Due and the rows get them', async ({ page, context }) => {
    await mockClaude(context, () => 'ok')
    await openApp(page)
    const alex = await wsEval(page, (s) => s.people.find((p: AnyState) => p.name === 'Alex').id)
    const reading = await pageIdByTitle(page, 'Reading list')
    const blockId = 'meeting-create-1'
    const id = await createPage(page, {
      title: 'Book club',
      content: doc({
        type: 'meetingNotes',
        attrs: { id: blockId, title: 'Book club', status: 'done', language: 'en-US', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 600_000, duration: 1_200_000, transcript: [{ t: 0, text: 'Alex reads Dune.' }] },
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Action items' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Read Dune ' },
                      { type: 'mention', attrs: { id: alex, label: 'Alex', kind: 'person' } },
                      { type: 'text', text: ' ' },
                      { type: 'mention', attrs: { id: '2026-10-20', label: 'October 20, 2026', kind: 'date' } },
                    ],
                  },
                ],
              },
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pick the next book' }] }] },
            ],
          },
        ],
      }),
    })
    await gotoPage(page, id)
    await page.locator('#main .mtg [data-meeting-key="send"]').click()
    const picker = page.getByRole('dialog', { name: 'Send to database' })
    await picker.getByRole('textbox').fill('Reading')
    await page.keyboard.press('Enter')

    const dlg = page.getByRole('dialog', { name: 'Missing in Reading list' })
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.dbc__item')).toHaveCount(2)
    await expect(dlg.getByRole('checkbox', { name: 'Create “Owner”' })).toBeChecked()
    await expect(dlg.getByRole('checkbox', { name: 'Create “Due”' })).toBeChecked()
    await expect(dlg).toContainText('1 item names an owner')
    // names are editable
    await dlg.getByRole('textbox', { name: 'Name for Due' }).fill('Deadline')
    await dlg.getByRole('button', { name: 'Create & send' }).click()
    await expect(page.locator('.toast').filter({ hasText: '2 action items → Reading list' })).toBeVisible()

    const owner = await propByName(page, reading, 'Owner')
    const due = await propByName(page, reading, 'Deadline')
    expect(owner?.type).toBe('person')
    expect(due?.type).toBe('date')
    const row = await pageIdByTitle(page, 'Read Dune')
    expect(await valueOf(page, row, owner!.id)).toEqual([alex])
    expect(await valueOf(page, row, due!.id)).toMatchObject({ start: '2026-10-20' })
  })

  test('CSV into an existing database: unknown columns → mapping dialog (create / existing / skip) → rows', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    await gotoPage(page, reading)
    await db(page).getByRole('tab').filter({ hasText: 'Table' }).click()
    const csv = ['Title,Author,Pages,Finished,Format,Writer', 'Dune,Frank Herbert,412,2026-09-01,Paperback,FH', 'Hyperion,Dan Simmons,482,2026-09-20,Hardcover,DS', 'Neuromancer,William Gibson,271,,Paperback,WG'].join('\n')
    await toolbar(page).getByRole('button', { name: 'More' }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Import CSV into this database…' }).click()
    await (await chooser).setFiles({ name: 'books.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

    const dlg = page.getByRole('dialog', { name: 'Import books.csv' })
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.dbc__item')).toHaveCount(4)
    await expect(dlg.locator('.dbc__matched')).toContainText('Title')
    await expect(dlg.locator('.dbc__matched')).toContainText('Author')
    // suggested types: Pages → number, Finished → date, Format → select
    const item = (name: string) => dlg.locator('.dbc__item', { has: page.locator('.dbc__fieldname', { hasText: new RegExp(`^${name}$`) }) })
    await expect(item('Pages').locator('.dbc__type')).toHaveText('Number')
    await expect(item('Finished').locator('.dbc__type')).toHaveText('Date')
    await expect(item('Format').locator('.dbc__type')).toHaveText('Select')
    // Writer → skip; Finished → into a new property named "Read on"
    await item('Writer').getByRole('button', { name: 'Where Writer goes' }).click()
    await page.getByRole('menuitem', { name: 'Skip' }).click()
    await item('Finished').getByRole('textbox').fill('Read on')
    await dlg.getByRole('button', { name: 'Import 3 rows' }).click()
    await expect(page.locator('.toast').filter({ hasText: '3 rows imported into Reading list' })).toBeVisible()

    const p = (name: string) => propByName(page, reading, name)
    expect((await p('Pages'))?.type).toBe('number')
    expect((await p('Read on'))?.type).toBe('date')
    expect((await p('Format'))?.type).toBe('select')
    expect(await p('Writer')).toBeUndefined()
    const dune = await pageIdByTitle(page, 'Dune')
    const author = (await p('Author'))!.id
    expect(await valueOf(page, dune, author)).toBe('Frank Herbert')
    expect(await valueOf(page, dune, (await p('Pages'))!.id)).toBe(412)
    expect(await valueOf(page, dune, (await p('Read on'))!.id)).toMatchObject({ start: '2026-09-01' })
    const format = (await p('Format'))!
    expect(await valueOf(page, dune, format.id)).toBe(format.options.find((o: AnyState) => o.name === 'Paperback').id)

    // one undo takes it all back
    await page.locator('.toast').filter({ hasText: '3 rows imported' }).getByRole('button', { name: 'Undo' }).click()
    expect(await p('Pages')).toBeUndefined()
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((x) => x.title === 'Dune'))).toBe(false)
  })

  test('a locked database never offers to create: the picker says so, a mention offers nothing', async ({ page }) => {
    await openApp(page)
    const reading = await pageIdByTitle(page, 'Reading list')
    await wsEval(page, (s, id) => s.updateDatabase(id, { locked: true }), reading)
    await flush(page)
    await gotoPage(page, reading)
    await db(page).getByRole('tab').filter({ hasText: 'Table' }).click()
    // filters still work on a locked database (this tab only), creating doesn't
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    await page.locator('.db-filterpop').getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByPlaceholder('Filter by…').fill('Budget')
    const locked = page.getByRole('menuitem', { name: 'Database is locked — no new properties' })
    await expect(locked).toBeVisible()
    await expect(locked).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('menuitem', { name: /Create property/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    const book = await pageIdByTitle(page, 'Shape Up')
    await gotoPage(page, book)
    await mention(page, book, 'Website relaunch')
    await page.waitForTimeout(400)
    await expect(offer(page)).toHaveCount(0)
    expect((await propsOf(page, reading)).some((p) => p.type === 'relation')).toBe(false)
  })

  test('German: picker entry, offer and dialog', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const reading = await pageIdByTitle(page, 'Leseliste')
    await gotoPage(page, reading)
    await db(page).getByRole('tab').filter({ hasText: 'Tabelle' }).click()
    await db(page).getByRole('toolbar', { name: 'Datenbank-Werkzeugleiste' }).getByRole('button', { name: 'Filter' }).click()
    await page.locator('.db-filterpop').getByRole('button', { name: 'Filterregel hinzufügen' }).click()
    await page.getByRole('menu').getByRole('textbox').fill('Budget')
    await expect(page.getByRole('menuitem', { name: 'Eigenschaft „Budget“ anlegen' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    const book = await pageIdByTitle(page, 'Shape Up')
    await gotoPage(page, book)
    await mention(page, book, 'Website-Relaunch')
    await expect(offer(page)).toContainText('Als Relation zu Projekte verknüpfen?')
    await offer(page).getByRole('button', { name: /^Verknüpfen/ }).click()
    const dlg = dialog(page)
    await expect(dlg.getByRole('heading')).toHaveText('Relation zu Projekte anlegen')
    await expect(dlg.getByRole('button', { name: 'Anlegen' })).toBeEnabled()
    await expect(dlg).toContainText('Name in Projekte')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    expect((await propsOf(page, reading)).some((p) => p.type === 'relation')).toBe(false)
  })

  test('390px: the offer and the dialog fit the phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    const book = await pageIdByTitle(page, 'Shape Up')
    await gotoPage(page, book)
    await mention(page, book, 'Website relaunch')
    await expect(offer(page)).toBeVisible()
    const box = (await offer(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await offer(page).getByRole('button', { name: /^Link/ }).click()
    const dlg = dialog(page)
    await expect(dlg).toBeVisible()
    const d = (await dlg.boundingBox())!
    expect(d.x).toBeGreaterThanOrEqual(0)
    expect(d.x + d.width).toBeLessThanOrEqual(390)
    await dlg.getByRole('button', { name: 'Create' }).click()
    await expect(dlg).toHaveCount(0)
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(noScroll).toBe(true)
  })
})
