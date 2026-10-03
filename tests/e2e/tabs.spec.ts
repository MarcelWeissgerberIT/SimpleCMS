/** Tabs block: slash insert, add / rename / switch (click + keyboard), view state, reload, share view, Markdown. */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, flush, pageById, reloadApp, MOD } from './fixtures'

const tab = (title: string, ...content: JSONContent[]): JSONContent => ({ type: 'tab', attrs: { title }, content })
const textOf = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('')

/** The tabs blocks of a page's stored content. */
async function storedTabs(page: Page, id: string): Promise<JSONContent[]> {
  const p = await pageById(page, id)
  return ((p.content?.content ?? []) as JSONContent[]).filter((n) => n.type === 'tabs')
}

/** Open the share dialog of the current page and return the link. */
async function shareLink(page: Page): Promise<string> {
  await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const url = dialog.getByRole('textbox', { name: 'Share link' })
  await expect(url).toHaveValue(/#\/s\//)
  return url.inputValue()
}

const shown = (block: Locator) => block.locator('.tab-panel.is-active')
/** Tab titles in strip order (the keys also show a mono index "01"). */
const titles = (block: Locator) => block.locator('[role="tab"] .tabs__title')

test.describe('tabs block', () => {
  test('slash → tabs: add a tab, rename, type in each, switch by click and keyboard; reload keeps it all', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Tabs lab', content: doc(para('Intro line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    await ed.locator('p', { hasText: 'Intro line' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/tabs')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('Tabs')
    await page.keyboard.press('Enter')

    const block = ed.locator('.tabs-block')
    await expect(block.getByRole('tablist')).toBeVisible()
    await expect(block.getByRole('tab')).toHaveCount(1)
    // the caret sits in the first tab
    await page.keyboard.type('Alpha content')
    await expect(shown(block)).toHaveText('Alpha content')

    // "+" adds a tab and opens its title for typing
    await block.getByRole('button', { name: 'Add tab' }).click()
    const title = block.getByRole('textbox', { name: 'Tab title' })
    await expect(title).toBeFocused()
    await page.keyboard.type('Beta')
    await page.keyboard.press('Enter')
    // Enter continues in the new tab's content
    await page.keyboard.type('Beta content')
    await expect(block.getByRole('tab')).toHaveCount(2)
    await expect(block.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    await expect(shown(block)).toHaveText('Beta content')
    await expect(block.getByText('Alpha content')).toBeHidden()

    // rename the first tab (double click)
    await block.getByRole('tab', { name: 'Tab 1' }).dblclick()
    await expect(title).toBeFocused()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('Alpha')
    await page.keyboard.press('Escape')
    await expect(block.getByRole('tab', { name: 'Tab 1' })).toHaveCount(1) // Escape: no rename
    await block.getByRole('tab', { name: 'Tab 1' }).dblclick()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('Alpha')
    await title.press('Tab') // blur commits
    await expect(block.getByRole('tab', { name: 'Alpha' })).toBeVisible()

    // click → that tab's content, the other one hidden
    await block.getByRole('tab', { name: 'Alpha' }).click()
    await expect(shown(block)).toHaveText('Alpha content')
    await expect(block.getByText('Beta content')).toBeHidden()
    await expect(block.getByRole('tabpanel')).toHaveText('Alpha content')

    // keyboard on the strip: roving focus + activation
    await block.getByRole('tab', { name: 'Alpha' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(block.getByRole('tab', { name: 'Beta' })).toBeFocused()
    await expect(block.getByRole('tab', { name: 'Beta' })).toHaveAttribute('tabindex', '0')
    await expect(shown(block)).toHaveText('Beta content')
    await page.keyboard.press('Home')
    await expect(shown(block)).toHaveText('Alpha content')
    await page.keyboard.press('End')
    await expect(shown(block)).toHaveText('Beta content')

    // Mod+Alt+← / → from inside the content
    await shown(block).locator('p').click()
    await page.keyboard.press(`${MOD}+Alt+ArrowLeft`)
    await expect(shown(block)).toHaveText('Alpha content')
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(shown(block)).toHaveText('Alpha content!')
    await page.keyboard.press(`${MOD}+Alt+ArrowRight`)
    await expect(shown(block)).toHaveText('Beta content')

    // stored: both tabs with their titles and content
    await flush(page)
    let tabs = await storedTabs(page, id)
    expect(tabs).toHaveLength(1)
    expect(tabs[0].content!.map((t) => t.attrs?.title)).toEqual(['Alpha', 'Beta'])
    expect(tabs[0].content!.map(textOf)).toEqual(['Alpha content!', 'Beta content'])

    // which tab is shown is view state: switching never writes the document
    const rev = (await pageById(page, id)).contentRev
    await block.getByRole('tab', { name: 'Alpha' }).click()
    await block.getByRole('tab', { name: 'Beta' }).click()
    await flush(page)
    expect((await pageById(page, id)).contentRev).toBe(rev)
    // search / plain text includes every tab
    const plain = (await pageById(page, id)).plain as string
    expect(plain).toContain('Alpha content!')
    expect(plain).toContain('Beta content')

    // reload: all tabs and their content are back
    await reloadApp(page)
    await gotoPage(page, id)
    const again = editorOf(page, id).locator('.tabs-block')
    await expect(titles(again)).toHaveText(['Alpha', 'Beta'])
    await expect(shown(again)).toHaveText('Alpha content!')
    await again.getByRole('tab', { name: 'Beta' }).click()
    await expect(shown(again)).toHaveText('Beta content')
    tabs = await storedTabs(page, id)
    expect(tabs[0].content!.map(textOf)).toEqual(['Alpha content!', 'Beta content'])
  })

  test('tab menu: duplicate, move, delete (with confirmation when it has content)', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Tab menu', content: doc({ type: 'tabs', content: [tab('One', para('first')), tab('Two', para('second'))] }, para('after')) })
    await gotoPage(page, id)
    const block = editorOf(page, id).locator('.tabs-block')
    await block.getByRole('tab', { name: 'Two' }).click()

    const menu = () => block.getByRole('button', { name: /^Tab options/ }).click()
    await menu()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(titles(block)).toHaveText(['One', 'Two', 'Two (copy)'])
    await expect(block.getByRole('tab', { name: 'Two (copy)' })).toHaveAttribute('aria-selected', 'true')

    await menu()
    await page.getByRole('menuitem', { name: 'Move left' }).click()
    await expect(titles(block)).toHaveText(['One', 'Two (copy)', 'Two'])

    await menu()
    await page.getByRole('menuitem', { name: 'Delete tab' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm).toContainText('Two (copy)')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(titles(block)).toHaveText(['One', 'Two'])
    await flush(page)
    const tabs = await storedTabs(page, id)
    expect(tabs[0].content!.map((t) => t.attrs?.title)).toEqual(['One', 'Two'])
  })

  test('shared page shows working tabs; Markdown has every tab and imports back as tabs', async ({ page, browser, context, errors }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await createPage(page, {
      title: 'Shared tabs',
      content: doc(para('Before'), { type: 'tabs', content: [tab('Install', para('npm install one')), tab('Configure', para('Set the API key'), para('Then restart'))] }, para('After')),
    })
    await gotoPage(page, id)
    const link = await shareLink(page)

    // Markdown copy: every tab's title and content
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain('**Install**')
    expect(md).toContain('npm install one')
    expect(md).toContain('**Configure**')
    expect(md).toContain('Set the API key')
    expect(md).toContain('Then restart')
    expect(md.indexOf('npm install one')).toBeLessThan(md.indexOf('Set the API key'))
    await page.keyboard.press('Escape')

    // the Markdown pastes back as a tabs block
    const target = await createPage(page, { title: 'Paste target', content: doc(para('')) })
    await gotoPage(page, target)
    const ed = editorOf(page, target)
    await ed.locator('p').first().click()
    await page.evaluate((text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, md.slice(md.indexOf('<!-- tabs -->')))
    await expect(titles(ed.locator('.tabs-block'))).toHaveText(['Install', 'Configure'])

    // someone else opens the link: read-only, the tabs still switch
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const shared = p2.locator('.shv__doc .tabs-block')
    await expect(titles(shared)).toHaveText(['Install', 'Configure'])
    await expect(shown(shared)).toHaveText('npm install one')
    await expect(p2.getByText('Set the API key')).toBeHidden()
    await shared.getByRole('tab', { name: 'Configure' }).click()
    await expect(shown(shared)).toContainText('Set the API key')
    await expect(p2.getByText('npm install one')).toBeHidden()
    await p2.keyboard.press('ArrowLeft')
    await expect(shown(shared)).toHaveText('npm install one')
    // no editing affordances in the read-only render
    await expect(shared.getByRole('button', { name: 'Add tab' })).toHaveCount(0)
    await expect(p2.locator('[contenteditable="true"]')).toHaveCount(0)
    await other.close()
  })

  test('no tabs inside tabs: "/tabs" in a tab adds the block below it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Nesting', content: doc({ type: 'tabs', content: [tab('Outer', para('inside'))] }) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('.tab-panel p', { hasText: 'inside' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/tabs')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('Tabs')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Tabs can’t go inside tabs')).toBeVisible()
    await expect(ed.locator('.tabs-block')).toHaveCount(2)
    await expect(ed.locator('.tabs-block .tabs-block')).toHaveCount(0)
    await flush(page)
    const top = ((await pageById(page, id)).content.content as JSONContent[]).map((n) => n.type)
    expect(top.filter((t) => t === 'tabs')).toHaveLength(2)
  })
})

test.describe('editor view state', () => {
  test('a page that starts with a bookmark or image opens with nothing selected or focused', async ({ page }) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Starts with a bookmark', content: doc({ type: 'bookmark', attrs: { url: '' } }, para('below')) })
    const b = await createPage(page, { title: 'Starts with an image', content: doc({ type: 'image', attrs: { src: 'assets/covers/dunes.webp', alt: 'Dunes' } }, para('below')) })
    for (const id of [a, b]) {
      await gotoPage(page, id)
      await expect(editorOf(page, id).locator('p', { hasText: 'below' })).toBeVisible()
      await page.waitForTimeout(150)
      await expect(page.locator('#main .is-selected, #main .is-block-selected, #main .ProseMirror-selectednode')).toHaveCount(0)
      // the empty bookmark's URL field must not grab the focus
      expect(await page.evaluate(() => document.activeElement?.closest('.ProseMirror') === null || document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT')
    }
  })
})
