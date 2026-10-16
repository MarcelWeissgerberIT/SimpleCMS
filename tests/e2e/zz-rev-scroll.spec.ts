import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, escapeRe } from './fixtures'
const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"]')
const row = (page: Page, title: string) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })

test('after the tree auto-scrolls during a drag, the middle of a row still means "inside"', async ({ page }) => {
  await openApp(page)
  await wsEval(page, (s) => { for (let i = 0; i < 60; i++) s.createPage({ title: `Item ${String(i).padStart(2, '0')}`, parentId: null }) })
  await flush(page)
  const box = page.locator('.sb-scroll')
  const src = row(page, 'Item 00')
  await src.scrollIntoViewIfNeeded()
  const b = (await box.boundingBox())!
  const a = (await src.boundingBox())!
  await page.mouse.move(a.x + 60, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 8, { steps: 3 })
  // to the bottom edge: the tree scrolls
  await page.mouse.move(b.x + 60, b.y + b.height - 6, { steps: 10 })
  await page.waitForTimeout(700)
  await page.mouse.move(b.x + 60, b.y + b.height * 0.5, { steps: 6 })
  await page.waitForTimeout(300)
  const scrolled = await box.evaluate((el) => el.scrollTop)
  // the row under the pointer now, and where on it the pointer sits
  const res = await page.evaluate((y) => {
    const rows = [...document.querySelectorAll<HTMLElement>('.sb section[aria-label="Pages"] .sb-row')]
    const hit = rows.find((r) => { const q = r.getBoundingClientRect(); return y >= q.top && y < q.bottom })
    if (!hit) return null
    const q = hit.getBoundingClientRect()
    return { title: hit.querySelector('.sb-row__title')?.textContent, rel: (y - q.top) / q.height, drop: hit.getAttribute('data-drop'), allDrops: rows.filter((r) => r.hasAttribute('data-drop')).map((r) => `${r.querySelector('.sb-row__title')?.textContent}:${r.getAttribute('data-drop')}`) }
  }, b.y + b.height * 0.5)
  console.log('scrollTop', scrolled, JSON.stringify(res))
  // move to the exact middle of that row
  const hitRow = row(page, res!.title!)
  const h = (await hitRow.boundingBox())!
  await page.mouse.move(b.x + 60, h.y + h.height / 2, { steps: 3 })
  await page.mouse.move(b.x + 61, h.y + h.height / 2, { steps: 1 })
  await page.waitForTimeout(300)
  const drops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sb-row[data-drop]')].map((r) => `${r.querySelector('.sb-row__title')?.textContent}:${r.getAttribute('data-drop')}`))
  console.log('middle of', res!.title, '→', JSON.stringify(drops), 'scrollTop', await box.evaluate((el) => el.scrollTop))
  await page.mouse.up()
  const srcId = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ id: string; title: string }>).find((p) => p.title === 'Item 00')!.id)
  const parent = await wsEval(page, (s, id) => { const p = s.pages[id].parentId; return p ? s.pages[p].title : null }, srcId)
  console.log('Item 00 parent after drop:', parent, 'expected', res!.title)
  expect(parent).toBe(res!.title)
})
