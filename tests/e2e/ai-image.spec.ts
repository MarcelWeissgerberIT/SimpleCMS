/**
 * Claude for images (features/ai/image): an image block → describe (alt text + caption), read out the
 * text, image → table (table / spreadsheet / database), ask a question — from the image toolbar's AI key,
 * the block menu and the AI menu; background runs; the AI terminal's image reference. The image is a
 * PNG drawn in the test and uploaded into the block. Claude is mocked — nothing reaches api.anthropic.com.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, sidebarRow, flush, sse, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const ALT = 'Lab protocol P1: deck layout, a 96-well plate and a volume table.'
const CAPTION = 'Protocol P1 — deck, plate and volumes'
const VOLUMES = { title: 'Volumes', header: ['Reagent', 'Volume (µl)', 'Wells'], rows: [['Buffer', '50', 'A1–A12'], ['Enzyme', '2,5', 'B1–B12'], ['Sample', '10', 'C1–C12'], ['Water', '37,5', 'D1–D12']] }
const DECK = { title: 'Deck', header: ['Slot', 'Labware'], rows: [['1', 'Tips 200 µl'], ['2', '96-well plate']] }
const READ = '## Protocol P1\n\n1. Load the deck as shown.\n2. Fill the plate A1–H12.'
const ANSWER = 'The plate has **96 wells**: rows A–H, columns 1–12.'

type Kind = 'describe' | 'read' | 'table' | 'ask' | 'agent'

interface Claude {
  bodies: AnyState[]
  kinds: Kind[]
  release: () => void
  waiting: () => number
}

/** The task text of a request (the text block after the image). */
const taskText = (body: AnyState): string => {
  const content = (body.messages as AnyState[])?.[0]?.content
  return Array.isArray(content) ? content.map((b: AnyState) => (b.type === 'text' ? b.text : '')).join('\n') : String(content ?? '')
}

function kindOf(body: AnyState): Kind {
  if (Array.isArray(body.tools) && body.tools.length) return 'agent'
  const text = taskText(body)
  if (/Write the alt text/.test(text)) return 'describe'
  if (/Read out all the text/.test(text)) return 'read'
  if (/Find every table/.test(text)) return 'table'
  return 'ask'
}

/** api.anthropic.com, answered by kind (`hold`: until release()); never a real request. */
async function mockClaude(ctx: BrowserContext, opts: { hold?: boolean; tables?: object[] } = {}): Promise<Claude> {
  const bodies: AnyState[] = []
  const kinds: Kind[] = []
  const held: Array<() => void> = []
  const answers: Record<Kind, string> = {
    describe: JSON.stringify({ alt: ALT, caption: CAPTION }),
    read: READ,
    table: JSON.stringify({ tables: opts.tables ?? [VOLUMES] }),
    ask: ANSWER,
    agent: 'I looked at the image: a protocol with a volume table.',
  }
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const kind = kindOf(body)
    kinds.push(kind)
    if (opts.hold) await new Promise<void>((resolve) => held.push(resolve))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(answers[kind]) })
    } catch {
      /* aborted */
    }
  })
  return { bodies, kinds, release: () => held.splice(0).forEach((r) => r()), waiting: () => held.length }
}

/** A PNG with a small table on it, drawn in the page (w × h). */
async function tablePng(page: Page, w = 720, h = 420): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#111'
      g.font = 'bold 26px sans-serif'
      g.fillText('Protocol P1 — volumes', 24, 44)
      g.font = '20px sans-serif'
      const rows = [['Reagent', 'Volume (µl)', 'Wells'], ['Buffer', '50', 'A1–A12'], ['Enzyme', '2,5', 'B1–B12'], ['Sample', '10', 'C1–C12']]
      rows.forEach((r, i) => r.forEach((t, j) => g.fillText(t, 36 + j * 220, 104 + i * 58)))
      return c.toDataURL('image/png').split(',')[1]
    },
    { w, h },
  )
  return Buffer.from(b64, 'base64')
}

