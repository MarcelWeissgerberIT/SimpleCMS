import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, editorOf, createPage, doc, para, wsEval, allTypes, flush, plainOf, waitForPlain, MOD } from './fixtures'

/** Type a slash command and run the first (active) match. */
async function slash(page: Page, query: string, expectLabel: string | RegExp) {
  await page.keyboard.type(`/${query}`)
  const menu = page.locator('.slash')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText(expectLabel)
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
}

/** Caret to the end of the document (the trailing empty paragraph after a block). */
async function toDocEnd(page: Page) {
  await page.keyboard.press(`${MOD}+End`)
}

test.describe('editor', () => {
  test('new page from the sidebar: markdown shortcuts + slash blocks persist after reload', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb-newpage').click()
    const title = page.locator('#main .pv-title')
    await expect(title).toBeFocused()
    await expect(title).toHaveValue('')
    await page.keyboard.type('E2E editor page')
    await page.keyboard.press('Enter')
    const ed = editorOf(page)
    await expect(ed).toBeFocused()

    // markdown shortcuts
    await page.keyboard.type('# Big heading')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- bullet one')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[] todo one')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('> quoted text')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect(ed.locator('h1')).toHaveText('Big heading')
    await expect(ed.locator('ul:not([data-type="taskList"]) li')).toHaveText('bullet one')
    await expect(ed.locator('[data-type="taskList"] li, ul.task-list li, li[data-checked]').first()).toContainText('todo one')
    await expect(ed.locator('blockquote')).toHaveText('quoted text')

    // slash menu blocks
    await slash(page, 'Heading 2', 'Heading 2')
    await page.keyboard.type('Slash heading')
    await page.keyboard.press('Enter')

    await slash(page, 'todo', 'To-do list')
    await page.keyboard.type('slash todo')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await slash(page, 'toggle', 'Toggle list')
    await page.keyboard.type('Toggle title')
    await page.keyboard.press('Enter')
    await page.keyboard.type('toggle body')
    await toDocEnd(page)

    await slash(page, 'divider', 'Divider')

    await toDocEnd(page)
    await slash(page, 'callout', 'Callout')
    await page.keyboard.type('callout text')
    await toDocEnd(page)

    await slash(page, 'code', 'Code')
    await page.keyboard.type('const answer = 42')
    await toDocEnd(page)

    await slash(page, 'table', 'Table')
    await page.keyboard.type('cell A1')
    await toDocEnd(page)
    await page.keyboard.type('The end.')

    const id = await page.evaluate(() => window.location.hash.split('/')[2])
    await waitForPlain(page, id, /The end\./)
    const types = await allTypes(page, id)
    for (const t of ['heading', 'bulletList', 'taskList', 'blockquote', 'details', 'detailsSummary', 'detailsContent', 'horizontalRule', 'callout', 'codeBlock', 'table'])
      expect(types, `node type ${t} in stored doc`).toContain(t)

    await reloadApp(page)
    await expect(title).toHaveValue('E2E editor page')
    const ed2 = editorOf(page, id)
    await expect(ed2.locator('h1')).toHaveText('Big heading')
    await expect(ed2.locator('h2')).toHaveText('Slash heading')
    await expect(ed2.locator('blockquote')).toHaveText('quoted text')
    await expect(ed2).toContainText('bullet one')
    await expect(ed2).toContainText('todo one')
    await expect(ed2).toContainText('slash todo')
    await expect(ed2).toContainText('Toggle title')
    await expect(ed2).toContainText('toggle body')
    await expect(ed2.locator('hr')).toHaveCount(1)
    await expect(ed2).toContainText('callout text')
    await expect(ed2.locator('pre')).toContainText('const answer = 42')
    await expect(ed2.locator('table')).toContainText('cell A1')
    await expect(ed2).toContainText('The end.')
    // page appears in the sidebar under its new title
    await expect(page.locator('.sb .sb-row__title', { hasText: 'E2E editor page' })).toBeVisible()
  })

  test('text typed right before a reload is not lost', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Quick reload', content: doc(para('first line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'first line' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' plus a fast edit')
    // a user hitting reload immediately: no explicit flush, no debounce wait
    await page.waitForTimeout(50)
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    await expect(editorOf(page, id)).toContainText('first line plus a fast edit')
  })

  test('drag-handle block menu: duplicate and delete blocks', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Block menu', content: doc(para('Alpha block'), para('Beta block'), para('Gamma block')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('p', { hasText: 'Gamma block' })).toBeVisible()

    const openBlockMenu = async (text: string) => {
      await ed.locator('p', { hasText: text }).first().hover()
      const grip = page.getByRole('button', { name: 'Block menu' })
      await expect(grip).toBeVisible()
      await grip.click()
      const menu = page.locator('[data-popover][role="menu"]').filter({ has: page.getByRole('menuitem', { name: /^Duplicate/ }) })
      await expect(menu).toBeVisible()
      return menu
    }

    let menu = await openBlockMenu('Beta block')
    await menu.getByRole('menuitem', { name: /^Duplicate/ }).click()
    await expect(ed.locator('p', { hasText: 'Beta block' })).toHaveCount(2)

    menu = await openBlockMenu('Gamma block')
    await menu.getByRole('menuitem', { name: /^Delete/ }).click()
    await expect(ed.locator('p', { hasText: 'Gamma block' })).toHaveCount(0)

    await expect.poll(() => plainOf(page, id)).not.toContain('Gamma')
    const plain = await plainOf(page, id)
    expect(plain.match(/Beta block/g)?.length).toBe(2)
    expect(plain).toContain('Alpha block')
    await flush(page)
    const order = await wsEval(page, (s, id) => (s.pages[id].content.content as Array<Record<string, any>>).map((n) => n.content?.[0]?.text ?? ''), id)
    expect(order.filter(Boolean)).toEqual(['Alpha block', 'Beta block', 'Beta block'])
  })
})

