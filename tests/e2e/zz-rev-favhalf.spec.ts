import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, escapeRe } from './fixtures'
const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"]')
const row = (page: Page, title: string) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
const favs = (page: Page) => page.locator('.sb section[aria-label="Favorites"]')
const favRow = (page: Page, t: string) => favs(page).locator('.sb-favs__list > .sb-node > .sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(t)}$`) }) })

test('a tree row dragged up through the tree into FAVORITES: the lower half of a favourite means after it', async ({ page }) => {
  await openApp(page)
  await wsEval(page, (s) => {
    Object.values(s.pages).forEach((p: { id: string; favorite: boolean }) => p.favorite && s.toggleFavorite(p.id))
    for (const t of ['Fav A', 'Fav B', 'Fav C']) s.toggleFavorite(s.createPage({ title: t, parentId: null }))
    for (let i = 0; i < 40; i++) s.createPage({ title: `Item ${String(i).padStart(2, '0')}`, parentId: null })
  })
  await flush(page)
  const box = page.locator('.sb-scroll')
  await box.evaluate((el) => (el.scrollTop = 600))
  await page.waitForTimeout(300)
  const b = (await box.boundingBox())!
  const y0 = b.y + b.height * 0.6
  await page.mouse.move(b.x + 60, y0)
  await page.mouse.down()
  await page.mouse.move(b.x + 60, y0 - 10, { steps: 3 })
  // up through the tree's top zone (it scrolls a little), into FAVORITES
  await page.mouse.move(b.x + 60, b.y + 50, { steps: 10 })
  await page.waitForTimeout(800)
  const a = (await favRow(page, 'Fav A').boundingBox())!
  await page.mouse.move(b.x + 60, a.y + a.height * 0.85, { steps: 8 })
  await page.mouse.move(b.x + 61, a.y + a.height * 0.85, { steps: 1 })
  await page.waitForTimeout(300)
  const drops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sb-favs .sb-row[data-drop]')].map((r) => `${r.querySelector('.sb-row__title')?.textContent}:${r.getAttribute('data-drop')}`))
  console.log('scrolled by', 600 - (await box.evaluate((el) => el.scrollTop)), 'drops', JSON.stringify(drops))
  await page.mouse.up()
  const order = await favs(page).locator('.sb-favs__list > .sb-node > .sb-row .sb-row__title').allInnerTexts()
  console.log('favourites now', JSON.stringify(order))
  expect(drops).toEqual(['Fav A:after'])
})
