/**
 * Notion block gaps: the /Form block (an inline database whose first view is a form), the
 * breadcrumb, "Link to page", 4 / 5 columns, the PDF viewer, more embed providers, the feed view
 * slash item — and how each new block reads in Markdown, HTML and a share link.
 * External hosts are answered locally (page.route) — nothing leaves the machine.
 */
import { readFileSync } from 'node:fs'
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, wsEval, flush, MOD } from './fixtures'

/** Type a slash command and run the active match (its label is checked first). */
async function slash(page: Page, query: string, label: string) {
  await page.keyboard.type(`/${query}`)
  await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText(label)
  await page.keyboard.press('Enter')
  await expect(page.locator('.slash')).toBeHidden()
}

/** Top-level blocks of a page as stored. */
async function blocksOf(page: Page, id: string): Promise<JSONContent[]> {
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content?.content ?? [])), id)
}

/** A tiny one-page PDF. */
const PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 44>>stream',
  'BT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET',
  'endstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n')

/** Paste files into the main editor, the way the browser delivers them. */
async function pasteFiles(page: Page, files: Array<{ name: string; type: string; text: string }>) {
  await page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([f.text], f.name, { type: f.type }))
    document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, files)
}

/** Every request to another host gets an empty page (a PDF for .pdf paths). */
async function answerExternal(ctx: BrowserContext) {
  await ctx.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route) => {
      const pdf = /\.pdf$/i.test(new URL(route.request().url()).pathname)
      return route.fulfill({ status: 200, contentType: pdf ? 'application/pdf' : 'text/html', body: pdf ? PDF : '<!doctype html><title>embed</title>' })
    },
  )
}

const workspaceName = (page: Page) => wsEval(page, (s) => s.settings.workspaceName.trim() || 'One')

/* ------------------------------------------------------------------ */

