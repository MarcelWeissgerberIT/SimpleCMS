/**
 * Created by / Last edited by properties, "Me" in person filters and locked databases — in the
 * local workspace (team behaviour: tests/e2e-cloud/db-people.spec.ts).
 *
 * Local rule (database/model/actors.ts): every row was made and changed by the local user, who shows
 * as their own person when the workspace has one (named like settings.userName, else "You" — the demo
 * workspace's person), else as "You" / the user's name. "Me" matches that person.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush, reloadApp } from './fixtures'

const db = (page: Page) => page.locator('#main section.db').first()
const toolbar = (page: Page) => db(page).getByRole('toolbar', { name: 'Database toolbar' })
const tableRow = (page: Page, title: string): Locator =>
  db(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: new RegExp(`^${title}`) }) })

async function titlesInTable(page: Page): Promise<string[]> {
  return db(page)
    .locator('.dbt-body .dbt-row[role="row"]')
    .evaluateAll((rows) => rows.map((r) => (r.querySelector('.dbt-cell--title')?.textContent ?? '').replace(/OPEN|ÖFFNEN/g, '').trim()))
}

/** A database with an Owner (person) column; Alpha is owned by the demo's "You", Beta by Alex, Gamma by nobody. */
async function createDb(page: Page): Promise<{ dbId: string; you: string; alex: string }> {
  const ids = await wsEval(page, (s) => {
    const you = s.people.find((p: { name: string }) => p.name === 'You').id as string
    const alex = s.people.find((p: { name: string }) => p.name === 'Alex').id as string
    const dbId = s.createDatabase({
      title: 'People DB',
      properties: [
        { id: 'pName', name: 'Name', type: 'title' },
        { id: 'pNotes', name: 'Notes', type: 'text' },
        { id: 'pKind', name: 'Kind', type: 'select', options: [{ id: 'oApple', name: 'Apple', color: 'red' }] },
        { id: 'pOwner', name: 'Owner', type: 'person' },
      ],
    })
    s.createRow(dbId, { title: 'Alpha', properties: { pOwner: [you] } })
    s.createRow(dbId, { title: 'Beta', properties: { pOwner: [alex] } })
    s.createRow(dbId, { title: 'Gamma' })
    return { dbId, you, alex }
  })
  await flush(page)
  return ids
}

/** Add a property from the table's "+" column button (its menu opens; Escape closes it). */
async function addColumn(page: Page, type: string) {
  await db(page).locator('.dbt-hcell--add button').click()
  await page.getByRole('menuitem', { name: new RegExp(`^${type}`) }).click()
  await expect(page.locator('.db-propmenu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.db-propmenu')).toHaveCount(0)
}

const cellsOf = (page: Page, type: string) => db(page).locator(`.dbt-body [role="gridcell"][data-type="${type}"]`)
/** The names shown in a column (person chips: avatar initials left out). */
const namesOf = (page: Page, type: string) => cellsOf(page, type).locator('.db-person__name')

async function readDownload(page: Page, trigger: () => Promise<void>): Promise<string> {
  const pending = page.waitForEvent('download')
  await trigger()
  const dl = await pending
  const path = await dl.path()
  const fs = await import('node:fs/promises')
  return (await fs.readFile(path!, 'utf8')).replace(/^﻿/, '')
}

