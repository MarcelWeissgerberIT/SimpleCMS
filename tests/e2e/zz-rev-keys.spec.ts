import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, pageIdByTitle, sidebarRow, escapeRe } from './fixtures'

const SHOTS = '/tmp/claude-0/-home-user-SimpleCMS/67d4b02e-fe50-527a-9f73-83525d6451bc/scratchpad/sidebar/fix-probe'
const favs = (page: Page) => page.locator('.sb section[aria-label="Favorites"]')
const favRow = (page: Page, title: string) =>
  favs(page).locator('.sb-favs__list > .sb-node > .sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
const favTitles = (page: Page) => favs(page).locator('.sb-favs__list > .sb-node > .sb-row .sb-row__title')
const clearFavs = (page: Page) => wsEval(page, (s) => Object.values(s.pages).forEach((p: { id: string; favorite: boolean }) => p.favorite && s.toggleFavorite(p.id)))
const star = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.forEach((id) => !s.pages[id].favorite && s.toggleFavorite(id)), ids)
const active = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    if (!a) return 'null'
    return `${a.tagName}.${a.className}|${a.getAttribute('aria-label') ?? ''}|${(a.textContent ?? '').trim().slice(0, 40)}|${a.closest('.sb') ? 'IN-SB' : 'OUT'}`
  })

async function drag(page: Page, from: Locator, to: { x: number; y: number }, check?: () => Promise<void>) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + 60, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 60, a.y + a.height / 2 - 8, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.move(to.x + 2, to.y, { steps: 2 })
  if (check) await check()
  await page.mouse.up()
}

test('K1 keyboard run, Shift+F10, menu moves, unstar via menu focus', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const a = await createPage(page, { title: 'Fav Alpha' })
  const b = await createPage(page, { title: 'Fav Bravo' })
  const c = await createPage(page, { title: 'Fav Charlie' })
  await star(page, [a, b, c])
  await expect(favTitles(page)).toHaveText(['Fav Alpha', 'Fav Bravo', 'Fav Charlie'])
  // Shift+F10 on fav Bravo → Move down by keyboard
  const blink = favRow(page, 'Fav Bravo').locator('.sb-row__link')
  await blink.focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible()
  console.log('menu focus', await active(page))
  await page.getByRole('menuitem', { name: 'Move down' }).click()
  await expect(favTitles(page)).toHaveText(['Fav Alpha', 'Fav Charlie', 'Fav Bravo'])
  await page.waitForTimeout(300)
  console.log('after Move down via Shift+F10 menu:', await active(page), 'live=', await page.locator('#sb-fav-live').textContent())
  // Escape case
  await favRow(page, 'Fav Charlie').locator('.sb-row__link').focus()
  await page.keyboard.press('Shift+F10')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  console.log('after Shift+F10 + Esc:', await active(page))
  // remove via menu
  await favRow(page, 'Fav Charlie').locator('.sb-row__link').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Remove from favorites' }).click()
  await page.waitForTimeout(400)
  console.log('after remove via menu:', await active(page))
  // Alt+Down on last fav
  await favRow(page, 'Fav Bravo').locator('.sb-row__link').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForTimeout(200)
  console.log('after alt up: ', await favTitles(page).allInnerTexts(), await active(page), await page.locator('#sb-fav-live').textContent())
  // Home / End / ArrowDown run
  await page.keyboard.press('Home')
  console.log('Home ->', await active(page))
  await page.keyboard.press('End')
  console.log('End ->', await active(page))
  await favRow(page, 'Fav Alpha').locator('.sb-row__link').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  console.log('2x down from last fav ->', await active(page))
})

