/**
 * Claude for files (features/ai/file): any file block — an upload, a mail attachment — gets an AI key and a
 * "Claude" group in its block menu. PDFs go to Claude as a base64 `document` (summarise, extract the text as a
 * page, extract the tables, ask); Word / HTML / RTF / text open as a page and CSV / TSV / Excel import as a
 * database or a spreadsheet right here (nothing sent). Background runs, previewed first, one-step undo.
 * The files are real (tests/e2e/helpers/files.ts); Claude is mocked — nothing reaches api.anthropic.com.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, wsEval, editorOf, sidebarRow, flush, sse, MOD } from './fixtures'
import { CSV_TEXT, HTML_TEXT, RTF_TEXT, docxBytes, pdfBytes, xlsxBytes } from './helpers/files'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SUMMARY = 'Invoice **2025-117** from Acme GmbH.\n\n- Amount: **1,250.50 €**\n- Due: 14 October 2025\n\n**To do:** pay by 14 October.'
const TABLES = { tables: [{ title: 'Line items', header: ['Item', 'Hours', 'Price'], rows: [['Design', '10', '950,00'], ['Hosting', '1', '300,50'], ['Support', '2', '160,00']] }] }
const EXTRACT = '# Invoice 2025-117\n\nAcme GmbH, Berlin\n\n## Line items\n\n- Design\n- Hosting\n\n![tracking](https://tracker.example/p.gif)'
const ANSWER = 'The invoice is due on **14 October 2025**.'

type Kind = 'summarize' | 'extract' | 'tables' | 'ask' | 'agent'

interface Claude {
  bodies: AnyState[]
  kinds: Kind[]
  release: () => void
  waiting: () => number
}

/** The task text of a request (the text block after the document). */
const taskText = (body: AnyState): string => {
  const content = (body.messages as AnyState[])?.[0]?.content
  return Array.isArray(content) ? content.map((b: AnyState) => (b.type === 'text' ? b.text : '')).join('\n') : String(content ?? '')
}

function kindOf(body: AnyState): Kind {
  if (Array.isArray(body.tools) && body.tools.length) return 'agent'
  const text = taskText(body)
  if (/Summarise the file/.test(text)) return 'summarize'
  if (/Transcribe the whole document/.test(text)) return 'extract'
  if (/Find every table/.test(text)) return 'tables'
  return 'ask'
}

/** api.anthropic.com, answered by kind (`hold`: until release()); never a real request. */
async function mockClaude(ctx: BrowserContext, opts: { hold?: boolean } = {}): Promise<Claude> {
  const bodies: AnyState[] = []
  const kinds: Kind[] = []
  const held: Array<() => void> = []
  const answers: Record<Kind, string> = { summarize: SUMMARY, extract: EXTRACT, tables: JSON.stringify(TABLES), ask: ANSWER, agent: 'I read the invoice: it is due on 14 October.' }
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

const setKey = (page: Page, extra: AnyState = {}) => wsEval(page, (s, extra) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...extra }), extra)
const panel = (page: Page) => page.getByRole('dialog', { name: /Ask Claude|Claude fragen/ })
const option = (page: Page, name: RegExp) => panel(page).getByRole('option', { name })
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const text = (s: string) => new TextEncoder().encode(s)

interface FileSpec {
  name: string
  type: string
  bytes: Uint8Array
  display?: 'viewer' | 'file' | null
  /** zero bytes added in the page (a large file without sending it over the wire) */
  pad?: number
}

