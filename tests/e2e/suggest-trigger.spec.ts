/**
 * "/", "@" and ":" menus open only where the character was just typed (or put there by the "+" key) —
 * never because the caret moved into existing text such as a reference "/r/24772".
 */
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, plainOf, MOD } from './fixtures'

const REF = 'Dossier in Archive: /r/24772 and @home and :smile here'

test.describe('suggestion triggers', () => {
  test('moving the caret through existing "/r/24772", "@home", ":smile" opens no menu', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Refs', content: doc(para(REF)) })
    await gotoPage(page, id)
    const p = editorOf(page, id).locator('p', { hasText: 'Dossier' })
    await p.click()
    await page.keyboard.press('Home')
    for (let i = 0; i < REF.length; i++) {
      await page.keyboard.press('ArrowRight')
      if (i % 4 === 0) await expect(page.locator('.slash, .mention-menu, .emoji-menu, [data-suggest]')).toHaveCount(0)
    }
    // a click right into the reference, after "/r/24"
    const box = await p.boundingBox()
    await page.mouse.click(box!.x + 5, box!.y + box!.height / 2)
    await page.keyboard.press('Home')
    for (let i = 0; i < 'Dossier in Archive: /r/24'.length; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
    await expect(page.locator('.slash')).toBeHidden()
    await expect.poll(() => plainOf(page, id)).toBe(REF)
  })

  test('typing "/" opens the menu; a second "/" (a path) closes it; Esc keeps it closed while typing on', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Typing', content: doc(para('Ref:')) })
    await gotoPage(page, id)
    await editorOf(page, id).locator('p', { hasText: 'Ref:' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' /')
    await expect(page.locator('.slash')).toBeVisible()
    await page.keyboard.type('r/')
    await expect(page.locator('.slash')).toBeHidden()
    await page.keyboard.type('24772')
    await expect(page.locator('.slash')).toBeHidden()
    await expect.poll(() => plainOf(page, id)).toBe('Ref: /r/24772')

    // back into it with the arrow keys: still closed
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(150)
    await expect(page.locator('.slash')).toBeHidden()

    // a fresh "/" opens it, Esc closes it, typing on doesn't reopen it
    await page.keyboard.press('End')
    await page.keyboard.type(' /')
    await expect(page.locator('.slash')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.slash')).toBeHidden()
    await page.keyboard.type('and more')
    await page.waitForTimeout(150)
    await expect(page.locator('.slash')).toBeHidden()
    await expect.poll(() => plainOf(page, id)).toBe('Ref: /r/24772 /and more')
  })

  test('the "+" key and a typed "/" still run commands; undo ⌘Z / redo ⌘⇧Z', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Plus', content: doc(para('First line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const line = ed.locator('p', { hasText: 'First line' })
    await line.hover()
    await page.getByRole('button', { name: 'Add block below' }).click()
    await expect(page.locator('.slash')).toBeVisible()
    await page.keyboard.type('Heading 2')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('Heading 2')
    await page.keyboard.press('Enter')
    await expect(page.locator('.slash')).toBeHidden()
    await page.keyboard.type('Sub title')
    await expect(ed.locator('h3')).toHaveText('Sub title')

    await page.keyboard.press('Enter')
    await page.keyboard.type('/todo')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('To-do list')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Task one')
    await expect(ed.locator('[data-type="taskList"]').first()).toContainText('Task one')

    await page.keyboard.press(`${MOD}+z`)
    await expect(ed).not.toContainText('Task one')
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(ed).toContainText('Task one')
  })
})