test.describe('Notion blocks', () => {
  test('/form: an inline form with three questions, ready to fill in; an answer becomes a row', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Contact', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, 'form', 'Form')

    const db = ed.locator('section.db')
    await expect(db).toHaveAttribute('data-view', 'form')
    await expect(db.locator('.db-inlinehead__title')).toHaveValue('Form')
    const form = db.locator('form.fm')
    await expect(form).toBeVisible()
    const qs = form.locator('.fm-q')
    await expect(qs).toHaveCount(3)
    await expect(qs.nth(0)).toContainText('Name')
    await expect(qs.nth(1)).toContainText('Email')
    await expect(qs.nth(2)).toContainText('Message')
    // the builder and the share key are one click away
    await expect(db.getByRole('radio', { name: 'Build' })).toBeVisible()
    await expect(db.getByRole('button', { name: 'Share form' })).toBeVisible()

    // name + email are required
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(qs.nth(0).locator('.fm-q__err')).toBeVisible()
    await qs.nth(0).locator('input').fill('Ada Lovelace')
    await qs.nth(1).locator('input').fill('ada@example.com')
    await qs.nth(2).locator('textarea').fill('Hello from the page')
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(db.locator('.fm--done')).toContainText('Response recorded')

    await expect.poll(async () => (await blocksOf(page, id)).some((b) => b.type === 'databaseBlock')).toBe(true)
    const info = await wsEval(
      page,
      (s, id) => {
        const blk = s.pages[id].content.content.find((b: { type: string }) => b.type === 'databaseBlock')
        const dbId = blk.attrs.databaseId
        const d = s.databases[dbId]
        const rows = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === dbId && !p.trashed)
        return JSON.parse(
          JSON.stringify({
            title: s.pages[dbId].title,
            parent: s.pages[dbId].parentId,
            inline: d.inline,
            views: d.views.map((v: { type: string; name: string }) => `${v.type}:${v.name}`),
            props: d.properties.map((p: { name: string; type: string }) => `${p.name}:${p.type}`),
            rows: rows.map((r) => ({ title: r.title, values: Object.values(r.properties) })),
          }),
        )
      },
      id,
    )
    expect(info).toMatchObject({ title: 'Form', parent: id, inline: true, views: ['form:Form', 'table:Responses'], props: ['Name:title', 'Email:email', 'Message:text'] })
    expect(info.rows).toEqual([{ title: 'Ada Lovelace', values: expect.arrayContaining(['ada@example.com', 'Hello from the page']) }])
  })

  test('/breadcrumb: the path as links — follows a rename and a move, a click goes there', async ({ page }) => {
    await openApp(page)
    const ws = await workspaceName(page)
    const parent = await createPage(page, { title: 'Handbook' })
    const archive = await createPage(page, { title: 'Archive' })
    const id = await createPage(page, { title: 'Onboarding', parentId: parent, content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, 'breadcrumb', 'Breadcrumb')

    const crumbs = ed.locator('nav.crumbs-view')
    const titles = crumbs.locator('.crumbs-view__title')
    await expect(titles).toHaveText([ws, 'Handbook', 'Onboarding'])
    await expect(crumbs.locator('[aria-current="page"]')).toContainText('Onboarding')
    // stored without a path: it is computed from the page it sits on
    await expect.poll(async () => (await blocksOf(page, id)).filter((b) => b.type === 'breadcrumb').map((b) => b.attrs?.path ?? null)).toEqual([null])

    await wsEval(page, (s, parent) => s.updatePage(parent, { title: 'Team handbook' }), parent)
    await expect(titles).toHaveText([ws, 'Team handbook', 'Onboarding'])
    await wsEval(page, (s, a) => s.movePage(a.id, a.archive), { id, archive })
    await expect(titles).toHaveText([ws, 'Archive', 'Onboarding'])

    // keyboard: the selected block hands Tab to its links, Escape comes back to the block
    const box = (await crumbs.boundingBox())!
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
    await page.keyboard.press('Tab')
    await expect(crumbs.locator('a').first()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(crumbs.getByRole('link', { name: 'Archive' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(ed).toBeFocused()

    await crumbs.getByRole('link', { name: 'Archive' }).click()
    await page.waitForFunction((archive) => window.location.hash.startsWith(`#/p/${archive}`), archive)
  })

  test('/link to page: picks an existing page (never itself or a template page) and links it', async ({ page }) => {
    await openApp(page)
    const target = await createPage(page, { title: 'Pricing notes' })
    await wsEval(page, (s) => {
      const tpl = s.createPage({ title: 'Secret template page', hidden: true })
      s.updatePage(tpl, { template: { name: 'Secret template page' } })
    })
    const id = await createPage(page, { title: 'Hub of links', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, 'link to page', 'Link to page')

    const picker = page.getByRole('dialog', { name: 'Link to page' })
    await expect(picker).toBeVisible()
    const search = picker.getByRole('combobox')
    await expect(search).toBeFocused()
    await search.fill('Secret template')
    await expect(picker.getByRole('option', { name: /Secret template page/ })).toHaveCount(0)
    await search.fill('Hub of links')
    await expect(picker.getByRole('option', { name: /^Hub of links/ })).toHaveCount(0)
    await search.fill('Pricing')
    await expect(picker.getByRole('option').first()).toContainText('Pricing notes')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()

    await expect(ed.locator('.page-link')).toContainText('Pricing notes')
    await expect.poll(async () => (await blocksOf(page, id)).filter((b) => b.type === 'pageLink').map((b) => b.attrs?.pageId)).toEqual([target])
    // linked, not created anew
    const count = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string; trashed: boolean }>).filter((p) => p.title === 'Pricing notes' && !p.trashed).length)
    expect(count).toBe(1)
  })

  test('4 and 5 columns from the slash menu sit side by side, and stack on a phone', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Grid page', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, '4 col', '4 columns')
    await page.keyboard.type('first')
    await page.keyboard.press(`${MOD}+End`)
    await slash(page, '5 col', '5 columns')
    await page.keyboard.type('alpha')

    const cols = ed.locator('.columns')
    await expect(cols).toHaveCount(2)
    await expect(cols.nth(0).locator(':scope > .column')).toHaveCount(4)
    await expect(cols.nth(1).locator(':scope > .column')).toHaveCount(5)
    const tracks = (i: number) => cols.nth(i).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(await tracks(0)).toBe(4)
    expect(await tracks(1)).toBe(5)
    await expect.poll(async () => (await blocksOf(page, id)).filter((b) => b.type === 'columns').map((b) => b.content?.length)).toEqual([4, 5])

    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => tracks(1)).toBe(1)
  })

  test('a pasted PDF shows in the viewer; "As file" makes it a card and back; a fake PDF never renders', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Reading room', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await pasteFiles(page, [{ name: 'Quarterly report.pdf', type: 'application/pdf', text: PDF }])

    const viewer = ed.locator('.pdf-view')
    await expect(viewer).toBeVisible()
    await expect(viewer.locator('.pdf-view__name')).toHaveText('Quarterly report.pdf')
    const frame = viewer.locator('iframe')
    await expect(frame).toHaveAttribute('src', /^blob:.*#view=FitH/)
    // the browser's own viewer: no sandbox (Chrome refuses it there) — so the frame only ever gets a typed PDF
    expect(await frame.getAttribute('sandbox')).toBeNull()
    expect(await frame.evaluate(async (f: HTMLIFrameElement) => (await (await fetch(f.src.split('#')[0])).blob()).type)).toBe('application/pdf')
    await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'fileBlock')?.attrs?.src ?? '').toMatch(/^onefile:/)

    // keyboard: select the block, Tab reaches its keys
    await viewer.locator('.pdf-view__bar').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('Tab')
    await expect(viewer.getByRole('button', { name: 'Show as file' })).toBeFocused()
    await page.keyboard.press('Enter')
    const card = ed.locator('.file-view')
    await expect(card).toBeVisible()
    await expect(ed.locator('.pdf-view')).toHaveCount(0)
    await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'fileBlock')?.attrs?.display).toBe('file')
    await card.getByRole('button', { name: 'Show in the viewer' }).click()
    await expect(ed.locator('.pdf-view iframe')).toHaveAttribute('src', /^blob:/)
    await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'fileBlock')?.attrs?.display).toBe('viewer')

    // a non-PDF stays a file card; a ".pdf" whose bytes are no PDF shows a note, never a frame
    await page.keyboard.press(`${MOD}+End`)
    await pasteFiles(page, [{ name: 'notes.txt', type: 'text/plain', text: 'plain text' }])
    await expect(ed.locator('.file-view', { hasText: 'notes.txt' })).toBeVisible()
    await expect(ed.locator('.file-view', { hasText: 'notes.txt' }).getByRole('button', { name: 'Show in the viewer' })).toHaveCount(0)
    await pasteFiles(page, [{ name: 'fake.pdf', type: 'application/pdf', text: '<script>alert(1)</script>' }])
    const fake = ed.locator('.pdf-view', { hasText: 'fake.pdf' })
    await expect(fake.locator('.pdf-view__note')).toContainText('This PDF can’t be shown here')
    await expect(fake.locator('iframe')).toHaveCount(0)
  })

  test('embed providers: the right frame source, always sandboxed; unknown links stay generic; a PDF link opens the viewer', async ({ page, context }) => {
    await answerExternal(context)
    await openApp(page)
    const cases: Array<{ url: string; provider: string; src: string | RegExp; height?: number }> = [
      { url: 'https://docs.google.com/document/d/DOC123/edit?usp=sharing', provider: 'gdocs', src: 'https://docs.google.com/document/d/DOC123/preview' },
      { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-pub/pubhtml', provider: 'gsheets', src: 'https://docs.google.com/spreadsheets/d/e/2PACX-pub/pubhtml?widget=true&headers=false' },
      { url: 'https://docs.google.com/presentation/d/SLIDES9/edit#slide=id.p', provider: 'gslides', src: 'https://docs.google.com/presentation/d/SLIDES9/embed?start=false&loop=false' },
      { url: 'https://drive.google.com/file/d/FILE42/view?usp=sharing', provider: 'gdrive', src: 'https://drive.google.com/file/d/FILE42/preview' },
      { url: 'https://drive.google.com/drive/folders/FOLDER7', provider: 'gdrive', src: 'https://drive.google.com/embeddedfolderview?id=FOLDER7#list' },
      { url: 'https://miro.com/app/board/uXjVO1Qe4Vk=/', provider: 'miro', src: 'https://miro.com/app/live-embed/uXjVO1Qe4Vk=/' },
      { url: 'https://excalidraw.com/#json=abc123,keyXYZ', provider: 'excalidraw', src: 'https://excalidraw.com/#json=abc123,keyXYZ' },
      { url: 'https://gist.github.com/octocat/6cad326836d38bd3a7ae', provider: 'gist', src: 'https://gist.github.com/octocat/6cad326836d38bd3a7ae.pibb', height: 360 },
      { url: 'https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x', provider: 'spotify', src: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', height: 152 },
      { url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', provider: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M', height: 352 },
      {
        url: 'https://soundcloud.com/forss/flickermood',
        provider: 'soundcloud',
        src: /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fforss%2Fflickermood&/,
        height: 166,
      },
      { url: 'https://acme.typeform.com/to/AbC123', provider: 'typeform', src: 'https://acme.typeform.com/to/AbC123', height: 520 },
      { url: 'https://calendly.com/acme/intro-call', provider: 'calendly', src: 'https://calendly.com/acme/intro-call?embed_type=Inline&hide_gdpr_banner=1', height: 700 },
      { url: 'https://airtable.com/appABC123/shrXYZ789', provider: 'airtable', src: 'https://airtable.com/embed/appABC123/shrXYZ789', height: 533 },
      { url: 'https://codesandbox.io/s/react-new', provider: 'codesandbox', src: 'https://codesandbox.io/embed/react-new' },
      { url: 'https://replit.com/@replit/Python', provider: 'replit', src: 'https://replit.com/@replit/Python?embed=true' },
      { url: 'https://x.com/jack/status/20', provider: 'twitter', src: 'https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true' },
      { url: 'https://example.com/some/page', provider: 'web', src: 'https://example.com/some/page' },
    ]
    const content = doc(...cases.map((c) => ({ type: 'embed', attrs: { url: c.url, provider: c.provider } })), para(''))
    const id = await createPage(page, { title: 'Embed wall', content })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const frames = ed.locator('.embed-view')
    await expect(frames).toHaveCount(cases.length)
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      const view = frames.nth(i)
      await expect(view, c.url).toHaveAttribute('data-provider', c.provider)
      const iframe = view.locator('iframe')
      await expect(iframe, c.url).toHaveAttribute('src', c.src)
      await expect(iframe, c.url).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation allow-forms')
      if (c.height) expect(await view.locator('.embed-view__frame').evaluate((el) => el.getBoundingClientRect().height), c.url).toBe(c.height)
    }
    await expect(frames.last().locator('.label').first()).toHaveText('Web')

    // typed into an empty embed: detected, stored with its provider; a PDF link gets the browser's viewer
    await page.keyboard.press(`${MOD}+End`)
    await ed.locator('p').last().click()
    await slash(page, 'embed', 'Embed')
    const input = ed.locator('.media-empty[data-type="embed"] input')
    await input.fill('https://files.example.com/docs/handbook.pdf')
    await page.keyboard.press('Enter')
    const pdf = ed.locator('.pdf-view[data-type="embed"]')
    await expect(pdf.locator('.pdf-view__name')).toHaveText('handbook.pdf')
    await expect(pdf.locator('iframe')).toHaveAttribute('src', 'https://files.example.com/docs/handbook.pdf#view=FitH&navpanes=0')
    await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'embed' && /handbook/.test(String(b.attrs?.url)))?.attrs?.provider).toBe('pdf')
    // "As file": a file block pointing at the link
    await pdf.getByRole('button', { name: 'Show as file' }).click()
    await expect(ed.locator('.file-view', { hasText: 'handbook.pdf' })).toBeVisible()
    await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'fileBlock')?.attrs).toMatchObject({ src: 'https://files.example.com/docs/handbook.pdf', display: 'file' })
  })

  test('/feed view inserts an inline database shown as a feed', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Announcements', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, 'feed', 'Feed view')
    await expect(ed.locator('section.db[data-view="feed"]')).toBeVisible()
  })

  test('exports: Markdown, the share link and the web page carry the path, PDF links and embeds as text / links', async ({ page, context, browser, errors }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await answerExternal(context)
    await openApp(page)
    const ws = await workspaceName(page)
    const parent = await createPage(page, { title: 'Field guide' })
    const id = await createPage(page, {
      title: 'Trail map',
      parentId: parent,
      content: doc(
        { type: 'breadcrumb' },
        para('Body text'),
        { type: 'embed', attrs: { url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', provider: 'spotify' } },
        { type: 'embed', attrs: { url: 'https://files.example.com/docs/handbook.pdf', provider: 'pdf' } },
        { type: 'columns', content: ['A', 'B', 'C', 'D', 'E'].map((x) => ({ type: 'column', content: [para(`col ${x}`)] })) },
        para(''),
      ),
    })
    await gotoPage(page, id)
    const path = `${ws} › Field guide › Trail map`

    // Markdown (share dialog → copy): the path as text under a marker, embeds and the PDF as links
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain(`<!-- breadcrumb -->\n${path}`)
    expect(md).toContain('[Spotify: open.spotify.com](https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC)')
    expect(md).toContain('[PDF: handbook.pdf](https://files.example.com/docs/handbook.pdf)')
    for (const x of ['A', 'B', 'C', 'D', 'E']) expect(md).toContain(`col ${x}`)
    await page.keyboard.press('Escape')

    // the share link: the frozen path, shown as text (the receiver has no workspace to look it up in)
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    await answerExternal(other)
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const shared = p2.locator('.shv__doc nav[data-type="breadcrumb"]')
    await expect(shared.locator('.crumbs-view__title')).toHaveText([ws, 'Field guide', 'Trail map'])
    await expect(shared.locator('a')).toHaveCount(0)
    await other.close()

    // web page export: the path as text, the embeds as links
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const ex = page.getByRole('dialog')
    await ex.getByRole('radio', { name: /Web page/ }).click()
    const download = page.waitForEvent('download')
    await ex.locator('[data-export-run]').click()
    const file = testInfo.outputPath('trail.html')
    await (await download).saveAs(file)
    const html = readFileSync(file, 'utf8')
    expect(html).toMatch(/<nav[^>]*data-type="breadcrumb"/)
    for (const t of [ws, 'Field guide', 'Trail map']) expect(html).toContain(`<span class="breadcrumb__item">${t}</span>`)
    expect(html).toContain('https://files.example.com/docs/handbook.pdf')
    expect(html).toContain('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')
  })

  test('Markdown import reads a breadcrumb marker back as the block (the path line is not kept as text)', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const md = ['# Crumbs', '', '<!-- breadcrumb -->', 'One › Somewhere › Crumbs', '', 'Body after the path.', ''].join('\n')
    const dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'crumbs.md', mimeType: 'text/markdown', buffer: Buffer.from(md) }])
    await expect(dialog.getByText(/Import complete/)).toBeVisible()
    const json = await wsEval(page, (s) => {
      const p = (Object.values(s.pages) as Array<Record<string, any>>).find((x) => !x.trashed && /Body after the path/.test(x.plain ?? ''))
      return p ? JSON.stringify(p.content) : ''
    })
    expect(json).toContain('"type":"breadcrumb"')
    expect(json).not.toContain('Somewhere')
  })
})

