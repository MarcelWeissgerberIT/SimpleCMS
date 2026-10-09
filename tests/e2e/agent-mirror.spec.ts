/**
 * Custom agents — the recipe "Mirror a list into a database" (features/agents: mirror.ts, MirrorSetup.tsx, the editor's
 * placeholders), brought by an integration profile (here `{ kind: 'mirror' }`: the built-in values; a configured recipe is
 * integrations.spec.ts): the setup creates the database (key, the person's fields "Only by hand", six views) and its
 * report page in one step, the editor opens with the agent draft (its note carries the Undo — no toast over the footer),
 * closing it unsaved asks (keep editing · keep both · both to the trash), a second setup with the same name offers the
 * database that is there instead of a duplicate, and a run mirrors items by their key.
 * Without an active profile the gallery has no mirror recipe. A mocked Claude API only — never api.anthropic.com; the
 * MCP servers are fictional addresses (Anthropic would call them, nothing does here).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, pageIdByTitle, wsEval, flush } from './fixtures'
import { addProfile, trackerProfile } from './helpers/integrations'

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
/** The servers, and the integration profile (both servers match by host) that brings the built-in mirror recipe. */
async function setServers(page: Page, servers: AnyState[] = SERVERS) {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)
  await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
}
const RECIPE = '[data-recipe="tracker:mirror"]'

const EN_PROPS = ['Name', 'Key', 'Link', 'Source status', 'Source priority', 'Owner', 'Tags', 'Changed at', 'Comments', 'Last comment', 'Last comment at', 'New comment', 'Waiting on me', 'Clarity', 'Why', 'Gone from source', 'My status', 'My priority', 'Next step', 'Due']
const EN_PLACEHOLDERS = ['[HOW TO LIST THE ITEMS]', '[HOW TO READ ONE ITEM WITH ITS COMMENTS]', '[WHO I AM IN THE SOURCE]', '[WHAT "CLEAR" MEANS HERE]']

