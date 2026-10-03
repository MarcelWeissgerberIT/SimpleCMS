import { readFileSync } from 'node:fs'
import { test, expect, openApp, gotoPage, createPage, doc, para, wsEval, pageById, editorOf } from './fixtures'

const naturalWidth = (img: import('@playwright/test').Locator) => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))

test.describe('images', () => {
  test('upload an image: stored locally, survives a reload, travels inside a share link', async ({ page, browser, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Photo page', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await page.keyboard.type('/image')
    await expect(page.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Image')
    await page.keyboard.press('Enter')
    const chooser = page.waitForEvent('filechooser')
    await ed.getByRole('button', { name: 'Upload' }).click()
    await (await chooser).setFiles([{ name: 'cover.webp', mimeType: 'image/webp', buffer: readFileSync('public/assets/covers/dunes.webp') }])
    const img = ed.locator('img').first()
    await expect.poll(() => naturalWidth(img), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)).toContain('onefile:')

    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const img2 = editorOf(page, id).locator('img').first()
    await expect.poll(() => naturalWidth(img2), { timeout: 10_000 }).toBeGreaterThan(0)

    // share: the image is inlined into the link
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const url = page.getByRole('dialog').getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    await expect(page.getByRole('dialog')).toContainText('Images inside the link: 1')
    const link = await url.inputValue()
    const other = await browser.newContext({ serviceWorkers: 'block' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    await expect(p2.locator('.shv__title')).toHaveText('Photo page')
    await expect.poll(() => naturalWidth(p2.locator('.shv__doc img').first()), { timeout: 10_000 }).toBeGreaterThan(0)
    await other.close()
  })
})

test.describe('share a rich page', () => {
  test('the seeded welcome page shares with its database, diagram and math flattened in', async ({ page, browser, errors }) => {
    await openApp(page)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const url = page.getByRole('dialog').getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    const other = await browser.newContext({ serviceWorkers: 'block' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const docEl = p2.locator('.shv__doc')
    await expect(p2.locator('.shv__title')).toHaveText('Welcome to One')
    await expect(docEl).toContainText('No account, no server, no subscription.')
    // the embedded Projects database arrives as a table snapshot
    await expect(docEl.locator('table').filter({ hasText: 'Website relaunch' })).toBeVisible()
    await expect(docEl).toContainText('@Projects')
    await docEl.locator('.katex').first().scrollIntoViewIfNeeded()
    await expect(docEl.locator('.katex').first()).toBeVisible()
    await expect(docEl.locator('svg').first()).toBeAttached({ timeout: 15_000 })
    await p2.getByRole('button', { name: /Save to my workspace/ }).click()
    await expect(p2.locator('#main .pv-title')).toHaveValue('Welcome to One')
    // the saved copy has no dangling database embed
    await expect(p2.locator('#main .ProseMirror')).not.toContainText('Database not found')
    await other.close()
  })
})

test.describe('routes and chrome', () => {
  test('home, not-found and status bar toggles', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Home/ }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('#main')).toContainText('Recently visited')
    await expect(page.locator('#main')).toContainText('Welcome to One')

    await page.evaluate(() => (window.location.hash = '#/p/does-not-exist'))
    await expect(page.locator('#main')).toContainText('Nothing here.')
    await expect(page).toHaveTitle(/Nothing here\./)
    await page.locator('#main').getByRole('button', { name: 'Go home' }).click()
    await expect(page).toHaveURL(/#\/$/)

    const status = page.getByRole('contentinfo', { name: 'Status bar' }).or(page.locator('footer.status')).first()
    await status.getByTitle('Switch theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await status.getByTitle('Switch language').click()
    await expect(page.locator('.sb').getByRole('button', { name: /^Suchen/ })).toBeVisible()
  })

  test('page icon and cover', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Decorated' })
    await gotoPage(page, id)
    await page.locator('#main .pv-head').hover()
    await page.locator('#main').getByRole('button', { name: 'Add icon' }).click()
    const picker = page.locator('.icon-picker')
    await expect(picker).toBeVisible()
    await picker.locator('.emoji-picker__list .emoji-picker__emoji:visible').first().click()
    await expect.poll(async () => (await pageById(page, id)).icon?.type).toBe('emoji')
    await expect(page.locator('#main .pv-icon')).toBeVisible()

    await page.locator('#main .pv-head').hover()
    await page.locator('#main').getByRole('button', { name: 'Add cover' }).click()
    await expect.poll(async () => (await pageById(page, id)).cover?.type).toBeTruthy()
    await expect(page.locator('#main article.pv')).toHaveAttribute('data-has-cover', 'true')
  })
})