test('K2 tools strip keys and agenda', async ({ page }) => {
  await openApp(page, '#/agenda')
  await page.waitForTimeout(500)
  const title = async () => (await page.locator('.ag-title__main').first().textContent()) ?? ''
  const t0 = await title()
  const strip = page.locator('.sb [role="toolbar"]')
  const tabbable = await strip.locator('[tabindex="0"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  console.log('tabbable in strip', tabbable)
  await strip.locator('[tabindex="0"]').focus()
  await page.keyboard.press('ArrowRight')
  console.log('after → in strip:', await active(page), 'agenda title', t0, '->', await title())
  await page.keyboard.press('End')
  console.log('End ->', await active(page))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  console.log('enter on Import ->', await active(page), await page.locator('[role="dialog"]').count())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  console.log('esc dialog ->', await active(page))
  // NAMEN toggle
  const names = page.locator('.sb-tools__names')
  await names.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  console.log('after NAMES on ->', await active(page), await names.getAttribute('aria-pressed'))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  console.log('after NAMES off ->', await active(page))
  // ← on NAMEN on the agenda
  const t1 = await title()
  await names.focus()
  await page.keyboard.press('ArrowRight')
  console.log('→ on NAMES: agenda', t1, '->', await title())
  // fold FAVORITES key with → (agenda)
  const fold = favs(page).locator('.sb-sect__fold')
  const t2 = await title()
  await fold.focus()
  await page.keyboard.press('ArrowRight')
  console.log('→ on fav fold: agenda', t2, '->', await title())
  // collapse all key
  const ca = page.locator('.sb-sect__collapse')
  console.log('collapse all disabled?', await ca.getAttribute('aria-disabled'))
})

test('K3 drag a favourite to the top over the head', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const a = await createPage(page, { title: 'Fav Alpha' })
  const b = await createPage(page, { title: 'Fav Bravo' })
  const c = await createPage(page, { title: 'Fav Charlie' })
  await star(page, [a, b, c])
  await expect(favTitles(page)).toHaveText(['Fav Alpha', 'Fav Bravo', 'Fav Charlie'])
  const head = favs(page).locator('.sb-sect')
  const h = (await head.boundingBox())!
  await drag(page, favRow(page, 'Fav Charlie'), { x: h.x + 60, y: h.y + h.height * 0.7 }, async () => {
    console.log('section data-drop', await favs(page).getAttribute('data-drop'))
    await page.screenshot({ path: `${SHOTS}/k3-drag-fav-onto-head.png`, clip: { x: 0, y: 0, width: 320, height: 500 } })
  })
  console.log('after dropping Charlie on the head:', await favTitles(page).allInnerTexts())
  // Alpha over the head: goes to the end
  await drag(page, favRow(page, 'Fav Alpha'), { x: h.x + 60, y: h.y + h.height * 0.5 })
  console.log('after dropping Alpha on the head:', await favTitles(page).allInnerTexts())
})

test('K4 drag tree row between favourites when one is expanded', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const a = await createPage(page, { title: 'Fav Alpha' })
  await createPage(page, { title: 'Alpha child', parentId: a })
  const b = await createPage(page, { title: 'Fav Bravo' })
  await createPage(page, { title: 'Loose page' })
  await star(page, [a, b])
  // expand Alpha in favourites
  await favRow(page, 'Fav Alpha').locator('.sb-row__toggle').click({ force: true })
  const child = favs(page).locator('.sb-row', { hasText: 'Alpha child' })
  await expect(child).toBeVisible()
  const r = (await child.boundingBox())!
  await drag(page, sidebarRow(page, 'Loose page'), { x: r.x + 60, y: r.y + r.height * 0.8 }, async () => {
    console.log('drop target over child: section', await favs(page).getAttribute('data-drop'), 'bravo', await favRow(page, 'Fav Bravo').getAttribute('data-drop'))
    await page.screenshot({ path: `${SHOTS}/k4-drag-onto-fav-child.png`, clip: { x: 0, y: 0, width: 320, height: 500 } })
  })
  console.log('after drop on fav child:', await favTitles(page).allInnerTexts())
})

