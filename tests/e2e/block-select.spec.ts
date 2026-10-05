/**
 * Visible block selection: the grip stays pinned at the first selected block (no hover), a strong
 * wash on every selected block (images tinted too), a count chip; Shift+click, Shift+↑ / ↓, a drag in
 * the margin, ⌘A twice and (phones) long-press + taps select several; the block menu acts on all of
 * them in one transaction (one ⌘Z); the pinned grip drags the whole range.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Top-level blocks of the stored page as [type, text] (an empty trailing line left out). */
const blocks = (page: Page, id: string) =>
  wsEval(page, (s, id) => {
    const t = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(t).join('')
    const list = ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((n) => [n.type, t(n)])
    const last = list[list.length - 1]
    return last && last[0] === 'paragraph' && !last[1] ? list.slice(0, -1) : list
  }, id)
const selectionJSON = (ed: Locator) => ed.evaluate((el) => (el as HTMLElement & { editor: AnyState }).editor.state.selection.toJSON())
const grip = (page: Page) => page.getByTestId('selection-grip')
const menu = (page: Page) => page.locator('[data-popover][role="menu"]').first()
/** The overlay wash of a selected block (its ::after). */
const washOf = (el: Locator) => el.evaluate((e) => getComputedStyle(e, '::after').backgroundColor)

