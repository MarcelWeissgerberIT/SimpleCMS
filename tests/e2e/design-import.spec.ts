/**
 * PowerPoint import + "Take over from Claude Design" (features/io/import/{pptx,deck,style,design}.ts,
 * io/DeckImport.tsx): a .pptx read here (slides in order, titles, bullets with levels, notes as a toggle,
 * tables, pictures stored, a chart as a table), previewed first, written as one page (Present = one slide per
 * PowerPoint slide) or a page per slide, with one Undo; the Claude Design step (HTML export → content + a
 * style note, PPTX theme, screenshots described by Claude only after asking, the style saved as a One memory
 * example that "#tag" brings into a request); the file block's "Open as page" on a .pptx; the zip-bomb guard;
 * a pasted Claude Design link → bookmark. The files are real (tests/e2e/helpers/design.ts); Claude is mocked —
 * nothing reaches api.anthropic.com.
 */
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, wsEval, uiEval, editorOf, flush, pageIdByTitle, sse, MOD } from './fixtures'
import { PNG, designHtml, pptxBombBytes, pptxBytes } from './helpers/design'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const pptxFile = (name = 'Quarterly review.pptx', bytes = pptxBytes()) => ({ name, mimeType: PPTX_TYPE, buffer: Buffer.from(bytes) })
const htmlFile = () => ({ name: 'acme-launch.html', mimeType: 'text/html', buffer: Buffer.from(designHtml()) })
const shotFile = () => ({ name: 'launch screen.png', mimeType: 'image/png', buffer: PNG })

const ALT = 'Launch page with the headline and an orange signup button'
const CAPTION = 'The launch page as designed'
const READ = '# Acme Launch\n\nShip faster with **Acme**.\n\n- Faster sync\n- Offline mode'

interface Claude {
  /** streamed requests (image describe / read, terminal tasks) */
  stream: Json[]
  /** structured, not streamed (memory proposals) */
  structured: Json[]
}

/** api.anthropic.com: the image actions and terminal tasks get SSE, structured requests JSON. Never a real request. */
async function mockClaude(ctx: BrowserContext): Promise<Claude> {
  const out: Claude = { stream: [], structured: [] }
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    if (!body.stream) {
      out.structured.push(body)
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_struct', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ memories: [] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }),
      })
    }
    out.stream.push(body)
    const task = JSON.stringify(body.messages ?? '')
    const answer = /Write the alt text/.test(task) ? JSON.stringify({ alt: ALT, caption: CAPTION }) : /Read out all the text/.test(task) ? READ : 'Drafted the launch note in the Acme style [M1].'
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(answer) })
    } catch {
      /* aborted */
    }
  })
  return out
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

async function openImport(page: Page) {
  await uiEval(page, (s) => s.openModal({ type: 'import' }))
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.io')).toBeVisible()
  return dialog
}

/** A source tile → its file picker → these files. */
async function viaTile(page: Page, source: string, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent('filechooser')
  await page.locator(`.io-src[data-source="${source}"]`).click()
  await (await chooser).setFiles(files)
}

/** A slot of the Claude Design step → its picker → these files. */
async function intoSlot(page: Page, slot: string, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent('filechooser')
  await page.locator(`.io-slot[data-slot="${slot}"] .btn`).click()
  await (await chooser).setFiles(files)
}

const pageOf = (page: Page, id: string): Promise<Json> => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id] ?? null)), id)
const text = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(text).join(''))

