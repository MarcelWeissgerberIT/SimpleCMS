import { test, expect, openApp, gotoPage, pageIdByTitle } from './fixtures'

/** Portalled popovers sit above the page — also above a database table's sticky header and rows. */
test('the page icon picker on a database page is not covered by the table', async ({ page }) => {
  await openApp(page)
  await gotoPage(page, await pageIdByTitle(page, 'Meetings'))
  await expect(page.locator('#main section.db .dbt-row[role="row"]').first()).toBeVisible()
  await page.locator('#main .pv-icon').click()
  const picker = page.locator('[data-popover] .icon-picker')
  await expect(picker).toBeVisible()
  // the topmost element at several points inside the picker belongs to the picker
  const box = (await picker.boundingBox())!
  for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.75], [0.8, 0.9], [0.5, 0.3]]) {
    const inside = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-popover]'),
      [box.x + box.width * fx, box.y + box.height * fy],
    )
    expect(inside, `point ${fx},${fy}`).toBe(true)
  }
})
