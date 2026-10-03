import { test, expect, openApp, waitForApp, createPage, doc, para, heading, wsEval, gotoPage, editorOf, plainOf, waitForPlain, flush, selectLine } from './fixtures'

test.describe('share link', () => {
  test('generate a link → open it in a fresh browser → read-only page → save to my workspace', async ({ page, browser, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Share me', content: doc(heading(2, 'Shared heading'), para('shared content xyz')) })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/app\/.*#\/s\/.+/)

    // a different person: fresh context, nothing stored
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    await expect(p2.locator('.shv__title')).toHaveText('Share me')
    await expect(p2.locator('.shv__doc')).toContainText('shared content xyz')
    await expect(p2.locator('.shv__doc h3')).toHaveText('Shared heading')
    await expect(p2.getByText('Read-only')).toBeVisible()
    // read-only: no editable surface
    await expect(p2.locator('[contenteditable="true"]')).toHaveCount(0)

    await p2.getByRole('button', { name: /Save to my workspace/ }).click()
    await expect(p2.getByText('Saved to your workspace')).toBeVisible()
    await expect(p2.locator('#main .pv-title')).toHaveValue('Share me')
    await expect(p2.locator('#main .ProseMirror')).toContainText('shared content xyz')
    const saved = await p2.evaluate(() => {
      const s = (window as unknown as { __one?: { workspace: { getState: () => { pages: Record<string, { title: string; plain?: string; trashed: boolean }> } } } }).__one
      if (!s) return 'no-hook'
      return Object.values(s.workspace.getState().pages).filter((p) => p.title === 'Share me' && !p.trashed).length
    })
    // the shared link carries no ?e2e, so the hook may be absent — fall back to the UI check above
    if (saved !== 'no-hook') expect(saved).toBe(1)
    await other.close()
  })
})

test.describe('version history', () => {
  test('edit, open history, restore the older version', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'History page', content: doc(para('Version one text')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed).toContainText('Version one text')

    // save a version by hand
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Save version/ }).first().click()
    await expect(page.getByText('Version saved')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // edit: replace the sentence
    await selectLine(page, ed.locator('p', { hasText: 'Version one text' }))
    await page.keyboard.type('Version two text')
    await waitForPlain(page, id, /^Version two text$/)
    await flush(page)

    // restore
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    dialog = page.getByRole('dialog')
    const manual = dialog.locator('.hist__row', { has: page.locator('.hist__tag--manual') }).first()
    await expect(manual).toBeVisible()
    await manual.click()
    await expect(dialog.locator('.hist__preview')).toContainText('Version one text')
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText(/Restored the version from/)).toBeVisible()
    await expect(ed).toContainText('Version one text')
    await expect(ed).not.toContainText('Version two text')
    await waitForPlain(page, id, /^Version one text$/)
  })
})

test.describe('templates', () => {
  test('create a project tracker from a template', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    await page.locator('.sb').getByRole('button', { name: /^Templates/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('option', { name: /Project tracker/ }).click()
    await expect(dialog.locator('.tpl-preview__title')).toHaveText('Project tracker')
    await dialog.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('“Project tracker” added')).toBeVisible()
    await expect(page.locator('#main .pv-title')).toHaveValue('Project tracker')
    const after = await wsEval(page, (s) => Object.keys(s.pages).length)
    expect(after).toBeGreaterThan(before + 1)
    // the new structure contains a working database
    await expect(page.locator('#main section.db').first()).toBeVisible()
  })
})

test.describe('journal', () => {
  test('Today opens (and reuses) today’s journal entry', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Today/ }).click()
    const expected = await page.evaluate(() => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).replace(/,/g, ''))
    const title = page.locator('#main .pv-title')
    await expect(title).toHaveValue(new RegExp(expected.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(',? ')))
    await expect(page.locator('#main .ProseMirror')).toContainText('Today’s focus')
    const entry = await page.evaluate(() => window.location.hash)
    // the journal database exists and has exactly one entry for today
    const count = await wsEval(page, (s) => {
      const pages = Object.values(s.pages) as Array<Record<string, any>>
      const jr = pages.find((p) => p.kind === 'database' && p.title === 'Journal')
      return jr ? pages.filter((p) => p.databaseId === jr.id).length : -1
    })
    expect(count).toBe(1)
    // a second click opens the same entry
    await page.locator('.sb').getByRole('button', { name: /^Home/ }).click()
    await page.locator('.sb').getByRole('button', { name: /^Today/ }).click()
    await expect(page).toHaveURL(new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
    // the #/journal deep link works too
    await page.goto('app/?e2e#/journal')
    await waitForApp(page)
    await expect(page).toHaveURL(new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
  })
})