test.describe('PowerPoint import', () => {
  test('preview → one page: an H2 + divider per slide, bullets in levels, notes as a toggle, table, picture, chart as a table; Present shows 3 slides', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    const dialog = await openImport(page)
    await viaTile(page, 'pptx', [pptxFile()])

    const preview = dialog.getByTestId('pptx-preview')
    await expect(preview).toContainText('Quarterly review.pptx')
    await expect(preview.getByRole('textbox', { name: 'Page title' })).toHaveValue('Quarterly review')
    const slides = preview.getByRole('list', { name: 'Slides in the deck' }).getByRole('listitem')
    await expect(slides).toHaveCount(3)
    await expect(slides.nth(0)).toContainText('PAGE TITLE')
    await expect(slides.nth(1)).toContainText('Highlights')
    await expect(slides.nth(1)).toContainText('NOTES')
    await expect(slides.nth(2)).toContainText('TABLE · IMG 1')
    await expect(preview.getByTestId('pptx-lost')).toContainText('1 chart → a table with its data')
    await expect(preview.getByRole('radio', { name: /One page/ })).toHaveAttribute('aria-checked', 'true')
    await preview.getByTestId('pptx-import').click()
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 })
    await expect(dialog.locator('[data-report]')).toContainText('A chart came in as a table with its data.')

    const id = await pageIdByTitle(page, 'Quarterly review')
    const p = await pageOf(page, id)
    // (the open editor may add its trailing empty line — and then writes it as its own)
    const blocks = (p.content.content as JSONContent[]).filter((b, i, all) => !(i === all.length - 1 && b.type === 'paragraph' && !b.content?.length))
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'horizontalRule', 'heading', 'bulletList', 'paragraph', 'details', 'horizontalRule', 'heading', 'table', 'image', 'paragraph', 'table'])
    // the title slide: page title + its line on top
    expect(text(blocks[0])).toBe('Q3 2026 · Team update')
    expect(blocks[2]).toMatchObject({ attrs: { level: 2 }, content: [{ text: 'Highlights' }] })
    // bullets: the second level nests in the first item; bold kept
    const first = blocks[3].content![0].content!
    expect(first.map((n) => n.type)).toEqual(['paragraph', 'bulletList'])
    expect(JSON.stringify(first[0])).toContain('{"type":"text","marks":[{"type":"bold"}],"text":"12 %"}')
    expect(text(first[1])).toBe('Mostly in October')
    expect(blocks[3].content).toHaveLength(2)
    // the text box after the body (reading order), italic
    expect(JSON.stringify(blocks[4])).toContain('"italic"')
    // notes: a closed toggle "Notes"
    expect(blocks[5].attrs?.open).toBe(false)
    expect(text(blocks[5].content![0])).toBe('Notes')
    expect(text(blocks[5].content![1])).toContain('Mention the October spike.')
    // table with a header row, the picture stored on this device, the chart's data as a table
    expect(blocks[8].content![0].content!.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
    expect(text(blocks[8])).toContain('August44,50013')
    expect(blocks[9].attrs?.src).toMatch(/^onefile:/)
    expect(blocks[9].attrs?.alt).toBe('Revenue by month')
    expect(text(blocks[10])).toBe('Chart: Signups')
    expect(text(blocks[11])).toContain('Sep240')
    // the picture really is in IndexedDB
    const size = await page.evaluate(async (src) => (await (window as unknown as { __one: Json }).__one.files.getFile(src))?.size ?? 0, blocks[9].attrs!.src as string)
    expect(size).toBe(PNG.length)

    // Present: one presentation slide per PowerPoint slide
    await dialog.getByRole('button', { name: 'Present' }).click()
    const deck = page.locator('.pres[role="dialog"]')
    await expect(deck).toBeVisible()
    const counter = deck.locator('.pres__corner--br')
    await expect(counter).toHaveText(/01\s*\/\s*03/)
    await expect(deck.locator('.pres__title')).toHaveText('Quarterly review')
    await expect(deck).toContainText('Q3 2026 · Team update')
    await page.keyboard.press('ArrowRight')
    await expect(counter).toHaveText(/02\s*\/\s*03/)
    await expect(deck).toContainText('Highlights')
    await page.keyboard.press('ArrowRight')
    await expect(deck).toContainText('Numbers')
    await expect(deck.locator('img')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(deck).toHaveCount(0)
    // read here: nothing went to Claude
    expect(claude.stream.length + claude.structured.length).toBe(0)
  })

  test('a page per slide (sub-pages under the deck page); Undo import removes everything in one step', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    const dialog = await openImport(page)
    // dropped / chosen with "Choose files": detected by its extension
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([pptxFile('Board meeting.pptx')])
    const preview = dialog.getByTestId('pptx-preview')
    await preview.getByRole('textbox', { name: 'Page title' }).fill('Board meeting Q3')
    await preview.getByRole('radio', { name: /A page per slide/ }).click()
    await preview.getByTestId('pptx-import').click()
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 })
    // a page per slide: no Present key
    await expect(dialog.getByRole('button', { name: 'Present' })).toHaveCount(0)

    const id = await pageIdByTitle(page, 'Board meeting Q3')
    const kids = await wsEval(page, (s, id) => (Object.values(s.pages) as Json[]).filter((p) => p.parentId === id && !p.trashed).sort((a, b) => a.order - b.order).map((p) => ({ title: p.title, content: JSON.stringify(p.content) })), id)
    expect(kids.map((k) => k.title)).toEqual(['Highlights', 'Numbers'])
    expect(kids[0].content).toContain('Mention the October spike.')
    expect(kids[1].content).toMatch(/"src":"onefile:/)
    const root = await pageOf(page, id)
    expect(JSON.stringify(root.content)).toContain('Q3 2026 · Team update')
    expect((root.content.content as JSONContent[]).filter((b) => b.type === 'pageLink')).toHaveLength(2)

    await dialog.getByRole('button', { name: 'Undo import' }).click()
    await expect(page.locator('.toast', { hasText: 'Import undone.' })).toBeVisible()
    await expect(dialog.locator('.io-drop')).toBeVisible()
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before)
  })

  test('zip-bomb guard: a deck whose declared unpacked size is over 200 MB is refused before anything is inflated; an old .ppt is not read', async ({ page }) => {
    await openApp(page)
    const dialog = await openImport(page)
    await viaTile(page, 'pptx', [pptxFile('huge.pptx', pptxBombBytes())])
    await expect(dialog.getByRole('alert')).toContainText('This deck unpacks to more than 200 MB')
    await dialog.getByRole('button', { name: 'Import more' }).click()
    // more than 300 slides: refused with the numbers
    await viaTile(page, 'pptx', [pptxFile('all-hands.pptx', pptxBytes({ extraSlides: 298 }))])
    await expect(dialog.getByRole('alert')).toContainText('This deck has 301 slides — at most 300')
    await dialog.getByRole('button', { name: 'Import more' }).click()
    await viaTile(page, 'pptx', [{ name: 'broken.pptx', mimeType: PPTX_TYPE, buffer: Buffer.from('not a zip at all') }])
    await expect(dialog.getByRole('alert')).toContainText('could not be read')
  })

  test('a .pptx file block: AI key → Open as page (on this device, pictures stored on apply); dropping one offers it', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const res = await page.evaluate(async (data) => {
      const one = (window as unknown as { __one: Json }).__one
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const src = await one.files.saveFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), 'Quarterly review.pptx')
      const s = one.workspace.getState()
      const id = s.createPage({ title: 'Team sync', parentId: null })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Slides from the review:' }] }, { type: 'fileBlock', attrs: { src, name: 'Quarterly review.pptx', size: bytes.length, display: 'file' } }] }, 'e2e')
      return { id, src }
    }, Buffer.from(pptxBytes()).toString('base64'))
    await flush(page)
    await gotoPage(page, res.id)
    const card = editorOf(page, res.id).locator('.file-view', { hasText: 'Quarterly review.pptx' })
    await card.hover()
    await card.getByTestId('file-ai-key').click()
    await expect(page.getByRole('menuitem', { name: /Open as page/ })).toContainText('LOCAL')
    await expect(page.getByRole('menuitem', { name: /Summarise/ })).toBeVisible()
    await page.getByRole('menuitem', { name: /Open as page/ }).click()
    const ai = page.getByRole('dialog', { name: /Ask Claude/ })
    await expect(ai.getByTestId('ai-file-meta')).toContainText(/On this device · nothing sent · PPTX/i)
    await expect(ai.getByRole('textbox', { name: 'Page title' })).toHaveValue('Quarterly review')
    await expect(ai.getByTestId('ai-file-deck')).toContainText('3 slides · 1 pictures come along')
    await ai.getByRole('option', { name: /^Create the page/ }).click()
    await expect(ai).toHaveCount(0)
    const blocks = async () => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content)), res.id)
    await expect.poll(async () => (await blocks()).map((b: Json) => b.type).slice(0, 3)).toEqual(['paragraph', 'fileBlock', 'pageLink'])
    const subId = (await blocks())[2].attrs.pageId as string
    const sub = await pageOf(page, subId)
    expect(sub.title).toBe('Quarterly review')
    expect(sub.contentOrigin).toBe('import')
    const json = JSON.stringify(sub.content)
    expect(json).toMatch(/"type":"image","attrs":\{[^}]*"src":"onefile:/)
    expect(json).toContain('Highlights')
    expect(json).not.toContain('ppt/media')
    expect(claude.stream.length + claude.structured.length).toBe(0)

    // dropping a deck onto a page: the toast offers "Open as page"
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const file = new File([bytes], 'Roadmap.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const target = document.querySelector('#main .ProseMirror p')!
      const r = target.getBoundingClientRect()
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 5 }))
    }, Buffer.from(pptxBytes()).toString('base64'))
    const toast = page.locator('.toast', { hasText: '“Roadmap.pptx” added' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Open as page' }).click()
    await expect(ai.getByTestId('ai-file-deck')).toBeVisible()
  })
})