/** A page with a line and file blocks (each file stored on this device like an upload / a loaded attachment). */
async function setup(page: Page, files: FileSpec[], opts: { title?: string; origin?: string } = {}): Promise<{ id: string; srcs: string[] }> {
  const res = await page.evaluate(
    async ({ files, title, origin }) => {
      const one = (window as unknown as { __one: AnyState }).__one
      const srcs: string[] = []
      const blocks: AnyState[] = [{ type: 'paragraph', content: [{ type: 'text', text: 'Mail from Acme: the invoice and the report are attached.' }] }]
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
        const blob = new Blob(f.pad ? [bytes, new Uint8Array(f.pad)] : [bytes], { type: f.type })
        const src = await one.files.saveFile(blob, f.name)
        srcs.push(src)
        blocks.push({ type: 'fileBlock', attrs: { src, name: f.name, size: blob.size, display: f.display ?? 'file' } })
      }
      blocks.push({ type: 'paragraph', content: [{ type: 'text', text: 'Notes follow below.' }] })
      const s = one.workspace.getState()
      const id = s.createPage({ title, parentId: null })
      s.setContent(id, { type: 'doc', content: blocks }, origin)
      return { id, srcs }
    },
    { files: files.map((f) => ({ name: f.name, type: f.type, data: b64(f.bytes), display: f.display, pad: f.pad })), title: opts.title ?? 'Acme mail', origin: opts.origin ?? 'e2e' },
  )
  await flush(page)
  await gotoPage(page, res.id)
  return res
}

const PDF: FileSpec = { name: 'invoice-2025-117.pdf', type: 'application/pdf', bytes: pdfBytes(2) }
const DOCX: FileSpec = { name: 'Quarterly report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docxBytes() }
const XLSX: FileSpec = { name: 'orders.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: xlsxBytes() }
const CSV: FileSpec = { name: 'tasks.csv', type: 'text/csv', bytes: text(CSV_TEXT) }
// a mail attachment's HTML is stored as application/octet-stream (never rendered)
const HTML: FileSpec = { name: 'newsletter.html', type: 'application/octet-stream', bytes: text(HTML_TEXT) }
const RTF: FileSpec = { name: 'letter.rtf', type: 'application/rtf', bytes: text(RTF_TEXT) }

/** The file block (compact card or PDF viewer) with this name. */
const card = (page: Page, id: string, name: string) => editorOf(page, id).locator('.file-view, .pdf-view', { hasText: name }).first()

/** The file block's AI key → an entry. */
async function viaKey(page: Page, id: string, name: string, entry: RegExp) {
  const c = card(page, id, name)
  await c.hover()
  await c.getByTestId('file-ai-key').click()
  await page.getByRole('menuitem', { name: entry }).click()
}

/** The top-level blocks of a page (store). */
const blocksOf = (page: Page, id: string): Promise<JSONContent[]> => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content?.content ?? [])), id)
/** The blocks right after the file block named `name`. */
async function afterFile(page: Page, id: string, name: string): Promise<JSONContent[]> {
  const blocks = await blocksOf(page, id)
  return blocks.slice(blocks.findIndex((b) => b.type === 'fileBlock' && b.attrs?.name === name) + 1)
}

/** A database's rows (title + values by property name) and its property types. */
async function dbOf(page: Page, dbId: string) {
  return wsEval(
    page,
    (s, dbId) => {
      const props = (s.databases[dbId]?.properties ?? []) as AnyState[]
      const rows = (Object.values(s.pages) as AnyState[])
        .filter((p) => p.databaseId === dbId && !p.trashed)
        .map((r) => {
          const out: AnyState = { title: r.title }
          for (const p of props) {
            if (p.type === 'title') continue
            const v = r.properties?.[p.id]
            out[p.name] = p.type === 'select' ? (p.options.find((o: AnyState) => o.id === v)?.name ?? null) : p.type === 'date' ? (v?.start ?? null) : (v ?? null)
          }
          return out
        })
      return { title: s.pages[dbId]?.title, props: props.map((p) => `${p.name}:${p.type}`), rows, private: !!s.pages[dbId]?.private }
    },
    dbId,
  )
}

