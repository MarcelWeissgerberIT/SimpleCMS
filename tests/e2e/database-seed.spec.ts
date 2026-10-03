/** Correctness of the seeded Projects database: formulas, calculations, chart and timeline. */
import { test, expect, openApp, gotoPage, pageIdByTitle, wsEval } from './fixtures'

test.describe('seeded Projects database', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await gotoPage(page, await pageIdByTitle(page, 'Projects'))
  })

  const db = (page: import('@playwright/test').Page) => page.locator('#main section.db').first()

  test('"Days left" formula shows whole days until the end of each timeline', async ({ page }) => {
    await db(page).getByRole('tab').filter({ hasText: 'All projects' }).click()
    const expected = await wsEval(page, (s) => {
      const projects = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.kind === 'database' && p.title === 'Projects')!
      const dbx = s.databases[projects.id]
      const due = dbx.properties.find((p: { name: string }) => p.name === 'Timeline').id
      const rows = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === projects.id)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return rows.map((r) => {
        const end = new Date(`${r.properties[due].end}T00:00:00`)
        return { title: r.title, days: Math.round((end.getTime() - today.getTime()) / 86_400_000) }
      })
    })
    const colIndex = await db(page).locator('.dbt-row--head .dbt-hcell').evaluateAll((cells) => cells.findIndex((c) => /Days left/i.test(c.textContent ?? '')))
    expect(colIndex, 'Days left column is visible').toBeGreaterThan(0)
    for (const { title, days } of expected) {
      const row = db(page).locator('.dbt-body .dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: title }) })
      const cell = row.locator('[role="gridcell"]').nth(colIndex)
      const text = (await cell.innerText()).trim()
      expect(text, `Days left for ${title}`).toMatch(/^-?\d+$/)
      expect(Math.abs(Number(text) - days), `Days left for ${title}: ${text} vs ~${days}`).toBeLessThanOrEqual(1)
    }
  })

  test('table calculations: budget sum and average progress', async ({ page }) => {
    await db(page).getByRole('tab').filter({ hasText: 'All projects' }).click()
    const calcs = await db(page).locator('.dbt-calc[data-set="true"]').allInnerTexts()
    const flat = calcs.map((c) => c.replace(/\s+/g, ' '))
    expect(flat.some((c) => /53,000/.test(c)), `budget sum in ${JSON.stringify(flat)}`).toBe(true)
    expect(flat.some((c) => /(55[.,]6\d?|56)\s?%/.test(c)), `average progress in ${JSON.stringify(flat)}`).toBe(true)
  })

  test('chart sums the budget per status', async ({ page }) => {
    await db(page).getByRole('tab').filter({ hasText: 'Chart' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'chart')
    await expect(db(page).locator('.dbch-bar')).toHaveCount(4)
    const table = db(page).locator('.dbch-table')
    const sums: Record<string, string> = { Backlog: '7,500', 'In progress': '20,500', Review: '13,000', Done: '12,000' }
    for (const [s, sum] of Object.entries(sums)) await expect(table.locator('tr', { hasText: s })).toContainText(sum)
    await expect(db(page).locator('.dbch-total__num')).toContainText('53,000')
  })

  test('timeline shows a bar per project and board columns per status', async ({ page }) => {
    await db(page).getByRole('tab').filter({ hasText: 'Timeline' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'timeline')
    await expect(db(page).locator('.dbtl-bar')).toHaveCount(8)
    await db(page).getByRole('tab').filter({ hasText: 'Board' }).click()
    for (const s of ['Backlog', 'In progress', 'Review', 'Done']) await expect(db(page).locator(`section.dbb-col[aria-label="${s}"] .dbc`)).toHaveCount(2)
  })
})