test.describe('Take over from Claude Design', () => {
  test('HTML + PPTX + a screenshot → the page with its style note, the deck as a sub-page, the screenshot described after asking; the style saved to memory and "#tag" brings it into a terminal request', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const dialog = await openImport(page)
    await page.locator('.io-src[data-source="design"]').click()
    const step = dialog.getByTestId('design-import')
    await expect(step).toContainText('Take over from Claude Design')
    await expect(step).toContainText('Claude Design has no direct connection')
    await expect(step.getByTestId('design-tokens')).toContainText('No colours, fonts or sizes yet')

    await intoSlot(page, 'html', [htmlFile()])
    await expect(step.locator('.io-slot[data-slot="html"]')).toContainText(/acme-launch\.html · \d+ colours · 3 fonts · 5 sizes/)
    await intoSlot(page, 'pptx', [pptxFile()])
    await expect(step.locator('.io-slot[data-slot="pptx"]')).toContainText('3 slides · 12 theme colours')
    await intoSlot(page, 'shots', [shotFile()])
    await expect(step.locator('.io-shots img')).toHaveCount(1)
    const tokens = step.getByTestId('design-tokens')
    await expect(tokens).toContainText('#ff5a1f')
    await expect(tokens).toContainText('Primary')
    await expect(tokens).toContainText('Space Grotesk')
    await expect(step.getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Acme Launch')

    // describe: asks first (the key arms, a second press sends)
    await step.getByRole('switch', { name: 'Describe the screenshots with Claude' }).click()
    await step.getByRole('switch', { name: 'Save the style to One memory' }).click()
    await expect(step.getByRole('textbox', { name: 'Tag' })).toHaveAttribute('placeholder', 'design-acme-launch')
    await step.getByTestId('design-import-go').click()
    await expect(step.getByTestId('design-confirm')).toContainText('1 screenshot goes to Anthropic')
    expect(claude.stream).toHaveLength(0)
    await expect(step.getByTestId('design-import-go')).toHaveText('Send & import')
    await step.getByTestId('design-import-go').click()
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByTestId('import-memory')).toContainText('Saved #design-acme-launch to One memory')
    await expect(dialog.locator('[data-report]')).toContainText('Inline SVG graphics')
    // describe + read, each with the picture as an image block
    expect(claude.stream).toHaveLength(2)
    for (const b of claude.stream) expect(JSON.stringify(b.messages)).toContain('"type":"image"')

    const id = await pageIdByTitle(page, 'Acme Launch')
    const root = await pageOf(page, id)
    const blocks = root.content.content as JSONContent[]
    // the style note on top: a closed toggle "Design tokens"
    expect(blocks[0].type).toBe('details')
    expect(blocks[0].attrs?.open).toBe(false)
    expect(text(blocks[0].content![0])).toBe('Design tokens')
    const note = JSON.stringify(blocks[0])
    for (const s of ['#ff5a1f', '--brand', 'Primary', '#faf7f2', 'Background', 'Space Grotesk', 'Inter', 'JetBrains Mono', '48 px', '32 px', '4 px · 12 px · full (pill)', '8 · 16 · 24 px — 8 px grid', 'accent3', 'Accent 3'])
      expect(note).toContain(s)
    // the swatch: the nearest of One's colours
    expect(note).toMatch(/"textStyle","attrs":\{[^}]*"color":"orange"/)
    // the HTML content: converted, scripts gone, the data: picture stored
    const json = JSON.stringify(root.content)
    expect(json).toContain('November 3')
    expect(json).toContain('Offline mode')
    expect(json).not.toMatch(/designPwned|<script|"type":"svg"/)
    expect((blocks.filter((b) => b.type === 'image') as JSONContent[]).every((b) => String(b.attrs?.src).startsWith('onefile:'))).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { __designPwned?: boolean }).__designPwned ?? false)).toBe(false)
    // the deck: a sub-page with a card on the page; the screenshot described, its text in a toggle
    const deckId = (blocks.find((b) => b.type === 'pageLink')?.attrs?.pageId ?? '') as string
    expect((await pageOf(page, deckId)).title).toBe('Quarterly review')
    const shot = blocks.find((b) => b.type === 'image' && b.attrs?.alt === ALT)!
    expect(shot.attrs?.caption).toBe(CAPTION)
    const shotText = blocks[blocks.indexOf(shot) + 1]
    expect(shotText.type).toBe('details')
    expect(text(shotText.content![0])).toBe('Text in the screenshot')
    expect(text(shotText.content![1])).toContain('Ship faster with Acme')

    // the memory: an Example tagged design-acme-launch, the style note as the pattern
    const ex = await wsEval(page, (s) => {
      const db = (Object.values(s.databases) as Json[]).find((d) => d.system === 'memory')
      if (!db) return null
      const prop = (name: string) => db.properties.find((p: Json) => p.name === name)
      const row = (Object.values(s.pages) as Json[]).find((r) => r.databaseId === db.id && r.properties[prop('Tag').id] === 'design-acme-launch')
      return row ? { title: row.title, type: prop('Type').options.find((o: Json) => o.id === row.properties[prop('Type').id])?.name, source: row.properties[prop('Source').id], content: JSON.stringify(row.content) } : null
    })
    expect(ex).toMatchObject({ type: 'Example', title: 'Visual style of “Acme Launch” from Claude Design: colours, fonts, sizes' })
    expect(ex!.source).toBe(`Acme Launch · #/p/${id}`)
    expect(ex!.content).toContain('"text":"Pattern"')
    expect(ex!.content).toContain('#ff5a1f')
    expect(ex!.content).toContain('"text":"Example"')
    expect(ex!.content).toContain('Offline mode')

    // "#design-acme-launch" in the AI terminal: the example goes along in full
    await dialog.getByRole('button', { name: 'View import' }).click()
    await page.keyboard.press(`${MOD}+j`)
    const input = page.locator('.term-prompt__input')
    await expect(input).toBeVisible()
    await input.fill('Write in #design-acme-launch the launch note for the newsletter')
    await input.press('Enter')
    await expect.poll(() => claude.stream.length).toBe(3)
    const sent = JSON.stringify(claude.stream[2].messages)
    expect(sent).toContain('Example #design-acme-launch')
    expect(sent).toContain('#ff5a1f')
    expect(sent).toContain('Space Grotesk')
  })

  test('screenshots only, without describing: image blocks, nothing sent; "Describe" needs a key; Undo import', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    const dialog = await openImport(page)
    await page.locator('.io-src[data-source="design"]').click()
    const step = dialog.getByTestId('design-import')
    await intoSlot(page, 'shots', [shotFile(), { ...shotFile(), name: 'settings.png' }])
    await expect(step.locator('.io-shots img')).toHaveCount(2)
    // no key: describing is off and says why; no style: memory is off and says why
    await expect(step.getByRole('switch', { name: 'Describe the screenshots with Claude' })).toBeDisabled()
    await expect(step).toContainText('Needs your Claude key')
    await expect(step.getByRole('switch', { name: 'Save the style to One memory' })).toBeDisabled()
    await step.getByRole('textbox', { name: 'Name' }).fill('Settings redesign')
    await step.getByTestId('design-import-go').click()
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 })
    const id = await pageIdByTitle(page, 'Settings redesign')
    // (the open editor may add its trailing empty line)
    const blocks = ((await pageOf(page, id)).content.content as JSONContent[]).filter((b) => !(b.type === 'paragraph' && !b.content?.length))
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'image', 'image'])
    expect(blocks.map((b) => b.attrs?.alt)).toEqual([undefined, 'launch screen', 'settings'])
    expect(text(blocks[0])).toBe('Screenshots')
    expect(claude.stream.length + claude.structured.length).toBe(0)
    await dialog.getByRole('button', { name: 'Undo import' }).click()
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id], id)).toBe(false)
  })

  test('a pasted Claude Design link offers the bookmark card first (↵)', async ({ page }) => {
    await openApp(page)
    const id = await wsEval(page, (s) => {
      const id = s.createPage({ title: 'Design links', parentId: null })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph' }] }, 'e2e')
      return id
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'https://claude.ai/design/p/7f3c2a')
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    const menu = page.getByRole('listbox', { name: 'Paste as' })
    await expect(menu.getByRole('option')).toHaveText([/Bookmark/, /Link/])
    await page.keyboard.press('Enter')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].content.content[0]?.type, id)).toBe('bookmark')
    const attrs = await wsEval(page, (s, id) => s.pages[id].content.content[0].attrs, id)
    expect(attrs).toMatchObject({ url: 'https://claude.ai/design/p/7f3c2a', title: 'Claude Design' })
    await expect(ed.locator('.bookmark-card')).toContainText('Claude Design')
  })
})