/** Width × height of a base64 PNG (its IHDR). */
const pngSize = (b64: string) => {
  const buf = Buffer.from(b64, 'base64')
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const setKey = (page: Page, lang?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), lang)
const panel = (page: Page) => page.getByRole('dialog', { name: /Ask Claude|Claude fragen/ })
const figure = (page: Page, id: string) => editorOf(page, id).locator('.image-view').first()

/** "Protokoll P1": a line, an image block with the uploaded PNG, a line. */
async function setup(page: Page, opts: { png?: Buffer } = {}): Promise<string> {
  const id = await createPage(page, { title: 'Protokoll P1', content: doc(para('Deck layout, plate and volumes for run P1.'), { type: 'image', attrs: { src: null } }, para('Notes follow below.')) })
  await gotoPage(page, id)
  const png = opts.png ?? (await tablePng(page))
  const chooser = page.waitForEvent('filechooser')
  await editorOf(page, id).locator('.media-empty').getByRole('button', { name: /Upload|Hochladen/ }).click()
  await (await chooser).setFiles({ name: 'protocol-p1.png', mimeType: 'image/png', buffer: png })
  await expect(figure(page, id).locator('img')).toBeVisible()
  await expect.poll(async () => String((await imageAttrs(page, id))?.src ?? '')).toMatch(/^onefile:/)
  return id
}

/** The top-level blocks of a page (store). */
const blocksOf = (page: Page, id: string): Promise<JSONContent[]> => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content?.content ?? [])), id)
const imageAttrs = async (page: Page, id: string): Promise<AnyState | null> => (await blocksOf(page, id)).find((b) => b.type === 'image')?.attrs ?? null
/** The blocks right after the image. */
const afterImage = async (page: Page, id: string): Promise<JSONContent[]> => {
  const blocks = await blocksOf(page, id)
  return blocks.slice(blocks.findIndex((b) => b.type === 'image') + 1)
}

/** The image toolbar's AI key → an action. */
async function viaToolbar(page: Page, id: string, action: RegExp) {
  await figure(page, id).hover()
  await figure(page, id).getByTestId('image-ai-key').click()
  await page.getByRole('menuitem', { name: action }).click()
}

/** The block menu (⋮⋮) of the image → an action of its "Claude" group. */
async function viaBlockMenu(page: Page, id: string, action: RegExp) {
  await figure(page, id).hover()
  await page.locator('.block-handle__grip').click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('Claude', { exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: action }).click()
}

/** The request carries the picture: base64 PNG (≤ 5 MB) in front of the task. */
function expectImageBlock(body: AnyState): { w: number; h: number } {
  const content = body.messages[0].content as AnyState[]
  expect(content[0].type).toBe('image')
  expect(content[0].source.type).toBe('base64')
  expect(content[0].source.media_type).toBe('image/png')
  expect(content[0].source.data.length).toBeGreaterThan(100)
  expect(content[0].source.data.length).toBeLessThanOrEqual(5 * 1024 * 1024)
  expect(content[1].type).toBe('text')
  return pngSize(content[0].source.data)
}

const option = (page: Page, name: RegExp) => panel(page).getByRole('option', { name })

