/**
 * Version history of database entries: a snapshot of a row keeps its title, icon and stored property
 * values (with the schema then); Changes lists what differs in a "Properties" block (old struck, new
 * marked); restore brings content and values back — not deleted properties, never computed ones. AI
 * writes (terminal update_row) keep the row as it was as an "AI" version; a bulk edit snapshots each
 * row at most once per interval; versions written before properties were kept still open.
 * Claude is mocked — never api.anthropic.com.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, doc, para, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const OPTS = {
  status: [
    { id: 'o-todo', name: 'Not started', color: 'default' },
    { id: 'o-prog', name: 'In progress', color: 'blue' },
    { id: 'o-done', name: 'Done', color: 'green' },
  ],
  tags: [
    { id: 't-web', name: 'Web', color: 'orange' },
    { id: 't-ios', name: 'iOS', color: 'purple' },
    { id: 't-press', name: 'Press', color: 'yellow' },
  ],
}

/** A database "Launch tasks" with stored and computed properties, and one row. */
async function setup(page: Page, rows = 1): Promise<{ dbId: string; rowIds: string[] }> {
  return wsEval(
    page,
    (s, { opts, rows, body }) => {
      const dbId = s.createDatabase({
        title: 'Launch tasks',
        parentId: null,
        properties: [
          { id: 'p-title', name: 'Name', type: 'title' },
          { id: 'p-status', name: 'Status', type: 'status', options: opts.status },
          { id: 'p-due', name: 'Due', type: 'date' },
          { id: 'p-tags', name: 'Tags', type: 'multi_select', options: opts.tags },
          { id: 'p-est', name: 'Estimate', type: 'number', numberFormat: 'number' },
          { id: 'p-ok', name: 'Approved', type: 'checkbox' },
          { id: 'p-note', name: 'Note', type: 'text' },
          { id: 'p-double', name: 'Double', type: 'formula', formula: 'prop("Estimate") * 2' },
          { id: 'p-created', name: 'Created', type: 'created_time' },
          { id: 'p-edited', name: 'Edited', type: 'last_edited_time' },
        ],
      })
      const rowIds: string[] = []
      for (let i = 0; i < rows; i++) {
        const id = s.createRow(dbId, {
          title: rows === 1 ? 'Pricing page copy' : `Task ${i + 1}`,
          properties: { 'p-status': 'o-prog', 'p-due': { start: '2026-10-09' }, 'p-tags': ['t-web', 't-ios'], 'p-est': 3, 'p-ok': false, 'p-note': 'first draft' },
          ...(rows === 1 ? { content: body } : {}),
        })
        rowIds.push(id)
      }
      return { dbId, rowIds }
    },
    { opts: OPTS, rows, body: doc(para('Draft the pricing copy with the new tiers.'), para('Owner: Mara.')) },
  )
}

/** Version metas of a page (oldest first) and, optionally, their bodies — straight from IndexedDB one-history. */
async function versions(page: Page, pageId: string, bodies = false): Promise<Array<AnyState & { body?: AnyState }>> {
  return page.evaluate(
    async ({ id, bodies }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('one-history')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      try {
        if (!db.objectStoreNames.contains('snapshots')) return []
        const get = (key: string) =>
          new Promise<AnyState>((res, rej) => {
            const q = db.transaction('snapshots').objectStore('snapshots').get(key)
            q.onsuccess = () => res(q.result)
            q.onerror = () => rej(q.error)
          })
        const metas = ((await get(`idx:${id}`)) ?? []) as AnyState[]
        if (!bodies) return metas
        return Promise.all(metas.map(async (m) => ({ ...m, body: await get(`snap:${m.id}`) })))
      } finally {
        db.close()
      }
    },
    { id: pageId, bodies },
  )
}

const openHistory = async (page: Page) => {
  await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.hist__title')).toBeVisible()
  return dialog
}

/** Changes compared with now (the default is the version before; these tests keep one version and change the row after it). */
const toNow = async (dialog: Locator) => {
  await dialog.getByRole('radio', { name: 'To now' }).click()
  await expect(dialog.getByTestId('hist-banner')).toContainText('What changed from this version until now')
}

const props = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id].properties as AnyState, id)