test.describe('DE · 390 px', () => {
  test('PowerPoint preview and the Claude Design step in German at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openImport(page)
    await expect(dialog.locator('.io-src[data-source="design"]')).toContainText('Claude Design')
    await expect(dialog.locator('.io-src[data-source="pptx"]')).toContainText('Eine .pptx-Präsentation')
    await viaTile(page, 'pptx', [pptxFile()])
    const preview = dialog.getByTestId('pptx-preview')
    await expect(preview.getByRole('textbox', { name: 'Seitentitel' })).toHaveValue('Quarterly review')
    await expect(preview.getByTestId('pptx-lost')).toContainText('1 Diagramm → eine Tabelle mit seinen Daten')
    await expect(preview.getByTestId('pptx-import')).toHaveText('3 Folien importieren')
    // nothing wider than the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await preview.getByTestId('pptx-import').click()
    await expect(dialog.getByText(/Import abgeschlossen/)).toBeVisible({ timeout: 30_000 })
    const id = await pageIdByTitle(page, 'Quarterly review')
    const blocks = (await pageOf(page, id)).content.content as JSONContent[]
    expect(text(blocks.find((b) => b.type === 'details')!.content![0])).toBe('Notizen')
    expect(JSON.stringify(blocks)).toContain('Diagramm: Signups')
    expect(JSON.stringify(blocks)).toContain('"text":"Kategorie"')

    await dialog.getByRole('button', { name: 'Weitere importieren' }).click()
    await dialog.locator('.io-src[data-source="design"]').click()
    const step = dialog.getByTestId('design-import')
    await expect(step).toContainText('Aus Claude Design übernehmen')
    await intoSlot(page, 'html', [htmlFile()])
    await expect(step.getByTestId('design-tokens')).toContainText('Primär')
    await expect(step.getByRole('switch', { name: 'Stil im One-Gedächtnis speichern' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await step.getByTestId('design-import-go').click()
    await expect(dialog.getByText(/Import abgeschlossen/)).toBeVisible({ timeout: 30_000 })
    const root = await pageOf(page, await pageIdByTitle(page, 'Acme Launch'))
    const note = JSON.stringify(root.content.content[0])
    expect(note).toContain('"text":"Design-Tokens"')
    expect(note).toContain('Hintergrund')
    expect(note).toContain('Schriftgrößen')
  })
})
