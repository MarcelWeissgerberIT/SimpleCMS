import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, heading, wsEval, flush, reloadApp, escapeRe, MOD } from './fixtures'

const CLIP = readFileSync('tests/fixtures/media/clip.webm')
const TONE = readFileSync('tests/fixtures/media/tone.ogg')
const TONE_URL = 'https://media.example.test/audio/tone.ogg'

/** Type a slash command and run the active match. */
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

const textOf = (n: JSONContent | undefined): string => (n?.text ?? '') + (n?.content ?? []).map(textOf).join('')

/** Pick an entry of the block menu's "Turn into" submenu for the block holding `line`. */
async function turnInto(page: Page, line: Locator, target: string) {
  await line.hover()
  await page.locator('.block-handle__grip').click()
  await page.getByRole('menuitem', { name: 'Turn into' }).click()
  // entries carry their Markdown shortcut ("Heading 2 ##")
  await page.getByRole('menuitem', { name: new RegExp(`^${escapeRe(target)}(\\s|$)`) }).click()
}

/** The export dialog from the command palette (the editor's own ⌘K edits links, so leave it first). */
async function openExport(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('>export')
  await page.keyboard.press('Enter')
  return page.getByRole('dialog')
}

/** Ready state of the first media element inside `scope` (≥ 1: metadata loaded). */
const mediaState = (el: Locator) => el.evaluate((m: HTMLMediaElement) => ({ ready: m.readyState, duration: Number.isFinite(m.duration) ? m.duration : 0 }))

/** A file paste / drop on the editor, the way the browser delivers it. */
async function dispatchFiles(page: Page, kind: 'paste' | 'drop', files: Array<{ name: string; type: string; b64: string }>, at?: { x: number; y: number }) {
  await page.evaluate(
    ({ kind, files, at }) => {
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
      const dom = document.querySelector('#main .ProseMirror')!
      if (kind === 'paste') dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      else dom.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: at!.x, clientY: at!.y }))
    },
    { kind, files, at },
  )
}

