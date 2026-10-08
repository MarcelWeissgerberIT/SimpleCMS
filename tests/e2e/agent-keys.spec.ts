/**
 * Row keys and "Only by hand" (store/keys.ts) and the agents' upsert_rows — the Claude API is mocked (never
 * api.anthropic.com): the property menu's switches (duplicates refuse a key, a locked database shows none), a key a
 * person types twice refused at the cell, a custom agent mirroring items by key (created / updated / unchanged /
 * refused), duplicates refused for create_row, properties "Only by hand" refused for custom agents and the AI
 * terminal, list_databases' marks, and a 50-row batch in the review (screenshots with ONE_SHOTS=1).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_keys_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,40}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 80 } })
  body += ev('message_stop', {})
  return body
}

const tool = (id: string, name: string, input: Record<string, unknown>) => () => sseMessage([{ type: 'tool_use', id, name, input }])
const say = (text: string) => () => sseMessage([{ type: 'text', text }])

/** api.anthropic.com → request n gets script[n]; later requests a short report. Returns the request bodies. */
async function mockClaude(ctx: BrowserContext, script: Array<() => string>): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    bodies.push(JSON.parse(req.postData() ?? '{}'))
    const step = script[bodies.length - 1] ?? say('Done.')
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step() })
  })
  return bodies
}

/** The tool result Claude got back for a tool_use id: its text and whether it was an error. */
function result(body: AnyState | undefined, id: string): { text: string; error: boolean } {
  const c = ((body?.messages ?? []) as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((x: AnyState) => x.type === 'tool_result' && x.tool_use_id === id)
  if (!c) return { text: '', error: false }
  const text = typeof c.content === 'string' ? c.content : (c.content as AnyState[]).map((x) => x.text ?? '').join('')
  return { text, error: c.is_error === true }
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

interface Tickets {
  db: string
  rows: { a: string; b: string; c: string }
}

/** A "Tickets" database: Ticket (text, the key) · Status (select) · Notes (text, only by hand) and three rows. */
async function tickets(page: Page, opts: { flags?: boolean; dupe?: boolean } = {}): Promise<Tickets> {
  const flags = opts.flags ?? true
  return wsEval(
    page,
    (s, a) => {
      const db = s.createDatabase({
        title: 'Tickets',
        parentId: null,
        properties: [
          { id: 'tk-title', name: 'Name', type: 'title' },
          { id: 'tk-ticket', name: 'Ticket', type: 'text', ...(a.flags ? { key: true } : {}) },
          {
            id: 'tk-status',
            name: 'Status',
            type: 'select',
            options: [
              { id: 'o-open', name: 'Open', color: 'gray' },
              { id: 'o-ready', name: 'Ready', color: 'green' },
              { id: 'o-done', name: 'Done', color: 'blue' },
            ],
          },
          { id: 'tk-notes', name: 'Notes', type: 'text', ...(a.flags ? { agentReadOnly: true } : {}) },
        ],
      })
      const view = (window as AnyState).__one.workspace.getState().databases[db].views[0]
      s.updateView(db, view.id, { type: 'table', visibleProperties: ['tk-title', 'tk-ticket', 'tk-status', 'tk-notes'] })
      const row = (title: string, ticket: string, status: string, notes = '') => s.createRow(db, { title, properties: { 'tk-ticket': ticket, 'tk-status': status, ...(notes ? { 'tk-notes': notes } : {}) } })
      return {
        db,
        rows: { a: row('Login fails', '8215', 'o-open'), b: row('Export broken', '8216', 'o-ready'), c: row('Slow search', a.dupe ? '8216' : '8217', 'o-open', 'Call back Mira first') },
      }
    },
    { flags, dupe: !!opts.dupe },
  )
}

const value = (page: Page, row: string, prop: string) => wsEval(page, (s, a) => s.pages[a.row]?.properties[a.prop] ?? null, { row, prop })
const propFlags = (page: Page, db: string, prop: string) => wsEval(page, (s, a) => {
  const p = s.databases[a.db].properties.find((x: AnyState) => x.id === a.prop)
  return { key: p.key ?? null, hand: p.agentReadOnly ?? null }
}, { db, prop })
const cell = (page: Page, row: number, col: number) => page.locator(`#main section.db [role="gridcell"][data-cell="${row}:${col}"]`)
/** Edit a cell: its text replaced by `text`, committed with Enter. */
async function retype(page: Page, row: number, col: number, text: string) {
  await cell(page, row, col).click()
  await page.keyboard.press('Enter')
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
const header = (page: Page, name: string) => page.locator('#main section.db').getByRole('columnheader', { name: new RegExp(`^${name}`) })

async function addAgent(page: Page, agent: AnyState): Promise<string> {
  return wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Mirror the tickets of the tracker into Tickets.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
      return a.id as string
    },
    agent,
  )
}

async function runAgent(page: Page, id: string) {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), id)
  await expect(page.locator('.agx-dhead')).toBeVisible()
  await page.getByRole('button', { name: 'Run now' }).click()
  const run = page.locator('.agx-run').first()
  await expect(run).toHaveAttribute('data-status', /staged|ok/, { timeout: 30_000 })
  return run
}

