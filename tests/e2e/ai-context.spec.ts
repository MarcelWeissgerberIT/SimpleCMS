/**
 * What Claude reads ("Kontext-Auswahl"): context marks on a page (editor/context) — the picker (boxes in
 * the gutter, a bar at the bottom), the AI menu's reads line, and the effect on what is sent: page-level
 * requests of the AI menu, the AI terminal's read_page / search. Claude is mocked; request bodies are
 * checked for text that must not go out. Never api.anthropic.com.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, mockClaude, selectText, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const setKey = (page: Page, lang?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), lang)
const panel = (page: Page) => page.locator('.ai-panel')
const reads = (page: Page) => page.getByTestId('ai-reads')
const layer = (page: Page) => page.getByTestId('ctx-layer')
const rows = (page: Page) => layer(page).getByRole('option')
const bar = (page: Page) => page.getByTestId('ctx-bar')

/** Five blocks: A, C, D are fine to send; B and E carry canaries that must never leave when unmarked. */
const BLOCKS = ['Alpha line about the launch plan.', 'Bravo SECRETBRAVO salary bands.', 'Charlie line about the beta testers.', 'Delta line about the tracker.', 'Echo SECRETECHO private notes.']

async function setup(page: Page): Promise<string> {
  const id = await createPage(page, { title: 'Context notes', content: doc(...BLOCKS.map(para), para('')) })
  await gotoPage(page, id)
  return id
}

/** Caret on the empty last line, Space → the AI panel. */
async function openPanel(page: Page, id: string) {
  const ed = editorOf(page, id)
  await ed.locator('p').last().click()
  await ed.evaluate((root) => {
    const e = (root as unknown as { editor: AnyState }).editor
    e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run()
  })
  await page.waitForTimeout(150)
  await page.keyboard.press('Space')
  await expect(panel(page)).toBeVisible()
}

/** The reads line → "Mark blocks…" → the picker. */
async function openPicker(page: Page) {
  await reads(page).click()
  await panel(page).getByRole('option', { name: /Mark blocks/ }).click()
  await expect(layer(page)).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
}