test.describe('graph', () => {
  test('graph route renders the page network', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Graph/ }).click()
    const canvas = page.locator('canvas.graph__canvas')
    await expect(canvas).toBeVisible()
    const label = (await canvas.getAttribute('aria-label')) ?? ''
    const m = label.match(/Graph of (\d+) pages and (\d+) connections/)
    expect(m, label).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(8)
    expect(Number(m![2])).toBeGreaterThanOrEqual(8)
    // the canvas is actually painted (not blank)
    await page.waitForTimeout(800)
    const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')
      if (!ctx) return true // webgl or offscreen — trust the label
      const { width, height } = c
      const data = ctx.getImageData(0, 0, width, height).data
      let distinct = 0
      const first = `${data[0]},${data[1]},${data[2]}`
      for (let i = 0; i < data.length; i += 4 * 97) if (`${data[i]},${data[i + 1]},${data[i + 2]}` !== first) distinct++
      return distinct > 20
    })
    expect(painted).toBe(true)
    // search focuses a node, and the focus plate opens it
    await page.getByRole('textbox', { name: 'Find a page…' }).fill('Glossary')
    await page.locator('.graph-results [role="option"]').filter({ hasText: 'Glossary' }).first().click()
    const focus = page.locator('.graph-focus')
    await expect(focus).toContainText('Glossary')
    await focus.locator('.graph-focus__open').click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Glossary')
  })
})

test.describe('presentation', () => {
  test('present a page: open, navigate, exit', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Deck page',
      content: doc(para('Intro line'), heading(2, 'First slide'), para('one'), heading(2, 'Second slide'), para('two'), heading(2, 'Third slide'), para('three')),
    })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Present' }).click()
    const deck = page.locator('.pres[role="dialog"]')
    await expect(deck).toBeVisible()
    const counter = deck.locator('.pres__corner--br')
    await expect(counter).toHaveText(/01\s*\/\s*04/)
    await expect(deck.locator('.pres__title')).toHaveText('Deck page')
    await page.keyboard.press('ArrowRight')
    await expect(counter).toHaveText(/02\s*\/\s*04/)
    await expect(deck).toContainText('First slide')
    await page.keyboard.press('ArrowRight')
    await expect(deck).toContainText('Second slide')
    await page.keyboard.press('ArrowLeft')
    await expect(counter).toHaveText(/02\s*\/\s*04/)
    await page.keyboard.press('End')
    await expect(counter).toHaveText(/04\s*\/\s*04/)
    await expect(deck).toContainText('Third slide')
    // overview grid
    await page.keyboard.press('g')
    await expect(deck.locator('.pres__thumb')).toHaveCount(4)
    await page.keyboard.press('Escape')
    await expect(deck.locator('.pres__thumb')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(deck).toHaveCount(0)
    // the page is untouched and the app keyboard works again
    expect(await plainOf(page, id)).toContain('Third slide')
    await expect(page.locator('#main .pv-title')).toHaveValue('Deck page')
  })
})

test.describe('presentation of a rich page', () => {
  test('the welcome page presents slide by slide without errors', async ({ page }) => {
    await openApp(page)
    await page.locator('.tb').getByRole('button', { name: 'Present' }).click()
    const deck = page.locator('.pres[role="dialog"]')
    await expect(deck).toBeVisible()
    const counter = deck.locator('.pres__corner--br')
    const total = Number(((await counter.innerText()).match(/\/\s*(\d+)/) ?? [])[1])
    expect(total).toBeGreaterThan(4)
    for (let i = 2; i <= total; i++) {
      await page.keyboard.press('ArrowRight')
      await expect(counter).toHaveText(new RegExp(`${String(i).padStart(2, '0')}\\s*/`))
    }
    await page.keyboard.press('Escape')
    await expect(deck).toHaveCount(0)
  })
})

test.describe('share formats', () => {
  test('"Copy as Markdown" puts the page on the clipboard as Markdown', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await createPage(page, { title: 'Markdown me', content: doc(heading(2, 'Section'), para('Body text'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('point')] }] }) })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain('# Markdown me')
    expect(md).toContain('## Section')
    expect(md).toContain('Body text')
    expect(md).toMatch(/^[-*] point$/m)
  })
})