/** #/agents → New agent → the mirror recipe: its setup dialog. */
async function openSetup(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await page.locator('.agx').first().waitFor()
  // the empty list shows the recipes inline; otherwise "New agent" opens them
  const inline = page.locator(`.agx-start ${RECIPE}`)
  if (await inline.count()) await inline.click()
  else {
    await page.locator('.agx-head .btn--primary').click()
    await page.locator(`.agx-recipe-modal ${RECIPE}`).click()
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
    await expect(dialog.getByTestId('agx-mir-spec')).toContainText('Weekdays · 07:30 · proposals first · $1.00 per run')
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
    // every mirrored row gets a Clarity: no empty "No value" column in front
    expect(board.hiddenGroups).toEqual(['__none__'])
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

  test('Undo moves the database and the report page to the trash (rows added meanwhile come back with them) and drops the draft; German names in a German UI', async ({ page }) => {
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

    // no toast over the editor: the Undo is a key in its note — database and report page go to the trash (never for
    // good: rows another tab or device added meanwhile come back with them), the open draft goes
    await expect(page.locator('.toast')).toHaveCount(0)
    const report = await pageIdByTitle(page, 'Tickets · Bericht')
    const row = await wsEval(page, (s, db) => s.createRow(db, { title: 'Aus dem anderen Tab' }) as string, made.page.id)
    await editor.getByTestId('agx-editor-intro').getByRole('button', { name: 'Rückgängig' }).click()
    await expect(editor).toHaveCount(0)
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id]?.trashed ?? 'gone'), [made.page.id, report, row])).toEqual([true, true, false])
    expect(await mirrorDb(page, 'Tickets')).toBeNull()
    const trashed = page.locator('.toast').filter({ hasText: '„Tickets“ und die Berichtsseite liegen im Papierkorb.' })
    await expect(trashed).toBeVisible()
    expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}).length)).toBe(0)
    // the toast takes it back: database (with the row) and report page live again
    await trashed.getByRole('button', { name: 'Rückgängig' }).click()
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id]?.trashed ?? 'gone'), [made.page.id, report, row])).toEqual([false, false, false])

    // switched off, a draft with placeholders may be saved
    const again = await openSetup(page)
    await again.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await editor.getByRole('switch', { name: 'Aktiv' }).click()
    await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const saved = await wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents)[0])))
    expect(saved.enabled).toBe(false)
    expect(saved.instructions).toContain('[WER ICH IN DER QUELLE BIN]')
    // such a draft is neither switched on nor run: it says what is missing
    await page.locator('.agx-dhead').getByRole('switch').click()
    await expect(page.locator('.toast').filter({ hasText: '„Spiegel · Tracker“ hat noch 4 Teile in [ECKIGEN KLAMMERN] zu ersetzen' })).toBeVisible()
    expect(await wsEval(page, (s, id) => s.agents[id].enabled, saved.id)).toBe(false)
    await page.locator('.agx-dhead .btn--primary').click()
    await expect(page.locator('.agx-run')).toHaveCount(0)
  })

  for (const [label, size] of [
    ['1440 px', { width: 1440, height: 900 }],
    ['390 px', { width: 390, height: 844 }],
  ] as const) {
    test(`${label}: right after setup no toast covers the editor's footer — "Agent anlegen" takes the first click`, async ({ page }) => {
      await page.setViewportSize(size)
      await openApp(page)
      await setKey(page)
      await setServers(page)
      await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
      const dialog = await openSetup(page)
      await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
      const editor = page.locator('.agx-editor')
      const save = editor.getByRole('button', { name: 'Agent anlegen', exact: true })
      await expect(save).toBeVisible()
      await expect(editor.getByTestId('agx-editor-intro')).toContainText('Die Datenbank „Tracker“ und die Seite „Tracker · Bericht“ sind angelegt.')
      await expect(page.locator('.toast')).toHaveCount(0)
      // nothing on top of the key: the point at its centre hits the key itself
      const free = () =>
        save.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return !!hit && el.contains(hit)
        })
      expect(await free()).toBe(true)
      // switched off it saves as a draft: the first click lands at once
      await editor.getByRole('switch', { name: 'Aktiv' }).click()
      expect(await free()).toBe(true)
      await save.click({ timeout: 2_000 })
      await expect(page.locator('.agx-dhead')).toBeVisible()
      expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}).length)).toBe(1)
    })
  }

  test('closing the editor after setup asks (Esc, ×, Cancel, scrim): keep editing, keep both, or both to the trash; a second setup never duplicates silently and never trashes what was there', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const liveDbs = (title: string) => wsEval(page, (s, title) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === title && !p.trashed).map((p) => p.id), title)
    const pageOf = (title: string) => wsEval(page, (s, title) => JSON.parse(JSON.stringify((Object.values(s.pages) as AnyState[]).find((p) => p.title === title) ?? null)), title)
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    const editor = page.locator('.agx-editor')
    const prompt = page.getByRole('dialog', { name: 'Agent verwerfen?' })
    const name = editor.getByRole('textbox', { name: 'Name' })

    // Esc: it asks; "Weiter bearbeiten" keeps the draft as it was, focus back in the field
    await name.fill('Spiegel · Mein Tracker')
    await page.keyboard.press('Escape')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('Die Datenbank „Tracker“ und die Seite „Tracker · Bericht“ gibt es schon.')
    await expect(prompt.getByRole('button', { name: 'Weiter bearbeiten' })).toBeFocused()
    await prompt.getByRole('button', { name: 'Weiter bearbeiten' }).click()
    await expect(prompt).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(name).toHaveValue('Spiegel · Mein Tracker')
    await expect(name).toBeFocused()
    // Cancel asks too; Esc in the prompt means "keep editing"
    await editor.locator('.modal__footer').getByRole('button', { name: 'Abbrechen' }).click()
    await expect(prompt).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveCount(0)
    await expect(editor).toBeVisible()
    // the scrim asks too
    await page.mouse.click(4, 4)
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Weiter bearbeiten' }).click()
    // ×: discard the agent, keep both
    await editor.locator('.modal__close').click()
    await prompt.getByRole('button', { name: 'Agent verwerfen, beide behalten' }).click()
    await expect(editor).toHaveCount(0)
    await expect(prompt).toHaveCount(0)
    const [dbId] = await liveDbs('Tracker')
    expect(dbId).toBeTruthy()
    const report = await pageOf('Tracker · Bericht')
    expect(report.trashed).toBe(false)
    expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}).length)).toBe(0)

    // the recipe again with the same name: it says so, Create waits, "Use" sets the agent up for the one there — with a
    // report page of its own right next to it (a page is never taken by its title)
    dialog = await openSetup(page)
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toContainText('„Tracker“ gibt es schon — eine Datenbank aus diesem Rezept.')
    await expect(dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })).toBeDisabled()
    // another name: no notice, Create possible
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker 2')
    await expect(exists).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })).toBeEnabled()
    await dialog.getByRole('textbox', { name: /Name/ }).fill(' tracker ')
    await exists.getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await expect(editor).toBeVisible()
    expect(await liveDbs('Tracker')).toEqual([dbId])
    const reports = () => wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === 'Tracker · Bericht' && !p.trashed).map((p) => p.id as string))
    const fresh = (await reports()).find((id) => id !== report.id) as string
    expect(await reports()).toHaveLength(2)
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id].parentId ?? null), [dbId, fresh])).toEqual([report.parentId ?? null, report.parentId ?? null])
    await expect(editor.getByTestId('agx-editor-intro')).toContainText('Die Datenbank „Tracker“ und die Seite „Tracker · Bericht“ sind angelegt.')
    // only that page to take back
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveAttribute('title', '„Tracker · Bericht“ wieder in den Papierkorb legen')

    // the scrim asks about that page only; to the trash: the new page goes, the database and the page that were there
    // stay live
    await page.mouse.click(4, 4)
    await expect(prompt.getByTestId('agx-discard-body')).toContainText('die Datenbank „Tracker“ gab es schon, sie bleibt')
    await prompt.getByRole('button', { name: 'Verwerfen, Seite in den Papierkorb' }).click()
    await expect(editor).toHaveCount(0)
    expect(await liveDbs('Tracker')).toEqual([dbId])
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => !!s.pages[id].trashed), [report.id, fresh])).toEqual([false, true])

    // saved through "Use": the agent mirrors into the database that was there and reports into a new page of its own
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await editor.getByRole('switch', { name: 'Aktiv' }).click()
    await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const agent = await wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents)[0])))
    expect(agent.scope.databases).toEqual([dbId])
    expect(agent.output.mode).toBe('append')
    expect([report.id, fresh]).not.toContain(agent.output.pageId)
    expect(await reports()).toEqual(expect.arrayContaining([report.id, agent.output.pageId]))
    expect(await liveDbs('Tracker')).toEqual([dbId])
  })

  test('a database of the same name that is not from the recipe: the setup asks for another name and offers nothing to use', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('projects')
    await expect(dialog.getByTestId('agx-mir-exists')).toHaveText('A database “Projects” exists already. Give the new one another name.')
    await expect(dialog.getByTestId('agx-mir-exists').getByRole('button')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    // Enter in the field does not slip past it
    await dialog.getByRole('textbox', { name: /Name/ }).press('Enter')
    await expect(page.locator('.agx-editor')).toHaveCount(0)
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title.toLowerCase() === 'projects').length)).toBe(1)
  })

  test('no active integration: the gallery has no mirror recipe — no profile, no server, or its server switched off', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await expect(page.locator('.agx-start [data-recipe="weekly"]')).toBeVisible()
    await expect(page.locator('[data-recipe*="mirror"]')).toHaveCount(0)
    // the profile, but no matching server
    await addProfile(page, trackerProfile({ match: { host: '*.example.org' } }))
    await expect(page.locator('[data-recipe*="mirror"]')).toHaveCount(0)
    // a matching one: offered, named by the profile
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await expect(page.locator(`.agx-start ${RECIPE}`)).toContainText('Tracker')
    // its servers switched off: gone again
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list.map((x: AnyState) => ({ ...x, enabled: false })) }), SERVERS)
    await expect(page.locator('[data-recipe*="mirror"]')).toHaveCount(0)
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