test.describe('Claude for images', () => {
  test('toolbar → Describe: the image goes along; Apply sets alt text + caption in one step; ⌘Z takes it back', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await viaToolbar(page, id, /Describe the image/)

    const ai = panel(page)
    await expect(ai.getByTestId('ai-image-describe')).toBeVisible()
    await expect(ai.getByRole('textbox', { name: 'Alt text' })).toHaveValue(ALT)
    await expect(ai.getByRole('textbox', { name: 'Caption' })).toHaveValue(CAPTION)
    await expect(ai.getByTestId('ai-image-meta')).toContainText(/720×420 · PNG/)
    await expect(ai.getByTestId('ai-reads')).toContainText(/image \+/)

    expect(claude.kinds).toEqual(['describe'])
    expect(expectImageBlock(claude.bodies[0])).toEqual({ w: 720, h: 420 })
    // the page goes along as "What Claude reads" allows (whole page here)
    expect(taskText(claude.bodies[0])).toContain('Deck layout, plate and volumes for run P1.')

    // the alt text can be edited before it is applied
    await ai.getByRole('textbox', { name: 'Caption' }).fill(`${CAPTION} (run 1)`)
    await option(page, /Apply alt text \+ caption/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await imageAttrs(page, id))?.alt).toBe(ALT)
    expect((await imageAttrs(page, id))?.caption).toBe(`${CAPTION} (run 1)`)
    await expect(figure(page, id).locator('img')).toHaveAttribute('alt', ALT)

    // one undo step: both back as they were (the upload named the image after its file)
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await imageAttrs(page, id))?.alt).toBe('protocol-p1')
    expect((await imageAttrs(page, id))?.caption ?? '').toBe('')
    await expect(page.getByTestId('ai-runs')).toHaveCount(0)
  })

  test('block menu → Read out the text: the Markdown lands right below the image', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await viaBlockMenu(page, id, /Read out the text/)
    await expect(panel(page)).toContainText('Load the deck as shown.')
    expect(claude.kinds).toEqual(['read'])
    expectImageBlock(claude.bodies[0])
    await option(page, /Insert below the image/).click()
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(async () => (await afterImage(page, id)).map((b) => b.type)).toEqual(['heading', 'orderedList', 'paragraph'])
    const after = await afterImage(page, id)
    expect(JSON.stringify(after[0])).toContain('Protocol P1')
    expect(JSON.stringify(after[2])).toContain('Notes follow below.')
  })

  test('Image → table: as table blocks (header row), as a spreadsheet (numbers as numbers), as a database (preview first)', async ({ page, context }) => {
    const claude = await mockClaude(context, { tables: [VOLUMES] })
    await openApp(page)
    await setKey(page)
    const id = await setup(page)

    // 1 — a real table below the image
    await viaToolbar(page, id, /Image → table/)
    const ai = panel(page)
    await expect(ai.getByTestId('ai-image-tables')).toContainText('Volumes')
    await expect(ai.getByTestId('ai-image-tables').locator('tbody tr')).toHaveCount(4)
    expectImageBlock(claude.bodies[0])
    expect(claude.bodies[0].output_config?.format?.type).toBe('json_schema')
    await option(page, /^Insert as table/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterImage(page, id))[0]?.type).toBe('table')
    const table = (await afterImage(page, id))[0]
    const rows = table.content!
    expect(rows).toHaveLength(5)
    expect(rows[0].content!.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
    expect(JSON.stringify(rows[0])).toContain('Volume (µl)')
    expect(JSON.stringify(rows[2])).toContain('2,5')

    // 2 — a spreadsheet: one sheet, bold header, "2,5" → 2.5
    await viaToolbar(page, id, /Image → table/)
    await option(page, /Insert as spreadsheet/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterImage(page, id))[0]?.type).toBe('spreadsheet')
    const sheet = (await afterImage(page, id))[0].attrs!.sheets[0]
    expect(sheet.name).toBe('Volumes')
    expect(sheet.cells.A1).toMatchObject({ v: 'Reagent', b: true })
    expect(sheet.cells.B3.v).toBe('2.5')
    expect(sheet.cells.B5.v).toBe('37.5')
    expect(sheet.cells.C2.v).toBe('A1–A12')
    expect(sheet.frozenRows).toBe(1)

    // 3 — a database: the "Turn into database" preview, then the block below the image
    await viaToolbar(page, id, /Image → table/)
    await option(page, /As database/).click()
    await expect(ai.getByTestId('todb-preview')).toBeVisible()
    await expect(ai.getByTestId('todb-spec')).toContainText(/4 entries · 2 columns/i)
    await option(page, /Create the database below the image/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterImage(page, id))[0]?.type).toBe('databaseBlock')
    const dbId = (await afterImage(page, id))[0].attrs!.databaseId as string
    const db = await wsEval(
      page,
      (s, dbId) => {
        const rows = (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === dbId && !p.trashed)
        const props = s.databases[dbId]?.properties ?? []
        return { titles: rows.map((r) => r.title).sort(), props: props.map((p: AnyState) => `${p.name}:${p.type}`) }
      },
      dbId,
    )
    expect(db.titles).toEqual(['Buffer', 'Enzyme', 'Sample', 'Water'])
    expect(db.props).toEqual(['Reagent:title', 'Volume (µl):number', 'Wells:text'])
    expect(claude.kinds).toEqual(['table', 'table', 'table'])
  })

  test('several tables: one table block each (titled); “as database” only for a single table', async ({ page, context }) => {
    await mockClaude(context, { tables: [VOLUMES, DECK] })
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await viaToolbar(page, id, /Image → table/)
    await expect(panel(page).getByTestId('ai-image-tables').locator('table')).toHaveCount(2)
    await expect(option(page, /As database/)).toHaveCount(0)
    await option(page, /Insert as 2 tables/).click()
    await expect.poll(async () => (await afterImage(page, id)).slice(0, 4).map((b) => b.type)).toEqual(['paragraph', 'table', 'paragraph', 'table'])
    const after = await afterImage(page, id)
    expect(JSON.stringify(after[0])).toContain('Volumes')
    expect(JSON.stringify(after[2])).toContain('Deck')
  })

  test('Ask about the image (block menu): a free question with the image → the answer below the image', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await viaBlockMenu(page, id, /Ask about the image/)
    const ai = panel(page)
    await expect(ai).toBeVisible()
    // the AI menu on the image offers the image actions too
    await expect(ai.getByRole('option', { name: /Describe the image/ })).toBeVisible()
    await expect(ai.getByRole('option', { name: /Read out the text/ })).toBeVisible()
    const input = ai.getByRole('textbox').first()
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('placeholder', /Ask about this image/)
    await input.fill('How many wells does the plate have?')
    await expect(ai.getByRole('option').first()).toContainText('Ask about the image “How many wells does the plate have?”')
    await input.press('Enter')
    await expect(ai).toContainText('96 wells')
    expect(claude.kinds).toEqual(['ask'])
    expectImageBlock(claude.bodies[0])
    expect(taskText(claude.bodies[0])).toContain('Question: How many wells does the plate have?')
    await option(page, /Insert below the image/).click()
    await expect.poll(async () => JSON.stringify((await afterImage(page, id))[0] ?? {})).toContain('96 wells')
  })

  test('the AI menu on a selection holding the image lists the image actions first', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    // select from the first line across the image into the last one, then Ask AI
    await editorOf(page, id).evaluate((el) => {
      const ed = (el as HTMLElement & { editor: AnyState }).editor
      ed.commands.focus()
      ed.commands.setTextSelection({ from: 3, to: ed.state.doc.content.size - 3 })
    })
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = panel(page)
    await expect(ai.locator('.ai-list__group').first()).toHaveText('Image')
    await expect(ai.getByRole('option').first()).toContainText('Describe the image')
    await expect(ai.getByRole('option', { name: /Improve writing/ })).toBeVisible()
    await ai.getByRole('option', { name: /Describe the image/ }).click()
    await expect(ai.getByTestId('ai-image-describe')).toBeVisible()
    expectImageBlock(claude.bodies[0])
  })

  test('the run keeps going when you leave the page: toast → back → the result waits', async ({ page, context }) => {
    const claude = await mockClaude(context, { hold: true })
    await openApp(page)
    await setKey(page)
    await createPage(page, { title: 'Elsewhere', content: doc(para('Nothing here.')) })
    const id = await setup(page)
    await viaToolbar(page, id, /Describe the image/)
    await expect(panel(page).getByTestId('ai-image-wait')).toBeVisible()
    await expect.poll(() => claude.waiting()).toBe(1)

    await sidebarRow(page, 'Elsewhere').locator('.sb-row__title').click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Elsewhere')
    await expect(panel(page)).toHaveCount(0)
    claude.release()
    await expect(page.locator('.toast').filter({ hasText: 'AI result ready · Protokoll P1' })).toBeVisible()

    await sidebarRow(page, 'Protokoll P1').locator('.sb-row__title').click()
    const plate = page.getByTestId('ai-runs').locator('button').first()
    await expect(plate).toHaveText(/AI result ready.*Describe the image/i)
    await plate.click()
    await expect(panel(page).getByRole('textbox', { name: 'Alt text' })).toHaveValue(ALT)
    await option(page, /Apply alt text \+ caption/).click()
    await expect.poll(async () => (await imageAttrs(page, id))?.alt).toBe(ALT)
    expect(claude.bodies).toHaveLength(1)
  })

  test('a web image whose site does not allow it (CORS): a friendly error, nothing sent; Upload a copy fixes it', async ({ page, context, errors }) => {
    errors.allow(/CORS policy|ERR_FAILED|Failed to load resource/)
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const png = await tablePng(page)
    // another origin, without Access-Control-Allow-Origin: the <img> shows, a fetch may not read it
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(png)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const src = `http://localhost:${(server.address() as AddressInfo).port}/plate.png`
      const id = await createPage(page, { title: 'Web plate', content: doc(para('From the vendor site.'), { type: 'image', attrs: { src, alt: 'plate' } }) })
      await gotoPage(page, id)
      await expect(figure(page, id).locator('img')).toBeVisible()
      await viaToolbar(page, id, /Describe the image/)
      const ai = panel(page)
      await expect(ai.getByTestId('ai-image-error')).toContainText(/CORS/)
      await expect(ai.getByTestId('ai-image-error')).toContainText('Nothing was sent.')
      expect(claude.bodies).toHaveLength(0)

      const chooser = page.waitForEvent('filechooser')
      await option(page, /Upload a copy/).click()
      await (await chooser).setFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png })
      await expect(ai.getByRole('textbox', { name: 'Alt text' })).toHaveValue(ALT)
      expect(String((await imageAttrs(page, id))?.src)).toMatch(/^onefile:/)
      expect(claude.kinds).toEqual(['describe'])
      expectImageBlock(claude.bodies[0])
    } finally {
      server.close()
    }
  })

  test('a large image goes scaled to 1568 px on its long edge', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await setup(page, { png: await tablePng(page, 2400, 1200) })
    await viaToolbar(page, id, /Describe the image/)
    await expect(panel(page).getByTestId('ai-image-describe')).toBeVisible()
    expect(expectImageBlock(claude.bodies[0])).toEqual({ w: 1568, h: 784 })
    await expect(panel(page).getByTestId('ai-image-meta')).toContainText('1568×784')
  })

  test('AI terminal: Mod+Shift+J on a selected image adds an image chip; the task sends the picture', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await figure(page, id).locator('img').click()
    await page.keyboard.press(`${MOD}+Shift+j`)
    const term = page.getByRole('region', { name: 'AI terminal' })
    const chip = term.getByTestId('term-image-chip')
    await expect(chip).toContainText('Protokoll P1')
    await expect(chip).toContainText(/image \d+ KB/)
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('What is on this image?')
    await prompt.press('Enter')
    await expect.poll(() => claude.kinds).toContain('agent')
    const body = claude.bodies[claude.kinds.indexOf('agent')]
    const content = (body.messages as AnyState[]).at(-1)!.content as AnyState[]
    const img = content.find((b) => b.type === 'image')
    expect(img?.source.type).toBe('base64')
    expect(img?.source.media_type).toBe('image/png')
    expect(JSON.stringify(content)).toContain('Image 1 — the image block referenced from the page')
    expect(JSON.stringify(content)).toContain('[Image block: protocol-p1]')
    await expect(term).toContainText('I looked at the image')
  })

  test('German at 390 px: the KI key, the Claude group, the panel fits the phone', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page, 'de')
    const id = await setup(page)
    await figure(page, id).locator('img').click()
    const key = figure(page, id).getByTestId('image-ai-key')
    await expect(key).toHaveText(/KI/)
    await key.click()
    await expect(page.getByRole('menu').getByText('Claude', { exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: /Bild beschreiben/ }).click()
    const ai = panel(page)
    await expect(ai.getByRole('textbox', { name: 'Alternativtext' })).toHaveValue(ALT)
    await expect(option(page, /Alternativtext \+ Bildunterschrift übernehmen/)).toBeVisible()
    const box = (await ai.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // the task asks for the page's language, falling back to German
    expect(taskText(claude.bodies[0])).toContain('Write both in the language of the page')
    await option(page, /Alternativtext \+ Bildunterschrift übernehmen/).click()
    await expect.poll(async () => (await imageAttrs(page, id))?.caption).toBe(CAPTION)
    await flush(page)
  })
})

