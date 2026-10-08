/**
 * Custom agents — the recipe "Mirror a list into a database" (features/agents: mirror.ts, MirrorSetup.tsx, the editor's
 * placeholders): the setup creates the database (key, the person's fields "Only by hand", six views) and its report page
 * in one step with one Undo, the editor opens with the agent draft, and a run mirrors items by their key. A mocked Claude
 * API only — never api.anthropic.com; the MCP servers are fictional addresses (Anthropic would call them, nothing does here).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, pageIdByTitle, wsEval, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[], usage = { input: 1200, output: 80 }): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_mir_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
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
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string
const tool = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input })
const say = (text: string): Block => ({ type: 'text', text })

/** api.anthropic.com → request n gets script[n]; later requests a short report. Returns the request bodies. */
async function mockClaude(ctx: BrowserContext, script: Step[] = []): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([say('Mirrored.')]))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
  })
  return bodies
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const TRACKER_TOOLS = ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment']
const SERVERS = [
  { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: TRACKER_TOOLS, checkedAt: Date.now() },
  { id: 'm-wiki', name: 'wiki', url: 'https://wiki.example.com/mcp', token: '', enabled: true, prompt: '' },
]
const setServers = (page: Page, servers: AnyState[] = SERVERS) => wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)

const EN_PROPS = ['Name', 'Key', 'Link', 'Source status', 'Source priority', 'Owner', 'Tags', 'Changed at', 'Comments', 'Last comment', 'Last comment at', 'New comment', 'Waiting on me', 'Clarity', 'Why', 'Gone from source', 'My status', 'My priority', 'Next step', 'Due']
const EN_PLACEHOLDERS = ['[HOW TO LIST THE ITEMS]', '[HOW TO READ ONE ITEM WITH ITS COMMENTS]', '[WHO I AM IN THE SOURCE]', '[WHAT "CLEAR" MEANS HERE]']

/** #/agents → New agent → the mirror recipe: its setup dialog. */
async function openSetup(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await page.locator('.agx').first().waitFor()
  // the empty list shows the recipes inline; otherwise "New agent" opens them
  const inline = page.locator('.agx-start [data-recipe="mirror"]')
  if (await inline.count()) await inline.click()
  else {
    await page.locator('.agx-head .btn--primary').click()
    await page.locator('.agx-recipe-modal [data-recipe="mirror"]').click()
  }
  const dialog = page.locator('.agx-mir')
  await expect(dialog).toBeVisible()
  return dialog
}

/** The database the setup made (by title), with its properties and views. */
async function mirrorDb(page: Page, title: string): Promise<AnyState> {
  return wsEval(
    page,
    (s, title) => {
      const page = (Object.values(s.pages) as AnyState[]).find((p) => p.kind === 'database' && p.title === title && !p.trashed)
      return page ? { page: JSON.parse(JSON.stringify(page)), db: JSON.parse(JSON.stringify(s.databases[page.id])) } : null
    },
    title,
  )
}

const propId = (db: AnyState, name: string): string => db.properties.find((p: AnyState) => p.name === name)?.id
const optId = (db: AnyState, prop: string, name: string): string => db.properties.find((p: AnyState) => p.name === prop)?.options.find((o: AnyState) => o.name === name)?.id

/** Fill every placeholder through its key in the strip (select, then type). */
async function fillPlaceholders(page: Page, texts: string[]) {
  const strip = page.getByTestId('agx-placeholders')
  for (const text of texts) {
    await strip.locator('.agx-ph__btn').first().click()
    await page.keyboard.insertText(text)
  }
  await expect(strip).toHaveCount(0)
}

const inboxData = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __oneInbox: { data: () => unknown } }).__oneInbox.data())) as AnyState)
const toolResults = (body: AnyState) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c: AnyState) => c.type === 'tool_result')
const resultOf = (body: AnyState, id: string): AnyState => toolResults(body).find((r: AnyState) => r.tool_use_id === id)
const resultText = (r: AnyState) => (typeof r.content === 'string' ? r.content : (r.content as AnyState[]).map((c) => c.text ?? '').join('\n'))
const userText = (body: AnyState): string => {
  const first = body.messages[0]
  return typeof first.content === 'string' ? first.content : (first.content as AnyState[]).map((c) => c.text ?? '').join('\n')
}

