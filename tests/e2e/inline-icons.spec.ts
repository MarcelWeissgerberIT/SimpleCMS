/**
 * /emoji opens a real emoji picker; /icon inserts inline icons (ceramic objects, lucide glyphs with a
 * colour): search EN + DE, keyboard only, change / remove, undo, copy & paste, Markdown + HTML export,
 * share dialog HTML download, website export, share link, reload, 390 px.
 */
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, reloadApp, gotoPage, editorOf, createPage, doc, para, flush, pageById, MOD } from './fixtures'

/** Run a slash command by its label. */
async function slash(page: Page, query: string, label: string) {
  await page.keyboard.type(`/${query}`)
  const menu = page.locator('.slash')
  await expect(menu.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText(label)
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
}

/** Inline nodes of the first paragraph (text runs and icons) as compact strings. */
async function firstLine(page: Page, id: string): Promise<string[]> {
  await flush(page)
  const content: JSONContent = (await pageById(page, id)).content
  return (content.content?.[0]?.content ?? []).map((n) => (n.type === 'text' ? n.text! : `<${n.type} ${n.attrs?.kind}:${n.attrs?.name}${n.attrs?.color ? `@${n.attrs.color}` : ''}>`))
}

const icon = (kind: string, name: string, color?: string) => ({ type: 'icon', attrs: { kind, name, color: color ?? null } })

/** Caret to the end of the first paragraph. */
async function caretAtEnd(page: Page, ed: Locator) {
  await ed.locator('p').first().click()
  await page.keyboard.press('End')
}

test.describe('inline emoji & icons', () => {
  test('/emoji: picker opens with focus in search, "rocket" ↵ inserts 🚀 at the caret, Esc returns focus, recent first', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Emoji line', content: doc(para('Launch')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await caretAtEnd(page, ed)
    await page.keyboard.type(' ')

    await slash(page, 'emoji', 'Emoji')
    const picker = page.getByRole('dialog', { name: 'Emoji' })
    await expect(picker).toBeVisible()
    const search = picker.getByRole('searchbox', { name: 'Search emoji' })
    await expect(search).toBeFocused()
    // categories render (the full set, not a shortcode menu)
    await expect(picker.locator('.ipk-emoji__category:visible').first()).toBeVisible()
    await page.keyboard.type('rocket')
    await expect(picker.getByRole('option', { selected: true })).toHaveText('🚀')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()
    await expect(ed).toBeFocused()
    await page.keyboard.type(' now ')
    expect(await firstLine(page, id)).toEqual(['Launch 🚀 now '])

    // Esc: closes, the caret is back where the command was typed
    await slash(page, 'emoji', 'Emoji')
    await expect(picker.getByRole('searchbox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(ed).toBeFocused()
    await page.keyboard.type('! ')
    expect(await firstLine(page, id)).toEqual(['Launch 🚀 now ! '])

    // arrows move through the results; recent emoji lead the next opening
    await slash(page, 'emoji', 'Emoji')
    await expect(picker.locator('.ipk-emoji__category:visible').first()).toHaveText('Recent')
    await page.keyboard.type('heart')
    const first = await picker.getByRole('option', { selected: true }).textContent()
    await page.keyboard.press('ArrowRight')
    const second = await picker.getByRole('option', { selected: true }).textContent()
    expect(second).not.toBe(first)
    await page.keyboard.press('Enter')
    expect((await firstLine(page, id)).join('')).toBe(`Launch 🚀 now ! ${second}`)

    // the ":" shortcode menu still works as before
    await page.keyboard.type(' :tada')
    await expect(page.locator('.emoji-menu')).toBeVisible()
    // the emoji data loads lazily: ↵ only picks once the results are there
    await expect(page.locator('.emoji-menu__cell[aria-selected="true"]')).toHaveText('🎉')
    await page.keyboard.press('Enter')
    expect((await firstLine(page, id)).join('')).toContain('🎉')
  })

  test('/icon: objects by name in English and German, glyphs with a colour, inline in the text; undo; reload', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Icon line', content: doc(para('Standup')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await caretAtEnd(page, ed)
    await page.keyboard.type(' ')

    await slash(page, 'icon', 'Icon')
    const picker = page.getByRole('dialog', { name: 'Icon' })
    await expect(picker.getByRole('tab', { name: 'Objects' })).toHaveAttribute('aria-selected', 'true')
    await expect(picker.getByRole('combobox', { name: 'Search icons' })).toBeFocused()
    await page.keyboard.type('clock')
    await expect(picker.getByRole('option', { selected: true })).toHaveAttribute('data-name', 'clock')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()
    await page.keyboard.type(' at 10 ')

    // German word for the same object
    await slash(page, 'icon', 'Icon')
    await page.keyboard.type('Uhr')
    await expect(picker.getByRole('option', { selected: true })).toHaveAttribute('data-name', 'clock')
    await page.keyboard.press('Escape')
    await expect(ed).toBeFocused()

    // glyph tab, red, "rocket"
    await slash(page, 'icon', 'Icon')
    await picker.getByRole('tab', { name: 'Glyphs' }).click()
    await picker.getByRole('radio', { name: 'Red' }).click()
    await picker.getByRole('combobox', { name: 'Search icons' }).fill('rocket')
    await expect(picker.getByRole('option', { selected: true })).toHaveAttribute('data-name', 'rocket')
    await picker.getByRole('combobox', { name: 'Search icons' }).press('Enter')
    await expect(picker).toBeHidden()
    await page.keyboard.type(' go')

    expect(await firstLine(page, id)).toEqual(['Standup ', '<icon asset:clock>', ' at 10 ', '<icon lucide:rocket@red>', ' go'])
    // rendered inline, line-sized, the glyph as SVG in its colour
    const clock = ed.locator('.one-icon--asset[data-name="clock"]')
    await expect(clock.locator('img')).toHaveAttribute('src', /assets\/icons\/clock\.webp$/)
    const rocket = ed.locator('.one-icon--lucide[data-name="rocket"]')
    await expect(rocket.locator('svg path').first()).toBeAttached()
    await expect(rocket).toHaveAttribute('data-color', 'red')
    const box = (await rocket.boundingBox())!
    const line = (await ed.locator('p').first().boundingBox())!
    expect(box.height).toBeGreaterThan(14)
    expect(box.height).toBeLessThan(line.height)

    // undo takes the glyph back (with the text typed right after it), redo restores it
    for (let i = 0; i < 3 && (await ed.locator('.one-icon--lucide').count()) > 0; i++) await page.keyboard.press(`${MOD}+z`)
    await expect(ed.locator('.one-icon--lucide')).toHaveCount(0)
    await expect(clock).toHaveCount(1)
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(rocket).toHaveCount(1)
    await expect.poll(async () => (await firstLine(page, id)).filter((s) => s.startsWith('<icon'))).toEqual(['<icon asset:clock>', '<icon lucide:rocket@red>'])

    await reloadApp(page)
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.one-icon--lucide[data-name="rocket"] svg')).toBeVisible()
    await expect(editorOf(page, id).locator('.one-icon--asset[data-name="clock"] img')).toBeVisible()
  })

  test('click an icon → change colour and icon, remove; ↵ on a selected icon opens it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Edit icons', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Status ' }, icon('lucide', 'check'), { type: 'text', text: ' done' }] }) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const glyph = ed.locator('.one-icon[data-name="check"]')
    await glyph.click()
    await expect(glyph).toHaveClass(/ProseMirror-selectednode/)
    const popover = page.getByRole('dialog', { name: 'Change icon' })
    await expect(popover).toBeVisible()
    await expect(popover.getByRole('tab', { name: 'Glyphs' })).toHaveAttribute('aria-selected', 'true')
    await expect(popover.getByRole('option', { selected: true })).toHaveAttribute('data-name', 'check')
    // colour applies right away
    await popover.getByRole('radio', { name: 'Green' }).click()
    expect(await firstLine(page, id)).toEqual(['Status ', '<icon lucide:check@green>', ' done'])
    // another glyph keeps the colour
    await popover.getByRole('combobox', { name: 'Search icons' }).fill('star')
    await page.keyboard.press('Enter')
    await expect(popover).toBeHidden()
    expect(await firstLine(page, id)).toEqual(['Status ', '<icon lucide:star@green>', ' done'])

    // keyboard: the icon is still selected → ↵ opens it, Esc closes with the icon still selected
    await page.keyboard.press('Enter')
    await expect(popover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(ed.locator('.one-icon[data-name="star"]')).toHaveClass(/ProseMirror-selectednode/)

    // an object instead, then remove
    await ed.locator('.one-icon[data-name="star"]').click()
    await popover.getByRole('tab', { name: 'Objects' }).click()
    await popover.getByRole('combobox', { name: 'Search icons' }).fill('compass')
    await page.keyboard.press('Enter')
    expect(await firstLine(page, id)).toEqual(['Status ', '<icon asset:compass>', ' done'])
    await ed.locator('.one-icon[data-name="compass"]').click()
    await popover.getByRole('button', { name: 'Remove icon' }).click()
    await expect(popover).toBeHidden()
    expect(await firstLine(page, id)).toEqual(['Status  done'])
  })

  test('copy & paste inside One keeps icons; plain text says what they are; Markdown paste turns back into icons', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Clipboard icons',
      content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Due ' }, icon('asset', 'clock'), { type: 'text', text: ' ok ' }, icon('lucide', 'check', 'green')] }, para('')),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('.one-icon--lucide svg')).toBeAttached()
    // copy the first line (keyboard selection), capture what One puts on the clipboard
    await ed.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.evaluate(() => {
      window.addEventListener('copy', (e) => ((window as unknown as { __copied: object }).__copied = { text: e.clipboardData!.getData('text/plain'), html: e.clipboardData!.getData('text/html') }), { once: true })
    })
    await page.keyboard.press(`${MOD}+c`)
    const copied = await page.evaluate(() => (window as unknown as { __copied: { text: string; html: string } }).__copied)
    expect(copied.text).toBe('Due [Clock] ok :check:')
    expect(copied.html).toContain('data-type="icon"')

    // paste into the empty second line → the icons come back as icons
    await ed.locator('p').nth(1).click()
    await page.evaluate(({ text, html }) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      dt.setData('text/html', html)
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, copied)
    await expect(ed.locator('.one-icon[data-name="clock"]')).toHaveCount(2)
    await expect(ed.locator('.one-icon[data-name="check"][data-color="green"]')).toHaveCount(2)

    // Markdown text (as the exports write it) pasted → icons again
    await page.keyboard.press(`${MOD}+End`)
    await page.keyboard.press('Enter')
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'Ship :icon-rocket@orange: with ![Hammer](assets/icons/hammer.webp) **now**')
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(ed.locator('.one-icon--lucide[data-name="rocket"][data-color="orange"]')).toHaveCount(1)
    await expect(ed.locator('.one-icon--asset[data-name="hammer"]')).toHaveCount(1)
  })

  test('exports and share link: Markdown, standalone HTML and the shared page show the icons', async ({ page, browser, context, errors }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await createPage(page, {
      title: 'Shared icons',
      content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Book ' }, icon('asset', 'book'), { type: 'text', text: ' and ship ' }, icon('lucide', 'rocket', 'red'), { type: 'text', text: ' today' }] }),
    })
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.one-icon--lucide svg')).toBeAttached()

    // Markdown (share dialog → Copy as Markdown)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain('Book ![Book](assets/icons/book.webp) and ship :icon-rocket@red: today')
    const link = await dialog.getByRole('textbox', { name: 'Share link' }).inputValue()
    // share dialog → Download as HTML: the object travels inside the file too
    const shareDownload = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /Download as HTML/ }).click()
    const shareFile = testInfo.outputPath('icons-share.html')
    await (await shareDownload).saveAs(shareFile)
    expect(readFileSync(shareFile, 'utf8')).toMatch(/<span[^>]*data-name="book"[^>]*><img src="data:image\/webp;base64,/)
    await page.keyboard.press('Escape')

    // standalone HTML (Export → Web page): the object inlined as an image, the glyph as SVG
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const exp = page.getByRole('dialog')
    await exp.getByRole('radio', { name: /Web page/ }).click()
    const download = page.waitForEvent('download')
    await exp.locator('[data-export-run]').click()
    const file = testInfo.outputPath('icons.html')
    await (await download).saveAs(file)
    const html = readFileSync(file, 'utf8')
    expect(html).toMatch(/<span[^>]*data-name="book"[^>]*data-type="icon"[^>]*><img src="data:image\/webp;base64,/)
    expect(html).toMatch(/<span[^>]*data-name="rocket"[^>]*data-color="red"[^>]*><svg[^>]*viewBox="0 0 24 24"[^>]*>(<path|<circle)/)
    await page.keyboard.press('Escape')

    // website export: the object's file is part of the site and the page points at it
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const siteDialog = page.getByRole('dialog')
    await siteDialog.getByRole('radio', { name: /Website/ }).click()
    const siteDownload = page.waitForEvent('download')
    await siteDialog.locator('[data-export-run]').click()
    const files = unzipSync(new Uint8Array(readFileSync((await (await siteDownload).path())!)))
    const icons = Object.keys(files).filter((f) => f.endsWith('icons/book.webp'))
    expect(icons, 'the icon file is in the site').toHaveLength(1)
    const pageFile = Object.keys(files).find((f) => f.endsWith('.html') && strFromU8(files[f]).includes('data-name="book"'))
    expect(pageFile, 'a page shows the icon').toBeDefined()
    expect(strFromU8(files[pageFile!])).toMatch(/data-name="book"[^>]*><img src="[^"]*icons\/book\.webp"/)
    await page.keyboard.press('Escape')

    // share link: another browser renders both
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const shared = p2.locator('.shv__doc')
    await expect(shared).toContainText('and ship')
    await expect(shared.locator('.one-icon--asset[data-name="book"] img')).toBeVisible()
    await expect(shared.locator('.one-icon--lucide[data-name="rocket"] svg')).toBeVisible()
    // read-only: a click does not open the picker
    await shared.locator('.one-icon--lucide').click()
    await expect(p2.locator('.ipk')).toHaveCount(0)
    await other.close()
  })

  test('keyboard only at 390 px: insert an object and a coloured glyph without the mouse', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    const id = await createPage(page, { title: 'Phone icons', content: doc(para('Go')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await caretAtEnd(page, ed)
    await page.keyboard.type(' ')

    await slash(page, 'icon', 'Icon')
    const picker = page.getByRole('dialog', { name: 'Icon' })
    const box = (await picker.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await page.keyboard.type('compass')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()

    await slash(page, 'icon', 'Icon')
    // Shift+Tab → the tabs; → switches to Glyphs; Tab → search; Tab → colour row; → picks a colour
    await page.keyboard.press('Shift+Tab')
    await expect(picker.getByRole('tab', { name: 'Objects' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(picker.getByRole('tab', { name: 'Glyphs' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Tab')
    await expect(picker.getByRole('combobox', { name: 'Search icons' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(picker.getByRole('radio', { name: 'Text colour' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(picker.getByRole('radio', { name: 'Brown' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type('flag')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()
    expect(await firstLine(page, id)).toEqual(['Go ', '<icon asset:compass>', '<icon lucide:flag@brown>'])
  })
})