/** ONE_SHOTS=1: screenshots into .shots/ at 1440×900 and 390×844, light and dark (`show` puts the subject on screen). */
const shots = !!process.env.ONE_SHOTS
async function shot(page: Page, name: string, show: () => Promise<void>) {
  if (!shots) return
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: w, height: h })
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await show()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `.shots/keys-${name}-${w}-${theme}.png` })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await wsEval(page, (s) => s.updateSettings({ theme: 'light' }))
}

test.describe('Row keys, "Only by hand" and upsert_rows', () => {
  test('property menu: Key refuses while rows share a value; Only by hand; a locked database shows neither', async ({ page }) => {
    await openApp(page)
    const t = await tickets(page, { flags: false, dupe: true })
    await gotoPage(page, t.db)
    await header(page, 'Ticket').click()
    const menu = page.locator('.db-propmenu')
    const key = menu.getByRole('switch', { name: 'Key' })
    await expect(key).toHaveAttribute('aria-checked', 'false')
    await key.click()
    await expect(menu.getByRole('alert')).toContainText('2 rows share “8216”')
    await expect(key).toHaveAttribute('aria-checked', 'false')
    expect((await propFlags(page, t.db, 'tk-ticket')).key).toBeNull()

    // unique values: it becomes the key, and the column header shows it
    await wsEval(page, (s, id) => s.setRowProperty(id, 'tk-ticket', '8218'), t.rows.c)
    await key.click()
    await expect(key).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('status')).toContainText('“Ticket” is the key')
    expect((await propFlags(page, t.db, 'tk-ticket')).key).toBe(true)
    await page.keyboard.press('Escape')
    await expect(header(page, 'Ticket').getByRole('img', { name: 'Key: unique per row' })).toBeVisible()

    // a select is no key, but can be "Only by hand"; the title is neither
    await header(page, 'Status').click()
    await expect(menu.getByRole('switch', { name: 'Key' })).toHaveCount(0)
    await expect(menu.getByRole('switch', { name: 'Only by hand' })).toBeVisible()
    await page.keyboard.press('Escape')
    await header(page, 'Name').click()
    await expect(menu.getByRole('switch')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await header(page, 'Notes').click()
    const hand = menu.getByRole('switch', { name: 'Only by hand' })
    await hand.click()
    await expect(hand).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('status')).toContainText('Agents no longer write “Notes”')
    expect((await propFlags(page, t.db, 'tk-notes')).hand).toBe(true)
    await page.keyboard.press('Escape')
    await shot(page, 'menu', async () => {
      if (await menu.isVisible()) await page.keyboard.press('Escape')
      await header(page, 'Ticket').click()
      await expect(menu.getByRole('switch', { name: 'Key' })).toBeVisible()
    })
    if (shots) await page.keyboard.press('Escape')
    await expect(header(page, 'Notes').getByRole('img', { name: /Only by hand/ })).toBeVisible()

    // another property as the key: the old one stops being it (one key per database)
    await header(page, 'Notes').click()
    await menu.getByRole('switch', { name: 'Key' }).click()
    expect(await propFlags(page, t.db, 'tk-ticket')).toEqual({ key: null, hand: null })
    expect((await propFlags(page, t.db, 'tk-notes')).key).toBe(true)
    await page.keyboard.press('Escape')

    // locked: the schema is fixed — no switches
    await wsEval(page, (s, db) => s.updateDatabase(db, { locked: true }), t.db)
    await header(page, 'Ticket').click()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('switch')).toHaveCount(0)
  })

  test('a person typing a key another row holds gets an inline refusal at the cell; a new value is written', async ({ page }) => {
    await openApp(page)
    const t = await tickets(page)
    await gotoPage(page, t.db)
    await retype(page, 1, 1, '8215')
    await expect(page.getByTestId('kt-refusal')).toContainText('“8215” is already the Ticket of “Login fails”')
    await page.waitForTimeout(300)
    expect(await value(page, t.rows.b, 'tk-ticket')).toBe('8216')

    await retype(page, 1, 1, '9100')
    await expect.poll(() => value(page, t.rows.b, 'tk-ticket')).toBe('9100')
  })

  test('custom agent: upsert_rows created / updated / unchanged / refused; create_row duplicates and protected fields refused', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const t = await tickets(page)
    const bodies = await mockClaude(context, [
      tool('tu1', 'list_databases', {}),
      tool('tu2', 'upsert_rows', {
        database_id: t.db,
        key_property: 'Ticket',
        rows: [
          { key: '8215', title: 'Login fails', properties: { Status: 'Ready' } },
          { key: 8216, title: 'Export broken', properties: { Status: 'Ready' } },
          { key: '9001', title: 'Dark mode', properties: { Status: 'Open' }, body: 'Asked for by **three** teams.' },
          { key: '9002', title: 'Typo on the start page', properties: { Notes: 'from the tracker' } },
          { key: '9001', properties: { Status: 'Ready' } },
        ],
      }),
      tool('tu3', 'create_row', { database_id: t.db, title: 'Duplicate', properties: { Ticket: '8217' } }),
      tool('tu4', 'update_row', { id: t.rows.a, properties: { Notes: 'overwritten' } }),
      say('Mirrored the tracker: 1 new ticket, 1 changed.'),
    ])
    const id = await addAgent(page, { id: 'ag-mirror', name: 'Tracker mirror' })
    const run = await runAgent(page, id)
    await expect(run).toHaveAttribute('data-status', 'staged')

    // list_databases marks the key and the protected field
    const schema = result(bodies[1], 'tu1').text
    expect(schema).toContain('Ticket (text, key: unique per row)')
    expect(schema).toContain('Notes (text, read-only for agents (only by hand))')

    // one call, one answer line per row
    const upsert = result(bodies[2], 'tu2')
    expect(upsert.error).toBe(false)
    expect(upsert.text).toContain('1 created, 2 updated, 1 unchanged, 1 refused')
    const lines = upsert.text.split('\n').slice(1).map((l) => JSON.parse(l))
    expect(lines.map((l: AnyState) => [l.key, l.action])).toEqual([
      ['8215', 'updated'],
      ['8216', 'unchanged'],
      ['9001', 'created'],
      ['9002', 'refused'],
      ['9001', 'updated'],
    ])
    expect(lines[0].id).toBe(t.rows.a)
    expect(lines[3].reason).toContain('"Notes" is filled in only by hand')
    expect(lines[4].change).toBe(lines[2].change)

    // a second row with a key that exists: refused, naming the row
    const dup = result(bodies[3], 'tu3')
    expect(dup.error).toBe(true)
    expect(dup.text).toContain('"Ticket" is this database\'s key')
    expect(dup.text).toContain('Slow search')
    // a protected field: refused, naming it
    const hand = result(bodies[4], 'tu4')
    expect(hand.error).toBe(true)
    expect(hand.text).toContain('"Notes" is filled in only by hand')

    // the review: one card per row
    const cards = run.locator('.agx-changes > li')
    await expect(cards).toHaveCount(2)
    await expect(run.getByRole('listitem', { name: '#1 Edit row' }).locator('.agent-diff__row', { hasText: 'Status' })).toContainText('Ready')
    const created = run.getByRole('listitem', { name: '#2 New row' })
    await expect(created).toContainText('Dark mode')
    await expect(created.locator('.agent-diff__row', { hasText: 'Ticket' })).toContainText('9001')
    await expect(created.locator('.agent-diff__row', { hasText: 'Status' })).toContainText('Ready')
    expect(await value(page, t.rows.a, 'tk-status')).toBe('o-open')

    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => value(page, t.rows.a, 'tk-status')).toBe('o-ready')
    const fresh = await wsEval(page, (s, db) => {
      const row = (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === db && p.title === 'Dark mode')
      return row ? { ticket: row.properties['tk-ticket'], status: row.properties['tk-status'], plain: row.plain ?? '' } : null
    }, t.db)
    expect(fresh).toEqual({ ticket: '9001', status: 'o-ready', plain: expect.stringContaining('three teams') })
    // the person's own field is untouched
    expect(await value(page, t.rows.c, 'tk-notes')).toBe('Call back Mira first')
  })

  test('apply: a key another row took since the proposal fails that change instead of writing a duplicate', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const t = await tickets(page)
    await mockClaude(context, [tool('tu1', 'upsert_rows', { database_id: t.db, key_property: 'Ticket', rows: [{ key: '9500', title: 'Offline mode' }] }), say('Proposed one ticket.')])
    const id = await addAgent(page, { id: 'ag-late', name: 'Late mirror' })
    const run = await runAgent(page, id)
    await expect(run.locator('.agx-changes > li')).toHaveCount(1)
    // meanwhile a person gives another row that key
    await wsEval(page, (s, row) => s.setRowProperty(row, 'tk-ticket', '9500'), t.rows.b)
    await run.getByRole('button', { name: 'Apply all' }).click()
    const card = run.getByRole('listitem', { name: '#1 New row' })
    await expect(card).toHaveAttribute('data-status', 'failed')
    await expect(card).toContainText('“Export broken” holds the key Ticket “9500” already')
    expect(await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, t.db)).toBe(3)
  })

  test('AI terminal: a protected field is refused; upsert_rows stages only what changed', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const t = await tickets(page)
    const bodies = await mockClaude(context, [
      tool('t1', 'update_row', { id: t.rows.c, properties: { Notes: 'changed by Claude', Status: 'Done' } }),
      tool('t2', 'upsert_rows', { database_id: t.db, key_property: 'Ticket', rows: [{ key: '8217', title: 'Slow search', properties: { Status: 'Done' } }] }),
      say('Closed ticket 8217.'),
    ])
    await page.keyboard.press(`${MOD}+j`)
    const terminal = page.getByRole('region', { name: 'AI terminal' })
    const prompt = terminal.getByRole('textbox', { name: 'Task for the agent' })
    await expect(prompt).toBeFocused()
    await prompt.fill('Close ticket 8217')
    await prompt.press('Enter')
    await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(3)
    const refused = result(bodies[1], 't1')
    expect(refused.error).toBe(true)
    expect(refused.text).toContain('"Notes" is filled in only by hand')
    expect(result(bodies[2], 't2').text).toContain('"action":"updated"')
    const change = terminal.locator('.term-change[data-kind="update_row"]')
    await expect(change).toHaveCount(1)
    await expect(change.locator('.agent-diff__row')).toHaveCount(1)
    await change.getByRole('button', { name: 'Apply #1' }).click()
    await expect.poll(() => value(page, t.rows.c, 'tk-status')).toBe('o-done')
    expect(await value(page, t.rows.c, 'tk-notes')).toBe('Call back Mira first')
  })

  test('a 50-row batch: one call, one card per row, Apply all writes them (51 rows are refused)', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const t = await tickets(page)
    const rows = [
      { key: '8215', title: 'Login fails', properties: { Status: 'Done' } },
      { key: '8216', title: 'Export broken', properties: { Status: 'Ready' } },
      { key: '8217', title: 'Slow search on phones', properties: { Status: 'Open' } },
      ...Array.from({ length: 47 }, (_, i) => ({ key: String(9100 + i), title: `Tracker item ${9100 + i}`, properties: { Status: i % 3 ? 'Open' : 'Ready' } })),
    ]
    const bodies = await mockClaude(context, [
      tool('b1', 'upsert_rows', { database_id: t.db, key_property: 'Ticket', rows: [...rows, { key: '9999', title: 'One too many' }] }),
      tool('b2', 'upsert_rows', { database_id: t.db, key_property: 'Ticket', rows }),
      say('Mirrored 50 tracker items: 47 new, 2 changed, 1 the same.'),
    ])
    const id = await addAgent(page, { id: 'ag-batch', name: 'Tracker mirror' })
    const run = await runAgent(page, id)
    expect(result(bodies[1], 'b1')).toEqual({ text: expect.stringContaining('Too many rows (51, at most 50'), error: true })
    expect(result(bodies[2], 'b2').text).toContain('47 created, 2 updated, 1 unchanged, 0 refused')
    // 47 new rows, one change of values, one rename
    const cards = run.locator('.agx-changes > li')
    await expect(cards).toHaveCount(49)
    await expect(run.getByTestId('agx-review-counts')).toHaveText('47× New row · 1× Edit row · 1× Rename')
    await shot(page, 'review', async () => {
      await run.locator('.agx-review').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    })
    // scrolled into the list: the head (counts, Apply all) stays in view
    await shot(page, 'review-scrolled', async () => {
      await run.getByRole('listitem', { name: '#20 New row' }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    })
    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, t.db), { timeout: 20_000 }).toBe(50)
    expect(await wsEval(page, (s, row) => s.pages[row].title, t.rows.c)).toBe('Slow search on phones')
    expect(await value(page, t.rows.a, 'tk-status')).toBe('o-done')
  })
})
