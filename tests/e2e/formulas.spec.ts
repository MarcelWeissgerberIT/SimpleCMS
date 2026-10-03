/** Formula, relation and rollup values as the table shows them. */
import type { Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush } from './fixtures'

async function cellText(page: Page, rowTitle: string, propName: string): Promise<string> {
  const db = page.locator('#main section.db').first()
  const col = await db.locator('.dbt-row--head .dbt-hcell').evaluateAll((cells, name) => cells.findIndex((c) => (c.querySelector('.dbt-hcell__name')?.textContent ?? '').trim() === name), propName)
  expect(col, `column ${propName}`).toBeGreaterThan(0)
  const row = db.locator('.dbt-body .dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: rowTitle }) })
  return (await row.locator('[role="gridcell"]').nth(col).innerText()).trim()
}

test('formulas, relations and rollups compute in the table', async ({ page }) => {
  await openApp(page)
  const { items, orders } = await wsEval(page, (s) => {
    const items = s.createDatabase({
      title: 'Items',
      properties: [
        { id: 'iName', name: 'Name', type: 'title' },
        { id: 'iScore', name: 'Score', type: 'number' },
        { id: 'iDone', name: 'Done', type: 'checkbox' },
        { id: 'iTag', name: 'Tag', type: 'select', options: [{ id: 'tA', name: 'Alpha', color: 'red' }, { id: 'tB', name: 'Beta', color: 'blue' }] },
        { id: 'iDue', name: 'Due', type: 'date' },
        { id: 'fDouble', name: 'Double', type: 'formula', formula: 'prop("Score") * 2' },
        { id: 'fState', name: 'State', type: 'formula', formula: 'if(prop("Done"), "yes", "no")' },
        { id: 'fLabel', name: 'Label', type: 'formula', formula: 'concat(prop("Name"), " / ", prop("Tag"))' },
        { id: 'fThird', name: 'Third', type: 'formula', formula: 'round(prop("Score") / 3, 2)' },
        { id: 'fLen', name: 'Len', type: 'formula', formula: 'length(upper(prop("Name")))' },
        { id: 'fYear', name: 'Year', type: 'formula', formula: 'year(dateAdd(prop("Due"), 1, "years"))' },
      ],
    })
    const apple = s.createRow(items, { title: 'Apple', properties: { iScore: 10, iDone: true, iTag: 'tA', iDue: { start: '2026-03-01' } } })
    const pear = s.createRow(items, { title: 'Pear', properties: { iScore: 7, iDone: false, iTag: 'tB', iDue: { start: '2027-12-31' } } })
    const orders = s.createDatabase({
      title: 'Orders',
      properties: [
        { id: 'oName', name: 'Order', type: 'title' },
        { id: 'oItems', name: 'Items', type: 'relation', relationDatabaseId: items },
        { id: 'oTotal', name: 'Total score', type: 'rollup', rollup: { relationPropertyId: 'oItems', targetPropertyId: 'iScore', fn: 'sum' } },
        { id: 'oCount', name: 'Item count', type: 'rollup', rollup: { relationPropertyId: 'oItems', targetPropertyId: 'iName', fn: 'count' } },
      ],
    })
    // (s is the state at call time — use the ids the actions return)
    s.createRow(orders, { title: 'Order 1', properties: { oItems: [apple, pear] } })
    return { items, orders }
  })
  await flush(page)

  await gotoPage(page, items)
  expect(await cellText(page, 'Apple', 'Double')).toBe('20')
  expect(await cellText(page, 'Pear', 'Double')).toBe('14')
  expect(await cellText(page, 'Apple', 'State')).toBe('yes')
  expect(await cellText(page, 'Pear', 'State')).toBe('no')
  expect(await cellText(page, 'Apple', 'Label')).toBe('Apple / Alpha')
  expect(await cellText(page, 'Pear', 'Third')).toBe('2.33')
  expect(await cellText(page, 'Pear', 'Len')).toBe('4')
  expect(await cellText(page, 'Apple', 'Year')).toBe('2027')
  expect(await cellText(page, 'Pear', 'Year')).toBe('2028')

  await gotoPage(page, orders)
  const rel = await cellText(page, 'Order 1', 'Items')
  expect(rel).toContain('Apple')
  expect(rel).toContain('Pear')
  expect(await cellText(page, 'Order 1', 'Total score')).toBe('17')
  expect(await cellText(page, 'Order 1', 'Item count')).toBe('2')

  // editing a source value updates formula and rollup live
  await wsEval(page, (s, items) => {
    const apple = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.databaseId === items && p.title === 'Apple')
    s.setRowProperty(apple!.id, 'iScore', 30)
  }, items)
  await expect.poll(() => cellText(page, 'Order 1', 'Total score')).toBe('37')
})