test.describe('iPad docked, coarse pointer', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })
  test('T1 star hidden, ⋯ carries it, drag by touch into FAVORITES', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    await createPage(page, { title: 'Touch page' })
    console.log('media', await page.evaluate(() => ({ hoverNone: matchMedia('(hover: none)').matches, coarse: matchMedia('(pointer: coarse)').matches, sb: document.querySelector('.sb')?.getAttribute('data-state') })))
    const row = sidebarRow(page, 'Touch page')
    await row.scrollIntoViewIfNeeded()
    console.log('star visible?', await row.locator('.sb-row__star').isVisible(), 'more visible?', await row.getByRole('button', { name: 'More' }).isVisible(), 'plus?', await row.locator('.sb-row__btn').count())
    await row.getByRole('button', { name: 'More' }).tap()
    await page.waitForTimeout(300)
    console.log('menu items', await page.getByRole('menuitem').allInnerTexts())
    await page.screenshot({ path: `${SHOTS}/t1-ipad-row-menu.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    console.log('slot text', await favs(page).locator('.sb-favs__how').textContent())
    // long-press drag by CDP touch
    const r = (await row.boundingBox())!
    const slot = (await favs(page).locator('.sb-favs__slot').boundingBox())!
    const before = await page.evaluate(() => [...document.querySelectorAll('.sb section[aria-label="Pages"] .sb-row .sb-row__title')].slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left)))
    const cdp = await page.context().newCDPSession(page)
    const x0 = r.x + 80, y0 = r.y + r.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    await page.waitForTimeout(400)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0, y: y0 - 4 }] })
    await page.waitForTimeout(50)
    const mid = await page.evaluate(() => ({ dragging: document.body.dataset.dragging ?? null, titles: [...document.querySelectorAll('.sb section[aria-label="Pages"] .sb-row .sb-row__title')].slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left)) }))
    console.log('titles left before drag', before, 'after drag start', mid)
    await page.screenshot({ path: `${SHOTS}/t1-ipad-drag-start.png`, clip: { x: 0, y: 0, width: 300, height: 768 } })
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((slot.x + 60 - x0) * i) / 12, y: y0 + ((slot.y + slot.height / 2 - y0) * i) / 12 }] })
      await page.waitForTimeout(30)
    }
    console.log('slot drop?', await favs(page).locator('.sb-favs__slot').getAttribute('data-drop'))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(300)
    console.log('favs after touch drag', await favTitles(page).allInnerTexts())
    await page.screenshot({ path: `${SHOTS}/t1-ipad-after.png`, clip: { x: 0, y: 0, width: 300, height: 768 } })
  })
})

test('D1 drop inside a row after the tree auto-scrolled (and after a wheel scroll)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 })
  await openApp(page)
  await wsEval(page, (s) => {
    for (let i = 0; i < 40; i++) s.createPage({ title: `Scroll page ${String(i).padStart(2, '0')}`, parentId: null })
  })
  await page.waitForTimeout(300)
  const src = sidebarRow(page, 'Team wiki')
  await src.scrollIntoViewIfNeeded()
  const a = (await src.boundingBox())!
  const box = (await page.locator('.sb-scroll').boundingBox())!
  await page.mouse.move(a.x + 60, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 8, { steps: 3 })
  // hold near the bottom edge: auto-scroll
  await page.mouse.move(a.x + 60, box.y + box.height - 6, { steps: 10 })
  const st0 = await page.locator('.sb-scroll').evaluate((el) => el.scrollTop)
  await page.waitForTimeout(900)
  const st1 = await page.locator('.sb-scroll').evaluate((el) => el.scrollTop)
  // back to the middle of the scroller, middle of a row
  await page.mouse.move(a.x + 60, box.y + box.height / 2, { steps: 6 })
  await page.waitForTimeout(150)
  const st2 = await page.locator('.sb-scroll').evaluate((el) => el.scrollTop)
  const info = await page.evaluate((y) => {
    const el = document.elementFromPoint(120, y)?.closest('.sb-row') as HTMLElement | null
    const r = el?.getBoundingClientRect()
    return { title: el?.querySelector('.sb-row__title')?.textContent, rel: r ? (y - r.top) / r.height : null }
  }, box.y + box.height / 2)
  // nudge to exact middle of that row
  const target = sidebarRow(page, info.title!)
  const tb = (await target.boundingBox())!
  await page.mouse.move(a.x + 60, tb.y + tb.height / 2, { steps: 4 })
  await page.mouse.move(a.x + 62, tb.y + tb.height / 2, { steps: 2 })
  await page.waitForTimeout(100)
  console.log('scrollTop', st0, st1, st2, 'pointer over', info, 'data-drop on it =', await target.getAttribute('data-drop'), 'any drop rows', await page.locator('.sb-row[data-drop]').evaluateAll((els) => els.map((e) => `${e.querySelector('.sb-row__title')?.textContent}:${e.getAttribute('data-drop')}`)))
  await page.screenshot({ path: `${SHOTS}/d1-after-autoscroll.png`, clip: { x: 0, y: 0, width: 320, height: 760 } })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const id = await pageIdByTitle(page, 'Team wiki')
  const parent = await wsEval(page, (s, id) => s.pages[id].parentId, id)
  console.log('Team wiki parent after drop', parent ? await wsEval(page, (s, p) => s.pages[p].title, parent) : null)
})

test('K5 Tab walk from Today', async ({ page }) => {
  await openApp(page)
  await page.locator('.sb-nav').getByRole('button', { name: 'Today' }).focus()
  const seq: string[] = []
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    seq.push(await active(page))
  }
  console.log(seq.join('\n'))
  // Shift+Tab back from first fav row
  await favs(page).locator('.sb-row__link').first().focus()
  const back: string[] = []
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+Tab')
    back.push(await active(page))
  }
  console.log('BACK\n' + back.join('\n'))
})

test('K6 unstar from FAVORITES row star: where does focus go', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const a = await createPage(page, { title: 'Fav Alpha' })
  const b = await createPage(page, { title: 'Fav Bravo' })
  await star(page, [a, b])
  const row = favRow(page, 'Fav Alpha')
  await row.hover()
  await row.locator('.sb-row__star').click()
  await page.waitForTimeout(50)
  console.log('right after click:', await active(page))
  await page.waitForTimeout(800)
  console.log('800ms later:', await active(page))
  await page.keyboard.press('Tab')
  console.log('after Tab:', await active(page))
})

test('K7 drag the third favourite up to the top, overshooting onto the head', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const ids = []
  for (const t of ['Fav Alpha', 'Fav Bravo', 'Fav Charlie', 'Fav Delta']) ids.push(await createPage(page, { title: t }))
  await createPage(page, { title: 'Charlie child', parentId: ids[2] })
  await star(page, ids)
  await expect(favTitles(page)).toHaveText(['Fav Alpha', 'Fav Bravo', 'Fav Charlie', 'Fav Delta'])
  const head = (await favs(page).locator('.sb-sect').boundingBox())!
  const first = (await favRow(page, 'Fav Alpha').boundingBox())!
  console.log('head bottom', head.y + head.height, 'first row top', first.y)
  await drag(page, favRow(page, 'Fav Charlie'), { x: head.x + 60, y: head.y + head.height - 4 }, async () => {
    await page.screenshot({ path: `${SHOTS}/k7-fav-over-head.png`, clip: { x: 0, y: 150, width: 300, height: 260 } })
  })
  console.log('after: ', await favTitles(page).allInnerTexts())
  // drop a favourite on its own expanded child
  await favRow(page, 'Fav Alpha').locator('.sb-row__toggle').click({ force: true })
  await page.waitForTimeout(200)
  const ch = await createPage(page, { title: 'Alpha kid', parentId: ids[0] })
  void ch
  const kid = favs(page).locator('.sb-row', { hasText: 'Alpha kid' })
  await expect(kid).toBeVisible()
  const k = (await kid.boundingBox())!
  await drag(page, favRow(page, 'Fav Alpha'), { x: k.x + 60, y: k.y + k.height / 2 })
  console.log('after dropping Alpha on its own child: ', await favTitles(page).allInnerTexts())
})

test('K8 Alt+Down three times quickly (key repeat)', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const ids = []
  for (const t of ['Fav Alpha', 'Fav Bravo', 'Fav Charlie', 'Fav Delta']) ids.push(await createPage(page, { title: t }))
  await star(page, ids)
  await favRow(page, 'Fav Alpha').locator('.sb-row__link').focus()
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    for (let i = 0; i < 3; i++) (document.activeElement ?? el).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(300)
  console.log('synthetic burst:', await favTitles(page).allInnerTexts(), await active(page))
  await favRow(page, 'Fav Alpha').locator('.sb-row__link').focus()
  await page.keyboard.down('Alt')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(300)
  console.log('fast real presses:', await favTitles(page).allInnerTexts(), await active(page))
})

test.describe('zoom', () => {
 test.use({ deviceScaleFactor: 3 })
test('K9 drop lines at the ends of FAVORITES', async ({ page }) => {
  await openApp(page)
  await clearFavs(page)
  const ids = []
  for (const t of ['Fav Alpha', 'Fav Bravo', 'Fav Charlie']) ids.push(await createPage(page, { title: t }))
  await createPage(page, { title: 'Loose page' })
  await star(page, ids)
  const last = (await favRow(page, 'Fav Charlie').boundingBox())!
  await drag(page, sidebarRow(page, 'Loose page'), { x: last.x + 60, y: last.y + last.height * 0.85 }, async () => {
    console.log('last row drop', await favRow(page, 'Fav Charlie').getAttribute('data-drop'))
    await page.screenshot({ path: `${SHOTS}/k9-after-last.png`, clip: { x: 0, y: 200, width: 300, height: 160 } })
  })
  console.log(await favTitles(page).allInnerTexts())
  const first = (await favRow(page, 'Fav Alpha').boundingBox())!
  await createPage(page, { title: 'Loose two' })
  await drag(page, sidebarRow(page, 'Loose two'), { x: first.x + 60, y: first.y + first.height * 0.15 }, async () => {
    console.log('first row drop', await favRow(page, 'Fav Alpha').getAttribute('data-drop'))
    await page.screenshot({ path: `${SHOTS}/k9-before-first.png`, clip: { x: 0, y: 200, width: 300, height: 160 } })
  })
  console.log(await favTitles(page).allInnerTexts())
})
})