test.describe('context marks: what Claude reads', () => {
  test('picker: click + keyboard (j/k, Space, a/n), Done keeps the request; Esc restores; Shift-click a range; marks survive typing above', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await openPanel(page, id)
    await expect(reads(page)).toHaveText(/Reads\s*·\s*whole page · 2\d words/i)
    await panel(page).locator('.ai-cmd__input').fill('draft a tagline')
    await openPicker(page)
    // typing is paused while picking
    await expect(editorOf(page, id)).toHaveAttribute('contenteditable', 'false')
    await expect(bar(page)).toContainText(/Context · Nothing marked/i)

    // a: all, n: none
    await page.keyboard.press('a')
    await expect(bar(page)).toContainText(/6 blocks/i)
    await page.keyboard.press('n')
    await expect(rows(page).and(page.locator('[aria-selected="true"]'))).toHaveCount(0)

    // click Alpha; j j Space → Charlie; k moves back up
    await rows(page).nth(0).click()
    await page.keyboard.press('j')
    await page.keyboard.press('j')
    await expect(rows(page).nth(2)).toHaveAttribute('data-focus', 'true')
    await page.keyboard.press(' ')
    await page.keyboard.press('k')
    await expect(rows(page).nth(1)).toHaveAttribute('data-focus', 'true')
    await expect(rows(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'false')
    await expect(rows(page).nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(bar(page)).toContainText(/Context · 2 blocks · 12 words/i)
    // unmarked blocks are dimmed
    await expect(editorOf(page, id).locator('p.ctx-off')).toHaveCount(4)

    // Enter = Done: the panel comes back with the request kept
    await page.keyboard.press('Enter')
    await expect(layer(page)).toHaveCount(0)
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).locator('.ai-cmd__input')).toHaveValue('draft a tagline')
    await expect(reads(page)).toHaveText(/2 marked blocks · 12 words/i)
    await expect(editorOf(page, id)).toHaveAttribute('contenteditable', 'true')

    // Esc cancels: the marks from before stay
    await openPicker(page)
    await rows(page).nth(1).click()
    await expect(bar(page)).toContainText(/3 blocks/i)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeVisible()
    await expect(reads(page)).toHaveText(/2 marked blocks/i)

    // Shift-click: a range
    await openPicker(page)
    await page.keyboard.press('n')
    await rows(page).nth(0).click()
    await rows(page).nth(3).click({ modifiers: ['Shift'] })
    await expect(bar(page)).toContainText(/4 blocks/i)
    await bar(page).getByRole('button', { name: /Done/ }).click()
    await expect(reads(page)).toHaveText(/4 marked blocks/i)

    // typing above the marked blocks: the marks follow
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await editorOf(page, id).evaluate((root) => {
      const e = (root as unknown as { editor: AnyState }).editor
      e.chain().focus().insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'A new first line typed above.' }] }).run()
    })
    await openPanel(page, id)
    await expect(reads(page)).toHaveText(/4 marked blocks/i)
    await openPicker(page)
    await expect(rows(page).nth(0)).toHaveAttribute('aria-selected', 'false')
    await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(rows(page).nth(4)).toHaveAttribute('aria-selected', 'true')
    await expect(rows(page).nth(5)).toHaveAttribute('aria-selected', 'false')
    await page.keyboard.press('Escape')
  })

  test('AI menu: marked sends only those blocks, nothing sends no page text, page-level actions ask first, selection actions still read the selection', async ({ page, context }) => {
    const bodies = await mockClaude(context, () => 'A crisp tagline.')
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await openPanel(page, id)
    // mark Alpha + Delta
    await openPicker(page)
    await rows(page).nth(0).click()
    await rows(page).nth(3).click()
    await page.keyboard.press('Enter')
    await panel(page).locator('.ai-cmd__input').fill('write a tagline')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toContainText('A crisp tagline.')
    await expect(panel(page).getByTestId('ai-run-reads')).toHaveText(/2 blocks/i)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('Alpha line about the launch plan.')
    expect(bodies[0]).toContain('Delta line about the tracker.')
    expect(bodies[0]).toContain('Context notes')
    for (const s of ['SECRETBRAVO', 'SECRETECHO', 'Charlie line']) expect(bodies[0]).not.toContain(s)
    await panel(page).getByRole('option', { name: /Discard/ }).click()

    // nothing from this page: a free request carries no page text at all
    await openPanel(page, id)
    await reads(page).click()
    await panel(page).getByRole('option', { name: /Nothing from this page/ }).click()
    await expect(reads(page)).toHaveText(/nothing from this page/i)
    await panel(page).locator('.ai-cmd__input').fill('write a haiku about autumn')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toContainText('A crisp tagline.')
    expect(bodies).toHaveLength(2)
    for (const s of ['Alpha line', 'SECRETBRAVO', 'Charlie line', 'Delta line', 'SECRETECHO', 'Context notes']) expect(bodies[1]).not.toContain(s)
    expect(bodies[1]).toContain('write a haiku about autumn')
    await panel(page).getByRole('option', { name: /Discard/ }).click()

    // "Summarize this page" with nothing to read: asked first, nothing sent
    await openPanel(page, id)
    await panel(page).getByRole('option', { name: /Summarize this page/ }).click()
    await expect(panel(page).getByTestId('ai-reads-ask')).toContainText('needs the text of this page')
    await page.waitForTimeout(300)
    expect(bodies).toHaveLength(2)
    await panel(page).getByRole('option', { name: /Read the whole page and run/ }).click()
    await expect(panel(page)).toContainText('A crisp tagline.')
    expect(bodies).toHaveLength(3)
    for (const s of BLOCKS) expect(bodies[2]).toContain(s.split(' ').slice(0, 2).join(' '))
    await expect(panel(page).getByTestId('ai-run-reads')).toHaveText(/^Page$/i)
    await panel(page).getByRole('option', { name: /Discard/ }).click()

    // a selection action reads the selection — with "nothing from this page" only the selection
    await openPanel(page, id)
    await reads(page).click()
    await panel(page).getByRole('option', { name: /Nothing from this page/ }).click()
    await page.keyboard.press('Escape')
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Charlie line' }).click()
    await selectText(page, ed, 'Charlie line about the beta testers.')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await expect(reads(page)).toHaveText(/selection · 6 words/i)
    await panel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(panel(page)).toContainText('A crisp tagline.')
    expect(bodies).toHaveLength(4)
    expect(bodies[3]).toContain('Charlie line about the beta testers.')
    for (const s of ['Alpha line', 'SECRETBRAVO', 'SECRETECHO']) expect(bodies[3]).not.toContain(s)
  })

  test('DE · 390 px: the picker by touch, German readouts', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page, 'de')
    const id = await setup(page)
    await openPanel(page, id)
    await expect(reads(page)).toHaveText(/Liest\s*·\s*ganze Seite · 2\d Wörter/i)
    await reads(page).click()
    await panel(page).getByRole('option', { name: /Blöcke markieren/ }).click()
    await expect(layer(page)).toBeVisible()
    await rows(page).nth(2).click()
    await expect(bar(page)).toContainText(/Kontext · 1 Block · 6 Wörter/i)
    const done = bar(page).getByRole('button', { name: /Fertig/ })
    const box = await done.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(36)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await done.click()
    await expect(reads(page)).toHaveText(/1 markierter Block · 6 Wörter/i)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