test.describe('Custom agents: the recipe "Mirror a list into a database"', () => {
  test('setup creates the database (key, own fields only by hand, six views) and its report page; the editor opens with the draft and refuses unreplaced placeholders', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')

    const dialog = await openSetup(page)
    await expect(dialog.getByRole('heading', { name: 'Mirror a list into a database' })).toBeVisible()
    // the first enabled server is picked, its tool count from the last test; an untested one says so
    await expect(dialog.getByRole('radio', { name: /TRACKER/ })).toBeChecked()
    await expect(dialog.locator('.agx-mir__server').first()).toContainText('7 tools · 4 read-only')
    await expect(dialog.locator('.agx-mir__server').nth(1)).toContainText('Not tested')
    // the name follows the source until someone types one
    await expect(dialog.getByRole('textbox', { name: /Name/ })).toHaveValue('Tracker')
    await dialog.getByRole('radio', { name: /WIKI/ }).check()
    await expect(dialog.getByRole('textbox', { name: /Name/ })).toHaveValue('Wiki')
    await dialog.getByRole('radio', { name: /TRACKER/ }).check()
    await expect(dialog.getByTestId('agx-mir-spec')).toContainText('20 properties · 6 views · key: Key')
    await expect(dialog.getByTestId('agx-mir-spec')).toContainText('My status · My priority · Next step · Due')
    await expect(dialog.getByTestId('agx-mir-spec')).toContainText('Weekdays 07:30 · proposals first · $1.00 per run')
    // an empty name is refused
    await dialog.getByRole('textbox', { name: /Name/ }).fill('  ')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(dialog.getByText('Give it a name.')).toBeVisible()
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    // below "Team wiki"
    await dialog.getByRole('button', { name: /Where/ }).click()
    await page.getByRole('menuitem', { name: 'Team wiki' }).click()
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()

    // ---- the database
    const made = await mirrorDb(page, 'Tracker')
    expect(made).not.toBeNull()
    const { db } = made
    expect(made.page.parentId).toBe(wiki)
    expect(db.properties.map((p: AnyState) => p.name)).toEqual(EN_PROPS)
    expect(db.properties.map((p: AnyState) => p.type)).toEqual(['title', 'text', 'url', 'select', 'select', 'text', 'multi_select', 'date', 'number', 'text', 'date', 'checkbox', 'checkbox', 'select', 'text', 'checkbox', 'status', 'select', 'text', 'date'])
    expect(db.properties.filter((p: AnyState) => p.key).map((p: AnyState) => p.name)).toEqual(['Key'])
    expect(db.properties.filter((p: AnyState) => p.agentReadOnly).map((p: AnyState) => p.name)).toEqual(['My status', 'My priority', 'Next step', 'Due'])
    const clarity = db.properties.find((p: AnyState) => p.name === 'Clarity')
    expect(clarity.options.map((o: AnyState) => [o.name, o.color])).toEqual([
      ['Clear', 'green'],
      ['Open questions', 'yellow'],
      ['Blocked', 'red'],
      ['In progress elsewhere', 'blue'],
      ['Done', 'gray'],
    ])
    expect(db.properties.find((p: AnyState) => p.name === 'My priority').options.map((o: AnyState) => o.name)).toEqual(['P1', 'P2', 'P3'])
    expect(db.properties.find((p: AnyState) => p.name === 'My status').options.map((o: AnyState) => o.group)).toEqual(['todo', 'in_progress', 'done'])
    expect(db.locked).toBeFalsy()

    // ---- the six views
    const views = db.views as AnyState[]
    expect(views.map((v) => [v.name, v.type])).toEqual([
      ['Board by Clarity', 'board'],
      ['New comments', 'table'],
      ['Ready to work', 'board'],
      ['My week', 'board'],
      ['As in the source', 'board'],
      ['All', 'table'],
    ])
    const [board, comments, ready, week, source] = views
    expect(board.groupBy).toBe(propId(db, 'Clarity'))
    expect(board.colorRules.map((r: AnyState) => [r.filter.items[0].propertyId, r.filter.items[0].operator, r.color])).toEqual([
      [propId(db, 'Waiting on me'), 'is_checked', 'red'],
      [propId(db, 'New comment'), 'is_checked', 'orange'],
    ])
    expect(comments.filter.op).toBe('or')
    expect(comments.filter.items.map((f: AnyState) => [f.propertyId, f.operator])).toEqual([
      [propId(db, 'New comment'), 'is_checked'],
      [propId(db, 'Waiting on me'), 'is_checked'],
    ])
    expect(ready.groupBy).toBe(propId(db, 'My priority'))
    expect(ready.filter.items.map((f: AnyState) => [f.propertyId, f.operator, f.value ?? null])).toEqual([
      [propId(db, 'Clarity'), 'is', optId(db, 'Clarity', 'Clear')],
      [propId(db, 'My status'), 'is_not', optId(db, 'My status', 'Done')],
      [propId(db, 'Gone from source'), 'is_not_checked', null],
    ])
    expect(week.groupBy).toBe(propId(db, 'My status'))
    expect(source.groupBy).toBe(propId(db, 'Source status'))
    expect(views[5].visibleProperties).toHaveLength(19)

    // ---- the report page, next to it
    const report = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Tracker · Report' && !p.trashed) ?? null)
    expect(report?.parentId).toBe(wiki)

    // ---- the editor with the draft
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await expect(editor.getByTestId('agx-editor-intro')).toContainText('The database “Tracker” and the page “Tracker · Report” are ready.')
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Mirror · Tracker')
    await expect(editor.getByText('Starts with proposals: you review every run. Switch to Apply directly once the first runs look right.')).toBeVisible()
    await expect(editor.getByRole('checkbox', { name: 'TRACKER' })).toBeChecked()
    await expect(editor.getByRole('checkbox', { name: 'WIKI' })).not.toBeChecked()
    const tools = editor.getByRole('group', { name: 'Tools of TRACKER' })
    await expect(tools.getByTestId('agx-tools-count')).toHaveText('4/7')
    for (const name of ['list_items', 'get_item', 'search_items', 'whoami']) await expect(tools.getByRole('checkbox', { name })).toBeChecked()
    for (const name of ['create_item', 'update_item', 'add_comment']) await expect(tools.getByRole('checkbox', { name })).not.toBeChecked()
    const strip = editor.getByTestId('agx-placeholders')
    await expect(strip.locator('.agx-ph__btn')).toHaveText(EN_PLACEHOLDERS)
    const instructions = editor.getByRole('textbox', { name: 'Instructions' })
    const text = await instructions.inputValue()
    for (const fixed of ['upsert_rows', 'key_property "Key"', 'agent_state_get', 'agent_state_set', 'notify_me', 'Never write My status, My priority, Next step or Due', 'Gone from source', 'Only read tracker'])
      expect(text).toContain(fixed)

    // switched on with placeholders left: refused
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(editor.getByText('Replace the parts in [SQUARE BRACKETS] first (4 left)')).toBeVisible()
    expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}).length)).toBe(0)
    // a key selects its placeholder: typing replaces it
    await strip.getByRole('button', { name: '[WHO I AM IN THE SOURCE]' }).click()
    expect(await instructions.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('[WHO I AM IN THE SOURCE]')
    await page.keyboard.insertText('the user "marcel"')
    await expect(strip.locator('.agx-ph__btn')).toHaveCount(3)
    await fillPlaceholders(page, ['list_items with project WEB, status open', 'get_item with the id, comments included', 'acceptance criteria written, no open question'])
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()

    const agent = await wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents)[0])))
    expect(agent).toMatchObject({
      name: 'Mirror · Tracker',
      trigger: { type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' },
      scope: { everything: false, pages: [], databases: [made.page.id] },
      write: 'stage',
      output: { pageId: report.id, mode: 'append' },
      mcpServers: ['tracker'],
      mcpTools: { tracker: ['list_items', 'get_item', 'search_items', 'whoami'] },
      runner: 'browser',
      maxRunUsd: 1,
      enabled: true,
    })
    expect(agent.instructions).toContain('Who I am in tracker: the user "marcel"')
    expect(agent.instructions).not.toContain('[')
    await expect(page.locator('.agx-spec--plate')).toContainText('TRACKER (4 tools)')
  })

  test('a run: upsert_rows by Key fills the database, the own fields stay the person’s, notes reach the inbox, the state is kept', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page)
    const ids: AnyState = {}
    const row = (key: string, title: string, props: AnyState) => ({ key, title, properties: props })
    const bodies = await mockClaude(context, [
      // run 1 (proposals): three items, one of them tries a field that is only by hand
      () =>
        sseMessage([
          tool('a1', 'upsert_rows', {
            database_id: ids.db,
            key_property: 'Key',
            rows: [
              row('8215', 'Login fails after password reset', { 'Source status': 'In review', Comments: 4, 'New comment': true, 'Waiting on me': true, Clarity: 'Open questions', Why: 'The reset link expiry is open.' }),
              row('8216', 'Export drops the last row', { 'Source status': 'Ready', Comments: 2, Clarity: 'Clear', Link: 'https://tracker.example.com/items/8216', Tags: ['export'] }),
              row('8217', 'Slow search on phones', { Clarity: 'Blocked', 'My status': 'Done' }),
            ],
          }),
        ]),
      () => sseMessage([tool('a2', 'agent_state_set', { json: '{"last":"2026-10-08T05:30:00Z","comments":{"8215":4,"8216":2}}' })]),
      () => sseMessage([say('2 new items, 1 refused (My status is only by hand).')]),
      // run 2 (applies): a new comment on #8215
      () => sseMessage([tool('b0', 'agent_state_get', {})]),
      () =>
        sseMessage([
          tool('b1', 'upsert_rows', { database_id: ids.db, key_property: 'Key', rows: [row('8215', 'Login fails after password reset', { Comments: 5, 'Last comment': 'Mira Lenz: Can you confirm the expiry?', 'New comment': true }), row('8216', 'Export drops the last row', { Comments: 2 })] }),
          tool('b2', 'notify_me', { text: 'New comment on #8215', page_id: ids.row8215 }),
          tool('b3', 'agent_state_set', { json: '{"last":"2026-10-09T05:30:00Z","comments":{"8215":5,"8216":2}}' }),
        ]),
      () => sseMessage([say('1 changed, 1 unchanged. New comment on #8215 for you.')]),
    ])

    const dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const made = await mirrorDb(page, 'Tracker')
    ids.db = made.page.id
    const editor = page.locator('.agx-editor')
    await fillPlaceholders(page, ['list_items', 'get_item', 'marcel', 'acceptance criteria written'])
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()

    // ---- run 1: proposals
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'staged', { timeout: 20_000 })
    const b0 = bodies[0]
    expect(b0.tools.map((t: AnyState) => t.name)).toEqual(expect.arrayContaining(['upsert_rows', 'agent_state_get', 'agent_state_set', 'notify_me']))
    expect(b0.tools.filter((t: AnyState) => t.type === 'mcp_toolset')).toEqual([
      { type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: { list_items: { enabled: true }, get_item: { enabled: true }, search_items: { enabled: true }, whoami: { enabled: true } } },
    ])
    expect(userText(b0)).toContain('Last successful run: none — this is the first run.')
    const up = resultText(resultOf(bodies[1], 'a1'))
    expect(up).toContain('2 created, 0 updated, 0 unchanged, 1 refused')
    expect(up).toMatch(/"key":"8217","action":"refused","reason":"\\"My status\\" is filled in only by hand/)
    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect
      .poll(() => wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).map((p) => p.title).sort(), ids.db))
      .toEqual(['Export drops the last row', 'Login fails after password reset'])
    const db = (await mirrorDb(page, 'Tracker')).db
    const rowOf = (key: string) => wsEval(page, (s, a) => JSON.parse(JSON.stringify((Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === a.db && p.properties[a.key] === a.value) ?? null)), { db: ids.db, key: propId(db, 'Key'), value: key })
    const r8215 = await rowOf('8215')
    ids.row8215 = r8215.id
    expect(r8215.properties[propId(db, 'Clarity')]).toBe(optId(db, 'Clarity', 'Open questions'))
    expect(r8215.properties[propId(db, 'Waiting on me')]).toBe(true)
    // new options came along (Source status was empty)
    expect((await mirrorDb(page, 'Tracker')).db.properties.find((p: AnyState) => p.name === 'Source status').options.map((o: AnyState) => o.name)).toEqual(['In review', 'Ready'])

    // ---- the person's own field, then run 2 applies directly
    const p1 = optId(db, 'My priority', 'P1')
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.prop, a.value), { row: ids.row8215, prop: propId(db, 'My priority'), value: p1 })
    await wsEval(page, (s) => {
      const a = Object.values(s.agents)[0] as AnyState
      s.upsertAgent({ ...a, write: 'apply' })
    })
    await flush(page)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    expect(userText(bodies[3])).toMatch(/Last successful run: \d{4}-\d\d-\d\dT/)
    expect(resultText(resultOf(bodies[4], 'b0'))).toContain('Saved state (from the run of')
    expect(resultText(resultOf(bodies[5], 'b1'))).toContain('1 updated, 1 unchanged')
    const after = await rowOf('8215')
    expect(after.properties[propId(db, 'Comments')]).toBe(5)
    expect(after.properties[propId(db, 'My priority')]).toBe(p1)

    // the note: in the inbox, linked to the row, labelled with the agent
    const items = ((await inboxData(page)).items as AnyState[]).filter((i) => i.kind === 'agent')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'agent', pageId: ids.row8215, excerpt: 'New comment on #8215' })
  })

  test('Undo removes the database, the report page and the draft; German names in a German UI', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openSetup(page)
    await expect(dialog.getByRole('heading', { name: 'Liste in eine Datenbank spiegeln' })).toBeVisible()
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tickets')
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    const made = await mirrorDb(page, 'Tickets')
    expect(made.db.properties.map((p: AnyState) => p.name)).toEqual([
      'Name',
      'Schlüssel',
      'Link',
      'Status (Quelle)',
      'Prio (Quelle)',
      'Zuständig',
      'Tags',
      'Geändert am',
      'Kommentare',
      'Letzter Kommentar',
      'Letzter Kommentar am',
      'Neuer Kommentar',
      'Wartet auf mich',
      'Klarheit',
      'Warum',
      'Nicht mehr in der Quelle',
      'Mein Status',
      'Meine Prio',
      'Nächster Schritt',
      'Fällig',
    ])
    expect(made.db.properties.find((p: AnyState) => p.name === 'Klarheit').options.map((o: AnyState) => o.name)).toEqual(['Klar', 'Offene Fragen', 'Blockiert', 'Woanders in Arbeit', 'Erledigt'])
    expect(made.db.views.map((v: AnyState) => v.name)).toEqual(['Board nach Klarheit', 'Neue Kommentare', 'Bereit zum Arbeiten', 'Meine Woche', 'Wie in der Quelle', 'Alle'])
    const editor = page.locator('.agx-editor')
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Spiegel · Tickets')
    await expect(editor.getByTestId('agx-placeholders').locator('.agx-ph__btn')).toHaveText(['[WIE ICH DIE EINTRÄGE AUFLISTE]', '[WIE ICH EINEN EINTRAG MIT SEINEN KOMMENTAREN LESE]', '[WER ICH IN DER QUELLE BIN]', '[WAS „KLAR“ HIER HEISST]'])
    const text = await editor.getByRole('textbox', { name: 'Anweisungen' }).inputValue()
    expect(text).toContain('key_property "Schlüssel"')
    expect(text).toContain('Schreibe nie Mein Status, Meine Prio, Nächster Schritt oder Fällig')

    // the toast's Undo: database, report page and the open draft go
    await page.locator('.toast').filter({ hasText: '„Tickets“ ist angelegt' }).getByRole('button', { name: 'Rückgängig' }).click()
    await expect(editor).toHaveCount(0)
    expect(await mirrorDb(page, 'Tickets')).toBeNull()
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((p) => p.title === 'Tickets · Bericht'))).toBe(false)
    expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}).length)).toBe(0)

    // switched off, a draft with placeholders may be saved
    const again = await openSetup(page)
    await again.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await editor.getByRole('switch', { name: 'Aktiv' }).click()
    await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const saved = await wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents)[0])))
    expect(saved.enabled).toBe(false)
    expect(saved.instructions).toContain('[WER ICH IN DER QUELLE BIN]')
  })

  test('no MCP server: the setup points to Settings and creates nothing', async ({ page }) => {
    await openApp(page)
    await setServers(page, [])
    const dialog = await openSetup(page)
    await expect(dialog.getByText('No MCP server yet — add the one of your tool first.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Settings → MCP servers' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  })

  test('390 px: setup and editor fit the phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page)
    await setServers(page)
    const dialog = await openSetup(page)
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('.modal__body')].every((el) => el.scrollWidth <= el.clientWidth + 1))
    expect(await fits()).toBe(true)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(page.locator('.agx-editor')).toBeVisible()
    await expect(page.getByTestId('agx-placeholders')).toBeVisible()
    expect(await fits()).toBe(true)
  })
})
