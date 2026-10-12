/**
 * Golden request bodies (multi-provider S1 → S10): every engine that talks to Claude, driven through its real UI path
 * against a scripted api.anthropic.com, captured on the wire (path, anthropic-beta header, body) and compared with
 * tests/fixtures/ai/anthropic/golden/<scenario>.json. The fixtures were written once from the code before the
 * multi-provider work (GOLDEN_WRITE=1); every later slice must send exactly these bytes (normalised only for ids, the
 * clock and base64 digests — helpers/golden.ts). Nothing reaches a real host. Test data is fictional.
 */
import { deflateSync } from 'node:zlib'
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, uiEval, editorOf, doc, para, selectText, flush, pageIdByTitle } from './fixtures'
import { mockClaudeScript, text, type CapturedRequest, type ClaudeStep } from './helpers/providers'
import { expectGolden } from './helpers/golden'
import { openTerminal, run, terminal } from './helpers/terminal'
import { docxBytes, pdfBytes } from './helpers/files'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-10-12T09:00:00+02:00')

async function start(page: Page, steps: ClaudeStep[], settings: AnyState = {}): Promise<CapturedRequest[]> {
  await page.clock.install({ time: NOW })
  const { requests } = await mockClaudeScript(page.context(), steps)
  await openApp(page)
  await wsEval(page, (s, extra) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...extra }), settings)
  return requests
}

/** Every id the workspace holds (pages, databases, properties, options, views, files, people …): normalised to <id#n>. */
async function workspaceIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> } } }).__one.workspace.getState()
    const out = new Set<string>()
    const ID = /^[0-9a-z]{12}$/
    const walk = (v: unknown, depth: number) => {
      if (depth > 40) return
      if (typeof v === 'string') {
        if (ID.test(v)) out.add(v)
        for (const m of v.matchAll(/onefile:([0-9a-z]+)/g)) out.add(m[1])
        for (const m of v.matchAll(/\bwi_[0-9a-z]+/g)) out.add(m[0])
        return
      }
      if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1))
      if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (ID.test(k)) out.add(k)
          walk(x, depth + 1)
        }
    }
    walk({ pages: s.pages, databases: s.databases, settings: s.settings, agents: s.agents, people: s.people }, 0)
    return [...out]
  })
}

/** Wait until exactly `n` requests went out (and a moment more: no further one follows). */
async function sent(page: Page, requests: CapturedRequest[], n: number): Promise<CapturedRequest[]> {
  await expect.poll(() => requests.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(n)
  await page.waitForTimeout(400)
  expect(requests.length, 'requests sent').toBe(n)
  return requests.slice(0, n)
}

async function golden(page: Page, id: string, requests: CapturedRequest[]) {
  expectGolden(id, requests, { ids: await workspaceIds(page) })
}

const panel = (page: Page) => page.getByRole('dialog', { name: /Ask AI|KI fragen/ })

/** "Launch notes": select a line and run "Improve writing". */
async function improve(page: Page) {
  const id = await createPage(page, { title: 'Launch notes', content: doc(para('Intro line stays.'), para('our launch sentence is kinda loose'), para('Closing line.')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: 'our launch sentence is kinda loose' }).click()
  await selectText(page, ed, 'our launch sentence is kinda loose')
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('option', { name: /Improve writing/ }).click()
  await expect(panel(page)).toContainText('A tighter launch sentence.')
}

const ARCHIVE = { id: 'srvarch001', name: 'archive', url: 'https://mcp.example.test/api/archive/mcp', token: 'archive-e2e-PLAINTEXT-token-7Hq0001', enabled: true, prompt: '**Archive** is the team knowledge base.\n- Find records with `archive_search` (query).', promptSource: 'auto', tools: ['archive_search'], checkedAt: 1 }

/** No speech recognition here: the meeting block takes a pasted transcript (before the app opens). */
const noSpeech = (page: Page) =>
  page.addInitScript(() => {
    for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true })
  })

/** A meeting block from a pasted transcript → the structured summary request. */
async function summarizeMeeting(page: Page) {
  const id = await createPage(page, { title: 'Relaunch sync' })
  await gotoPage(page, id)
  await editorOf(page).click()
  await page.keyboard.type('/transcript')
  await expect(page.locator('.slash')).toBeVisible()
  await page.keyboard.press('Enter')
  const deck = page.locator('#main .mtg').first()
  await deck.getByRole('textbox', { name: 'Transcript text' }).fill('Ada: We ship in two steps.\nAlex: I send the deck to legal.')
  await deck.getByRole('button', { name: 'Use transcript' }).click()
  await expect(deck.locator('.mtg__notes').getByRole('heading', { name: 'Action items' })).toBeVisible()
}