test.describe('version history: database entries keep their properties', () => {
  test('Status, Date, Tags, number, checkbox changed → History lists them (old struck, new marked), computed ones never → restore brings them back', async ({ page }) => {
    await openApp(page)
    const { rowIds } = await setup(page)
    const row = rowIds[0]
    await gotoPage(page, row)

    // a version of the row as it is
    let dialog = await openHistory(page)
    await dialog.locator('.hist__head').getByRole('button', { name: 'Save version' }).click()
    await expect.poll(async () => (await versions(page, row)).map((m) => m.reason)).toEqual(['manual'])
    const [saved] = await versions(page, row, true)
    expect(saved.body.props.values).toEqual({ 'p-status': 'o-prog', 'p-due': { start: '2026-10-09' }, 'p-tags': ['t-web', 't-ios'], 'p-est': 3, 'p-note': 'first draft' })
    // the schema then: stored properties only (no formula, no created / edited time, no title)
    expect(saved.body.props.defs.map((d: AnyState) => d.name)).toEqual(['Status', 'Due', 'Tags', 'Estimate', 'Approved', 'Note'])
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // the person changes the row
    await wsEval(page, (s, id) => {
      s.setRowProperty(id, 'p-status', 'o-done')
      s.setRowProperty(id, 'p-due', { start: '2026-10-12' })
      s.setRowProperty(id, 'p-tags', ['t-web', 't-press'])
      s.setRowProperty(id, 'p-est', 5)
      s.setRowProperty(id, 'p-ok', true)
      s.updatePage(id, { title: 'Pricing page copy, final' })
    }, row)

    dialog = await openHistory(page)
    await toNow(dialog)
    const block = dialog.getByTestId('hist-props')
    await expect(block).toBeVisible()
    await expect(dialog.locator('.hist__banner')).toContainText('Properties 6')
    const line = (name: string) => block.locator('.hprops__row', { has: page.locator('.hprops__name', { hasText: new RegExp(`^${name}$`) }) })
    await expect(line('Title').locator('del')).toHaveText('Pricing page copy')
    await expect(line('Title').locator('ins')).toHaveText('Pricing page copy, final')
    await expect(line('Status').locator('del')).toHaveText('In progress')
    await expect(line('Status').locator('ins')).toHaveText('Done')
    await expect(line('Due').locator('del')).toContainText('9')
    await expect(line('Due').locator('ins')).toContainText('12')
    await expect(line('Tags').locator('del')).toHaveText('iOS')
    await expect(line('Tags').locator('ins')).toHaveText('Press')
    await expect(line('Tags').locator('.hprops__chip', { hasText: 'Web' })).toHaveCount(1)
    await expect(line('Estimate').locator('del')).toHaveText('3')
    await expect(line('Estimate').locator('ins')).toHaveText('5')
    await expect(line('Approved').locator('del')).toHaveText('☐')
    await expect(line('Approved').locator('ins')).toHaveText('☑')
    // unchanged and computed properties are not listed
    await expect(block.locator('.hprops__name')).toHaveText(['Title', 'Status', 'Due', 'Tags', 'Estimate', 'Approved'])

    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.toast', { hasText: 'Restored the version' })).toBeVisible()
    await expect.poll(() => props(page, row)).toMatchObject({ 'p-status': 'o-prog', 'p-due': { start: '2026-10-09' }, 'p-tags': ['t-web', 't-ios'], 'p-est': 3, 'p-ok': false })
    expect(await wsEval(page, (s, id) => s.pages[id].title, row)).toBe('Pricing page copy')
    // the state before the restore is a version of its own (its undo)
    const after = await versions(page, row, true)
    const before = after.find((m) => m.reason === 'restore')
    expect(before?.body.props.values['p-status']).toBe('o-done')
    expect(before?.body.title).toBe('Pricing page copy, final')
  })

  test('a deleted property is listed as "not restored"; the others come back', async ({ page }) => {
    await openApp(page)
    const { dbId, rowIds } = await setup(page)
    const row = rowIds[0]
    await gotoPage(page, row)
    let dialog = await openHistory(page)
    await dialog.locator('.hist__head').getByRole('button', { name: 'Save version' }).click()
    await expect.poll(async () => (await versions(page, row)).length).toBe(1)
    await page.keyboard.press('Escape')

    await wsEval(
      page,
      (s, { id, dbId }) => {
        s.setRowProperty(id, 'p-status', 'o-done')
        s.deleteProperty(dbId, 'p-note')
      },
      { id: row, dbId },
    )
    dialog = await openHistory(page)
    await toNow(dialog)
    const block = dialog.getByTestId('hist-props')
    const note = block.locator('.hprops__row', { hasText: 'Note' })
    await expect(note.locator('.hprops__name')).toHaveText('Note (deleted)')
    await expect(note.locator('del')).toHaveText('first draft')
    await expect(note.locator('.hprops__note')).toHaveText('Not restored · deleted')
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(page.locator('.toast', { hasText: 'not restored: Note (deleted)' })).toBeVisible()
    await expect.poll(async () => (await props(page, row))['p-status']).toBe('o-prog')
    expect(await wsEval(page, (s, dbId) => s.databases[dbId].properties.some((p: AnyState) => p.id === 'p-note'), dbId)).toBe(false)
  })

  test('a version saved before properties were kept still opens and restores its content', async ({ page }) => {
    await openApp(page)
    const { rowIds } = await setup(page)
    const row = rowIds[0]
    // an old-format version (content + title + icon only), written the way older builds did
    await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('one-history')
        r.onupgradeneeded = () => r.result.createObjectStore('snapshots')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const tx = db.transaction('snapshots', 'readwrite')
      const store = tx.objectStore('snapshots')
      const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The old wording of the pricing copy.' }] }] }
      store.put({ content, title: 'Pricing page copy', icon: null }, 'snap:old-v1')
      store.put([{ id: 'old-v1', pageId: id, at: Date.now() - 3_600_000, reason: 'auto', title: 'Pricing page copy', words: 7, blocks: 1, hash: 'old.hash.v1' }], `idx:${id}`)
      await new Promise((res) => (tx.oncomplete = res))
      db.close()
    }, row)
    await gotoPage(page, row)
    const dialog = await openHistory(page)
    await expect(dialog.locator('.hist__preview')).toContainText('The old wording')
    await toNow(dialog)
    await expect(dialog.locator('.hist__preview .ddiff-del').first()).toBeVisible()
    await expect(dialog.getByTestId('hist-props')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('#main .ProseMirror')).toContainText('The old wording of the pricing copy.')
    // content only: the property values stay as they are
    expect((await props(page, row))['p-status']).toBe('o-prog')
  })

  test('the AI terminal applies update_row → the row as it was is kept as an "AI" version first', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const { rowIds } = await setup(page)
    const row = rowIds[0]
    await gotoPage(page, row)
    let calls = 0
    await context.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
      const n = calls++
      const block =
        n === 0
          ? { type: 'tool_use', id: 'tu1', name: 'update_row', input: { id: row, properties: { Status: 'Done', Estimate: 8 } } }
          : { type: 'text', text: 'Marked it done.' }
      let body = ev('message_start', { message: { id: `msg_h${n}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
      body += ev('content_block_start', { index: 0, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } })
      body += ev('content_block_delta', { index: 0, delta: block.type === 'text' ? { type: 'text_delta', text: (block as AnyState).text } : { type: 'input_json_delta', partial_json: JSON.stringify((block as AnyState).input) } })
      body += ev('content_block_stop', { index: 0 })
      body += ev('message_delta', { delta: { stop_reason: block.type === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
      body += ev('message_stop', {})
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body })
    })
    await page.keyboard.press(`${MOD}+j`)
    const term = page.getByRole('region', { name: 'AI terminal' })
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('Mark the pricing copy done, estimate 8')
    await prompt.press('Enter')
    const change = term.locator('.term-change[data-kind="update_row"]')
    await expect(change).toHaveCount(1, { timeout: 20_000 })
    expect(await versions(page, row)).toEqual([])
    await change.getByRole('button', { name: 'Apply #1' }).click()
    await expect(change).toHaveAttribute('data-status', 'applied')
    await expect.poll(async () => (await props(page, row))['p-status']).toBe('o-done')
    await expect.poll(async () => (await versions(page, row)).map((m) => m.reason)).toEqual(['ai'])
    const [ai] = await versions(page, row, true)
    expect(ai.body.props.values['p-status']).toBe('o-prog')
    expect(ai.body.props.values['p-est']).toBe(3)
  })

  test('a bulk edit over 20 rows: at most one version per row per interval', async ({ page }) => {
    await openApp(page)
    const { rowIds } = await setup(page, 20)
    expect(rowIds).toHaveLength(20)
    // paste-like bulk edits: every row twice, a moment apart (well within the interval)
    await wsEval(page, (s, ids) => ids.forEach((id: string) => s.setRowProperty(id, 'p-status', 'o-done')), rowIds)
    await page.waitForTimeout(300)
    await wsEval(page, (s, ids) => ids.forEach((id: string, i: number) => s.setRowProperty(id, 'p-est', 10 + i)), rowIds)
    await page.waitForTimeout(300)
    await wsEval(page, (s, ids) => ids.forEach((id: string) => s.setRowProperty(id, 'p-tags', ['t-press'])), rowIds)
    const counts = () => Promise.all(rowIds.map(async (id) => (await versions(page, id)).length))
    await expect.poll(counts).toEqual(rowIds.map(() => 1))
    await page.waitForTimeout(600)
    expect(await counts()).toEqual(rowIds.map(() => 1))
    // that one version is the row before the first edit
    const [first] = await versions(page, rowIds[7], true)
    expect(first.reason).toBe('session')
    expect(first.body.props.values['p-status']).toBe('o-prog')
  })
})
