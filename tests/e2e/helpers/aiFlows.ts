/**
 * AI flows through their real UI paths, for the ledger and receipt specs (ai-ledger.spec.ts) and the screenshot
 * scripts: Improve, an own request with an MCP server, ⌘K "?", Transform → Auto, a meeting summary, a PDF, an image,
 * an MCP server test, autofill. Every host is mocked by the caller (helpers/providers.ts). Test data is fictional.
 */
import { deflateSync } from 'node:zlib'
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { expect, gotoPage, createPage, wsEval, uiEval, editorOf, doc, para, selectText, flush, pageIdByTitle, MOD } from '../fixtures'
import { pdfBytes } from './files'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const aiPanel = (page: Page) => page.getByRole('dialog', { name: /Ask AI|KI fragen/ })

/** "Launch notes": select a line and run "Improve writing" (`answer`: wait for it; null: do not wait). */
export async function improve(page: Page, answer: string | null = 'A tighter launch sentence.'): Promise<string> {
  const id = await createPage(page, { title: 'Launch notes', content: doc(para('Intro line stays.'), para('our launch sentence is kinda loose'), para('Closing line.')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: 'our launch sentence is kinda loose' }).click()
  await selectText(page, ed, 'our launch sentence is kinda loose')
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(aiPanel(page)).toBeVisible()
  await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
  if (answer) await expect(aiPanel(page)).toContainText(answer)
  return id
}

export const ARCHIVE = { id: 'srvarch001', name: 'archive', url: 'https://mcp.example.test/api/archive/mcp', token: 'archive-e2e-PLAINTEXT-token-7Hq0001', enabled: true, prompt: '**Archive** is the team knowledge base.\n- Find records with `archive_search` (query).', promptSource: 'auto', tools: ['archive_search'], checkedAt: 1 }

/** An own request from the empty line of "Launch plan" (the AI menu opens on Space). */
export async function ownRequest(page: Page, request: string): Promise<string> {
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
  await ask.fill(request)
  await page.keyboard.press('Enter')
  return id
}

/** ⌘K "?" on "Launch plan". */
export async function paletteAsk(page: Page, question: string, answer: string) {
  const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.')) })
  await gotoPage(page, id)
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type(`?${question}`)
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  await expect(pal.locator('.pal-mode')).toHaveText('ASK')
  await page.keyboard.press('Enter')
  await expect(pal).toContainText(answer)
  await page.keyboard.press('Escape')
}

/** Transform → Auto on a short list (two requests: the classification, then the form). */
export async function transformAuto(page: Page) {
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
  await expect(aiPanel(page)).toBeVisible()
  await aiPanel(page).getByRole('option', { name: /^Transform into…/ }).click()
  await aiPanel(page).getByRole('option', { name: /^Auto/ }).click()
  await expect(page.getByTestId('transform-auto')).toHaveText(/Auto picked Diagram/)
}

export const TRANSFORM_STEPS = [
  { blocks: [{ type: 'text' as const, text: JSON.stringify({ type: 'diagram', reason: 'The text lists steps in order' }) }] },
  { blocks: [{ type: 'text' as const, text: JSON.stringify({ diagram: 'flowchart', code: 'flowchart TD\n  s1["Open the box"] --> s2["Check the parts"]\n  s2 --> s3["Assemble the frame"]', keep: [1], left: ['Allow about 20 minutes.'] }) }] },
]

/** No speech recognition here: the meeting block takes a pasted transcript (call before the app opens). */
export const noSpeech = (page: Page) =>
  page.addInitScript(() => {
    for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true })
  })

export const SUMMARY = { title: 'Relaunch sync', summary: ['We ship in two steps.'], decisions: ['Ship in two steps.'], actionItems: [{ text: 'Send the deck to legal', owner: 'Alex', due: null }] }