test.describe('Claude for files', () => {
  test('PDF → Summarise: the PDF goes as a base64 document block; the summary lands below the file in one undo step', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [PDF])
    await viaKey(page, id, PDF.name, /^Summarise/)

    const ai = panel(page)
    await expect(ai.getByTestId('ai-file-meta')).toContainText(/Sent · PDF · 2 pages/i)
    await expect(ai).toContainText('To do:')
    expect(claude.kinds).toEqual(['summarize'])
    const content = claude.bodies[0].messages[0].content as AnyState[]
    expect(content[0]).toMatchObject({ type: 'document', title: PDF.name, source: { type: 'base64', media_type: 'application/pdf' } })
    expect(content[0].source.data).toBe(b64(PDF.bytes))
    expect(content[1].type).toBe('text')
    // the page goes along as "What Claude reads" allows
    expect(taskText(claude.bodies[0])).toContain('Mail from Acme')
    expect(claude.bodies[0].model).toBe('claude-opus-5-5')

    await option(page, /^Insert below the file/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => JSON.stringify(await afterFile(page, id, PDF.name))).toContain('2025-117')
    const after = await afterFile(page, id, PDF.name)
    expect(after.some((b) => b.type === 'bulletList')).toBe(true)
    // one undo step takes the whole summary back
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await afterFile(page, id, PDF.name)).map((b) => b.type)).toEqual(['paragraph'])
  })

  test('PDF → Extract the tables → as database: preview first, then the database below the file (typed columns)', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [{ ...PDF, display: 'viewer' }])
    // the PDF shows in the browser's viewer: the AI key sits in its bar
    await viaKey(page, id, PDF.name, /Extract the tables/)
    const ai = panel(page)
    await expect(ai.getByTestId('ai-file-tables')).toContainText('Line items')
    await expect(ai.getByTestId('ai-file-tables').locator('tbody tr')).toHaveCount(3)
    expect(claude.bodies[0].output_config?.format?.type).toBe('json_schema')
    expect(claude.bodies[0].messages[0].content[0].source.media_type).toBe('application/pdf')

    await option(page, /^As database/).click()
    await expect(ai.getByTestId('todb-preview')).toBeVisible()
    await expect(ai.getByTestId('todb-spec')).toContainText(/3 entries · 2 columns/i)
    await option(page, /Create the database below the file/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterFile(page, id, PDF.name))[0]?.type).toBe('databaseBlock')
    const dbId = (await afterFile(page, id, PDF.name))[0].attrs!.databaseId as string
    const db = await dbOf(page, dbId)
    expect(db.title).toBe('Line items')
    expect(db.props).toEqual(['Item:title', 'Hours:number', 'Price:number'])
    expect(db.rows.map((r: AnyState) => r.title).sort()).toEqual(['Design', 'Hosting', 'Support'])
    expect(db.rows.find((r: AnyState) => r.title === 'Hosting')?.Price).toBe(300.5)
    await expect(page.locator('.toast').filter({ hasText: /3 entries/ })).toBeVisible()
    expect(claude.kinds).toEqual(['tables'])
  })

  test('PDF → Extract the text as a page: a sub-page (its H1 the title, origin ai, web images as links) linked below the file', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [PDF])
    // the block menu (⋮⋮) has the same "Claude" group
    await card(page, id, PDF.name).hover()
    await page.locator('.block-handle__grip').click()
    const menu = page.getByRole('menu')
    await expect(menu.getByText('Claude', { exact: true })).toBeVisible()
    await menu.getByRole('menuitem', { name: /Extract the text as a page/ }).click()

    const ai = panel(page)
    await expect(ai).toContainText('Line items')
    expect(claude.bodies[0].max_tokens).toBeGreaterThanOrEqual(64000)
    await option(page, /^Create the page/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterFile(page, id, PDF.name))[0]?.type).toBe('pageLink')
    const subId = (await afterFile(page, id, PDF.name))[0].attrs!.pageId as string
    const sub = await wsEval(page, (s, subId) => ({ title: s.pages[subId].title, parent: s.pages[subId].parentId, origin: s.pages[subId].contentOrigin, doc: s.pages[subId].content }), subId)
    expect(sub.title).toBe('Invoice 2025-117')
    expect(sub.parent).toBe(id)
    expect(sub.origin).toBe('ai')
    const json = JSON.stringify(sub.doc)
    expect(json).toContain('Line items')
    expect(json).not.toContain('"type":"image"')
    expect(json).toContain('https://tracker.example/p.gif')
    await expect(page.locator('.toast').filter({ hasText: 'Page created · Invoice 2025-117' })).toBeVisible()
    // the toast's Undo takes the link and the page away
    await page.locator('.toast').filter({ hasText: 'Page created' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await afterFile(page, id, PDF.name))[0]?.type).toBe('paragraph')
    expect(await wsEval(page, (s, subId) => !!s.pages[subId], subId)).toBe(false)
  })

  test('Ask about the file…: the prompt takes the question; the answer goes below the file', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [PDF])
    await viaKey(page, id, PDF.name, /Ask about the file/)
    const ai = panel(page)
    const prompt = ai.getByRole('textbox').first()
    await expect(prompt).toBeFocused()
    await prompt.fill('When is it due?')
    await option(page, /Ask about the file “When is it due\?”/).click()
    await expect(ai).toContainText('14 October 2025')
    expect(claude.kinds).toEqual(['ask'])
    expect(taskText(claude.bodies[0])).toContain('Question: When is it due?')
    await option(page, /^Insert below the file/).click()
    await expect.poll(async () => JSON.stringify(await afterFile(page, id, PDF.name))).toContain('14 October 2025')
  })

  test('Word → Open as page: headings, nested list, numbered list, table, link — converted here, nothing sent', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [DOCX])
    await card(page, id, DOCX.name).hover()
    await card(page, id, DOCX.name).getByTestId('file-ai-key').click()
    // a conversion on this device says so in the menu
    await expect(page.getByRole('menuitem', { name: /Open as page/ })).toContainText('LOCAL')
    await page.getByRole('menuitem', { name: /Open as page/ }).click()

    const ai = panel(page)
    await expect(ai.getByTestId('ai-file-meta')).toContainText(/On this device · nothing sent · DOCX/i)
    await expect(ai.getByRole('textbox', { name: 'Page title' })).toHaveValue('Quarterly report Q3')
    await expect(ai.getByTestId('ai-file-spec')).toContainText(/3 headings · 2 paragraphs · 2 lists · 1 table/i)
    await option(page, /^Create the page/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterFile(page, id, DOCX.name))[0]?.type).toBe('pageLink')
    const subId = (await afterFile(page, id, DOCX.name))[0].attrs!.pageId as string
    const sub = await wsEval(page, (s, subId) => ({ title: s.pages[subId].title, origin: s.pages[subId].contentOrigin, doc: s.pages[subId].content }), subId)
    expect(sub.title).toBe('Quarterly report Q3')
    expect(sub.origin).toBe('import')
    const blocks = sub.doc.content as JSONContent[]
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'bulletList', 'heading', 'orderedList', 'table', 'paragraph'])
    expect(blocks[0]).toMatchObject({ attrs: { level: 1 }, content: [{ text: 'Summary' }] })
    expect(blocks[2].attrs?.level).toBe(2)
    // bold and italic runs
    expect(JSON.stringify(blocks[1])).toContain('{"type":"text","text":"12 %","marks":[{"type":"bold"}]}')
    expect(JSON.stringify(blocks[1])).toContain('"type":"italic"')
    // the second-level bullet nests inside the first item
    const nested = blocks[3].content![0].content!
    expect(nested.map((n) => n.type)).toEqual(['paragraph', 'bulletList'])
    expect(JSON.stringify(nested[1])).toContain('Acme GmbH in Berlin')
    expect(blocks[5].content).toHaveLength(2)
    expect(blocks[6].content![0].content!.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
    expect(blocks[6].content).toHaveLength(3)
    expect(JSON.stringify(blocks[7])).toContain('"href":"https://example.com/finance"')
    expect(claude.bodies).toHaveLength(0)
  })

  test('CSV → Import as database: semicolons, German decimals and dates, statuses and yes/no — typed columns, nothing sent', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [CSV])
    await viaKey(page, id, CSV.name, /Import as database/)
    const ai = panel(page)
    await expect(ai.getByTestId('todb-preview')).toBeVisible()
    await expect(ai.getByTestId('todb-spec')).toContainText(/4 entries · 4 columns/i)
    await option(page, /Create the database below the file/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterFile(page, id, CSV.name))[0]?.type).toBe('databaseBlock')
    const db = await dbOf(page, (await afterFile(page, id, CSV.name))[0].attrs!.databaseId)
    expect(db.title).toBe('tasks')
    expect(db.props).toEqual(['Task:title', 'Hours:number', 'Due:date', 'Status:select', 'Done:checkbox'])
    const brief = db.rows.find((r: AnyState) => r.title === 'Write brief')
    expect(brief).toMatchObject({ Hours: 2.5, Due: '2025-10-14', Status: 'Open', Done: false })
    expect(db.rows.find((r: AnyState) => r.title === 'Ship release')).toMatchObject({ Hours: 4, Status: 'Done', Done: true })
    expect(db.rows).toHaveLength(4)
    expect(claude.bodies).toHaveLength(0)
  })

  test('Excel → database from the sheet picked; → spreadsheet with every visible sheet (the hidden one left out)', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [XLSX])

    // 1 — a spreadsheet block: Orders + Regions, dates as dates, booleans kept
    await viaKey(page, id, XLSX.name, /Open as spreadsheet/)
    const ai = panel(page)
    await expect(ai.getByRole('radio', { name: /Orders/ })).toBeVisible()
    await expect(ai.getByRole('radio', { name: /Hidden/ })).toHaveCount(0)
    await expect(ai.getByTestId('ai-file-tables')).toContainText('2025-09-30')
    await option(page, /Insert as spreadsheet \(2 sheets\)/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterFile(page, id, XLSX.name))[0]?.type).toBe('spreadsheet')
    const sheets = (await afterFile(page, id, XLSX.name))[0].attrs!.sheets as AnyState[]
    expect(sheets.map((s) => s.name)).toEqual(['Orders', 'Regions'])
    expect(sheets[0].cells.A1).toMatchObject({ v: 'Customer', b: true })
    expect(sheets[0].cells.B2.v).toBe('1250.5')

    // 2 — a database from the second sheet
    await viaKey(page, id, XLSX.name, /Import as database/)
    await expect(ai.getByTestId('todb-preview')).toBeVisible()
    await ai.getByRole('radio', { name: /Regions/ }).click()
    await expect(ai.getByTestId('todb-spec')).toContainText(/2 entries · 1 column/i)
    await ai.getByRole('radio', { name: /Orders/ }).click()
    await expect(ai.getByTestId('todb-spec')).toContainText(/3 entries · 4 columns/i)
    await option(page, /Create the database below the file/).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(async () => (await afterFile(page, id, XLSX.name))[0]?.type).toBe('databaseBlock')
    const db = await dbOf(page, (await afterFile(page, id, XLSX.name))[0].attrs!.databaseId)
    expect(db.title).toBe('Orders')
    expect(db.props).toEqual(['Customer:title', 'Amount:number', 'Ordered:date', 'Paid:checkbox', 'Status:select'])
    expect(db.rows.find((r: AnyState) => r.title === 'Globex')).toMatchObject({ Amount: 980, Ordered: '2025-10-10', Paid: false, Status: 'Open' })
    expect(claude.bodies).toHaveLength(0)
  })

  test('an HTML mail attachment → a sanitised page: no script runs, no form, the tracking pixel only a link', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    // written like the mail sync writes a loaded attachment
    const { id } = await setup(page, [HTML], { origin: 'mail' })
    await viaKey(page, id, HTML.name, /Open as page/)
    const ai = panel(page)
    await expect(ai.getByRole('textbox', { name: 'Page title' })).toHaveValue('Newsletter October')
    await option(page, /^Create the page/).click()
    await expect.poll(async () => (await afterFile(page, id, HTML.name))[0]?.type).toBe('pageLink')
    const subId = (await afterFile(page, id, HTML.name))[0].attrs!.pageId as string
    const json = JSON.stringify(await wsEval(page, (s, subId) => s.pages[subId].content, subId))
    expect(json).toContain('November 3')
    expect(json).toContain('Venue booked')
    expect(json).toContain('"href":"https://example.com/launch"')
    expect(json).not.toMatch(/pwned|script|onload|onclick|evil\.example|"type":"image"/)
    expect(json).toContain('https://tracker.example/pixel.gif?u=42')
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned ?? false)).toBe(false)
    expect(await page.title()).not.toBe('pwned')
    // the new page opens without loading anything from the tracker
    const tracker: string[] = []
    page.on('request', (r) => r.url().includes('tracker.example') && tracker.push(r.url()))
    await gotoPage(page, subId)
    await expect(editorOf(page, subId)).toContainText('Venue booked')
    expect(tracker).toEqual([])
    expect(claude.bodies).toHaveLength(0)
  })

  test('RTF → Open as page (umlauts, bold text kept as text)', async ({ page, context }) => {
    await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [RTF])
    await viaKey(page, id, RTF.name, /Open as page/)
    await option(page, /Insert below the file/).click()
    await expect.poll(async () => JSON.stringify(await afterFile(page, id, RTF.name))).toContain('Dear Ms. Müller,')
    expect(JSON.stringify(await afterFile(page, id, RTF.name))).toContain('thank you for the offer No. 17.')
  })

  test('Word → Summarise: the converted text goes as a text document (Markdown, headings kept)', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [DOCX])
    await viaKey(page, id, DOCX.name, /^Summarise/)
    const ai = panel(page)
    await expect(ai.getByTestId('ai-file-meta')).toContainText(/Sent · DOCX as text/i)
    await expect(ai).toContainText('To do:')
    const content = claude.bodies[0].messages[0].content as AnyState[]
    expect(content[0]).toMatchObject({ type: 'document', title: DOCX.name, source: { type: 'text', media_type: 'text/plain' } })
    expect(content[0].source.data).toContain('# Quarterly report Q3')
    expect(content[0].source.data).toContain('# Summary')
    expect(content[0].source.data).toContain('## Highlights')
    expect(content[0].source.data).toContain('**12 %**')
    expect(content[0].source.data).toContain('Acme GmbH in Berlin')
  })

  test('limits: too many pages, too large, Haiku’s 100 pages — said with the numbers, nothing sent', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [
      { name: 'scan-601.pdf', type: 'application/pdf', bytes: pdfBytes(601) },
      { name: 'huge.pdf', type: 'application/pdf', bytes: text('%PDF-1.4\n'), pad: 24 * 1024 * 1024 },
      { name: 'manual-150.pdf', type: 'application/pdf', bytes: pdfBytes(150) },
    ])
    const ai = panel(page)

    await viaKey(page, id, 'scan-601.pdf', /^Summarise/)
    await expect(ai.getByTestId('ai-file-error')).toContainText('This PDF has 601 pages — Claude reads at most 600 pages of one PDF.')
    await expect(ai.getByTestId('ai-file-error')).toContainText('ERR · FILE_PAGES')
    await page.keyboard.press('Escape')

    await viaKey(page, id, 'huge.pdf', /^Summarise/)
    await expect(ai.getByTestId('ai-file-error')).toContainText(/This file is 24 MB — at most 23 MB works here/)
    await page.keyboard.press('Escape')

    // 150 pages pass with Opus / Sonnet, not with Haiku (200k context: 100 pages)
    await setKey(page, { aiModel: 'claude-haiku-4-5' })
    await viaKey(page, id, 'manual-150.pdf', /^Summarise/)
    await expect(ai.getByTestId('ai-file-error')).toContainText('with Claude Haiku 4.5, Claude reads at most 100 pages')
    expect(claude.bodies).toHaveLength(0)
    await option(page, /^Discard/).click()
    await setKey(page, { aiModel: 'claude-opus-5-5' })
    await viaKey(page, id, 'manual-150.pdf', /^Summarise/)
    await expect(ai).toContainText('To do:')
    await expect(ai.getByTestId('ai-file-meta')).toContainText('150 pages')
    expect(claude.bodies).toHaveLength(1)
  })

  test('a web PDF whose site does not allow it (CORS): a friendly error, nothing sent; Upload a copy fixes it', async ({ page, context, errors }) => {
    errors.allow(/CORS policy|ERR_FAILED|Failed to load resource/)
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(Buffer.from(PDF.bytes))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const src = `http://localhost:${(server.address() as AddressInfo).port}/invoice-2025-117.pdf`
      const id = await wsEval(page, (s, src) => {
        const id = s.createPage({ title: 'Web invoice', parentId: null })
        s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From the vendor portal.' }] }, { type: 'fileBlock', attrs: { src, name: 'invoice-2025-117.pdf', size: 0, display: 'file' } }] }, 'e2e')
        return id
      }, src)
      await gotoPage(page, id)
      await viaKey(page, id, PDF.name, /^Summarise/)
      const ai = panel(page)
      await expect(ai.getByTestId('ai-file-error')).toContainText(/CORS/)
      await expect(ai.getByTestId('ai-file-error')).toContainText('Nothing was sent.')
      expect(claude.bodies).toHaveLength(0)
      const chooser = page.waitForEvent('filechooser')
      await option(page, /Upload a copy/).click()
      await (await chooser).setFiles({ name: PDF.name, mimeType: 'application/pdf', buffer: Buffer.from(PDF.bytes) })
      await expect(ai).toContainText('To do:')
      // the copy's src reaches the store with the editor's next save
      await expect.poll(async () => (await blocksOf(page, id)).find((b) => b.type === 'fileBlock')?.attrs?.src).toMatch(/^onefile:/)
      expect(claude.bodies[0].messages[0].content[0].source.data).toBe(b64(PDF.bytes))
    } finally {
      server.close()
    }
  })

  test('the run keeps going when you leave the page: toast → back → the result waits', async ({ page, context }) => {
    const claude = await mockClaude(context, { hold: true })
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s) => s.createPage({ title: 'Elsewhere', parentId: null }))
    const { id } = await setup(page, [PDF], { title: 'Acme invoice' })
    await viaKey(page, id, PDF.name, /^Summarise/)
    await expect.poll(() => claude.waiting()).toBe(1)
    // closing the panel leaves the run going: the page's plate says so
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByTestId('ai-runs')).toContainText(/Reading/i)

    await sidebarRow(page, 'Elsewhere').locator('.sb-row__title').click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Elsewhere')
    claude.release()
    await expect(page.locator('.toast').filter({ hasText: 'AI result ready · Acme invoice' })).toBeVisible()
    await page.locator('.toast').filter({ hasText: 'AI result ready' }).getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Acme invoice')
    await expect(panel(page)).toContainText('To do:')
    await option(page, /^Insert below the file/).click()
    await expect.poll(async () => JSON.stringify(await afterFile(page, id, PDF.name))).toContain('2025-117')
    expect(claude.bodies).toHaveLength(1)
  })

  test('AI terminal: Mod+Shift+J on a selected file block adds a file chip; the task sends the PDF as a document', async ({ page, context }) => {
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page, [PDF, CSV])
    await card(page, id, PDF.name).locator('.file-view__name').click()
    await page.keyboard.press(`${MOD}+Shift+j`)
    const term = page.getByRole('region', { name: 'AI terminal' })
    const chip = term.getByTestId('term-file-chip')
    await expect(chip).toContainText('Acme mail')
    await expect(chip).toContainText(/PDF \d+ (B|KB)/)
    // a second reference: the CSV goes as its text
    await card(page, id, CSV.name).locator('.file-view__name').click()
    await page.keyboard.press(`${MOD}+Shift+j`)
    await expect(term.getByTestId('term-file-chip')).toHaveCount(2)
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('When is the invoice due, and how many hours are open?')
    await prompt.press('Enter')
    await expect.poll(() => claude.kinds).toContain('agent')
    const body = claude.bodies[claude.kinds.indexOf('agent')]
    const content = (body.messages as AnyState[]).at(-1)!.content as AnyState[]
    const docs = content.filter((b) => b.type === 'document')
    expect(docs).toHaveLength(2)
    expect(docs[0]).toMatchObject({ title: PDF.name, source: { type: 'base64', media_type: 'application/pdf', data: b64(PDF.bytes) } })
    expect(docs[1]).toMatchObject({ title: CSV.name, source: { type: 'text', media_type: 'text/plain' } })
    expect(docs[1].source.data).toContain('Ship release')
    expect(JSON.stringify(content)).toContain(`File 1 — the file block \\"${PDF.name}\\" referenced from the page`)
    await expect(term).toContainText('due on 14 October')
  })

  test('a loaded mail attachment: the PDF block and the image block both get their AI keys', async ({ page, context }) => {
    await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 80
      c.height = 40
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 80, 40)
      return c.toDataURL('image/png').split(',')[1]
    })
    const { id } = await setup(page, [{ ...PDF, display: 'viewer' }], { origin: 'mail' })
    const src = await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      return (window as unknown as { __one: AnyState }).__one.files.saveFile(new Blob([bytes], { type: 'image/png' }), 'scan.png')
    }, png)
    await wsEval(
      page,
      (s, { id, src }) => {
        const content = s.pages[id].content
        s.setContent(id, { ...content, content: [...content.content, { type: 'image', attrs: { src, alt: 'scan.png', caption: 'scan.png' } }] }, 'mail')
      },
      { id, src },
    )
    await expect(card(page, id, PDF.name).getByTestId('file-ai-key')).toBeVisible()
    const fig = editorOf(page, id).locator('.image-view').first()
    await fig.hover()
    await expect(fig.getByTestId('image-ai-key')).toBeVisible()
  })

  test('German at 390 px: the KI key, LOKAL conversions, the panel fits the phone', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const claude = await mockClaude(context)
    await openApp(page)
    await setKey(page, { language: 'de' })
    const { id } = await setup(page, [CSV])
    const key = card(page, id, CSV.name).getByTestId('file-ai-key')
    await expect(key).toHaveText(/KI/)
    await key.click()
    await expect(page.getByRole('menu').getByText('Claude', { exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Als Datenbank importieren/ })).toContainText('LOKAL')
    await page.getByRole('menuitem', { name: /Als Tabellenkalkulation öffnen/ }).click()
    const ai = panel(page)
    await expect(ai.getByTestId('ai-file-meta')).toContainText(/Auf diesem Gerät · nichts gesendet · CSV/i)
    await expect(option(page, /Als Tabellenkalkulation einfügen/)).toBeVisible()
    const box = (await ai.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // typed after a conversion: a question about the data
    await ai.getByRole('textbox').first().fill('Wie viele Stunden insgesamt?')
    await expect(option(page, /Frage zu den Daten.*Wie viele Stunden insgesamt\?/)).toBeVisible()
    await option(page, /Frage zu den Daten/).click()
    await expect(ai).toContainText('14 October 2025')
    const content = claude.bodies[0].messages[0].content as AnyState[]
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'text' } })
    expect(content[0].source.data).toContain('Write brief,"2,5",14.10.2025,Open,no')
    expect(taskText(claude.bodies[0])).toContain('a table as CSV')
    await flush(page)
  })
})
