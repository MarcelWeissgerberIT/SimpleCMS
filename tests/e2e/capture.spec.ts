import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, waitForApp, gotoPage, createPage, doc, para, wsEval, uiEval, pageById, pageIdByTitle, editorOf, flush, MOD } from './fixtures'

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Ids of live Inbox pages (recognised by their id prefix). */
const inboxIds = (page: Page) => wsEval(page, (s) => (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.id.startsWith('inbx') && !p.trashed).map((p) => p.id as string))

/** Live children of a page: [id, title]. */
const childrenOf = (page: Page, id: string) =>
  wsEval(page, (s, id) => (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.parentId === id && !p.trashed).map((p) => [p.id as string, p.title as string]), id)

/** Page ids the Inbox lists (its page-link blocks, in order). */
const inboxLinks = (page: Page, id: string) =>
  wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as Array<Record<string, any>>).filter((n) => n.type === 'pageLink').map((n) => n.attrs.pageId as string), id)

/** The page id the main column shows (#/p/<id>). */
const routeId = (page: Page) => page.evaluate(() => window.location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? null)

const enc = encodeURIComponent

/** This device's clip token, as the "Clip to One" bookmarklet carries it (k=…). */
const TOKEN = 'e2eClipToken_0123456789abcdef'
const setClipToken = (page: Page) => page.evaluate((token) => localStorage.setItem('one.clipToken', token), TOKEN)

/** The "Save to Clippings?" card shown for clips without this device's token. */
const askCard = (page: Page) => page.getByRole('dialog', { name: 'Save to Clippings?' })

/* ------------------------------------------------------------------ */
/* Unlinked mentions                                                   */
/* ------------------------------------------------------------------ */

