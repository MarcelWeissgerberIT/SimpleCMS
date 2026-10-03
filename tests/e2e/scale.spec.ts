/** A workspace that has grown: big databases stay usable. */
import { test, expect, openApp, gotoPage, wsEval, flush } from './fixtures'

test('a 2,000-row database renders virtualised, scrolls to the end and searches', async ({ page }) => {
  test.setTimeout(90_000)
  await openApp(page)
  const dbId = await wsEval(page, (s) => {
    const id = s.createDatabase({
      title: 'Big table',
      properties: [
        { id: 'bName', name: 'Name', type: 'title' },
        { id: 'bN', name: 'N', type: 'number' },
        { id: 'bKind', name: 'Kind', type: 'select', options: [{ id: 'kOdd', name: 'Odd', color: 'blue' }, { id: 'kEven', name: 'Even', color: 'green' }] },
      ],
    })
    for (let i = 1; i <= 2000; i++) s.createRow(id, { title: `Row ${String(i).padStart(4, '0')}`, properties: { bN: i, bKind: i % 2 ? 'kOdd' : 'kEven' } })
    return id
  })
  await flush(page)
  const t0 = Date.now()
  await gotoPage(page, dbId)
  const dbEl = page.locator('#main section.db').first()
  await expect(dbEl.locator('.db-counter__num')).toHaveText(/2,000|2000/)
  await expect(dbEl.locator('.dbt-cell--title', { hasText: 'Row 0001' })).toBeVisible()
  const renderMs = Date.now() - t0
  expect(renderMs, 'time to first paint of a 2,000-row table').toBeLessThan(5000)
  // virtualised: far fewer DOM rows than records
  const domRows = await dbEl.locator('.dbt-body .dbt-row[role="row"]').count()
  expect(domRows).toBeLessThan(300)

  // scroll to the end with the mouse wheel
  await dbEl.locator('.dbt-cell--title', { hasText: 'Row 0005' }).hover()
  const last = dbEl.locator('.dbt-cell--title', { hasText: 'Row 2000' })
  for (let i = 0; i < 40 && !(await last.isVisible()); i++) {
    await page.mouse.wheel(0, 6000)
    await page.waitForTimeout(100)
  }
  await expect(last).toBeVisible()

  // search narrows instantly
  await dbEl.getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Search' }).click()
  await page.getByPlaceholder('Search rows…').fill('Row 1999')
  await expect(dbEl.locator('.dbt-body .dbt-row[role="row"]')).toHaveCount(1)
  await expect(dbEl.locator('.db-counter__num')).toHaveText(/^1\/2,?000$/)
})