/** A meeting block from a pasted transcript → the structured summary request. */
export async function summarizeMeeting(page: Page) {
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

/** A PNG made here, byte for byte the same every run (w × h, a few stripes). */
export function pngBytes(w = 64, h = 48): Buffer {
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

/** "Protokoll P1" with an image block holding the PNG → an image action ('Describe the image' …). */
export async function imageAction(page: Page, action: RegExp): Promise<{ id: string; figure: Locator }> {
  const id = await createPage(page, { title: 'Protokoll P1', content: doc(para('Deck layout, plate and volumes for run P1.'), { type: 'image', attrs: { src: null } }, para('Notes follow below.')) })
  await gotoPage(page, id)
  const chooser = page.waitForEvent('filechooser')
  await editorOf(page, id).locator('.media-empty').getByRole('button', { name: /Upload/ }).click()
  await (await chooser).setFiles({ name: 'protocol-p1.png', mimeType: 'image/png', buffer: pngBytes() })
  const figure = editorOf(page, id).locator('.image-view').first()
  await expect(figure.locator('img')).toBeVisible()
  await figure.hover()
  await figure.getByTestId('image-ai-key').click()
  await page.getByRole('menuitem', { name: action }).click()
  return { id, figure }
}

/** A page with a stored PDF file block → Summarise. */
export async function summarisePdf(page: Page): Promise<string> {
  const file = { name: 'invoice-2025-117.pdf', type: 'application/pdf', bytes: pdfBytes(2) }
  const id = await page.evaluate(
    async ({ f }) => {
      const one = (window as unknown as { __one: AnyState }).__one
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: f.type })
      const src = await one.files.saveFile(blob, f.name)
      const s = one.workspace.getState()
      const id = s.createPage({ title: 'Acme mail', parentId: null })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mail from Acme: the invoice is attached.' }] }, { type: 'fileBlock', attrs: { src, name: f.name, size: blob.size, display: 'file' } }] }, 'e2e')
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

/** Settings → Claude AI → Add server (the server test request). */
export async function addArchiveServer(page: Page) {
  await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
  const section = page.getByTestId('mcp-servers')
  await section.scrollIntoViewIfNeeded()
  await section.getByRole('button', { name: 'Add server' }).click()
  const form = section.getByRole('form', { name: 'Add server' })
  await form.getByLabel('Server URL').fill(ARCHIVE.url)
  await form.getByLabel('Token · Optional').fill(ARCHIVE.token)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.mcps-card[data-server="archive"]').getByTestId('mcp-status')).toHaveText(/Connected/)
  await page.keyboard.press('Escape')
}

/** Autofill "Priority" on the first project row (skip review). Returns the database and property ids. */
export async function autofillPriority(page: Page): Promise<{ dbId: string; propId: string }> {
  const dbId = await pageIdByTitle(page, 'Projects')
  await gotoPage(page, dbId)
  await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
  await expect(page.locator('#main section.db').first()).toHaveAttribute('data-view', 'table')
  const propId = await wsEval(
    page,
    (s, dbId) => {
      const p = s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority')
      s.updateProperty(dbId, p.id, { autofill: { preset: 'categorize', skipReview: true } })
      return p.id as string
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
  return { dbId, propId }
}

/** A browser agent (manual trigger, scope "everything") — "Run now" on its page; waits for the run to end ok. */
export async function runAgentNow(page: Page, agent: AnyState) {
  await wsEval(
    page,
    (s, a) =>
      s.upsertAgent({ instructions: 'Summarise the status of all projects.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: 1760252400000, updatedAt: 1760252400000, ...a }),
    agent,
  )
  await flush(page)
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), agent.id)
  await expect(page.locator('.agx-dhead')).toBeVisible()
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
}

/** The ledger seam (window.__oneLedger, ?e2e): this member's entries on this device, oldest first. */
export const ledger = (page: Page): Promise<AnyState[]> => page.evaluate(() => (window as unknown as { __oneLedger: { entries: () => Promise<AnyState[]> } }).__oneLedger.entries())