/* ------------------------------------------------------------------ */
/* AI terminal                                                         */
/* ------------------------------------------------------------------ */

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
let seq = 0

function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', { message: { id: `msg_ctx_${++seq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } })
  body += ev('message_stop', {})
  return body
}

async function mockAgent(ctx: BrowserContext, script: Array<(body: AnyState) => string>): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
  })
  return bodies
}

const terminal = (page: Page) => page.getByRole('region', { name: 'AI terminal' })
const prompt = (page: Page) => terminal(page).getByRole('textbox', { name: 'Task for the agent' })
const toolResult = (body: AnyState, id: string): string =>
  JSON.stringify((body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)?.content ?? '')

test.describe('context marks in the AI terminal', () => {
  test('the chip shows the mode; read_page of the open page returns only the marked blocks, nothing in "none"; another page reads fully; /context opens the picker', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const other = await createPage(page, { title: 'Other notes', content: doc(para('Other page SECRETOTHER stays readable.')) })
    const id = await setup(page)
    const bodies = await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'toolu_open', name: 'read_page', input: { id } }, { type: 'tool_use', id: 'toolu_other', name: 'read_page', input: { id: other } }]),
      () => sseMessage([{ type: 'tool_use', id: 'toolu_find', name: 'search_pages', input: { query: 'SECRETBRAVO' } }]),
      () => sseMessage([{ type: 'text', text: 'Read them.' }]),
      () => sseMessage([{ type: 'tool_use', id: 'toolu_none', name: 'read_page', input: { id } }]),
      () => sseMessage([{ type: 'text', text: 'Nothing to read.' }]),
    ])

    // /context opens the picker on the open page
    await page.keyboard.press(`${MOD}+j`)
    await expect(prompt(page)).toBeFocused()
    await prompt(page).fill('/context')
    await prompt(page).press('Enter')
    await expect(layer(page)).toBeVisible()
    await rows(page).nth(0).click()
    await rows(page).nth(2).click()
    await page.keyboard.press('Enter')
    await expect(layer(page)).toHaveCount(0)
    await expect(terminal(page)).toContainText('Context · Context notes: 2 blocks')
    await expect(page.getByTestId('term-page-chip')).toHaveText(/Context notes\s*· 2 blocks/)

    await prompt(page).fill('Summarise this page and the other one')
    await prompt(page).press('Enter')
    await expect(terminal(page).locator('.term-answer')).toContainText('Read them.', { timeout: 20_000 })
    expect(JSON.stringify(bodies[0].messages[0].content)).toContain('only the 2 blocks they marked')
    const open = toolResult(bodies[1], 'toolu_open')
    expect(open).toContain('The person limited what you may read on this page')
    expect(open).toContain('Alpha line about the launch plan.')
    expect(open).toContain('Charlie line about the beta testers.')
    for (const s of ['SECRETBRAVO', 'SECRETECHO', 'Delta line']) expect(open).not.toContain(s)
    expect(toolResult(bodies[1], 'toolu_other')).toContain('Other page SECRETOTHER stays readable.')
    // search does not find (or quote) the unmarked text of the page
    expect(toolResult(bodies[2], 'toolu_find')).not.toContain('SECRETBRAVO salary')

    // the chip's menu: nothing from this page → read_page withholds it
    await page.getByTestId('term-page-chip').click()
    await page.getByRole('menuitem', { name: /Nothing from this page/ }).click()
    await expect(page.getByTestId('term-page-chip')).toHaveText(/Context notes\s*· nothing/)
    await prompt(page).fill('What does this page say?')
    await prompt(page).press('Enter')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Nothing to read.', { timeout: 20_000 })
    const none = toolResult(bodies[4], 'toolu_none')
    expect(none).toContain('Content withheld')
    for (const s of BLOCKS) expect(none).not.toContain(s)
    expect(JSON.stringify(bodies[3].messages.at(-1).content)).toContain("excluded the open page's content")
  })
})