test.describe('toggle headings', () => {
  test('slash menu, fold / unfold, turn into heading and back, listed in the table of contents', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Toggle headings', content: doc({ type: 'toc' }, para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()

    await slash(page, 'toggle heading 2', 'Toggle heading 2')
    await page.keyboard.type('Launch plan')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Body under the heading')

    const toggle = ed.locator('[data-type="details"][data-heading="2"]')
    await expect(toggle).toHaveCount(1)
    // the title reads as a heading (one level below the page title) in heading typography
    const summary = toggle.locator('summary')
    await expect(summary).toHaveText('Launch plan')
    await expect(summary).toHaveAttribute('role', 'heading')
    await expect(summary).toHaveAttribute('aria-level', '3')
    expect(await summary.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(20)
    await flush(page)
    let blocks = await blocksOf(page, id)
    const stored = blocks.find((b) => b.type === 'details')!
    expect(stored.attrs).toMatchObject({ heading: 2, open: true })
    const blockId = stored.attrs!.id as string
    expect(blockId).toBeTruthy()
    expect(textOf(stored.content![1])).toBe('Body under the heading')

    // the table of contents lists it
    await expect(ed.locator('.toc-view__text')).toHaveText(['Launch plan'])

    // fold: the body hides, the heading level and block id survive the chevron
    await toggle.getByRole('button', { name: 'Collapse toggle' }).click()
    await expect(toggle.getByText('Body under the heading')).toBeHidden()
    await flush(page)
    blocks = await blocksOf(page, id)
    expect(blocks.find((b) => b.type === 'details')!.attrs).toMatchObject({ heading: 2, open: false, id: blockId })
    await toggle.getByRole('button', { name: 'Expand toggle' }).click()
    await expect(toggle.getByText('Body under the heading')).toBeVisible()

    // turn into a plain heading: the title stays, the body is lifted out below it
    await turnInto(page, summary, 'Heading 2')
    await expect(ed.locator('[data-type="details"]')).toHaveCount(0)
    await expect(ed.locator('h3')).toHaveText('Launch plan')
    await flush(page)
    blocks = await blocksOf(page, id)
    const at = blocks.findIndex((b) => b.type === 'heading')
    expect(blocks[at].attrs?.level).toBe(2)
    expect(textOf(blocks[at + 1])).toBe('Body under the heading')

    // …and back: the heading text becomes the title of a toggle heading with an empty body
    await turnInto(page, ed.locator('h3', { hasText: 'Launch plan' }), 'Toggle heading 1')
    await expect(ed.locator('[data-type="details"][data-heading="1"] summary')).toHaveText('Launch plan')
    await flush(page)
    blocks = await blocksOf(page, id)
    const back = blocks.find((b) => b.type === 'details')!
    expect(back.attrs?.heading).toBe(1)
    expect(textOf(back.content![0])).toBe('Launch plan')
    expect(textOf(back.content![1])).toBe('')
    await expect(ed.locator('.toc-view__text')).toHaveText(['Launch plan'])
  })

  test('markdown shortcuts: ">## " on a line, "> " in a heading, "# " in a toggle title', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Shortcuts', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()

    await page.keyboard.type('>## Typed section')
    await expect(ed.locator('[data-type="details"][data-heading="2"] summary')).toHaveText('Typed section')
    await page.keyboard.press(`${MOD}+End`)

    await page.keyboard.type('### Made heading')
    await page.keyboard.press('Home')
    await page.keyboard.type('> ')
    await expect(ed.locator('[data-type="details"][data-heading="3"] summary')).toHaveText('Made heading')
    await page.keyboard.press(`${MOD}+End`)

    await page.keyboard.type('>> plain toggle')
    await page.keyboard.press('Home')
    await page.keyboard.type('# ')
    await expect(ed.locator('[data-type="details"][data-heading="1"] summary')).toHaveText('plain toggle')
    await flush(page)
    const levels = (await blocksOf(page, id)).filter((b) => b.type === 'details').map((b) => b.attrs?.heading)
    expect(levels).toEqual([2, 3, 1])
  })

  test('Markdown export → import round trip keeps toggle headings and video blocks', async ({ page }, testInfo) => {
    const { unzipSync, strFromU8 } = await import('fflate')
    await openApp(page)
    const toggle = (level: number, title: string, body: string): JSONContent => ({
      type: 'details',
      attrs: { open: true, heading: level },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: title }] },
        { type: 'detailsContent', content: [para(body)] },
      ],
    })
    const id = await createPage(page, { title: 'Round trip', content: doc(toggle(2, 'Folded section', 'folded body'), para('')) })
    await gotoPage(page, id)
    await editorOf(page, id).locator('p').last().click()
    await dispatchFiles(page, 'paste', [{ name: 'clip.webm', type: 'video/webm', b64: CLIP.toString('base64') }])
    await expect(editorOf(page, id).locator('.media-view--video video')).toHaveAttribute('src', /^blob:/)
    await flush(page)
    const ref = await wsEval(
      page,
      (s, id) => {
        const content = s.pages[id].content
        const blocks = content.content.map((b: Record<string, any>) => (b.type === 'video' ? { ...b, attrs: { ...b.attrs, caption: 'Teaser cut' } } : b))
        s.setContent(id, { ...content, content: [...blocks, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] }, 'e2e')
        return blocks.find((b: Record<string, any>) => b.type === 'video').attrs.src as string
      },
      id,
    )
    expect(ref).toMatch(/^onefile:/)
    await flush(page)
    const dialog = await openExport(page)
    await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('round-trip.zip')
    await (await download).saveAs(file)
    await page.keyboard.press('Escape')

    const entries = unzipSync(new Uint8Array(readFileSync(file)))
    const mdName = Object.keys(entries).find((n) => n.endsWith('.md'))!
    const md = strFromU8(entries[mdName])
    expect(md).toContain('<summary><h2>Folded section</h2></summary>')
    expect(md).toMatch(/<video src="_files\/clip\.webm" controls title="Teaser cut"[^>]*><\/video>/)
    expect(Object.keys(entries)).toContain('_files/clip.webm')

    // import the folder again: the same blocks come back, the video plays from a new local file
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'round-trip.zip', mimeType: 'application/zip', buffer: readFileSync(file) }])
    await expect(page.getByRole('dialog').getByText(/Import complete/)).toBeVisible({ timeout: 20_000 })
    const imported = await wsEval(
      page,
      (s, id) => {
        const p = (Object.values(s.pages) as Array<Record<string, any>>).find((x) => x.id !== id && !x.trashed && x.title === 'Round trip')
        return p ? (p.content?.content ?? []) : null
      },
      id,
    )
    expect(imported, 'the imported page').not.toBeNull()
    const details = imported!.find((b: JSONContent) => b.type === 'details')
    expect(details.attrs.heading).toBe(2)
    expect(textOf(details.content[0])).toBe('Folded section')
    expect(textOf(details.content[1])).toBe('folded body')
    const video = imported!.find((b: JSONContent) => b.type === 'video')
    expect(video.attrs).toMatchObject({ name: 'clip.webm', caption: 'Teaser cut' })
    expect(video.attrs.src).toMatch(/^onefile:/)
    expect(video.attrs.src).not.toBe(ref)
    // nothing left over as a plain attachment
    expect(imported!.some((b: JSONContent) => b.type === 'fileBlock')).toBe(false)
  })
})

