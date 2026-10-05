/**
 * Claude changes existing content — always after the person's OK, shown as a diff (features/ai/agent
 * edit_page, features/history docDiff). read_page with refs → edit_page (replace / delete /
 * insert_after / replace_all) → the terminal's review shows a word-level diff → Apply / Discard per edit
 * → one transaction after an "AI" version, one ⌘Z. A block changed after staging is skipped; context
 * marks refuse unreadable blocks; custom agents in direct-write mode still stage edits for review.
 * Claude is mocked — never api.anthropic.com.
 */
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, flush, MOD } from './fixtures'
import { diffDocs, docDiffStats, foldRows, wordRuns, type DiffNode } from '../../src/app/features/history/docDiff'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_edit_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 70 } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string

/** api.anthropic.com → request n gets script[n] (later ones a short answer). */
async function mockAgent(ctx: BrowserContext, script: Step[]): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
    } catch {
      /* aborted */
    }
  })
  return bodies
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const terminal = (page: Page) => page.getByRole('region', { name: 'AI terminal' })
const prompt = (page: Page) => terminal(page).getByRole('textbox', { name: 'Task for the agent' })
const change = (page: Page, n: number) => terminal(page).locator('.term-change').nth(n - 1)

async function openTerminal(page: Page) {
  await page.keyboard.press(`${MOD}+j`)
  await expect(terminal(page)).toBeVisible()
  await expect(prompt(page)).toBeFocused()
}

async function run(page: Page, task: string) {
  await prompt(page).fill(task)
  await prompt(page).press('Enter')
}

/** The text Claude got back for a tool call (and whether it was an error). */
function toolResult(body: AnyState, id: string): { text: string; error: boolean } {
  const r = (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)
  if (!r) return { text: '', error: false }
  const text = typeof r.content === 'string' ? r.content : (r.content as AnyState[]).map((c) => c.text ?? '').join('')
  return { text, error: !!r.is_error }
}

/** The ref read_page put before a text ("⟦b3⟧\nThe team met …" or "- ⟦b6⟧ Ship …"). */
function refBefore(text: string, snippet: string): string {
  const at = text.indexOf(snippet)
  if (at < 0) throw new Error(`"${snippet}" not in the read_page result:\n${text}`)
  const refs = [...text.slice(0, at).matchAll(/⟦(b\d+)⟧/g)]
  return refs[refs.length - 1][1]
}

/** Texts of the page's top-level blocks (empty lines left out). */
const blocksOf = (page: Page, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const txt = (n: AnyState): string => n.text ?? (n.content ?? []).map(txt).join('|')
      return ((s.pages[id].content?.content ?? []) as AnyState[]).map(txt).filter(Boolean)
    },
    id,
  )

const P1 = 'The team met on Monday to plan the release.'
const P2 = 'Legacy note that should go.'
const P3 = 'Next steps follow below.'
const list = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) })
const ORIGINAL = ['Weekly sync', P1, P2, P3, 'Ship the beta|Fix the login bug']

async function setup(page: Page): Promise<string> {
  const id = await createPage(page, { title: 'Weekly sync notes', content: doc(heading(1, 'Weekly sync'), para(P1), para(P2), para(P3), list('Ship the beta', 'Fix the login bug')) })
  await gotoPage(page, id)
  await expect(editorOf(page, id)).toContainText('Fix the login bug')
  return id
}

/** Snapshots (version history) of a page, newest last, from IndexedDB one-history. */
async function snapshotsOf(page: Page, pageId: string): Promise<AnyState[]> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-history')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      if (!db.objectStoreNames.contains('snapshots')) return []
      return await new Promise<AnyState[]>((res, rej) => {
        const q = db.transaction('snapshots').objectStore('snapshots').get(`idx:${id}`)
        q.onsuccess = () => res(Array.isArray(q.result) ? q.result : [])
        q.onerror = () => rej(q.error)
      })
    } finally {
      db.close()
    }
  }, pageId)
}