test.describe('database people', () => {
  test('Created by / Last edited by: computed, read-only, the local user; filter, sort, group, CSV', async ({ page }) => {
    await openApp(page)
    const { dbId } = await createDb(page)
    await gotoPage(page, dbId)
    await addColumn(page, 'Created by')
    await addColumn(page, 'Last edited by')
    await expect(db(page).locator('.dbt-hcell', { hasText: 'Created by' })).toBeVisible()
    await expect(db(page).locator('.dbt-hcell', { hasText: 'Last edited by' })).toBeVisible()

    // the local user — the demo workspace's own person "You" — on every row, never stored
    await expect(namesOf(page, 'created_by')).toHaveText(['You', 'You', 'You'])
    await expect(namesOf(page, 'last_edited_by')).toHaveText(['You', 'You', 'You'])
    const props = await wsEval(page, (s, id) => s.databases[id].properties.filter((p: { type: string }) => p.type === 'created_by' || p.type === 'last_edited_by').map((p: { id: string }) => p.id), dbId)
    expect(props).toHaveLength(2)
    const stored = await wsEval(page, (s, a) => (Object.values(s.pages) as Array<{ databaseId: string; properties: Record<string, unknown> }>).filter((p) => p.databaseId === a.dbId).some((p) => a.props.some((id: string) => id in p.properties)), { dbId, props })
    expect(stored).toBe(false)

    // read-only: no editor opens, the row panel has no editor either
    const cell = cellsOf(page, 'created_by').first()
    await expect(cell).toHaveAttribute('data-readonly', 'true')
    await cell.click()
    await page.keyboard.press('Enter')
    await expect(page.locator('.db-pop')).toHaveCount(0)

    // a name in settings: shown instead of the demo person (no person has that name)
    await wsEval(page, (s) => s.updateSettings({ userName: 'Marcel Probe' }))
    await expect(namesOf(page, 'created_by')).toHaveText(['Marcel Probe', 'Marcel Probe', 'Marcel Probe'])
    await expect(cellsOf(page, 'created_by').first().locator('.db-avatar')).toHaveText('MP')

    // filter: Created by is Me → every row; is not Me → none (stored as the "@me" token)
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    const fpop = page.locator('.db-filterpop')
    await fpop.getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByRole('menuitem', { name: 'Created by' }).click()
    await fpop.locator('.db-frule__value').click()
    await page.getByRole('menuitem', { name: 'Me' }).click()
    await expect(fpop.locator('.db-frule__value')).toHaveAccessibleName('Me')
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha', 'Beta', 'Gamma'])
    const rule = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].views[0].filter.items[0])), dbId)
    expect(rule).toMatchObject({ operator: 'is', value: '@me' })
    await fpop.locator('.db-frule__op').click()
    await page.getByRole('menuitem', { name: 'is not', exact: true }).click()
    await expect.poll(() => titlesInTable(page)).toEqual([])
    await fpop.getByRole('button', { name: 'Remove' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha', 'Beta', 'Gamma'])

    // sort + group by Created by: one group, the local user
    await wsEval(page, (s, a) => s.updateView(a.dbId, s.databases[a.dbId].views[0].id, { sorts: [{ propertyId: a.props[0], direction: 'desc' }], groupBy: a.props[0] }), { dbId, props })
    const groups = db(page).locator('.dbt-grouphead')
    await expect(groups).toHaveCount(1)
    await expect(groups.first()).toContainText('Marcel Probe')
    await expect(groups.first().locator('.dbt-grouphead__count')).toHaveText('3')
    await wsEval(page, (s, id) => s.updateView(id, s.databases[id].views[0].id, { sorts: [], groupBy: null }), dbId)

    // CSV export: names
    const csv = await readDownload(page, async () => {
      await toolbar(page).getByRole('button', { name: 'More' }).click()
      await page.getByRole('menuitem', { name: 'Export as CSV' }).click()
    })
    const [header, first] = csv.split(/\r\n/)
    expect(header.split(',')).toEqual(expect.arrayContaining(['Created by', 'Last edited by']))
    const cols = header.split(',')
    expect(first.split(',')[cols.indexOf('Created by')]).toBe('Marcel Probe')

    // forms leave them out; they survive a reload as definitions only
    await reloadApp(page)
    await gotoPage(page, dbId)
    await expect(namesOf(page, 'last_edited_by')).toHaveText(['Marcel Probe', 'Marcel Probe', 'Marcel Probe'])
  })

  test('"Me" in a person filter: the local user\'s person, new rows get it', async ({ page }) => {
    await openApp(page)
    const { dbId, you } = await createDb(page)
    await gotoPage(page, dbId)
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    const fpop = page.locator('.db-filterpop')
    await fpop.getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByRole('menuitem', { name: 'Owner' }).click()
    await fpop.locator('.db-frule__value').click()
    // "Me" comes first, then the workspace people
    const items = page.getByRole('menu').last().getByRole('menuitem')
    await expect(items.first()).toHaveAccessibleName('Me')
    await page.getByRole('menuitem', { name: 'Me' }).click()
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha'])
    await page.keyboard.press('Escape')
    await expect(db(page).locator('.db-fchip', { hasText: 'Owner' })).toContainText('Me')

    // a new row in this view is preset to match: Owner = the local user's person
    await toolbar(page).getByRole('button', { name: 'New', exact: true }).click()
    await page.keyboard.type('Delta')
    await page.keyboard.press('Enter')
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha', 'Delta'])
    const owner = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string; properties: Record<string, unknown> }>).find((p) => p.title === 'Delta')?.properties.pOwner ?? null)
    expect(owner).toEqual([you])

    // named user without a matching person: "Me" is nobody (Delta, made in this session, stays in sight)
    await wsEval(page, (s) => s.updateSettings({ userName: 'Nobody Here' }))
    await expect.poll(() => titlesInTable(page)).toEqual(['Delta'])
  })

  test('locked database: properties and views are fixed, rows stay editable, filters are this tab\'s, one click unlocks', async ({ page }) => {
    await openApp(page)
    const { dbId } = await createDb(page)
    await gotoPage(page, dbId)
    await expect(db(page).locator('.dbt-hcell--add button')).toHaveCount(1)

    // lock from the "…" menu
    await toolbar(page).getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Lock database' }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].locked ?? null, dbId)).toBe(true)
    const plate = toolbar(page).getByTestId('db-locked')
    await expect(plate).toBeVisible()
    await expect(plate).toHaveText(/Locked/i)
    await expect(db(page)).toHaveAttribute('data-locked', 'true')

    // no schema or view editing: add column, add view, group, properties, resize
    await expect(db(page).locator('.dbt-hcell--add button')).toHaveCount(0)
    await expect(db(page).getByRole('button', { name: 'Add view' })).toHaveCount(0)
    await expect(toolbar(page).getByRole('button', { name: 'Group' })).toHaveCount(0)
    await expect(toolbar(page).getByRole('button', { name: 'Properties' })).toHaveCount(0)
    await expect(db(page).locator('.dbt-resize')).toHaveCount(0)
    await toolbar(page).getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menuitem', { name: /^Layout/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Unlock database' })).toBeVisible()
    await page.keyboard.press('Escape')

    // the column menu only sorts and filters
    await db(page).locator('.dbt-hcell', { hasText: 'Notes' }).locator('.dbt-hcell__btn').click()
    const menu = page.locator('.db-propmenu')
    await expect(menu).toContainText(/sort and filter only/i)
    await expect(menu.locator('input')).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Sort ascending' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Delete property/ })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: /^Type/ })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: /Hide/ })).toHaveCount(0)

    // sorting there is for this tab only: the saved view keeps no sorts
    await menu.getByRole('menuitem', { name: 'Sort descending' }).click()
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha', 'Beta', 'Gamma'])
    await wsEval(page, (s, id) => {
      const rows = (Object.values(s.pages) as Array<{ id: string; databaseId: string; title: string }>).filter((p) => p.databaseId === id)
      for (const r of rows) s.setRowProperty(r.id, 'pNotes', r.title === 'Beta' ? 'zz' : r.title === 'Alpha' ? 'aa' : 'mm')
    }, dbId)
    await expect.poll(() => titlesInTable(page)).toEqual(['Beta', 'Gamma', 'Alpha'])
    expect(await wsEval(page, (s, id) => s.databases[id].views[0].sorts.length, dbId)).toBe(0)
    const chips = db(page).locator('.db-chipsbar')
    await expect(chips).toContainText(/Not saved/i)

    // filters too
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    const fpop = page.locator('.db-filterpop')
    await expect(fpop.getByRole('note')).toContainText(/this tab only/i)
    await fpop.getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByRole('menuitem', { name: 'Name' }).click()
    await fpop.getByPlaceholder('Value').fill('Gam')
    await expect.poll(() => titlesInTable(page)).toEqual(['Gamma'])
    await page.keyboard.press('Escape')
    expect(await wsEval(page, (s, id) => s.databases[id].views[0].filter, dbId)).toBeNull()
    await chips.getByRole('button', { name: 'Reset' }).click()
    await expect.poll(() => titlesInTable(page)).toEqual(['Alpha', 'Beta', 'Gamma'])
    await expect(db(page).locator('.db-chipsbar')).toHaveCount(0)

    // rows stay editable: a cell, a new row; existing options only (no "Create")
    await tableRow(page, 'Beta').locator('[role="gridcell"][data-type="text"]').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.type('edited while locked')
    await page.keyboard.press('Enter')
    await expect(tableRow(page, 'Beta').locator('[role="gridcell"][data-type="text"]')).toHaveText('edited while locked')
    await tableRow(page, 'Beta').locator('[role="gridcell"][data-type="select"]').click()
    const picker = page.locator('.db-picker')
    await expect(picker).toBeVisible()
    await picker.locator('input').fill('Cherry')
    await expect(picker).not.toContainText('Create')
    await picker.locator('input').fill('App')
    await page.keyboard.press('Enter')
    await expect(tableRow(page, 'Beta').locator('[role="gridcell"][data-type="select"]')).toHaveText('Apple')
    await page.keyboard.press('Escape')
    const optionCount = await wsEval(page, (s, id) => s.databases[id].properties.find((p: { id: string }) => p.id === 'pKind').options.length, dbId)
    expect(optionCount).toBe(1)

    // the row page: values editable, no "Add a property", no property menus
    const row = tableRow(page, 'Gamma')
    await row.hover()
    await row.locator('.db-open').click()
    const peek = page.locator('.peek')
    await expect(peek).toBeVisible()
    await expect(peek.getByRole('button', { name: 'Add a property' })).toHaveCount(0)
    await expect(peek.locator('.db-prow__name').first()).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('.peek')).toHaveCount(0)

    // a reload keeps the lock; one click on the plate unlocks
    await reloadApp(page)
    await gotoPage(page, dbId)
    await expect(toolbar(page).getByTestId('db-locked')).toBeVisible()
    await toolbar(page).getByTestId('db-locked').click()
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].locked ?? null, dbId)).toBe(false)
    await expect(toolbar(page).getByTestId('db-locked')).toHaveCount(0)
    await expect(db(page).locator('.dbt-hcell--add button')).toHaveCount(1)
    await expect(toolbar(page).getByRole('button', { name: 'Group' })).toHaveCount(1)
  })
})