/**
 * The setup may only ever take back what THIS setup created (MirrorMade.created) — never a database or page that was
 * there, never one a saved agent uses by then, never for good — and a draft never disappears silently (route changes
 * leave a toast with Undo, dismissed when a new setup takes that database). "Use" makes a report page of its own, never
 * one found by its title. A double-click on Create never acts in the editor it opens; focus comes back after the prompt
 * (whichever dialog cleans up first; the main region after a route change); the key matches in both languages; names
 * fold with NFC; a database a saved agent mirrors into (reading the recipe's server) offers that agent instead.
 */
test.describe('Custom agents: the mirror setup takes back only what it made', () => {
  const liveDbs = (page: Page, title: string) => wsEval(page, (s, title) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === title && !p.trashed).map((p) => p.id), title)
  const trashedOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id]?.trashed ?? 'gone'), ids)
  const agentsOf = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents ?? {}))) as AnyState[])

  /** Live pages titled `title`. */
  const titled = (page: Page, title: string) => wsEval(page, (s, t) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === t && !p.trashed).map((p) => p.id as string), title)

  /** Setup → Create (name, language as set), then close the editor and keep both; returns the database and report ids. */
  async function setUpAndKeep(page: Page, name: string, de = false, reportTitle?: string): Promise<{ db: string; report: string }> {
    const title = reportTitle ?? (de ? `${name} · Bericht` : `${name} · Report`)
    const before = await titled(page, title)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
    await dialog.getByRole('button', { name: de ? 'Datenbank und Agent anlegen' : 'Create database and agent' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    const made = await wsEval(page, (s, n) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === n && p.kind === 'database' && !p.trashed).map((p) => p.id)[0], name)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: de ? 'Agent verwerfen, beide behalten' : 'Discard agent, keep both' }).click()
    await expect(editor).toHaveCount(0)
    const report = (await titled(page, title)).find((id) => !before.includes(id)) as string
    expect(report).toBeTruthy()
    return { db: made, report }
  }

  /** A saved agent (another tab, a teammate, a blank agent): defaults overridden by `over`. */
  const saveAgent = (page: Page, over: AnyState) =>
    wsEval(
      page,
      (s, a) => {
        const now = Date.now()
        s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
      },
      over,
    )
  const dismissToasts = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { __one: { ui: { getState: () => { dismissToast: (id: string) => void; toasts: Array<{ id: string }> } } } }
      for (const x of w.__one.ui.getState().toasts) w.__one.ui.getState().dismissToast(x.id)
    })

  test('#1 set up for a database that was there: "Use" makes only a report page next to it — the note and the prompt name only it, only it goes to the trash, the database and the page that were there stay', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const { db, report } = await setUpAndKeep(page, 'Tracker', true)
    const editor = page.locator('.agx-editor')
    const prompt = page.getByRole('dialog', { name: 'Agent verwerfen?' })
    const parentOf = (id: string) => wsEval(page, (s, id) => s.pages[id]?.parentId ?? null, id)

    // "Use": a new report page right next to the database — never the one there (found by its title)
    let dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await expect(editor).toBeVisible()
    const fresh = (await titled(page, 'Tracker · Bericht')).find((id) => id !== report) as string
    expect(fresh).toBeTruthy()
    expect(await parentOf(fresh)).toBe(await parentOf(db))
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveAttribute('title', '„Tracker · Bericht“ wieder in den Papierkorb legen')
    await page.keyboard.press('Escape')
    await expect(prompt.getByTestId('agx-discard-body')).toHaveText(
      'Der Agent ist noch nicht gespeichert. Seine Berichtsseite „Tracker · Bericht“ wurde dafür angelegt — die Datenbank „Tracker“ gab es schon, sie bleibt. Behalte die Seite oder leg sie in den Papierkorb.',
    )
    await expect(prompt.getByRole('button', { name: 'Agent verwerfen, Seite behalten' })).toBeVisible()
    await prompt.getByRole('button', { name: 'Verwerfen, Seite in den Papierkorb' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: 'Die Seite „Tracker · Bericht“ liegt im Papierkorb.' })).toBeVisible()
    // the database and the page that were there stay live
    expect(await trashedOf(page, [db, report, fresh])).toEqual([false, false, true])

    // again, and keep the page: it stays next to the others
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await expect(editor).toBeVisible()
    const again = (await titled(page, 'Tracker · Bericht')).find((id) => id !== report) as string
    expect([report, fresh]).not.toContain(again)
    await page.keyboard.press('Escape')
    await prompt.getByRole('button', { name: 'Agent verwerfen, Seite behalten' }).click()
    await expect(editor).toHaveCount(0)
    expect(await trashedOf(page, [db, report, fresh, again])).toEqual([false, false, true, false])
  })

  // German, two matching servers: at 390 px the second click lands on the editor's "Agent anlegen", at 1280 × 720 on its
  // "Abbrechen" (which asked to discard)
  for (const [label, size] of [
    ['390 px', { width: 390, height: 844 }],
    ['1280 × 720', { width: 1280, height: 720 }],
  ] as const) {
    test(`#3 ${label}: a double-click on Create never acts in the editor it opens (no save, no prompt); a click of its own does`, async ({ page }) => {
      await page.setViewportSize(size)
      await openApp(page)
      await setKey(page)
      await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
      // a recipe without placeholders: a switched-on draft would save at once
      await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', agent: { instructions: 'Halte die Datenbank „{db}“ mit den Einträgen in {server} im Gleichstand. Lies {server} nur.' } }] }))
      await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
      const dialog = await openSetup(page)
      await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).dblclick()
      const editor = page.locator('.agx-editor')
      await expect(editor).toBeVisible()
      await page.waitForTimeout(400)
      await expect(editor).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Agent verwerfen?' })).toHaveCount(0)
      expect(await agentsOf(page)).toHaveLength(0)
      // the person's own click saves
      await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
      await expect(page.locator('.agx-dhead')).toBeVisible()
      expect(await agentsOf(page)).toHaveLength(1)
    })
  }

  test('#5 "Use" never adopts a page by its title — not another mirror’s report, not a hand-written page, not a deleted agent’s: it makes its own', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', report: { name: 'Weekly report' } }] }))
    const editor = page.locator('.agx-editor')
    // "Features" and "Bugs": both kept, no agent — two "Weekly report" pages at the top level
    const features = await setUpAndKeep(page, 'Features', false, 'Weekly report')
    const bugs = await setUpAndKeep(page, 'Bugs', false, 'Weekly report')
    // "Old": saved (switched off), then deleted — its report stays behind
    let dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Old')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [old] = await agentsOf(page)
    await wsEval(page, (s, id) => s.deleteAgent(id), old.id)
    // and a hand-written "Weekly report", the newest of them
    const hand = await wsEval(page, (s) => s.createPage({ title: 'Weekly report' }) as string)
    const before = await titled(page, 'Weekly report')
    expect(before).toEqual(expect.arrayContaining([features.report, bugs.report, old.output.pageId, hand]))

    // "Features" again → Use: a page of its own, none of those
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Features')
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Features”' }).click()
    await expect(editor).toBeVisible()
    const mine = (await titled(page, 'Weekly report')).filter((id) => !before.includes(id))
    expect(mine).toHaveLength(1)
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const featuresAgent = (await agentsOf(page)).find((a) => a.scope.databases.includes(features.db))
    expect(featuresAgent?.output).toEqual({ pageId: mine[0], mode: 'append' })
    // nothing else was touched
    expect(await trashedOf(page, before)).toEqual(before.map(() => false))
  })

  test('#6 a route change with the draft open (Back, another page) leaves a toast: what the setup made stays, its Undo trashes only that; saving leaves none', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const editor = page.locator('.agx-editor')
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const [db] = await liveDbs(page, 'Tracker')
    const report = await pageIdByTitle(page, 'Tracker · Report')
    // browser Back: the list (and the editor with it) goes — the toast says what stays
    await page.goBack()
    await expect(editor).toHaveCount(0)
    const left = page.locator('.toast').filter({ hasText: 'The agent was not saved. “Tracker” and its report page stay.' })
    await expect(left).toBeVisible()
    expect(await trashedOf(page, [db, report])).toEqual([false, false])
    await left.getByRole('button', { name: 'Undo' }).click()
    expect(await trashedOf(page, [db, report])).toEqual([true, true])
    const trashed = page.locator('.toast').filter({ hasText: '“Tracker” and its report page are in the trash.' })
    await trashed.getByRole('button', { name: 'Undo' }).click()
    expect(await trashedOf(page, [db, report])).toEqual([false, false])

    // another page opened from inside the app (⌘K, ⌘⌥N, a link — the same route change)
    await page.evaluate(() => {
      const w = window as unknown as { __one: { ui: { getState: () => { dismissToast: (id: string) => void; toasts: Array<{ id: string }> } } } }
      for (const x of w.__one.ui.getState().toasts) w.__one.ui.getState().dismissToast(x.id)
    })
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker 2')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)
    await expect(page.locator('.toast').filter({ hasText: 'The agent was not saved. “Tracker 2” and its report page stay.' })).toBeVisible()
    expect(await liveDbs(page, 'Tracker 2')).toHaveLength(1)

    // saved: no such toast
    await page.evaluate(() => {
      const w = window as unknown as { __one: { ui: { getState: () => { dismissToast: (id: string) => void; toasts: Array<{ id: string }> } } } }
      for (const x of w.__one.ui.getState().toasts) w.__one.ui.getState().dismissToast(x.id)
    })
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker 3')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.waitForTimeout(300)
    await expect(page.locator('.toast').filter({ hasText: 'was not saved' })).toHaveCount(0)
  })

  test('#7 keyboard only: after "keep both" or "to the trash" focus is back on the recipe that started it, never on the page body', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const recipe = page.locator(`.agx-start ${RECIPE}`)
    const focusedIsRecipe = () => recipe.evaluate((el) => document.activeElement === el)
    for (const [name, choice] of [
      ['Tracker', 'Discard agent, keep both'],
      ['Tracker 2', 'Discard, both to the trash'],
    ] as const) {
      const dialog = await openSetup(page)
      await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
      await dialog.getByRole('textbox', { name: /Name/ }).press('Enter')
      const editor = page.locator('.agx-editor')
      await expect(editor).toBeVisible()
      await page.keyboard.press('Escape')
      const prompt = page.getByRole('dialog', { name: 'Discard the agent?' })
      await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeFocused()
      // Shift+Tab to the choice, Enter
      for (let i = 0; i < 4 && !(await prompt.getByRole('button', { name: choice }).evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Shift+Tab')
      await expect(prompt.getByRole('button', { name: choice })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(prompt).toHaveCount(0)
      await expect(editor).toHaveCount(0)
      await expect.poll(focusedIsRecipe).toBe(true)
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
    }
  })

  test('#8 a mirror set up in German is offered in English (key named in either language), and its agent speaks the database’s language', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const { db } = await setUpAndKeep(page, 'Tracker', true)
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    const dialog = await openSetup(page)
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toContainText('“Tracker” exists already — a database from this recipe.')
    await exists.getByRole('button', { name: 'Use “Tracker”' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Spiegel · Tracker')
    const text = await editor.getByRole('textbox', { name: 'Instructions' }).inputValue()
    expect(text).toContain('key_property "Schlüssel"')
    expect(text).toContain('Schreibe nie Mein Status, Meine Prio, Nächster Schritt oder Fällig')
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    expect((await agentsOf(page))[0].scope.databases).toEqual([db])
    expect(await liveDbs(page, 'Tracker')).toEqual([db])
  })

  test('#9 a database a saved agent mirrors into already: the setup offers that agent, never a second one', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const editor = page.locator('.agx-editor')
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)

    dialog = await openSetup(page)
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toHaveText(/“Tracker” exists already, and the agent “Mirror · Tracker” keeps it in step\. Open that agent, or give the new database another name\./)
    await expect(exists.getByRole('button', { name: 'Use “Tracker”' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    await exists.getByRole('button', { name: 'Open “Mirror · Tracker”' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.agx-dhead')).toContainText('Mirror · Tracker')
    expect(await page.evaluate(() => window.location.hash)).toBe(`#/agents/${agent.id}`)
    expect(await agentsOf(page)).toHaveLength(1)
  })

  test('#10 names fold with Unicode NFC: a decomposed “Café” is the same name as a composed one', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.createDatabase({ title: 'Café' }))
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Café')
    await expect(dialog.getByTestId('agx-mir-exists')).toContainText('exists already. Give the new one another name.')
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
  })

  test('#11 a stale Undo never trashes what a saved agent uses: a new setup for the same database dismisses the left-behind toast; the toast says what stayed', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const editor = page.locator('.agx-editor')
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const leave = () => page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)

    // "Tracker" set up, the draft left open by a route change: the toast with Undo
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const [db] = await liveDbs(page, 'Tracker')
    const report = await pageIdByTitle(page, 'Tracker · Report')
    await leave()
    const left = page.locator('.toast').filter({ hasText: 'The agent was not saved. “Tracker” and its report page stay.' })
    await expect(left).toBeVisible()
    // back within its 10 s, the setup again, "Use “Tracker”": that toast goes at once (its Undo would take back what the
    // new agent stands on)
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Tracker”' }).click()
    await expect(editor).toBeVisible()
    await expect(left).toHaveCount(0, { timeout: 1_000 })
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)
    expect(agent.scope.databases).toEqual([db])
    expect(await trashedOf(page, [db, report, agent.output.pageId])).toEqual([false, false, false])

    // "Tracker 2" left open; meanwhile an agent saved elsewhere reads the database: the Undo trashes only the report
    // page and says why the database stays — its own Undo brings the page back
    await dismissToasts(page)
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker 2')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const [db2] = await liveDbs(page, 'Tracker 2')
    const report2 = await pageIdByTitle(page, 'Tracker 2 · Report')
    await leave()
    const left2 = page.locator('.toast').filter({ hasText: 'The agent was not saved. “Tracker 2” and its report page stay.' })
    await expect(left2).toBeVisible()
    await saveAgent(page, { id: 'ag-digest', name: 'Digest', scope: { everything: false, pages: [], databases: [db2] } })
    await left2.getByRole('button', { name: 'Undo' }).click()
    const said = page.locator('.toast').filter({ hasText: 'The page “Tracker 2 · Report” is in the trash. “Tracker 2” stays — the agent “Digest” uses it.' })
    await expect(said).toBeVisible()
    expect(await trashedOf(page, [db2, report2])).toEqual([false, true])
    await said.getByRole('button', { name: 'Undo' }).click()
    expect(await trashedOf(page, [db2, report2])).toEqual([false, false])

    // "Tracker 3": an agent reads one of its rows and reports into its page — nothing goes, the toast says so (no Undo)
    await dismissToasts(page)
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker 3')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const [db3] = await liveDbs(page, 'Tracker 3')
    const report3 = await pageIdByTitle(page, 'Tracker 3 · Report')
    const row = await wsEval(page, (s, id) => s.createRow(id, { title: 'Item 1' }) as string, db3)
    await leave()
    const left3 = page.locator('.toast').filter({ hasText: 'The agent was not saved. “Tracker 3” and its report page stay.' })
    await expect(left3).toBeVisible()
    await saveAgent(page, { id: 'ag-rows', name: 'Row watcher', scope: { everything: false, pages: [row], databases: [] }, output: { pageId: report3, mode: 'append' } })
    await left3.getByRole('button', { name: 'Undo' }).click()
    const kept = page.locator('.toast').filter({ hasText: 'Nothing went to the trash. “Tracker 3” and “Tracker 3 · Report” stay — the agent “Row watcher” uses them.' })
    await expect(kept).toBeVisible()
    await expect(kept.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    expect(await trashedOf(page, [db3, report3, row])).toEqual([false, false, false])
  })

  test('#12 an agent on the database that reads another server is not its mirror: "Use" is offered (never "Open" that agent), and its page is never taken', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const { db, report } = await setUpAndKeep(page, 'Tracker')
    // a digest of the database through another server: scoped to it and it may write — but it is no mirror
    await saveAgent(page, { id: 'ag-weekly', name: 'Weekly digest', scope: { everything: false, pages: [], databases: [db] }, write: 'stage', mcpServers: ['chat'], output: { pageId: report, mode: 'append' } })
    const dialog = await openSetup(page)
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toHaveText(/^“Tracker” exists already — a database from this recipe\./)
    await expect(exists.getByRole('button', { name: 'Open “Weekly digest”' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    await exists.getByRole('button', { name: 'Use “Tracker”' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const mirror = (await agentsOf(page)).find((a) => a.id !== 'ag-weekly') as AnyState
    expect(mirror.scope.databases).toEqual([db])
    expect(mirror.mcpServers).toEqual(['tracker'])
    expect(mirror.output.pageId).not.toBe(report)
    // now a mirror reads "tracker" into it: the setup offers that agent
    const again = await openSetup(page)
    await expect(again.getByTestId('agx-mir-exists').getByRole('button', { name: `Open “${mirror.name}”` })).toBeVisible()
  })

  test('#13 a route change with the discard prompt open: focus lands in the main region, never on the page body, and nothing stays inert', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await page.keyboard.press('Escape')
    const prompt = page.getByRole('dialog', { name: 'Discard the agent?' })
    await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeFocused()
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)
    await expect(prompt).toHaveCount(0)
    await expect(editor).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => ({ tag: document.activeElement?.tagName, inMain: !!document.activeElement?.closest('#main'), inert: document.querySelectorAll('[inert]').length }))).toEqual({ tag: 'MAIN', inMain: true, inert: 0 })
  })
})