test.describe('edit_page: Claude changes existing content after the OK', () => {
  test('refs → replace + delete + insert_after → word-level review, nothing changed → discard one, apply the rest → AI version, History word-level, ⌘Z', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    const bodies = await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id, refs: true } }]),
      (body) => {
        const read = toolResult(body, 'tu1').text
        return sseMessage([
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'edit_page',
            input: {
              id,
              edits: [
                { op: 'replace', from: refBefore(read, P1), markdown: 'The team met on Tuesday to plan the beta release.' },
                { op: 'delete', from: refBefore(read, P2) },
                { op: 'insert_after', ref: refBefore(read, P3), markdown: 'Owner: Mara' },
              ],
            },
          },
        ])
      },
      () => sseMessage([{ type: 'text', text: 'Staged three edits: the day, the legacy note, the owner.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Fix the day, drop the legacy note and add the owner')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 })

    // read_page with refs: every block and list item labelled, the labels outside the text
    const read = toolResult(bodies[1], 'tu1').text
    expect(read).toMatch(/⟦b\d+⟧\n# Weekly sync/)
    expect(read).toMatch(/- ⟦b\d+⟧ Ship the beta/)
    expect(toolResult(bodies[2], 'tu2')).toEqual({ text: expect.stringContaining('#1 replace'), error: false })

    // the review: three edits, each with its diff — word level inside the changed paragraph
    await expect(terminal(page).locator('.term-change[data-kind="edit"]')).toHaveCount(3)
    const first = change(page, 1)
    await expect(first.locator('.ddiff-del')).toHaveText(['Monday'])
    await expect(first.locator('.ddiff-ins')).toHaveText(['Tuesday', 'beta'])
    await expect(first.locator('.ddiff__seg[data-state="changed"]')).toContainText('The team met on')
    await expect(first.getByTestId('diff-fold')).toContainText('2 unchanged blocks')
    await expect(change(page, 2).locator('.ddiff__seg[data-state="removed"]')).toContainText(P2)
    await expect(change(page, 3).locator('.ddiff__seg[data-state="added"]')).toContainText('Owner: Mara')
    // nothing changed before Apply
    expect(await blocksOf(page, id)).toEqual(ORIGINAL)

    // discard the delete, apply the rest (one batch)
    await change(page, 2).getByRole('button', { name: 'Discard #2' }).click()
    await expect(change(page, 2)).toHaveAttribute('data-status', 'discarded')
    await terminal(page).locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect(change(page, 1)).toHaveAttribute('data-status', 'applied')
    await expect(change(page, 3)).toHaveAttribute('data-status', 'applied')
    await expect.poll(() => blocksOf(page, id)).toEqual(['Weekly sync', 'The team met on Tuesday to plan the beta release.', P2, P3, 'Owner: Mara', 'Ship the beta|Fix the login bug'])
    await expect(editorOf(page, id)).toContainText('Owner: Mara')
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, id)).toBe('ai')

    // the state before: an "AI" version; History shows the change word by word
    await expect.poll(async () => (await snapshotsOf(page, id)).filter((m) => m.reason === 'ai').length).toBe(1)
    await page.keyboard.press(`${MOD}+j`)
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('.hist__row', { has: page.locator('.hist__tag--ai') }).first().click()
    await expect(dialog.locator('.hist__preview .ddiff-del')).toHaveText(['Monday'])
    await expect(dialog.locator('.hist__preview .ddiff-ins').first()).toHaveText('Tuesday')
    await expect(dialog.locator('.hist__preview .ddiff__seg[data-state="added"]')).toContainText('Owner: Mara')
    await expect(dialog.locator('.hist__banner')).toContainText('~1 changed')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // ⌘Z in the page takes the whole applied edit back in one step
    await editorOf(page, id).locator('h2, h1').first().click()
    await page.keyboard.press(`${MOD}+z`)
    await expect(editorOf(page, id)).not.toContainText('Owner: Mara')
    await expect(editorOf(page, id)).toContainText(P1)
    await flush(page)
    await expect.poll(() => blocksOf(page, id)).toEqual(ORIGINAL)
  })

  test('a block the person edits after staging: that edit is skipped with a note, nothing overwritten', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id, refs: true } }]),
      (body) => {
        const read = toolResult(body, 'tu1').text
        return sseMessage([
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'edit_page',
            input: { id, edits: [{ op: 'replace', from: refBefore(read, P1), markdown: 'The team met on Tuesday.' }, { op: 'replace', from: refBefore(read, P3), markdown: 'Next steps:' }] },
          },
        ])
      },
      () => sseMessage([{ type: 'text', text: 'Staged two edits.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Tighten the notes')
    await expect(terminal(page).locator('.term-change[data-kind="edit"]')).toHaveCount(2, { timeout: 20_000 })

    // the person changes the first paragraph meanwhile
    const p1 = editorOf(page, id).locator('p', { hasText: 'Monday' })
    await p1.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Confirmed.')
    await flush(page)
    await expect(change(page, 1).locator('.agent-edit__note')).toContainText('Changed since it was proposed')

    await terminal(page).locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect(change(page, 2)).toHaveAttribute('data-status', 'applied')
    await expect(change(page, 1)).toHaveAttribute('data-status', 'failed')
    await expect(change(page, 1).locator('.term-change__error')).toContainText('Skipped: the text changed after Claude proposed this')
    await expect.poll(() => blocksOf(page, id)).toEqual(['Weekly sync', `${P1} Confirmed.`, P2, 'Next steps:', 'Ship the beta|Fix the login bug'])
  })

  test('list items: replace one item, add one after another → each diff inside its list, applied in place', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id, refs: true } }]),
      (body) => {
        const read = toolResult(body, 'tu1').text
        return sseMessage([
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'edit_page',
            input: { id, edits: [{ op: 'replace', from: refBefore(read, 'Fix the login bug'), markdown: 'Fix the login and signup bugs' }, { op: 'insert_after', ref: refBefore(read, 'Ship the beta'), markdown: '- Write the release notes' }] },
          },
        ])
      },
      () => sseMessage([{ type: 'text', text: 'Staged two list edits.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Update the list')
    await expect(terminal(page).locator('.term-change[data-kind="edit"]')).toHaveCount(2, { timeout: 20_000 })
    await expect(change(page, 1).locator('ul li .ddiff-del')).toHaveText(['bug'])
    await expect(change(page, 1).locator('ul li .ddiff-ins')).toHaveText(['and signup bugs'])
    await expect(change(page, 2).locator('ul li[data-diff="add"]')).toHaveText('Write the release notes')
    await terminal(page).locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect(change(page, 2)).toHaveAttribute('data-status', 'applied')
    await expect.poll(() => blocksOf(page, id)).toEqual(['Weekly sync', P1, P2, P3, 'Ship the beta|Write the release notes|Fix the login and signup bugs'])
    // applied: what each edit did, still inside the list
    await expect(change(page, 1).locator('ul li .ddiff-ins')).toHaveText(['and signup bugs'])
    await expect(change(page, 2).locator('ul li[data-diff="add"]')).toHaveText('Write the release notes')
  })

  test('context marks: read_page shows only the marked blocks; an edit of an unmarked block is refused', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await setup(page)
    let refs: Record<string, string> = {}
    const bodies = await mockAgent(context, [
      // task 1: the whole page is readable
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id, refs: true } }]),
      (body) => {
        const read = toolResult(body, 'tu1').text
        refs = { p1: refBefore(read, P1), p2: refBefore(read, P2), p3: refBefore(read, P3) }
        return sseMessage([{ type: 'text', text: 'Read it.' }])
      },
      // task 2: only the heading and P1 are marked
      () => sseMessage([{ type: 'tool_use', id: 'tu3', name: 'read_page', input: { id, refs: true } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu4', name: 'edit_page', input: { id, edits: [{ op: 'replace', from: refs.p2, markdown: 'Sneaky rewrite.' }] } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu5', name: 'edit_page', input: { id, edits: [{ op: 'delete', from: refs.p1, to: refs.p3 }] } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu6', name: 'edit_page', input: { id, edits: [{ op: 'replace_all', markdown: 'Everything new.' }] } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu7', name: 'edit_page', input: { id, edits: [{ op: 'replace', from: refs.p1, markdown: 'The team met on Tuesday.' }] } }]),
      () => sseMessage([{ type: 'text', text: 'Changed the readable paragraph only.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Read the notes')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 })

    // /context: mark the heading and the first paragraph
    await run(page, '/context')
    const rows = page.getByTestId('ctx-layer').getByRole('option')
    await expect(rows.first()).toBeVisible()
    await page.keyboard.press('n')
    await rows.nth(0).click()
    await rows.nth(1).click()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('ctx-layer')).toHaveCount(0)
    if (!(await terminal(page).isVisible())) await openTerminal(page)
    await prompt(page).click()
    await run(page, 'Rewrite the legacy note')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 })

    const read = toolResult(bodies[3], 'tu3').text
    expect(read).toContain(P1)
    expect(read).not.toContain(P2)
    expect(read).not.toContain('Ship the beta')
    const refused = (i: number, tu: string) => toolResult(bodies[i], tu)
    expect(refused(4, 'tu4').error).toBe(true)
    expect(refused(4, 'tu4').text).toContain('not readable')
    expect(refused(5, 'tu5').error).toBe(true)
    expect(refused(5, 'tu5').text).toContain('refused')
    expect(refused(6, 'tu6').error).toBe(true)
    expect(refused(6, 'tu6').text).toContain('replace_all')
    expect(refused(7, 'tu7').error).toBe(false)
    // one edit staged: the readable paragraph
    await expect(terminal(page).locator('.term-change[data-kind="edit"]')).toHaveCount(1)
    expect(await blocksOf(page, id)).toEqual(ORIGINAL)
  })

  test('replace_all on a page that is not open: the whole page as a diff, applied after a version', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Draft memo', content: doc(para('Old intro line.'), para('Old body text that will be rewritten.')) })
    await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'edit_page', input: { id, edits: [{ op: 'replace_all', markdown: '## Memo\n\nNew intro line.\n\nOld body text that was rewritten.' }] } }]),
      () => sseMessage([{ type: 'text', text: 'Rewrote the memo.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Rewrite the whole Draft memo')
    const c = change(page, 1)
    await expect(c).toHaveAttribute('data-kind', 'edit', { timeout: 20_000 })
    await expect(c.locator('.agent-edit__meta')).toContainText(/Rewrite\s*whole page/i)
    await expect(c.locator('.ddiff-del')).toContainText(['Old', 'will be'])
    await expect(c.locator('.ddiff-ins')).toContainText(['New', 'was'])
    await c.getByRole('button', { name: 'Apply #1' }).click()
    await expect(c).toHaveAttribute('data-status', 'applied')
    expect(await blocksOf(page, id)).toEqual(['Memo', 'New intro line.', 'Old body text that was rewritten.'])
    await expect.poll(async () => (await snapshotsOf(page, id)).map((m) => m.reason)).toEqual(['ai'])
    // the batch undo (u) puts the page back
    await c.focus()
    await page.keyboard.press('u')
    await expect.poll(() => blocksOf(page, id)).toEqual(['Old intro line.', 'Old body text that will be rewritten.'])
  })

  test('a custom agent in direct-write mode: its edit is staged for review, not applied', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Agent notes', content: doc(para('Status: the launch is on track.'), para('Keep this line.')) })
    await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id, refs: true } }]),
      (body) => {
        const read = toolResult(body, 'tu1').text
        return sseMessage([
          { type: 'tool_use', id: 'tu2', name: 'edit_page', input: { id, edits: [{ op: 'replace', from: refBefore(read, 'Status:'), markdown: 'Status: the launch slipped a week.' }] } },
          { type: 'tool_use', id: 'tu3', name: 'append_to_page', input: { id, markdown: 'Checked by the agent.' } },
        ])
      },
      () => sseMessage([{ type: 'text', text: 'Updated the status; the edit waits for review.' }]),
    ])
    const agentId = await wsEval(page, (s, pageId) => {
      const now = Date.now()
      s.upsertAgent({ id: 'ag-edit', name: 'Status keeper', instructions: 'Keep the status line current.', trigger: { type: 'manual' }, scope: { everything: false, pages: [pageId], databases: [] }, write: 'apply', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
      return 'ag-edit'
    }, id)
    await flush(page)
    await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), agentId)
    await page.getByRole('button', { name: 'Run now' }).click()
    const runRow = page.locator('.agx-run').first()
    await expect(runRow).toHaveAttribute('data-status', 'staged', { timeout: 20_000 })
    // the append went in directly, the edit waits — with its diff
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('Checked by the agent.')
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('on track')
    await expect(runRow.locator('.agx-step', { hasText: 'waits for your review' })).toBeVisible()
    const edit = runRow.locator('.agent-change[data-kind="edit"]')
    await expect(edit).toHaveAttribute('data-status', 'pending')
    await expect(edit.locator('.ddiff-del')).toContainText(['is on track.'])
    await expect(edit.locator('.ddiff-ins')).toContainText(['slipped a week.'])
    await edit.getByRole('button', { name: /^Apply/ }).click()
    await expect(edit).toHaveAttribute('data-status', 'applied')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('slipped a week')
  })
})