test.describe('video and audio blocks', () => {
  test('video: upload through the file picker, metadata plays, caption survives a reload', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Video page', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, 'video', 'Video')
    const empty = ed.locator('.media-empty[data-type="video"]')
    await expect(empty).toContainText('Video — no source')
    const chooser = page.waitForEvent('filechooser')
    await empty.getByRole('button', { name: 'Upload' }).click()
    await (await chooser).setFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: CLIP }])

    const view = ed.locator('.media-view--video')
    const video = view.locator('video')
    await expect(video).toHaveAttribute('src', /^blob:/)
    expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(false)
    await expect.poll(async () => (await mediaState(video)).ready, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    expect((await mediaState(video)).duration).toBeGreaterThan(0)
    // the spec bar: kind, name, duration · size
    await expect(view.locator('.media-view__name')).toHaveText('clip.webm')
    await expect(view.locator('.media-view__meta')).toHaveText(/^00:0[12] · 17\.\d KB$/)

    // caption
    await view.hover()
    await view.getByRole('button', { name: 'Caption' }).click()
    await page.keyboard.type('Teaser cut')
    await page.keyboard.press('Enter')
    await flush(page)
    const stored = (await blocksOf(page, id)).find((b) => b.type === 'video')!
    expect(stored.attrs).toMatchObject({ name: 'clip.webm', caption: 'Teaser cut' })
    expect(stored.attrs!.src).toMatch(/^onefile:/)

    await reloadApp(page)
    const view2 = editorOf(page, id).locator('.media-view--video')
    await expect(view2.locator('figcaption input')).toHaveValue('Teaser cut')
    await expect.poll(async () => (await mediaState(view2.locator('video'))).ready, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    // keyboard: the selected block's toolbar is reachable with Tab, Escape returns to the block
    await view2.locator('.media-view__bar').click()
    await page.keyboard.press('Tab')
    await expect(view2.getByRole('button', { name: 'Align left' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(editorOf(page, id)).toBeFocused()
  })

  test('audio: a link to an audio file plays in the keycap transport', async ({ page }) => {
    await page.route(TONE_URL, (route) => route.fulfill({ status: 200, contentType: 'audio/ogg', body: TONE, headers: { 'access-control-allow-origin': '*' } }))
    await openApp(page)
    const id = await createPage(page, { title: 'Audio page', content: doc(para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await slash(page, 'audio', 'Audio')
    const input = ed.locator('.media-empty[data-type="audio"] input')
    await expect(input).toBeFocused()
    await page.keyboard.type(TONE_URL)
    await page.keyboard.press('Enter')

    const view = ed.locator('.media-view--audio')
    await expect(view.locator('.media-view__name')).toHaveText('tone.ogg')
    const audio = view.locator('audio')
    await expect.poll(async () => (await mediaState(audio)).ready, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    await expect(view.locator('.media-transport__time--total')).toHaveText('00:02')
    await expect(view.locator('.media-view__meta')).toContainText('media.example.test')

    // play / pause from the keycap
    await view.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(view.locator('.led')).toHaveClass(/led--on/)
    await view.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(view.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    // links can be copied, local files cannot
    await expect(view.getByRole('button', { name: 'Copy link' })).toBeAttached()

    await flush(page)
    const stored = (await blocksOf(page, id)).find((b) => b.type === 'audio')!
    expect(stored.attrs).toMatchObject({ src: TONE_URL, name: 'tone.ogg' })
  })

  test('pasting and dropping media files creates video / audio blocks, oversized files are refused', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Drop zone', content: doc(para('first line'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()

    await dispatchFiles(page, 'paste', [{ name: 'memo.ogg', type: 'audio/ogg', b64: TONE.toString('base64') }])
    await expect(ed.locator('.media-view--audio .media-view__name')).toHaveText('memo.ogg')

    const box = (await ed.locator('p', { hasText: 'first line' }).boundingBox())!
    await dispatchFiles(page, 'drop', [{ name: 'dropped.webm', type: 'video/webm', b64: CLIP.toString('base64') }], { x: box.x + 20, y: box.y + box.height / 2 })
    await expect(ed.locator('.media-view--video .media-view__name')).toHaveText('dropped.webm')
    await expect.poll(async () => (await mediaState(ed.locator('.media-view--video video'))).ready, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    await flush(page)
    const types = (await blocksOf(page, id)).map((b) => b.type)
    expect(types).toEqual(expect.arrayContaining(['video', 'audio']))
    expect(types).not.toContain('fileBlock')
    const media = (await blocksOf(page, id)).filter((b) => b.type === 'video' || b.type === 'audio')
    for (const m of media) expect(m.attrs!.src).toMatch(/^onefile:/)

    // over the 200 MB limit: a toast, no block
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(201 * 1024 * 1024)], 'huge.mp4', { type: 'video/mp4' }))
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(page.getByText('“huge.mp4” is larger than 200 MB')).toBeVisible()
    await expect(ed.locator('.media-view--video')).toHaveCount(1)
  })

  test('HTML export embeds the media; a share link carries a note instead of a local file', async ({ page }, testInfo) => {
    await page.route(TONE_URL, (route) => route.fulfill({ status: 200, contentType: 'audio/ogg', body: TONE, headers: { 'access-control-allow-origin': '*' } }))
    await openApp(page)
    const id = await createPage(page, { title: 'Exported media', content: doc(heading(1, 'Clips'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()
    await dispatchFiles(page, 'paste', [{ name: 'clip.webm', type: 'video/webm', b64: CLIP.toString('base64') }])
    await expect(ed.locator('.media-view--video video')).toHaveAttribute('src', /^blob:/)
    await flush(page)
    await wsEval(
      page,
      (s, { id, url }) => {
        const content = s.pages[id].content
        s.setContent(id, { ...content, content: [...content.content, { type: 'audio', attrs: { src: url, name: 'tone.ogg', caption: '' } }] }, 'e2e')
      },
      { id, url: TONE_URL },
    )
    await flush(page)

    const dialog = await openExport(page)
    await dialog.getByRole('radio', { name: /Web page/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('media.html')
    await (await download).saveAs(file)
    const html = readFileSync(file, 'utf8')
    expect(html).toMatch(/<video[^>]*src="data:video\/webm;base64,/)
    expect(html).toContain(`<audio controls="" preload="metadata" src="${TONE_URL}"`)
    expect(html).not.toContain('onefile:')
    await page.keyboard.press('Escape')

    // share link: the local video becomes a note, the web audio stays a player
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const url = page.getByRole('dialog').getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    expect(link.length).toBeLessThan(4000)
    await page.keyboard.press('Escape')
    await page.goto(link)
    await expect(page.locator('.shv__doc')).toContainText('clip.webm — media file not included')
    await expect(page.locator('.shv__doc .media-view--audio')).toBeVisible()
  })
})