test.describe('Notion blocks in German', () => {
  test.use({ locale: 'de-DE' })

  test('/Formular, /Brotkrumen, /Link zur Seite — German names, questions and answers', async ({ page }) => {
    await openApp(page)
    const target = await createPage(page, { title: 'Preisliste' })
    const parent = await createPage(page, { title: 'Vertrieb' })
    const id = await createPage(page, { title: 'Kontakt', parentId: parent, content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()

    await slash(page, 'brotkrumen', 'Brotkrumen')
    await expect(ed.locator('nav.crumbs-view .crumbs-view__title')).toHaveText([await workspaceName(page), 'Vertrieb', 'Kontakt'])
    await page.keyboard.press(`${MOD}+End`)

    await slash(page, 'link zur', 'Link zur Seite')
    const picker = page.getByRole('dialog', { name: 'Link zur Seite' })
    await picker.getByRole('combobox', { name: 'Seiten suchen…' }).fill('Preisliste')
    await page.keyboard.press('Enter')
    await expect(ed.locator('.page-link')).toContainText('Preisliste')
    await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'pageLink')?.attrs?.pageId).toBe(target)
    await page.keyboard.press(`${MOD}+End`)

    await slash(page, 'formular', 'Formular')
    const db = ed.locator('section.db')
    await expect(db.locator('.db-inlinehead__title')).toHaveValue('Formular')
    const qs = db.locator('form.fm .fm-q')
    await expect(qs).toHaveCount(3)
    await expect(qs.nth(0)).toContainText('Name')
    await expect(qs.nth(1)).toContainText('E-Mail')
    await expect(qs.nth(2)).toContainText('Nachricht')
    await expect(db.getByRole('button', { name: 'Formular teilen' })).toBeVisible()
    await qs.nth(0).locator('input').fill('Grace Hopper')
    await qs.nth(1).locator('input').fill('grace@example.com')
    await db.getByRole('button', { name: 'Absenden' }).click()
    await expect(db.locator('.fm--done')).toContainText('Antwort erfasst')
    await flush(page)
    const rows = await wsEval(page, (s) => (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.title === 'Grace Hopper' && !p.trashed).map((p) => Object.values(p.properties)))
    expect(rows).toEqual([expect.arrayContaining(['grace@example.com'])])
    const views = await wsEval(page, (s) => (Object.values(s.databases) as Array<Record<string, any>>).flatMap((d) => d.views.map((v: { name: string }) => v.name)))
    expect(views).toEqual(expect.arrayContaining(['Formular', 'Antworten']))
  })
})