test.describe('unlinked mentions', () => {
  test('lists pages naming this one; "Link" turns the text into a mention, open editors follow', async ({ page }) => {
    await openApp(page)
    const target = await createPage(page, { title: 'Zephyr protocol' })
    const notes = await createPage(page, { title: 'Meeting notes', content: doc(para('Intro line.'), para('We discussed the zephyr protocol rollout today.')) })
    // already linked: shows under "Linked from", never as unlinked
    await createPage(page, {
      title: 'Linked already',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'mention', attrs: { id: target, label: 'Zephyr protocol', kind: 'page' } }, { type: 'text', text: ' and the Zephyr protocol again.' }] }] },
    })
    // not whole words, inside code, inside a trashed page: never counted
    await createPage(page, { title: 'Plural only', content: doc(para('Two zephyr protocols compared.')) })
    await createPage(page, { title: 'Code only', content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'zephyr protocol' }] }] } })
    const gone = await createPage(page, { title: 'Trashed note', content: doc(para('Zephyr protocol in the trash.')) })
    await wsEval(page, (s, id) => s.trashPage(id), gone)
    // a database row counts too
    const projects = await pageIdByTitle(page, 'Projects')
    const row = await wsEval(page, (s, db) => s.createRow(db, { title: 'Protocol migration' }), projects)
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Blocked by ' }, { type: 'text', text: 'Zephyr Protocol', marks: [{ type: 'bold' }] }, { type: 'text', text: ' sign-off.' }] }] }, 'e2e'), row)
    await flush(page)

    await gotoPage(page, target)
    const foot = page.locator('#main .pv-foot')
    await expect(foot.locator('section.pv-links').first()).toContainText('Linked already')
    const section = foot.locator('section.pv-um')
    const toggle = section.getByRole('button', { name: /Unlinked mentions/ })
    await expect(toggle).toHaveText(/Unlinked mentions\s*· 02/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(section.locator('.pv-um__item')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const items = section.locator('.pv-um__item')
    await expect(items).toHaveCount(2)
    await expect(items.filter({ hasText: 'Meeting notes' }).locator('mark')).toHaveText('zephyr protocol')
    await expect(items.filter({ hasText: 'Protocol migration' }).locator('mark')).toHaveText('Zephyr Protocol')

    // the other page is open next to this one: its editor must pick up the change
    await uiEval(page, (s, id) => s.openPane(id), notes)
    const paneEditor = editorOf(page, notes)
    await expect(paneEditor).toContainText('We discussed the zephyr protocol rollout today.')

    await section.getByRole('button', { name: 'Link the mention in “Meeting notes”' }).click()
    await expect(page.getByText('Linked in “Meeting notes”')).toBeVisible()
    const para2 = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content[1].content)), notes)
    expect(para2).toEqual([
      { type: 'text', text: 'We discussed the ' },
      { type: 'mention', attrs: { id: target, label: 'Zephyr protocol', kind: 'page' } },
      { type: 'text', text: ' rollout today.' },
    ])
    // other content untouched
    expect((await pageById(page, notes)).content.content[0].content[0].text).toBe('Intro line.')
    // moved to "Linked from"
    await expect(foot.locator('section.pv-links').first()).toContainText('Meeting notes')
    await expect(toggle).toHaveText(/· 01/)
    await expect(items).toHaveCount(1)
    // the open editor shows the mention (and keeps the rest)
    await expect(paneEditor.locator('.mention').filter({ hasText: 'Zephyr protocol' })).toBeVisible()
    await expect(paneEditor).toContainText('rollout today.')

    // the last one (a database row, title in bold): the section goes away
    await items.first().getByRole('button', { name: /^Link the mention in/ }).click()
    await expect(section).toHaveCount(0)
    const rowDoc = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), row)
    expect(rowDoc).toContain(`"id":"${target}"`)
    expect(rowDoc).toContain('Blocked by ')
    expect(rowDoc).toContain(' sign-off.')
    // the text was bold: so is the mention that replaced it
    const rowMention = await wsEval(
      page,
      (s, a) => {
        let found: unknown = null
        const walk = (n: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          if (n.type === 'mention' && n.attrs?.id === a.target) found = JSON.parse(JSON.stringify(n))
          ;(n.content ?? []).forEach(walk)
        }
        walk(s.pages[a.row].content)
        return found
      },
      { row, target },
    )
    expect(rowMention).toMatchObject({ type: 'mention', marks: [{ type: 'bold' }] })
  })

  test('"Link all" links every listed page; Undo restores the text', async ({ page }) => {
    await openApp(page)
    const target = await createPage(page, { title: 'Halcyon budget' })
    const a = await createPage(page, { title: 'Note A', content: doc(para('The halcyon budget is due.')) })
    const b = await createPage(page, { title: 'Note B', content: doc(para('Ask finance about Halcyon Budget numbers.')) })
    await gotoPage(page, target)
    const section = page.locator('#main section.pv-um')
    await section.getByRole('button', { name: /Unlinked mentions/ }).click()
    await expect(section.locator('.pv-um__item')).toHaveCount(2)
    await section.getByRole('button', { name: 'Link all' }).click()
    await expect(page.getByText('Linked 2 mentions')).toBeVisible()
    await expect(section).toHaveCount(0)
    for (const id of [a, b]) expect(JSON.stringify((await pageById(page, id)).content)).toContain(`"id":"${target}"`)

    // B is edited after the link: Undo can't restore the old doc, it turns the mention back into
    // the text exactly as it was written ("Halcyon Budget", not the page title "Halcyon budget")
    await wsEval(
      page,
      (s, id) => s.setContent(id, { ...s.pages[id].content, content: [...s.pages[id].content.content, { type: 'paragraph', content: [{ type: 'text', text: 'Added later.' }] }] }, 'e2e'),
      b,
    )
    await page.locator('.toast').filter({ hasText: 'Linked 2 mentions' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await pageById(page, a)).content.content[0].content).toEqual([{ type: 'text', text: 'The halcyon budget is due.' }])
    await expect.poll(async () => (await pageById(page, b)).content.content[0].content).toEqual([{ type: 'text', text: 'Ask finance about Halcyon Budget numbers.' }])
    expect((await pageById(page, b)).content.content[1].content[0].text).toBe('Added later.')
    await expect(page.locator('#main section.pv-um').getByRole('button', { name: /Unlinked mentions/ })).toHaveText(/· 02/)
  })

  test('short or placeholder titles never collect mentions', async ({ page }) => {
    await openApp(page)
    const short = await createPage(page, { title: 'AI' })
    await createPage(page, { title: 'Uses AI', content: doc(para('AI everywhere, ai all day.')) })
    await gotoPage(page, short)
    await expect(page.locator('#main .pv-foot')).toBeVisible()
    await expect(page.locator('#main section.pv-um')).toHaveCount(0)
  })
})

/* ------------------------------------------------------------------ */
/* Web clipper                                                         */
/* ------------------------------------------------------------------ */