async function fourLines(page: Page, title: string): Promise<{ id: string; ed: Locator }> {
  const id = await createPage(page, { title, content: doc(para('Alpha line.'), para('Bravo line.'), para('Charlie line.'), para('Delta line.')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await expect(ed.locator('p', { hasText: 'Delta line.' })).toBeVisible()
  return { id, ed }
}

/** Esc on a caret selects its block. */
async function selectBlockOf(page: Page, line: Locator) {
  await line.click()
  await page.keyboard.press('Escape')
}

test.describe('block selection', () => {
  test('click an image: the grip stays without hover, the image is tinted; its menu duplicates it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Image select', content: doc(para('Before the picture.'), { type: 'image', attrs: { src: 'assets/covers/dunes.webp', alt: 'Dunes' } }, para('After the picture.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const img = ed.locator('img').first()
    await expect(img).toBeVisible()
    await img.click({ position: { x: 40, y: 60 } })
    // the pointer leaves the page: the grip stays, next to the image
    await page.mouse.move(5, 450)
    await expect(grip(page)).toBeVisible()
    const imgBox = (await img.boundingBox())!
    const gripBox = (await grip(page).boundingBox())!
    expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(imgBox.x + 2)
    expect(Math.abs(gripBox.y - imgBox.y)).toBeLessThan(30)
    const node = ed.locator('.is-block-selected')
    await expect(node).toHaveCount(1)
    expect(await washOf(node)).toMatch(/rgba\(255, 79, 0, 0\.18\)/)

    await grip(page).getByRole('button', { name: 'Block menu' }).click()
    await expect(menu(page)).toBeVisible()
    await menu(page).getByRole('menuitem', { name: /^Duplicate/ }).click()
    await expect.poll(async () => (await blocks(page, id)).map((b) => b[0])).toEqual(['paragraph', 'image', 'image', 'paragraph'])
  })

  test('Shift+click 3 blocks: count chip, wash on all three; right-click → Delete removes them in one step, ⌘Z brings them back', async ({ page }) => {
    await openApp(page)
    const { id, ed } = await fourLines(page, 'Range select')
    await selectBlockOf(page, ed.locator('p', { hasText: 'Bravo' }))
    await ed.locator('p', { hasText: 'Delta' }).click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('selection-count')).toHaveText('3 blocks · Esc')
    await expect(page.getByTestId('selection-count')).toHaveCSS('text-transform', 'uppercase')
    const selected = ed.locator('.is-block-selected')
    await expect(selected).toHaveText(['Bravo line.', 'Charlie line.', 'Delta line.'])
    for (const i of [0, 1, 2]) expect(await washOf(selected.nth(i))).toMatch(/rgba\(255, 79, 0, 0\.18\)/)
    // the gutter rule runs from the first to the last
    const rule = (await page.locator('.sel-rule').boundingBox())!
    const first = (await selected.first().boundingBox())!
    const last = (await selected.last().boundingBox())!
    expect(rule.y).toBeLessThanOrEqual(first.y + 1)
    expect(rule.y + rule.height).toBeGreaterThanOrEqual(last.y + last.height - 1)

    await ed.locator('p', { hasText: 'Charlie' }).click({ button: 'right' })
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).locator('.menu-section, [role="presentation"]').first()).toContainText(/3 blocks/i)
    await menu(page).getByRole('menuitem', { name: /^Delete/ }).click()
    await expect.poll(() => blocks(page, id)).toEqual([['paragraph', 'Alpha line.']])

    await ed.focus()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => blocks(page, id)).toEqual([
      ['paragraph', 'Alpha line.'],
      ['paragraph', 'Bravo line.'],
      ['paragraph', 'Charlie line.'],
      ['paragraph', 'Delta line.'],
    ])

    // Shift+click on another block's grip grows the selection too
    await selectBlockOf(page, ed.locator('p', { hasText: 'Charlie' }))
    await ed.locator('p', { hasText: 'Alpha' }).hover()
    const hoverGrip = page.locator('.block-handle-wrap .block-handle__grip')
    await expect(hoverGrip).toBeVisible()
    await page.waitForTimeout(150)
    const hg = (await hoverGrip.boundingBox())!
    await page.mouse.move(hg.x + hg.width / 2, hg.y + hg.height / 2, { steps: 4 })
    await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect(ed.locator('.is-block-selected')).toHaveText(['Alpha line.', 'Bravo line.', 'Charlie line.'])
    await expect(menu(page)).toHaveCount(0)
  })

  test('keyboard: Esc selects, Shift+↓ / ↑ grow and shrink from the anchor, Alt+Enter → Duplicate all, Esc leaves, ⌘A twice selects every block', async ({ page }) => {
    await openApp(page)
    const { id, ed } = await fourLines(page, 'Keys select')
    await selectBlockOf(page, ed.locator('p', { hasText: 'Bravo' }))
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(ed.locator('.is-block-selected')).toHaveText(['Bravo line.', 'Charlie line.', 'Delta line.'])
    await page.keyboard.press('Shift+ArrowUp')
    await expect(ed.locator('.is-block-selected')).toHaveText(['Bravo line.', 'Charlie line.'])
    // typing never replaces selected blocks
    await page.keyboard.type('x')
    await expect.poll(async () => (await blocks(page, id)).length).toBe(4)

    await page.keyboard.press('Alt+Enter')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.type('dupl')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await blocks(page, id)).map((b) => b[1])).toEqual(['Alpha line.', 'Bravo line.', 'Charlie line.', 'Bravo line.', 'Charlie line.', 'Delta line.'])
    // the copies are selected now; one ⌘Z takes them away again
    await expect(ed.locator('.is-block-selected')).toHaveCount(2)
    await ed.focus()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await blocks(page, id)).length).toBe(4)

    // Esc leaves the selection (a caret in the text again)
    await selectBlockOf(page, ed.locator('p', { hasText: 'Alpha' }))
    await page.keyboard.press('Shift+ArrowDown')
    await expect(ed.locator('.is-block-selected')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(ed.locator('.is-block-selected')).toHaveCount(0)
    await expect(grip(page)).toHaveCount(0)
    expect((await selectionJSON(ed)).type).toBe('text')

    // ⌘A: all text, ⌘A again: every block
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.press(`${MOD}+a`)
    await expect(ed.locator('.is-block-selected')).toHaveCount(4)
    await expect(page.getByTestId('selection-count')).toHaveText('4 blocks · Esc')
  })

  test('the block menu on a range: Turn into → Heading 2 for all, Turn into page, Move to — each one step', async ({ page }) => {
    await openApp(page)
    const target = await createPage(page, { title: 'Archive shelf' })
    const { id, ed } = await fourLines(page, 'Range menu')
    await selectBlockOf(page, ed.locator('p', { hasText: 'Alpha' }))
    await page.keyboard.press('Shift+ArrowDown')
    await page.mouse.move(5, 450)
    await grip(page).getByRole('button', { name: 'Block menu · 2 blocks' }).click()
    await menu(page).getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Heading 2/ }).click()
    await expect.poll(() => blocks(page, id)).toEqual([
      ['heading', 'Alpha line.'],
      ['heading', 'Bravo line.'],
      ['paragraph', 'Charlie line.'],
      ['paragraph', 'Delta line.'],
    ])

    // Turn into page from the range's menu
    await selectBlockOf(page, ed.locator('p', { hasText: 'Charlie' }))
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(async () => (await blocks(page, id)).map((b) => b[0])).toEqual(['heading', 'heading', 'pageLink'])

    // Move to another page: both headings go there
    await selectBlockOf(page, ed.locator('h3, h2', { hasText: 'Alpha' }))
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Alt+Enter')
    await menu(page).getByRole('menuitem', { name: /^Move to/ }).click()
    await page.getByPlaceholder('Move block to page…').fill('Archive shelf')
    await page.getByRole('menuitem', { name: 'Archive shelf' }).click()
    await expect.poll(async () => (await blocks(page, id)).map((b) => b[0])).toEqual(['pageLink'])
    await expect.poll(async () => (await blocks(page, target)).map((b) => b[1])).toEqual(['Alpha line.', 'Bravo line.'])
  })

  test('drag the pinned grip: the whole range moves; a drag in the margin selects blocks', async ({ page }) => {
    await openApp(page)
    const { id, ed } = await fourLines(page, 'Drag select')
    // margin drag from Alpha to Bravo (left of the text)
    const a = (await ed.locator('p', { hasText: 'Alpha' }).boundingBox())!
    const b = (await ed.locator('p', { hasText: 'Bravo' }).boundingBox())!
    await page.mouse.move(a.x - 20, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x - 20, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(ed.locator('.is-block-selected')).toHaveText(['Alpha line.', 'Bravo line.'])

    // drag them below Delta by the pinned grip
    await page.mouse.move(5, 450)
    const g = (await grip(page).getByRole('button', { name: 'Block menu · 2 blocks' }).boundingBox())!
    const d = (await ed.locator('p', { hasText: 'Delta' }).boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y + 12, { steps: 4 })
    await page.mouse.move(d.x + 40, d.y + d.height - 2, { steps: 15 })
    await page.mouse.up()
    await expect.poll(async () => (await blocks(page, id)).map((x) => x[1])).toEqual(['Charlie line.', 'Delta line.', 'Alpha line.', 'Bravo line.'])
  })

  test('inside a column: Shift+↓ stays in the column; deleting all its blocks leaves an empty line there', async ({ page }) => {
    await openApp(page)
    const column = (...content: AnyState[]) => ({ type: 'column', content })
    const id = await createPage(page, { title: 'Column select', content: doc({ type: 'columns', content: [column(para('Left one.'), para('Left two.')), column(para('Right one.'))] }, para('After the columns.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await selectBlockOf(page, ed.locator('p', { hasText: 'Left one.' }))
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(ed.locator('.is-block-selected')).toHaveText(['Left one.', 'Left two.'])
    await page.keyboard.press('Alt+Enter')
    await page.keyboard.type('delete')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => wsEval(page, (s, id) => (s.pages[id].content.content[0].content as AnyState[]).map((c) => (c.content as AnyState[]).map((n) => n.type + ':' + ((n.content ?? []).map((x: AnyState) => x.text).join('')))), id))
      .toEqual([['paragraph:'], ['paragraph:Right one.']])
  })

  test('German: chip, menu heading and actions', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const { ed } = await fourLines(page, 'Auswahl')
    await selectBlockOf(page, ed.locator('p', { hasText: 'Alpha' }))
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.getByTestId('selection-count')).toHaveText('3 Blöcke · Esc')
    await page.keyboard.press('Alt+Enter')
    await expect(menu(page)).toContainText(/3 Blöcke/i)
    await expect(menu(page).getByRole('menuitem', { name: /^Duplizieren/ })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: /^In Datenbank umwandeln…/ })).toBeVisible()
  })
})