const SUMMARY = { title: 'Relaunch sync', summary: ['We ship in two steps.'], decisions: ['Ship in two steps.'], actionItems: [{ text: 'Send the deck to legal', owner: 'Alex', due: null }] }

/** A PNG made here, byte for byte the same every run (w × h, a few stripes). */
function pngBytes(w = 64, h = 48): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows: Buffer[] = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      const on = Math.floor(x / 8) % 2 === 0 || y % 12 < 2
      row[1 + x * 3] = on ? 30 : 245
      row[2 + x * 3] = on ? 30 : 240
      row[3 + x * 3] = on ? 40 : 230
    }
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

/** "Protokoll P1": a line, an image block holding the PNG, a line. */
async function imagePage(page: Page): Promise<{ id: string; figure: Locator }> {
  const id = await createPage(page, { title: 'Protokoll P1', content: doc(para('Deck layout, plate and volumes for run P1.'), { type: 'image', attrs: { src: null } }, para('Notes follow below.')) })
  await gotoPage(page, id)
  const chooser = page.waitForEvent('filechooser')
  await editorOf(page, id).locator('.media-empty').getByRole('button', { name: /Upload/ }).click()
  await (await chooser).setFiles({ name: 'protocol-p1.png', mimeType: 'image/png', buffer: pngBytes() })
  const figure = editorOf(page, id).locator('.image-view').first()
  await expect(figure.locator('img')).toBeVisible()
  return { id, figure }
}

async function imageAction(page: Page, figure: Locator, action: RegExp) {
  await figure.hover()
  await figure.getByTestId('image-ai-key').click()
  await page.getByRole('menuitem', { name: action }).click()
}

/** A page with a line and one stored file block (like an upload). */
async function filePage(page: Page, file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
  const id = await page.evaluate(
    async ({ f }) => {
      const one = (window as unknown as { __one: AnyState }).__one
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: f.type })
      const src = await one.files.saveFile(blob, f.name)
      const s = one.workspace.getState()
      const id = s.createPage({ title: 'Acme mail', parentId: null })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mail from Acme: the invoice is attached.' }] }, { type: 'fileBlock', attrs: { src, name: f.name, size: blob.size, display: 'file' } }, { type: 'paragraph', content: [{ type: 'text', text: 'Notes follow below.' }] }] }, 'e2e')
      return id
    },
    { f: { name: file.name, type: file.type, data: Buffer.from(file.bytes).toString('base64') } },
  )
  await flush(page)
  await gotoPage(page, id)
  const card = editorOf(page, id).locator('.file-view, .pdf-view', { hasText: file.name }).first()
  await card.hover()
  await card.getByTestId('file-ai-key').click()
  await page.getByRole('menuitem', { name: /^Summarise/ }).click()
  return id
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