test.describe('editor: inline features', () => {
  test('"@" mention of a page links to it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Mentions', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await page.keyboard.type('See @Glossa')
    const menu = page.locator('[role="listbox"]').filter({ has: page.locator('[role="option"]', { hasText: 'Glossary' }) })
    await expect(menu).toBeVisible()
    await expect(menu.locator('[role="option"][aria-selected="true"]')).toContainText('Glossary')
    await page.keyboard.press('Enter')
    const mention = ed.locator('[data-type="mention"], .mention').filter({ hasText: 'Glossary' }).first()
    await expect(mention).toBeVisible()
    await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)).toContain('"kind":"page"')
    await mention.click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Glossary')
    // backlink shows on the target
    await expect(page.locator('#main .pv-foot')).toContainText('Mentions')
  })

  test('pasting Markdown text turns it into blocks', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Paste target', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await ed.evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', '## Pasted heading\n\n- first\n- second\n\n**strong** text with `code`\n')
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(ed.locator('h2')).toHaveText('Pasted heading')
    await expect(ed.locator('ul li')).toHaveCount(2)
    await expect(ed.locator('strong')).toHaveText('strong')
    await expect(ed.locator('code')).toHaveText('code')
    await expect.poll(() => allTypes(page, id)).toContain('bulletList')
  })
})

test.describe('editor in German', () => {
  test.use({ locale: 'de-DE' })
  test('slash menu searches German block names', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Deutsch', content: doc(para('')) })
    await gotoPage(page, id)
    await editorOf(page, id).locator('p').first().click()
    await slash(page, 'überschrift 2', 'Überschrift 2')
    await page.keyboard.type('Zwischentitel')
    await page.keyboard.press('Enter')
    await slash(page, 'aufgabe', 'To-do-Liste')
    await expect(editorOf(page, id).locator('h2')).toHaveText('Zwischentitel')
    await expect(editorOf(page, id).locator('[data-type="taskList"], ul[data-type="taskList"]').first()).toBeVisible()
  })
})