test.describe('the word-level diff helper (features/history/docDiff)', () => {
  const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const texts = (n: DiffNode, d?: 'del' | 'add'): string[] => (n.type === 'text' ? (n.diff === d ? [n.text ?? ''] : []) : (n.content ?? []).flatMap((c) => texts(c, d)))

  test('words, pairing, marks, lists, atoms, folding', () => {
    expect(wordRuns('the quick brown fox', 'the slow brown fox')).toEqual([
      { op: 'same', text: 'the ' },
      { op: 'del', text: 'quick' },
      { op: 'add', text: 'slow' },
      { op: 'same', text: ' brown fox' },
    ])
    // a changed paragraph is paired and merged word by word; ids never count as a change
    const items = diffDocs(doc({ ...p('Alpha one two'), attrs: { id: 'x' } }, p('Same')), doc({ ...p('Alpha one three'), attrs: { id: 'y' } }, p('Same')))
    expect(items.map((i) => i.kind)).toEqual(['changed', 'same'])
    const merged = items[0].kind === 'changed' ? items[0].merged : null
    expect(texts(merged!, 'del')).toEqual(['two'])
    expect(texts(merged!, 'add')).toEqual(['three'])
    // unrelated blocks stay a removed + added pair
    expect(diffDocs(doc(p('Completely different words here')), doc(p('Nothing alike at all'))).map((i) => i.kind)).toEqual(['removed', 'added'])
    // a mark change is a change of those words
    const bold = diffDocs(doc(p('make it bold')), doc({ type: 'paragraph', content: [{ type: 'text', text: 'make it ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] }))
    expect(bold[0].kind).toBe('changed')
    // lists: a changed item inside the list, an item removed
    const before = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('Ship the beta')] }, { type: 'listItem', content: [p('Fix the bug')] }, { type: 'listItem', content: [p('Drop this')] }] })
    const after = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('Ship the beta')] }, { type: 'listItem', content: [p('Fix the login bug')] }] })
    const l = diffDocs(before, after)
    expect(l.map((i) => i.kind)).toEqual(['changed'])
    const ln = l[0].kind === 'changed' ? l[0].merged : null
    expect(texts(ln!, 'add')).toEqual(['login'])
    expect(ln!.content!.map((c) => c.diff ?? 'same')).toEqual(['same', 'same', 'del'])
    // atoms: text-less blocks are never merged — a whole removed / added pair
    const img = (src: string): JSONContent => ({ type: 'image', attrs: { src } })
    expect(diffDocs(doc(img('a.png')), doc(img('b.png'))).map((i) => i.kind)).toEqual(['removed', 'added'])
    // folding: the change with one block of context, the rest folded
    const many = Array.from({ length: 10 }, (_, i) => p(`Block number ${i}`))
    const changed = many.map((b, i) => (i === 5 ? p('Block number five') : b))
    const rows = foldRows(diffDocs(doc(...many), doc(...changed)), 1)
    expect(rows.map((r) => (r.kind === 'fold' ? `fold ${r.count}` : r.item.kind))).toEqual(['fold 4', 'same', 'changed', 'same', 'fold 3'])
    expect(docDiffStats(diffDocs(doc(...many), doc(...changed)))).toEqual({ added: 0, removed: 0, changed: 1, same: 9 })
  })
})