test.describe('golden Claude request bodies', () => {
  test('E1 improve · Opus', async ({ page }) => {
    const requests = await start(page, [text('A tighter launch sentence.')])
    await improve(page)
    await golden(page, 'e1-improve-opus', await sent(page, requests, 1))
  })

  test('E1 improve · Haiku 4.5', async ({ page }) => {
    const requests = await start(page, [text('A tighter launch sentence.')], { aiModel: 'claude-haiku-4-5' })
    await improve(page)
    await golden(page, 'e1-improve-haiku', await sent(page, requests, 1))
  })

  test('E1 refusal-fallback answer (another model served)', async ({ page }) => {
    const requests = await start(page, [text('A tighter launch sentence.', { model: 'claude-sonnet-5-5' })])
    await improve(page)
    await golden(page, 'e1-refusal-fallback', await sent(page, requests, 1))
  })

  test('E1 free request + one MCP server + pause_turn resume', async ({ page }) => {
    const requests = await start(page, [
      {
        blocks: [
          { type: 'mcp_tool_use', id: 'mcptoolu_1', server: 'archive', name: 'archive_search', input: { query: 'launch date' } },
          { type: 'mcp_tool_result', id: 'mcptoolu_1', text: 'REC-12 Launch: 2026-10-18' },
        ],
        stop: 'pause_turn',
      },
      text('According to Archive, the launch is on 2026-10-18 (REC-12).'),
    ])
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [ARCHIVE])
    const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const ask = page.getByPlaceholder('Ask AI to write anything…')
    await expect(async () => {
      await ed.locator('p').last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Space')
      try {
        await expect(ask).toBeFocused({ timeout: 2000 })
      } catch (e) {
        if (!(await ask.count())) await page.keyboard.press('Backspace')
        throw e
      }
    }).toPass({ timeout: 15_000 })
    await ask.fill('What does Archive say about the launch?')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out__body')).toContainText('According to Archive')
    await golden(page, 'e1-free-mcp-pause', await sent(page, requests, 2))
  })

  test('E2 autofill · Opus', async ({ page }) => {
    const requests = await start(page, [text(JSON.stringify({ value: 'Low' }))])
    const dbId = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, dbId)
    await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
    await expect(page.locator('#main section.db').first()).toHaveAttribute('data-view', 'table')
    await wsEval(
      page,
      (s, dbId) => {
        const p = s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority')
        s.updateProperty(dbId, p.id, { autofill: { preset: 'categorize', skipReview: true } })
      },
      dbId,
    )
    const grid = page.locator('#main .dbt')
    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(grid.locator('[data-cell="0:2"]')).toHaveAttribute('data-active', 'true')
    await page.keyboard.press('Alt+Enter')
    await expect(page.locator('.toast', { hasText: 'Priority filled for' })).toBeVisible()
    await golden(page, 'e2-autofill-opus', await sent(page, requests, 1))
  })

  test('E2 transform → Auto: the classification (600 tokens), then the form', async ({ page }) => {
    const FLOW = 'flowchart TD\n  s1["Open the box"] --> s2["Check the parts"]\n  s2 --> s3["Assemble the frame"]'
    const requests = await start(page, [
      text(JSON.stringify({ type: 'diagram', reason: 'The text lists steps in order' })),
      text(JSON.stringify({ diagram: 'flowchart', code: FLOW, keep: [1], left: ['Allow about 20 minutes.'] })),
    ])
    const li = (s: string): JSONContent => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] })
    const content = doc(para('Setting up the kit:'), { type: 'orderedList', attrs: { start: 1 }, content: ['Open the box', 'Check the parts', 'Assemble the frame'].map(li) }, para('Allow about 20 minutes.'), para('After the list.'))
    const id = await createPage(page, { title: 'Kit auto', content })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Setting up the kit:' }).first().click()
    await expect(async () => {
      await ed.evaluate((root) => {
        const find = (needle: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const i = (node as Text).data.indexOf(needle)
            if (i >= 0) return { node, i }
          }
          throw new Error(`text not found: ${needle}`)
        }
        const a = find('Setting up the kit:')
        const b = find('Allow about 20 minutes.')
        const r = document.createRange()
        r.setStart(a.node, a.i)
        r.setEnd(b.node, b.i + 'Allow about 20 minutes.'.length)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
      })
      await page.waitForTimeout(150)
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Allow about 20 minutes.')
    }).toPass({ timeout: 10_000 })
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await expect(panel(page)).toBeVisible()
    await panel(page).getByRole('option', { name: /^Transform into…/ }).click()
    await panel(page).getByRole('option', { name: /^Auto/ }).click()
    await expect(page.getByTestId('transform-auto')).toHaveText(/Auto picked Diagram/)
    await golden(page, 'e2-transform-classify', await sent(page, requests, 2))
  })

  test('E2 Haiku 4.5 (meeting summary)', async ({ page }) => {
    await noSpeech(page)
    const requests = await start(page, [text(JSON.stringify(SUMMARY))], { aiModel: 'claude-haiku-4-5' })
    await summarizeMeeting(page)
    await golden(page, 'e2-haiku', await sent(page, requests, 1))
  })

  test('E2 with an "All AI calls" MCP server (meeting summary)', async ({ page }) => {
    await noSpeech(page)
    const requests = await start(page, [text(JSON.stringify(SUMMARY))])
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [{ ...ARCHIVE, scope: 'all' }])
    await summarizeMeeting(page)
    await golden(page, 'e2-mcp-all', await sent(page, requests, 1))
  })

  test('E3 terminal: round 1, then round 2 with a tool result and an error result', async ({ page }) => {
    const requests = await start(page, [
      {
        blocks: [
          { type: 'text', text: 'Looking it up.' },
          { type: 'tool_use', id: 'toolu_g1', name: 'search_pages', input: { query: 'launch' } },
          { type: 'tool_use', id: 'toolu_g2', name: 'read_page', input: { page_id: 'nope00000000' } },
        ],
      },
      text('The launch notes say we launch in two weeks.'),
    ])
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('We launch in two weeks.')) })
    await gotoPage(page, id)
    await openTerminal(page)
    await run(page, 'When do we launch?')
    await expect(terminal(page).locator('.term-answer')).toContainText('we launch in two weeks')
    const got = await sent(page, requests, 2)
    const results = (got[1].body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c: AnyState) => c.type === 'tool_result')
    expect(results.map((r: AnyState) => !!r.is_error)).toEqual([false, true])
    await golden(page, 'e3-terminal-rounds', got)
  })

  test('E3 terminal: an unparseable streamed tool input is asked again', async ({ page }) => {
    const requests = await start(page, [{ blocks: [{ type: 'tool_use', id: 'toolu_bad', name: 'search_pages', input: '{"query": "launch"}}' }] }, text('Nothing found about the launch.')])
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('We launch in two weeks.')) })
    await gotoPage(page, id)
    await openTerminal(page)
    await run(page, 'When do we launch?')
    await expect(terminal(page).locator('.term-answer')).toContainText('Nothing found about the launch.')
    const got = await sent(page, requests, 2)
    expect(got[1].body).toEqual(got[0].body)
    await golden(page, 'e3-eager-retry', got)
  })

  test('E3 custom agent with its own model and effort', async ({ page }) => {
    const requests = await start(page, [{ blocks: [{ type: 'tool_use', id: 'toolu_a1', name: 'search_pages', input: { query: 'launch' } }] }, text('**Status report:** nothing blocks the launch.')])
    await wsEval(page, (s) => {
      const now = Date.now()
      s.upsertAgent({ id: 'ag-golden', name: 'Status reader', instructions: 'Summarise the status of all projects.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: 'claude-sonnet-5-5', effort: 'high', maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
    })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-golden'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await golden(page, 'e3-agent-model-effort', await sent(page, requests, 2))
  })

  test('file: PDF → Summarise (base64 document, cached)', async ({ page }) => {
    const requests = await start(page, [text('Invoice **2025-117** from Acme GmbH.')])
    await filePage(page, { name: 'invoice-2025-117.pdf', type: 'application/pdf', bytes: pdfBytes(2) })
    await expect(panel(page)).toContainText('from Acme GmbH')
    await golden(page, 'file-pdf-summarise', await sent(page, requests, 1))
  })

  test('file: Word → Summarise (a text document)', async ({ page }) => {
    const requests = await start(page, [text('Revenue grew by **12 %**.')])
    await filePage(page, { name: 'Quarterly report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docxBytes() })
    await expect(panel(page)).toContainText('Revenue grew by')
    await golden(page, 'file-text-document', await sent(page, requests, 1))
  })

  test('image: Describe (alt text + caption, structured)', async ({ page }) => {
    const requests = await start(page, [text(JSON.stringify({ alt: 'A striped test pattern.', caption: 'Test pattern P1' }))])
    const { figure } = await imagePage(page)
    await imageAction(page, figure, /Describe the image/)
    await expect(panel(page).getByRole('textbox', { name: 'Alt text' })).toHaveValue('A striped test pattern.')
    await golden(page, 'image-describe', await sent(page, requests, 1))
  })

  test('image: Image → table (structured, medium effort)', async ({ page }) => {
    const requests = await start(page, [text(JSON.stringify({ tables: [{ title: 'Volumes', header: ['Reagent', 'Volume (µl)'], rows: [['Buffer', '50'], ['Enzyme', '2,5']] }] }))])
    const { figure } = await imagePage(page)
    await imageAction(page, figure, /Image → table/)
    await expect(panel(page).getByTestId('ai-image-tables')).toContainText('Volumes')
    await golden(page, 'image-table', await sent(page, requests, 1))
  })

  test('MCP server test (inspectServer) after adding a server', async ({ page }) => {
    const requests = await start(page, [text('TOOLS: archive_search, archive_get\n---\n**Archive** is the team knowledge base.')])
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('mcp-servers')
    await section.scrollIntoViewIfNeeded()
    await section.getByRole('button', { name: 'Add server' }).click()
    const form = section.getByRole('form', { name: 'Add server' })
    await form.getByLabel('Server URL').fill(ARCHIVE.url)
    await form.getByLabel('Token · Optional').fill(ARCHIVE.token)
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.mcps-card[data-server="archive"]').getByTestId('mcp-status')).toHaveText('Connected · 2 tools')
    await golden(page, 'mcp-inspect', await sent(page, requests, 1))
  })
})
