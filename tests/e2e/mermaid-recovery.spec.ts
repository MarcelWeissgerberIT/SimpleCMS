import { test, expect, openApp, gotoPage, createPage, doc, wsEval } from './fixtures'

const broken = 'flowchart TD\n  A[Start] --> B[Finish]\n  Not a valid statement @@@'
const valid = 'flowchart TD\n  A["Volume (µL)"] --> B["Restore speed"]'

test('a syntax error cannot break neighbouring diagrams, and editing or clearing recovers', async ({ page }) => {
  await openApp(page)
  const id = await createPage(page, { title: 'Independent diagrams', content: doc(
    ...[broken, valid, broken, valid, valid].map(code => ({ type: 'mermaid', attrs: { code } })),
  ) })
  await gotoPage(page, id)
  const blocks = page.locator('#main .mermaid-view')
  await expect(blocks).toHaveCount(5)
  for (const n of [1, 3, 4]) await expect(blocks.nth(n).locator('svg[id^="one-mermaid-"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('#main .mermaid-view__error')).toHaveCount(2)
  await expect(page.locator('#main')).not.toContainText('firstChild')
  await wsEval(page, s => s.updateSettings({ theme: 'dark' }))
  for (const n of [1, 3, 4]) await expect(blocks.nth(n).locator('svg[id^="one-mermaid-"]')).toBeVisible()
  await expect(blocks.first().locator('.mermaid-view__error')).toContainText('invalid Mermaid syntax')
  await blocks.first().locator('summary').click()
  await expect(blocks.first().locator('.mermaid-view__error pre')).toContainText('line 3')
  await blocks.first().getByRole('button', { name: 'Check diagram code', exact: true }).click()
  await blocks.first().locator('textarea').fill(valid)
  await expect(blocks.first().locator('.mermaid-view__error')).toHaveCount(0)
  await expect(blocks.first().locator('svg[id^="one-mermaid-"]')).toBeVisible()
  await blocks.nth(2).getByRole('button', { name: 'Edit', exact: true }).click()
  await blocks.nth(2).locator('textarea').fill('')
  await expect(blocks.nth(2).locator('.mermaid-view__error')).toHaveCount(0)
  await expect(blocks.nth(2).locator('.mermaid-view__svg')).toBeEmpty()
  expect(await page.locator('body > [data-one-mermaid-scratch]').count()).toBe(0)
})
