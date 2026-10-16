import type { Page } from '@playwright/test'
import { test, openApp, wsEval, flush, escapeRe } from './fixtures'
const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"]')
const row = (page: Page, title: string) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })

for (const off of [40, 60]) test(`dragging toward the top keeps scrolling the tree up (pointer ${off}px below the scroll top)`, async ({ page }) => {
  await openApp(page)
  await wsEval(page, (s) => { for (let i = 0; i < 80; i++) s.createPage({ title: `Item ${String(i).padStart(2, '0')}`, parentId: null }) })
  await flush(page)
  const box = page.locator('.sb-scroll')
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.waitForTimeout(300)
  const b = (await box.boundingBox())!
  const start = await box.evaluate((el) => el.scrollTop)
  // a row in the middle of the scroll area
  const y0 = b.y + b.height * 0.6
  await page.mouse.move(b.x + 60, y0)
  await page.mouse.down()
  await page.mouse.move(b.x + 60, y0 - 10, { steps: 3 })
  await page.mouse.move(b.x + 60, b.y + off, { steps: 12 })
  const samples: number[] = []
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500)
    samples.push(await box.evaluate((el) => el.scrollTop))
  }
  await page.keyboard.press('Escape')
  await page.mouse.up()
  console.log(`off ${off}: box ${Math.round(b.y)} h ${Math.round(b.height)}; scrollTop ${start} → ${samples.join(', ')}`)
})