test.describe('block selection on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('long-press the grip selects the block, taps extend, the pinned grip (with a count) opens the menu; no overflow', async ({ page, context }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Phone select', content: doc(heading(2, 'Phone list'), para('One on the phone.'), para('Two on the phone.'), para('Three on the phone.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'One on' }).tap()
    const touchGrip = page.locator('.touch-grip')
    await expect(touchGrip).toBeVisible()
    const box = (await touchGrip.boundingBox())!
    const cdp = await context.newCDPSession(page)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await page.waitForTimeout(650)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(ed.locator('.is-block-selected')).toHaveText(['One on the phone.'])
    await expect(menu(page)).toHaveCount(0)

    await ed.locator('p', { hasText: 'Three on' }).tap()
    await expect(ed.locator('.is-block-selected')).toHaveText(['One on the phone.', 'Two on the phone.', 'Three on the phone.'])
    await expect(page.getByTestId('selection-count')).toHaveText('3')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await grip(page).getByRole('button', { name: 'Block menu · 3 blocks' }).tap()
    await expect(menu(page)).toBeVisible()
    const m = (await menu(page).boundingBox())!
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(390)
    await menu(page).getByRole('menuitem', { name: /^Delete/ }).tap()
    await expect.poll(async () => (await blocks(page, id)).map((b) => b[1])).toEqual(['Phone list'])
  })
})