test.describe('web clipper', () => {
  test('#/clip with this device\'s token creates exactly one page in Clippings (bookmark + quote + date), reload does not duplicate', async ({ page }) => {
    await openApp(page)
    await setClipToken(page)
    expect(await inboxIds(page)).toEqual([])
    const url = 'https://example.com/articles/one?id=7&ref=feed'
    const hash = `#/clip?k=${TOKEN}&url=${enc(url)}&title=${enc('An example article')}&text=${enc('First line of the quote\nsecond line\n\nNext paragraph')}&desc=${enc('A short description')}`
    // a fresh tab, as the bookmarklet opens one
    await page.goto('about:blank')
    await page.goto(`app/?e2e${hash}`)
    await waitForApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('An example article')
    await expect(page).toHaveURL(/#\/p\/[\w-]+$/)
    await expect(page.getByText('Saved to Clippings')).toBeVisible()

    const inbox = await inboxIds(page)
    expect(inbox).toHaveLength(1)
    const kids = await childrenOf(page, inbox[0])
    expect(kids).toHaveLength(1)
    const [id, title] = kids[0]
    expect(title).toBe('An example article')
    expect(await routeId(page)).toBe(id)
    const p = await pageById(page, id)
    expect(p.content.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'bookmark', 'blockquote', 'paragraph'])
    expect(p.content.content[1].attrs).toMatchObject({ url, title: 'An example article', description: 'A short description' })
    const quote = p.content.content[2].content
    expect(quote).toHaveLength(2)
    expect(quote[0].content.map((n: { type: string }) => n.type)).toEqual(['text', 'hardBreak', 'text'])
    expect(quote[1].content[0].text).toBe('Next paragraph')
    const clipped = p.content.content[0].content
    expect(clipped[0].text).toBe('Clipped ')
    expect(clipped[1]).toMatchObject({ type: 'mention', attrs: { kind: 'date' } })
    expect(clipped[1].attrs.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // the page renders: bookmark card + quote
    await expect(editorOf(page, id).locator('[data-type="bookmark"]')).toContainText('An example article')
    await expect(editorOf(page, id).locator('blockquote')).toContainText('First line of the quote')
    // the Inbox sits at the root with its icon and lists the clip
    const box = await pageById(page, inbox[0])
    expect(box.parentId).toBeNull()
    expect(box.icon).toEqual({ type: 'asset', value: 'import' })
    expect(await inboxLinks(page, inbox[0])).toEqual([id])

    await reloadApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('An example article')
    expect(await childrenOf(page, inbox[0])).toHaveLength(1)
    expect(await inboxIds(page)).toHaveLength(1)

    // a second clip lands in the same Inbox; javascript: URLs are never kept
    await page.evaluate((token) => (window.location.hash = `#/clip?k=${token}&url=${encodeURIComponent('javascript:alert(1)')}&title=Second`), TOKEN)
    await expect(page.locator('#main .pv-title')).toHaveValue('Second')
    // silent: no question asked
    await expect(askCard(page)).toHaveCount(0)
    expect(await inboxIds(page)).toHaveLength(1)
    expect(await childrenOf(page, inbox[0])).toHaveLength(2)
    const second = (await routeId(page))!
    expect((await pageById(page, second)).content.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'paragraph'])
    // newest first in the Inbox
    expect(await inboxLinks(page, inbox[0])).toEqual([second, id])
    // back does not bounce into the clip route again
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`#/p/${id}$`))
    expect(await childrenOf(page, inbox[0])).toHaveLength(2)
  })

  test('a clip link without page, title or text creates nothing', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    await page.evaluate(() => (window.location.hash = '#/clip?url=&title=%20'))
    await expect(page.getByText('Nothing to clip — the link had no page, title or text')).toBeVisible()
    await expect(page).not.toHaveURL(/#\/clip/)
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before)
    expect(await inboxIds(page)).toEqual([])
  })

  test('a #/clip link without this device\'s token asks first: Discard saves nothing, Save (↵) files it', async ({ page }) => {
    await openApp(page)
    await setClipToken(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    // any web page can open this link — it carries no (or a wrong) token
    await page.evaluate((h) => (window.location.hash = h), `#/clip?url=${enc('https://evil.example/landing')}&title=${enc('Sneaky page')}&text=${enc('Injected text that would land in your workspace')}`)
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    await expect(ask.locator('.clipq__page')).toHaveText('Sneaky page')
    await expect(ask.locator('.clipq__host')).toContainText('evil.example')
    await expect(ask.locator('.clipq__quote')).toContainText('Injected text that would land in your workspace')
    // the route is gone already (a reload must not ask again), nothing saved yet
    await expect(page).not.toHaveURL(/#\/clip/)
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before)
    await ask.getByRole('button', { name: /Discard/ }).click()
    await expect(ask).toHaveCount(0)
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before)
    expect(await inboxIds(page)).toEqual([])

    // Esc discards too
    await page.evaluate((h) => (window.location.hash = h), `#/clip?k=${'W'.repeat(32)}&title=${enc('Wrong key')}`)
    await expect(ask).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    expect(await inboxIds(page)).toEqual([])

    // a wrong token asks as well — ↵ saves (the Save key has focus)
    await page.evaluate((h) => (window.location.hash = h), `#/clip?k=${'x'.repeat(32)}&url=${enc('https://example.net/a')}&title=${enc('Chosen page')}`)
    await expect(ask).toBeVisible()
    await expect(ask.getByRole('button', { name: /Save to Clippings/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(ask).toHaveCount(0)
    await expect(page.locator('#main .pv-title')).toHaveValue('Chosen page')
    await expect(page.getByText('Saved to Clippings')).toBeVisible()
    const inbox = await inboxIds(page)
    expect(inbox).toHaveLength(1)
    expect((await childrenOf(page, inbox[0])).map(([, title]) => title)).toEqual(['Chosen page'])
  })

  test('a clip inside a frame is refused, even with the token', async ({ page }) => {
    await openApp(page)
    await setClipToken(page)
    await page.evaluate((src) => {
      const f = document.createElement('iframe')
      f.id = 'clipframe'
      f.style.cssText = 'position:fixed;inset:0;width:900px;height:700px;z-index:9999'
      f.src = src
      document.body.appendChild(f)
    }, `?e2e#/clip?k=${TOKEN}&url=${enc('https://example.com/framed')}&title=${enc('Framed clip')}`)
    const frame = page.frameLocator('#clipframe')
    await expect(frame.getByText('Web clips are only saved in One’s own tab, never from inside another page')).toBeVisible({ timeout: 30_000 })
    await expect(frame.getByRole('dialog', { name: 'Save to Clippings?' })).toHaveCount(0)
    const inner = page.frames().find((f) => f !== page.mainFrame())!
    expect(await inner.evaluate(() => (Object.values((window as any).__one.workspace.getState().pages) as Array<{ title: string }>).some((p) => p.title === 'Framed clip'))).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await inboxIds(page)).toEqual([])
  })

  test('share target (GET, older installs): a shared URL is shown first and saved on "Save to Clippings"', async ({ page }) => {
    await openApp(page)
    // the manifest now POSTs (files too — tests/e2e/quick-capture.spec.ts); an app installed before still opens /app/?title=…
    const res = await page.request.get('manifest.webmanifest')
    expect(res.ok()).toBe(true)
    const manifest = await res.json()
    expect(manifest.share_target).toMatchObject({ method: 'POST', params: { title: 'title', text: 'text', url: 'url' } })
    const action = new URL(manifest.share_target.action, res.url())
    expect(action.pathname).toBe('/SimpleCMS/app/')
    action.search = ''

    // Android apps often put the link into "text" and leave "url" empty
    const share = new URL(action)
    share.search = `?e2e&title=${enc('Shared from phone')}&text=${enc('Worth reading https://example.org/post?x=1')}&url=`
    await page.goto('about:blank')
    await page.goto(share.href)
    await waitForApp(page)
    // any app can share into One: it shows what it would save and asks
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    await expect(ask.locator('.clipq__page')).toHaveText('Shared from phone')
    await expect(ask.locator('.clipq__host')).toContainText('example.org')
    await expect(ask.locator('.clipq__quote')).toHaveText('Worth reading')
    // the share query is gone (a reload must not share again), the test flag stays
    expect(await page.evaluate(() => window.location.search)).toBe('?e2e')
    expect(await inboxIds(page)).toEqual([])
    await ask.getByRole('button', { name: /Save to Clippings/ }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Shared from phone')
    const id = (await routeId(page))!
    const p = await pageById(page, id)
    expect(p.content.content[1]).toMatchObject({ type: 'bookmark', attrs: { url: 'https://example.org/post?x=1' } })
    expect(p.content.content[2].content[0].content[0].text).toBe('Worth reading')
    const inbox = await inboxIds(page)
    expect(inbox).toHaveLength(1)
    expect(p.parentId).toBe(inbox[0])

    await reloadApp(page)
    expect(await childrenOf(page, inbox[0])).toHaveLength(1)
  })

  test('Settings → Data: the bookmarklet is a javascript: URL for this app and clips a real page', async ({ page, context }) => {
    await openApp(page)
    const app = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`)
    expect(app).toMatch(/\/SimpleCMS\/app\/$/)
    await page.keyboard.press(`${MOD}+,`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: /Data/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Web clipper' })).toBeVisible()
    const key = dialog.locator('a[data-bookmarklet]')
    await expect(key).toHaveText('Clip to One')
    const href = (await key.getAttribute('href'))!
    expect(href.startsWith('javascript:')).toBe(true)
    const code = decodeURIComponent(href.slice('javascript:'.length))
    expect(code).toContain(JSON.stringify(app))
    // this device's clip token is baked in (created on first use, kept in localStorage)
    const token = (await page.evaluate(() => localStorage.getItem('one.clipToken')))!
    expect(token).toMatch(/^[\w-]{20,64}$/)
    expect(code).toContain(JSON.stringify(token))
    // clicking it inside the app only explains what to do
    await key.click()
    await expect(page.getByText('Drag the key to your bookmarks bar — it clips other pages, not this one.')).toBeVisible()
    await expect(dialog).toBeVisible()

    // run it on a (mocked) web page with a selection: it opens <app>#/clip?…
    await context.route('https://clip.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Hammer time</title><meta name="description" content="All about hammers"></head><body><p id="sel">Selected words here</p><p>rest</p></body></html>',
      }),
    )
    const site = await context.newPage()
    await site.goto('https://clip.example/post/42')
    await site.evaluate(() => {
      const r = document.createRange()
      r.selectNodeContents(document.getElementById('sel')!)
      window.getSelection()!.addRange(r)
      ;(window as unknown as { open: (u: string) => null }).open = (u: string) => {
        ;(window as unknown as { __opened: string }).__opened = u
        return null
      }
    })
    await site.evaluate(code)
    const opened = await site.evaluate(() => (window as unknown as { __opened?: string }).__opened ?? '')

    // a selection cut right inside an emoji (surrogate pair) at the 4000-character limit still clips
    await site.evaluate(() => {
      const p = document.createElement('p')
      p.textContent = `${'a'.repeat(3999)}😀 tail`
      document.body.appendChild(p)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      const r = document.createRange()
      r.selectNodeContents(p)
      sel.addRange(r)
      ;(window as unknown as { __opened: string }).__opened = ''
    })
    await site.evaluate(code)
    const openedEmoji = await site.evaluate(() => (window as unknown as { __opened?: string }).__opened ?? '')
    await site.close()
    expect(openedEmoji).toContain(`&text=${'a'.repeat(3999)}${enc('😀')}`)
    expect(openedEmoji).not.toContain('tail')

    expect(opened.startsWith(`${app}#/clip?k=${token}&`)).toBe(true)
    expect(opened).toContain(`url=${enc('https://clip.example/post/42')}`)

    await page.goto(opened.replace('#/clip', '?e2e#/clip'))
    await waitForApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Hammer time')
    const p = await pageById(page, (await routeId(page))!)
    expect(p.content.content[1].attrs).toMatchObject({ url: 'https://clip.example/post/42', title: 'Hammer time', description: 'All about hammers' })
    expect(p.plain).toContain('Selected words here')
  })

  test('palette: "Quick note to Clippings" opens a timestamped page with the caret in its body', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal).toBeVisible()
    await page.keyboard.type('quick note')
    await expect(pal.locator('[role="option"][aria-selected="true"]')).toContainText('Quick note to Clippings')
    await page.keyboard.press('Enter')
    await expect(pal).toBeHidden()
    await expect(page.locator('#main .pv-title')).toHaveValue(/^Note · /)
    const id = (await routeId(page))!
    await expect(editorOf(page, id)).toBeFocused()
    await page.keyboard.type('remember the milk')
    await expect.poll(async () => (await pageById(page, id)).plain).toContain('remember the milk')
    const inbox = await inboxIds(page)
    expect(inbox).toHaveLength(1)
    expect((await pageById(page, id)).parentId).toBe(inbox[0])
    // the Clippings page shows up in the sidebar
    await expect(page.locator('.sb section[aria-label="Pages"] .sb-row__title', { hasText: /^Clippings$/ })).toBeVisible()
  })
})
