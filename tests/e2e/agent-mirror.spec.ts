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
    // good: rows another tab or device added meanwhile come back with them), the open draft goes; the draft is unchanged,
    // so nothing is asked
    await expect(page.locator('.toast')).toHaveCount(0)
    const report = await pageIdByTitle(page, 'Tickets · Bericht')
    const row = await wsEval(page, (s, db) => s.createRow(db, { title: 'Aus dem anderen Tab' }) as string, made.page.id)
    // they were never in the trash: the key's title says where they go, not "again"
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveAttribute('title', '„Tickets“ und „Tickets · Bericht“ in den Papierkorb legen')
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

  test('closing the editor after setup asks (Esc, ×, Cancel, scrim): keep editing, keep both, or both to the trash; a second setup never duplicates silently, takes back the kept report page and never trashes what was there', async ({ page }) => {
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
    await expect(prompt).toContainText('Die Datenbank „Tracker“ und die Seite „Tracker · Bericht“ wurden gerade angelegt.')
    // keeping them pays off: the next setup with that name offers the database, with this page as its report
    await expect(prompt).toContainText('Behältst du sie, bietet das Rezept sie dir wieder an, wenn du es mit demselben Namen einrichtest.')
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

    // the recipe again with the same name: it says so, Create waits, "Use" sets the agent up for the one there — with the
    // report page this setup made for it and that was kept (remembered on this device, never found by its title):
    // nothing new is made, so the note has no Undo and closing asks nothing
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
    const reports = () => wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title.startsWith('Tracker · Bericht') && !p.trashed).map((p) => p.id as string))
    expect(await reports()).toEqual([report.id])
    await expect(editor.getByTestId('agx-editor-intro')).toHaveText(
      '„Tracker“ und die Seite „Tracker · Bericht“ gab es schon. Ersetze die 4 Teile in [ECKIGEN KLAMMERN] in den Anweisungen durch das, was für dein Werkzeug gilt, und speichere dann.',
    )
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveCount(0)
    // the scrim closes it without asking: nothing of it was made by this setup; both stay live
    await page.mouse.click(4, 4)
    await expect(editor).toHaveCount(0)
    await expect(prompt).toHaveCount(0)
    expect(await liveDbs('Tracker')).toEqual([dbId])
    expect(await wsEval(page, (s, id) => !!s.pages[id].trashed, report.id)).toBe(false)

    // saved through "Use": the agent mirrors into the database that was there and reports into the page kept for it
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await editor.getByRole('switch', { name: 'Aktiv' }).click()
    await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const agent = await wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents)[0])))
    expect(agent.scope.databases).toEqual([dbId])
    expect(agent.mirrorOf).toBe(dbId)
    expect(agent.output).toEqual({ pageId: report.id, mode: 'append' })
    expect(await reports()).toEqual([report.id])
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
 * leave a toast with Undo; every agent dialog takes such toasts down as it opens, so their Undo never takes a click meant
 * for the dialog). "Use" takes back the report page this device's setup made for that database (while no saved agent
 * uses it), else makes one of its own — never one found by its title; titles the setup makes are distinct. A double-click
 * on Create never acts in the editor it opens; focus comes back after the prompt (whichever dialog cleans up first; the
 * main region after a route change); the key matches in both languages; names fold with NFC; a database a saved agent
 * mirrors into (marked `mirrorOf`, or an older one reading a server that matches the profile, on or off) offers that
 * agent instead; nothing is saved against a page in the trash; the note's Undo asks before an edited draft is lost.
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

  test('#1 set up for a database that was there whose kept report page a saved agent uses: "Use" makes only a report page next to it — the note and the prompt name only it, only it goes to the trash, the database and the page that were there stay; kept, the next "Use" takes it back', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const { db, report } = await setUpAndKeep(page, 'Tracker', true)
    // a digest (no mirror: it only reads) reports into the page kept for "Tracker" — "Use" never takes a page a saved
    // agent uses
    await saveAgent(page, { id: 'ag-digest', name: 'Digest', output: { pageId: report, mode: 'append' } })
    const editor = page.locator('.agx-editor')
    const intro = editor.getByTestId('agx-editor-intro')
    const prompt = page.getByRole('dialog', { name: 'Agent verwerfen?' })
    const parentOf = (id: string) => wsEval(page, (s, id) => s.pages[id]?.parentId ?? null, id)

    // "Use": a new report page right next to the database — never the one there (found by its title); its title is
    // distinct from the page that is there
    let dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await expect(editor).toBeVisible()
    const [fresh] = await titled(page, 'Tracker · Bericht (2)')
    expect(fresh).toBeTruthy()
    expect(await parentOf(fresh)).toBe(await parentOf(db))
    await expect(intro).toContainText('„Tracker“ gab es schon; die Seite „Tracker · Bericht (2)“ ist neu angelegt.')
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveAttribute('title', '„Tracker · Bericht (2)“ in den Papierkorb legen')
    await page.keyboard.press('Escape')
    await expect(prompt.getByTestId('agx-discard-body')).toHaveText(
      'Der Agent ist noch nicht gespeichert. Seine Berichtsseite „Tracker · Bericht (2)“ wurde gerade angelegt. Die Datenbank „Tracker“ gab es schon, sie bleibt. Behältst du die Seite, nimmt die nächste Einrichtung für „Tracker“ sie wieder als Bericht. Oder leg sie in den Papierkorb.',
    )
    await expect(prompt.getByRole('button', { name: 'Agent verwerfen, Seite behalten' })).toBeVisible()
    await prompt.getByRole('button', { name: 'Verwerfen, Seite in den Papierkorb' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: 'Die Seite „Tracker · Bericht (2)“ liegt im Papierkorb.' })).toBeVisible()
    // the database and the page that were there stay live
    expect(await trashedOf(page, [db, report, fresh])).toEqual([false, false, true])

    // again (the remembered page is in the trash now: a new one), and keep the page: it stays next to the others
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await expect(editor).toBeVisible()
    const [again] = await titled(page, 'Tracker · Bericht (2)')
    expect([report, fresh]).not.toContain(again)
    await page.keyboard.press('Escape')
    await prompt.getByRole('button', { name: 'Agent verwerfen, Seite behalten' }).click()
    await expect(editor).toHaveCount(0)
    expect(await trashedOf(page, [db, report, fresh, again])).toEqual([false, false, true, false])

    // kept: the next "Use" takes it back as the report — nothing new, no Undo, nothing to ask
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Tracker“ verwenden' }).click()
    await expect(editor).toBeVisible()
    await expect(intro).toContainText('„Tracker“ und die Seite „Tracker · Bericht (2)“ gab es schon.')
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveCount(0)
    expect(await titled(page, 'Tracker · Bericht (2)')).toEqual([again])
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(prompt).toHaveCount(0)
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

  test('#5 "Use" never adopts a page by its title: with a report name without {db} ("Weekly report") each database gets back only its OWN page — a deleted agent’s report goes on, a hand-written page of the same title is never taken', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', report: { name: 'Weekly report' } }] }))
    const editor = page.locator('.agx-editor')
    const ids = () => wsEval(page, (s) => Object.keys(s.pages))
    const titleOf = (id: string) => wsEval(page, (s, id) => s.pages[id]?.title ?? null, id)
    /** Setup → Create (`name`) → close, keep both: the database and the report page it made (whatever their titles). */
    const keepBoth = async (name: string) => {
      const before = await ids()
      const d = await openSetup(page)
      await d.getByRole('textbox', { name: /Name/ }).fill(name)
      await d.getByRole('button', { name: 'Create database and agent' }).click()
      await expect(editor).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Discard agent, keep both' }).click()
      await expect(editor).toHaveCount(0)
      const made = await wsEval(page, (s, before) => (Object.values(s.pages) as AnyState[]).filter((p) => !before.includes(p.id) && !p.databaseId).map((p) => ({ id: p.id as string, kind: p.kind as string })), before)
      return { db: made.find((p) => p.kind === 'database')!.id, report: made.find((p) => p.kind === 'page')!.id }
    }
    // "Features" and "Bugs": both kept, no agent
    const features = await keepBoth('Features')
    const bugs = await keepBoth('Bugs')
    // "Old": saved (switched off), then deleted — its report stays behind
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Old')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [old] = await agentsOf(page)
    const oldDb = old.scope.databases[0]
    await wsEval(page, (s, id) => s.deleteAgent(id), old.id)
    // and a hand-written "Weekly report", the newest page of that title
    const hand = await wsEval(page, (s) => s.createPage({ title: 'Weekly report' }) as string)
    const all = [features.report, bugs.report, old.output.pageId, hand]
    const pageCount = () => wsEval(page, (s) => Object.keys(s.pages).length)
    const useAndSave = async (name: string, db: string) => {
      const before = await pageCount()
      const d = await openSetup(page)
      await d.getByRole('textbox', { name: /Name/ }).fill(name)
      await d.getByTestId('agx-mir-exists').getByRole('button', { name: `Use “${name}”` }).click()
      await expect(editor).toBeVisible()
      // nothing new: its own page comes back
      expect(await pageCount()).toBe(before)
      await expect(editor.getByTestId('agx-editor-intro')).toContainText(`“${name}” and the page “`)
      await expect(editor.getByTestId('agx-editor-intro')).toContainText('were there already.')
      await editor.getByRole('switch', { name: 'Active' }).click()
      await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
      await expect(page.locator('.agx-dhead')).toBeVisible()
      return (await agentsOf(page)).find((a) => a.scope.databases[0] === db) as AnyState
    }
    // each database gets back exactly the page its own setup made
    expect((await useAndSave('Features', features.db)).output).toEqual({ pageId: features.report, mode: 'append' })
    expect((await useAndSave('Bugs', bugs.db)).output).toEqual({ pageId: bugs.report, mode: 'append' })
    // the deleted agent's report (with its history) goes on
    expect((await useAndSave('Old', oldDb)).output).toEqual({ pageId: old.output.pageId, mode: 'append' })
    // the hand-written page is never a report; nothing went to the trash
    expect((await agentsOf(page)).map((a) => a.output?.pageId)).not.toContain(hand)
    expect(await trashedOf(page, all)).toEqual(all.map(() => false))
    // the titles the setup made are distinct: the first keeps the configured name
    expect(await Promise.all([features.report, bugs.report, old.output.pageId].map(titleOf))).toEqual(['Weekly report', 'Weekly report (Bugs)', 'Weekly report (Old)'])
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
    // new agent stands on) — the setup takes back the report page it made
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Tracker”' }).click()
    await expect(editor).toBeVisible()
    await expect(left).toHaveCount(0, { timeout: 1_000 })
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)
    expect(agent.scope.databases).toEqual([db])
    expect(agent.output.pageId).toBe(report)
    expect(await trashedOf(page, [db, report])).toEqual([false, false])

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

/**
 * Review round 3: a database's mirror is the agent the recipe set up for it (`mirrorOf`), whatever became of its server
 * — an older one counts by the servers that match the profile, switched on or off, never one whose tool list for them
 * is empty or one marked for another database. "Use" takes back the report page this device's setup made for that
 * database (localStorage `one.mirror.reports:<kind>:<id>`). The mirror toasts never take a click meant for an agent
 * dialog; nothing is saved against a page in the trash; the note's Undo asks before an edited draft is lost; the texts
 * say what was made, the name's hint what is named after it, and titles the setup makes are distinct.
 */
test.describe('Custom agents: the mirror setup — markers, report memory, toasts, texts', () => {
  const editorOf = (page: Page) => page.locator('.agx-editor')
  const liveDbs = (page: Page, title: string) => wsEval(page, (s, title) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === title && !p.trashed).map((p) => p.id as string), title)
  const trashedOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id]?.trashed ?? 'gone'), ids)
  const agentsOf = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents ?? {}))) as AnyState[])
  const titled = (page: Page, title: string) => wsEval(page, (s, t) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === t && !p.trashed).map((p) => p.id as string), title)
  const saveAgent = (page: Page, over: AnyState) =>
    wsEval(
      page,
      (s, a) => {
        const now = Date.now()
        s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
      },
      over,
    )
  /** A database holding the recipe's key property (English names), made by hand. */
  const keyedDb = (page: Page, title: string) =>
    wsEval(page, (s, title) => s.createDatabase({ title, properties: [{ id: 'p-name', name: 'Name', type: 'title' }, { id: 'p-key', name: 'Key', type: 'text', key: true }] }) as string, title)

  /** Setup → Create (`name`), switched off, saved; returns the agent. */
  async function setUpAndSave(page: Page, name = 'Tracker'): Promise<AnyState> {
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const editor = editorOf(page)
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    return (await agentsOf(page)).find((a) => a.name === `Mirror · ${name}`) as AnyState
  }

  /** The setup with `name` typed: its notice. */
  async function noticeFor(page: Page, name: string) {
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toBeVisible()
    return { dialog, exists }
  }

  /** The point in the middle of `el`, clicked like a person would — whatever lies on top there takes the click. */
  async function clickAtCentre(page: Page, el: ReturnType<Page['locator']>) {
    const box = await el.boundingBox()
    if (!box) throw new Error('not on screen')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }

  /** German, two matching servers, a recipe without placeholders (a switched-on draft saves at once). */
  async function germanNoPlaceholders(page: Page) {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', agent: { instructions: 'Halte die Datenbank „{db}“ mit den Einträgen in {server} im Gleichstand. Lies {server} nur.' } }] }))
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  }

  test('A1 probe E: a mirror whose server is switched off (another server still matches) stays the mirror — the setup offers that agent, never "Use"; an older mirror without the marker too', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const agent = await setUpAndSave(page)
    const [db] = await liveDbs(page, 'Tracker')
    expect(agent.scope.databases).toEqual([db])
    // an older mirror (saved before the marker existed) of "Legacy", reading "tracker" too
    const legacy = await keyedDb(page, 'Legacy')
    await saveAgent(page, { id: 'ag-legacy', name: 'Legacy mirror', scope: { everything: false, pages: [], databases: [legacy] }, write: 'stage', mcpServers: ['tracker'] })
    // "tracker" switched off — "wiki" still matches the profile, so the recipe stays on offer
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list.map((x: AnyState) => (x.name === 'tracker' ? { ...x, enabled: false } : x)) }), SERVERS)

    let { dialog, exists } = await noticeFor(page, 'Tracker')
    await expect(dialog.getByRole('radio', { name: /WIKI/ })).toBeChecked()
    await expect(exists).toContainText('“Tracker” exists already, and the agent “Mirror · Tracker” keeps it in step. Open that agent, or give the new database another name.')
    await expect(exists.getByRole('button', { name: 'Open “Mirror · Tracker”' })).toBeVisible()
    await expect(exists.getByRole('button', { name: 'Use “Tracker”' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    ;({ dialog, exists } = await noticeFor(page, 'Legacy'))
    await expect(exists.getByRole('button', { name: 'Open “Legacy mirror”' })).toBeVisible()
    await expect(exists.getByRole('button', { name: 'Use “Legacy”' })).toHaveCount(0)
    await exists.getByRole('button', { name: 'Open “Legacy mirror”' }).click()
    expect(await page.evaluate(() => window.location.hash)).toBe('#/agents/ag-legacy')
    // never a second mirror; the recipe marked its own for its database
    expect(await agentsOf(page)).toHaveLength(2)
    expect((await agentsOf(page)).find((a) => a.id === agent.id)?.mirrorOf).toBe(db)
  })

  test('A1 a marked mirror stays the mirror when its server is renamed, and switched off and read-only', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const agent = await setUpAndSave(page)
    // "tracker" renamed to "issues" (the agent still names "tracker"): the marker holds
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list.map((x: AnyState) => (x.name === 'tracker' ? { ...x, name: 'issues' } : x)) }), SERVERS)
    let { dialog, exists } = await noticeFor(page, 'Tracker')
    await expect(exists.getByRole('button', { name: 'Open “Mirror · Tracker”' })).toBeVisible()
    await expect(exists.getByRole('button', { name: 'Use “Tracker”' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    // switched off (it is) and set to "Read only": still that database's mirror
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], write: 'none', enabled: false }), agent.id)
    ;({ exists } = await noticeFor(page, 'Tracker'))
    await expect(exists.getByRole('button', { name: 'Open “Mirror · Tracker”' })).toBeVisible()
    await expect(exists.getByRole('button', { name: 'Use “Tracker”' })).toHaveCount(0)
  })

  test('A1 variant C: an agent whose tool list for the source server is empty is not the mirror, nor is one marked for another database', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const tracker = await keyedDb(page, 'Tracker')
    const other = await keyedDb(page, 'Other')
    // "tracker" left out of its runs (no tools) — no mirror
    await saveAgent(page, { id: 'ag-none', name: 'Tool-less', scope: { everything: false, pages: [], databases: [tracker] }, write: 'stage', mcpServers: ['tracker'], mcpTools: { tracker: [] } })
    // set up for "Other", it also reads and writes "Tracker" — "Other"'s mirror, never "Tracker"'s
    await saveAgent(page, { id: 'ag-other', name: 'Other mirror', scope: { everything: false, pages: [], databases: [other, tracker] }, write: 'stage', mcpServers: ['tracker'], mirrorOf: other })
    let { dialog, exists } = await noticeFor(page, 'Tracker')
    await expect(exists).toHaveText(/^“Tracker” exists already — a database from this recipe\./)
    await expect(exists.getByRole('button', { name: 'Use “Tracker”' })).toBeVisible()
    await expect(exists.getByRole('button', { name: /^Open/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    ;({ exists } = await noticeFor(page, 'Other'))
    await expect(exists.getByRole('button', { name: 'Open “Other mirror”' })).toBeVisible()
  })

  test('A3 keep both → "Use": no new page — the kept one is the report; nothing made: no Undo, closing asks nothing, a route change leaves no toast; the memory keeps the newest 100 per workspace', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const editor = editorOf(page)
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const [db] = await liveDbs(page, 'Tracker')
    const [report] = await titled(page, 'Tracker · Report')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Discard agent, keep both' }).click()
    await expect(editor).toHaveCount(0)

    // "Use": the kept page is the report — no page is made
    const count = () => wsEval(page, (s) => Object.keys(s.pages).length)
    const before = await count()
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Tracker”' }).click()
    await expect(editor).toBeVisible()
    expect(await count()).toBe(before)
    await expect(editor.getByTestId('agx-editor-intro')).toHaveText(
      '“Tracker” and the page “Tracker · Report” were there already. Replace the 4 parts in [SQUARE BRACKETS] in the instructions with how your tool works, then save.',
    )
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveCount(0)
    // closing asks nothing
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Discard the agent?' })).toHaveCount(0)
    // a route change leaves no toast (nothing of it was made by this setup)
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Tracker”' }).click()
    await expect(editor).toBeVisible()
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)
    await expect(editor).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(page.locator('.toast').filter({ hasText: 'was not saved' })).toHaveCount(0)
    expect(await count()).toBe(before)

    // remembered on this device, per workspace
    const KEY = 'one.mirror.reports:local:local'
    const memory = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY)
    expect(await memory()).toEqual({ [db]: [report] })
    // 99 older entries before it: a new setup adds one, the oldest goes — at most 100
    await page.evaluate(
      ({ k, db, report }) => {
        const old: Record<string, string> = {}
        for (let i = 0; i < 99; i++) old[`fk-db-${i}`] = `fk-page-${i}`
        localStorage.setItem(k, JSON.stringify({ ...old, [db]: report }))
      },
      { k: KEY, db, report },
    )
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker 2')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    const [db2] = await liveDbs(page, 'Tracker 2')
    const mem = (await memory()) as Record<string, string[]>
    expect(Object.keys(mem)).toHaveLength(100)
    expect(mem['fk-db-0']).toBeUndefined()
    // an older value (one page per database) reads as a list of one
    expect(mem['fk-db-1']).toEqual(['fk-page-1'])
    expect(mem[db]).toEqual([report])
    expect(Object.keys(mem).at(-1)).toBe(db2)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Discard agent, keep both' }).click()
    await expect(editor).toHaveCount(0)

    // saved: it reports into the kept page
    const now = await count()
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Tracker”' }).click()
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const agent = (await agentsOf(page)).find((a) => a.scope.databases[0] === db) as AnyState
    expect(agent).toMatchObject({ scope: { databases: [db] }, output: { pageId: report, mode: 'append' }, mirrorOf: db })
    expect(await count()).toBe(now)
    expect(await trashedOf(page, [db, report])).toEqual([false, false])
  })

  test('A4a 1280 × 720, German: a stale "in the trash" toast never takes the click on "Agent anlegen" — the next setup with the same name saves, nothing comes back', async ({ page }) => {
    await germanNoPlaceholders(page)
    const editor = editorOf(page)
    let dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Overlap')
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await expect(editor).toBeVisible()
    const [first] = await liveDbs(page, 'Overlap')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Verwerfen, beide in den Papierkorb' }).click()
    const binned = page.locator('.toast').filter({ hasText: '„Overlap“ und die Berichtsseite liegen im Papierkorb.' })
    await expect(binned).toBeVisible()
    // within its 6 s: the recipe again, the same name, Create (Enter in the field), a click on "Agent anlegen" where it
    // is — whatever lies there takes it
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Overlap')
    await dialog.getByRole('textbox', { name: /Name/ }).press('Enter')
    await expect(editor).toBeVisible()
    await clickAtCentre(page, editor.getByRole('button', { name: 'Agent anlegen', exact: true }))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    expect(await agentsOf(page)).toHaveLength(1)
    // the first "Overlap" stays in the trash: one live database of that name, the toast went with the first dialog
    const live = await liveDbs(page, 'Overlap')
    expect(live).toHaveLength(1)
    expect(live).not.toContain(first)
    await expect(binned).toHaveCount(0)
  })

  test('A4a Back variant, German: the left-behind toast of "Erster" never takes the click on "Agent anlegen" of "Zweiter"', async ({ page }) => {
    await germanNoPlaceholders(page)
    const editor = editorOf(page)
    let dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Erster')
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await expect(editor).toBeVisible()
    const [erster] = await liveDbs(page, 'Erster')
    const ersterReport = await pageIdByTitle(page, 'Erster · Bericht')
    await page.goBack()
    const left = page.locator('.toast').filter({ hasText: 'Der Agent ist nicht gespeichert. „Erster“ und die Berichtsseite bleiben.' })
    await expect(left).toBeVisible()
    // within its 10 s: set up "Zweiter" (Enter in the field), then a click on "Agent anlegen" where it is
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Zweiter')
    await dialog.getByRole('textbox', { name: /Name/ }).press('Enter')
    await expect(editor).toBeVisible()
    await clickAtCentre(page, editor.getByRole('button', { name: 'Agent anlegen', exact: true }))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    expect(await agentsOf(page)).toHaveLength(1)
    expect(await trashedOf(page, [erster, ersterReport])).toEqual([false, false])
    await expect(left).toHaveCount(0)
  })

  test('A4a the recipe gallery and a blank editor take a stale mirror toast down before anything in them is clicked (sweep S3: "Neuer Agent" → "Leer")', async ({ page }) => {
    await germanNoPlaceholders(page)
    const editor = editorOf(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await expect(editor).toBeVisible()
    await page.goBack()
    const left = page.locator('.toast').filter({ hasText: '„Tracker“ und die Berichtsseite bleiben.' })
    await expect(left).toBeVisible()
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-head .btn--primary').click()
    await expect(page.locator('.agx-recipe-modal')).toBeVisible()
    // at once — not when its own 10 s are up
    await expect(left).toHaveCount(0, { timeout: 500 })
    await page.locator('.agx-recipe-modal [data-recipe="blank"]').click()
    await expect(editor).toBeVisible()
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 500 })
  })

  test('A4b nothing is saved against a page in the trash: a scope database or the report page trashed while the editor is open (or below a trashed page) is named, and saving waits', async ({ page }) => {
    await openApp(page)
    const tracker = await wsEval(page, (s) => s.createDatabase({ title: 'Tracker' }) as string)
    const archive = await wsEval(page, (s) => s.createPage({ title: 'Archive' }) as string)
    const notes = await wsEval(page, (s, parentId) => s.createPage({ title: 'Agent notes', parentId }) as string, archive)
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-start [data-recipe="blank"]').click()
    const editor = editorOf(page)
    await editor.getByRole('textbox', { name: 'Name' }).fill('Watcher')
    await editor.getByLabel('Instructions').fill('Report on the tracker.')
    await editor.getByRole('radio', { name: 'Chosen pages' }).click()
    await editor.getByRole('button', { name: 'Add page or database' }).click()
    await page.getByRole('menuitem', { name: /^Tracker/ }).click()
    await editor.getByRole('button', { name: 'Report page' }).click()
    await page.getByRole('menuitem', { name: 'Agent notes' }).click()
    // meanwhile (another tab, an Undo in a toast) "Tracker" goes to the trash
    await wsEval(page, (s, id) => s.trashPage(id), tracker)
    const create = editor.getByRole('button', { name: 'Create agent', exact: true })
    await create.click()
    await expect(editor.getByText('“Tracker” is in the trash — remove it from “May use” or restore it.')).toBeVisible()
    await expect(editor.locator('.agx-chipx[data-trashed]')).toContainText('In the trash')
    expect(await agentsOf(page)).toHaveLength(0)
    // back from the trash; now the report page's parent goes there (the page itself is not trashed, only below one)
    await wsEval(page, (s, id) => s.restorePage(id), tracker)
    await wsEval(page, (s, id) => s.trashPage(id), archive)
    await create.click()
    await expect(editor.getByText('The report page “Agent notes” is in “Archive”, and “Archive” is in the trash — choose another one or restore “Archive”.')).toBeVisible()
    expect(await agentsOf(page)).toHaveLength(0)
    // restored: it saves
    await wsEval(page, (s, id) => s.restorePage(id), archive)
    await create.click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)
    expect(agent).toMatchObject({ scope: { everything: false, databases: [tracker] }, output: { pageId: notes } })
  })

  test('A5 the note’s Undo asks first when the draft was changed: "Weiter bearbeiten" keeps it (Esc too), "Rückgängig, Änderungen verwerfen" takes it all back', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const editor = editorOf(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Zweiter')
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await expect(editor).toBeVisible()
    const [db] = await liveDbs(page, 'Zweiter')
    const report = await pageIdByTitle(page, 'Zweiter · Bericht')
    const name = editor.getByRole('textbox', { name: 'Name' })
    await name.fill('Spiegel · Geändert')
    const undo = editor.getByTestId('agx-editor-intro-undo')
    await undo.click()
    const ask = page.getByRole('dialog', { name: 'Rückgängig machen und Änderungen verwerfen?' })
    await expect(ask).toBeVisible()
    await expect(ask.getByTestId('agx-undoask-body')).toHaveText(
      'Du hast den Agenten geändert. „Rückgängig“ legt die Datenbank „Zweiter“ und die Seite „Zweiter · Bericht“ in den Papierkorb und verwirft den Agenten samt deinen Änderungen.',
    )
    await expect(ask.getByRole('button', { name: 'Weiter bearbeiten' })).toBeFocused()
    // Esc means "keep editing": nothing went, the change is there, focus back on the key
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(name).toHaveValue('Spiegel · Geändert')
    await expect(undo).toBeFocused()
    expect(await trashedOf(page, [db, report])).toEqual([false, false])
    // the danger key: both to the trash (toast with Undo), the draft goes
    await undo.click()
    await ask.getByRole('button', { name: 'Rückgängig, Änderungen verwerfen' }).click()
    await expect(ask).toHaveCount(0)
    await expect(editor).toHaveCount(0)
    expect(await trashedOf(page, [db, report])).toEqual([true, true])
    await expect(page.locator('.toast').filter({ hasText: '„Zweiter“ und die Berichtsseite liegen im Papierkorb.' })).toBeVisible()
    expect(await agentsOf(page)).toHaveLength(0)
  })

  test('A6 the name’s hint says what is named after it; titles the setup makes are distinct (" (<database>)"), the first keeps the configured names', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(
      page,
      trackerProfile({
        match: { host: '*.example.com' },
        recipes: [
          { kind: 'mirror', id: 'both' },
          { kind: 'mirror', id: 'agent', report: { name: 'Weekly report' } },
          { kind: 'mirror', id: 'report', agent: { name: 'Weekly mirror' } },
          { kind: 'mirror', id: 'none', agent: { name: 'Weekly mirror' }, report: { name: 'Weekly report' } },
        ],
      }),
    )
    const open = async (id: string) => {
      await page.evaluate(() => (window.location.hash = '#/agents'))
      await page.locator('.agx-head').waitFor()
      const inline = page.locator(`.agx-start [data-recipe="tracker:${id}"]`)
      if (await inline.count()) await inline.click()
      else {
        await page.locator('.agx-head .btn--primary').click()
        await page.locator(`.agx-recipe-modal [data-recipe="tracker:${id}"]`).click()
      }
      const dialog = page.locator('.agx-mir')
      await expect(dialog).toBeVisible()
      return dialog
    }
    const hints: Array<[string, string]> = [
      ['both', 'The database’s name — the agent and its report page are named after it.'],
      ['agent', 'The database’s name — the agent is named after it.'],
      ['report', 'The database’s name — its report page is named after it.'],
      ['none', 'The database’s name.'],
    ]
    for (const [id, hint] of hints) {
      const dialog = await open(id)
      // the hint under the name field
      await expect(dialog.locator('.agx-mir__grid .agx-field').first().locator('.agx-field__hint')).toHaveText(hint)
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toHaveCount(0)
    }

    // "Features": the configured names exactly; "Bugs": " (Bugs)" on both
    const editor = editorOf(page)
    for (const name of ['Features', 'Bugs']) {
      const dialog = await open('none')
      await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
      const report = name === 'Features' ? 'Weekly report' : 'Weekly report (Bugs)'
      await expect(dialog.getByTestId('agx-mir-spec')).toContainText(report)
      await dialog.getByRole('button', { name: 'Create database and agent' }).click()
      await expect(editor).toBeVisible()
      await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue(name === 'Features' ? 'Weekly mirror' : 'Weekly mirror (Bugs)')
      await expect(editor.getByTestId('agx-editor-intro')).toContainText(`The database “${name}” and the page “${report}” are ready.`)
      expect(await titled(page, report)).toHaveLength(1)
      await editor.getByRole('switch', { name: 'Active' }).click()
      await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
      await expect(page.locator('.agx-dhead')).toBeVisible()
    }
    expect((await agentsOf(page)).map((a) => a.name).sort()).toEqual(['Weekly mirror', 'Weekly mirror (Bugs)'])
    expect(await titled(page, 'Weekly report')).toHaveLength(1)
  })
})

test.describe('Custom agents: the mirror setup shows what it makes; pages in the trash; the source live', () => {
  const editorOf = (page: Page) => page.locator('.agx-editor')
  const agentsOf = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents ?? {}))) as AnyState[])
  const titled = (page: Page, title: string) => wsEval(page, (s, t) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === t && !p.trashed).map((p) => p.id as string), title)
  const trashedOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id]?.trashed ?? 'gone'), ids)
  const pageIds = (page: Page) => wsEval(page, (s) => Object.keys(s.pages))
  const saveAgent = (page: Page, over: AnyState) =>
    wsEval(
      page,
      (s, a) => {
        const now = Date.now()
        s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
      },
      over,
    )
  const KEY = 'one.mirror.reports:local:local'

  /** #/agents → New agent → the profile's recipe `id`: its setup dialog. */
  async function openRecipe(page: Page, id: string) {
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-head').waitFor()
    const inline = page.locator(`.agx-start [data-recipe="tracker:${id}"]`)
    if (await inline.count()) await inline.click()
    else {
      await page.locator('.agx-head .btn--primary').click()
      await page.locator(`.agx-recipe-modal [data-recipe="tracker:${id}"]`).click()
    }
    const dialog = page.locator('.agx-mir')
    await expect(dialog).toBeVisible()
    return dialog
  }

  /** Setup → Create (`name`) → Esc → keep both: the database and the report page it made. */
  async function keepBoth(page: Page, name: string, de = false): Promise<{ db: string; report: string }> {
    const before = await pageIds(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
    await dialog.getByRole('button', { name: de ? 'Datenbank und Agent anlegen' : 'Create database and agent' }).click()
    await expect(editorOf(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: de ? 'Agent verwerfen, beide behalten' : 'Discard agent, keep both' }).click()
    await expect(editorOf(page)).toHaveCount(0)
    const made = await wsEval(page, (s, before) => (Object.values(s.pages) as AnyState[]).filter((p) => !before.includes(p.id) && !p.databaseId).map((p) => ({ id: p.id as string, kind: p.kind as string })), before)
    return { db: made.find((p) => p.kind === 'database')!.id, report: made.find((p) => p.kind === 'page')!.id }
  }

  /** The setup with `name` typed, then "Use …": the draft opens; returns the pages that were made by it. */
  async function useIt(page: Page, name: string, label = `Use “${name}”`): Promise<string[]> {
    const before = await pageIds(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: label }).click()
    await expect(editorOf(page)).toBeVisible()
    return (await pageIds(page)).filter((id) => !before.includes(id))
  }

  /** The draft's report page as the editor shows it. */
  const draftReport = (page: Page) => editorOf(page).getByRole('button', { name: /^(Report page|Berichtsseite)$/ })

  test('C1 while "Use" is offered the spec plate names the page it takes back — and the agent it makes', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const editor = editorOf(page)
    const eps = await keepBoth(page, 'Epsilon')
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Epsilon')
    const use = dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Use “Epsilon”' })
    await expect(use).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    // the plate: the kept page (never "… (2)", a page Use does not make) and the agent's name
    const spec = dialog.getByTestId('agx-mir-spec')
    await expect(spec).not.toContainText('Epsilon · Report (2)')
    await expect(spec).toContainText('Epsilon · Report')
    await expect(spec).toContainText('Mirror · Epsilon')
    const before = await pageIds(page)
    await use.click()
    await expect(editor).toBeVisible()
    expect(await pageIds(page)).toEqual(before)
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Mirror · Epsilon')
    await expect(draftReport(page)).toHaveText('Epsilon · Report')
    await expect(editor.getByTestId('agx-editor-intro')).toContainText('“Epsilon” and the page “Epsilon · Report” were there already.')
    void eps
  })

  test('C1 German UI, a database set up in English: the plate names what "Use" makes — in the database’s language, like the agent', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const editor = editorOf(page)
    const sig = await keepBoth(page, 'Sigma')
    // a digest reports into the kept page: "Use" makes a new one
    await saveAgent(page, { id: 'ag-digest', name: 'Digest', output: { pageId: sig.report, mode: 'append' } })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Sigma')
    const use = dialog.getByTestId('agx-mir-exists').getByRole('button', { name: '„Sigma“ verwenden' })
    await expect(use).toBeVisible()
    const spec = dialog.getByTestId('agx-mir-spec')
    await expect(spec).toContainText('Sigma · Report (2)')
    await expect(spec).toContainText('Mirror · Sigma')
    await expect(spec).not.toContainText('Sigma · Bericht')
    const made = await (async () => {
      const before = await pageIds(page)
      await use.click()
      await expect(editor).toBeVisible()
      return (await pageIds(page)).filter((id) => !before.includes(id))
    })()
    expect(made).toHaveLength(1)
    expect(await titled(page, 'Sigma · Report (2)')).toEqual(made)
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Mirror · Sigma')
  })

  test('C1 a report named like its own database keeps that name ("{db}" → “Delta”), and the plate said so', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', id: 'self', report: { name: '{db}' } }] }))
    const editor = editorOf(page)
    const dialog = await openRecipe(page, 'self')
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Delta')
    await expect(dialog.getByTestId('agx-mir-spec')).toContainText('Delta')
    await expect(dialog.getByTestId('agx-mir-spec')).not.toContainText('Delta (2)')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editor).toBeVisible()
    await expect(editor.getByTestId('agx-editor-intro')).toContainText('The database “Delta” and the page “Delta” are ready.')
    await expect(draftReport(page)).toHaveText('Delta')
    expect(await titled(page, 'Delta (2)')).toHaveLength(0)
    // the page and its database share the name; a second setup still never repeats another page's title
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === 'Delta' && !p.trashed).map((p) => p.kind).sort())).toEqual(['database', 'page'])
  })

  test('C2 a taken title gets the database’s name in parentheses, then a number: “Weekly report (Bugs)”, “Weekly mirror (Bugs)”, “… (Ops) (2)”', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', id: 'fixed', agent: { name: 'Weekly mirror' }, report: { name: 'Weekly report' } }] }))
    const editor = editorOf(page)
    const make = async (name: string, report: string, agent: string) => {
      const dialog = await openRecipe(page, 'fixed')
      await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
      await expect(dialog.getByTestId('agx-mir-spec')).toContainText(report)
      await expect(dialog.getByTestId('agx-mir-spec')).toContainText(agent)
      await dialog.getByRole('button', { name: 'Create database and agent' }).click()
      await expect(editor).toBeVisible()
      await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue(agent)
      await expect(editor.getByTestId('agx-editor-intro')).toContainText(`The database “${name}” and the page “${report}” are ready.`)
      await editor.getByRole('switch', { name: 'Active' }).click()
      await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
      await expect(page.locator('.agx-dhead')).toBeVisible()
    }
    await make('Features', 'Weekly report', 'Weekly mirror')
    await make('Bugs', 'Weekly report (Bugs)', 'Weekly mirror (Bugs)')
    // "(Ops)" taken by hand already: then the number
    await wsEval(page, (s) => s.createPage({ title: 'Weekly report (Ops)' }))
    await saveAgent(page, { id: 'ag-ops', name: 'Weekly mirror (Ops)' })
    await make('Ops', 'Weekly report (Ops) (2)', 'Weekly mirror (Ops) (2)')
    expect((await agentsOf(page)).map((a) => a.name).sort()).toEqual(['Weekly mirror', 'Weekly mirror (Bugs)', 'Weekly mirror (Ops)', 'Weekly mirror (Ops) (2)'])
  })

  test('C3 storage that reads but refuses writes (quota): what this tab remembered counts — keep → "Use" takes the kept page back each time', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    // an earlier setup's entry is stored, and every write of the memory fails
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ 'older-db': 'older-page' })), KEY)
    await page.evaluate(() => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith('one.mirror.')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return set.call(this, k, v)
      }
    })
    const { report } = await keepBoth(page, 'Tracker')
    for (let i = 0; i < 3; i++) {
      expect(await useIt(page, 'Tracker'), `cycle ${i + 1}: nothing new`).toEqual([])
      await expect(draftReport(page)).toHaveText('Tracker · Report')
      await page.keyboard.press('Escape')
      await expect(editorOf(page)).toHaveCount(0)
    }
    expect(await titled(page, 'Tracker · Report')).toEqual([report])
    expect(await titled(page, 'Tracker · Report (2)')).toEqual([])
  })

  test('C3 a kept page inside a writing agent’s scope through a page above it is never taken back; a read-only agent there, or one with "everything", leaves it free', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const anc = await keepBoth(page, 'Anc')
    const parent = await wsEval(page, (s) => s.createPage({ title: 'Team notes' }) as string)
    await wsEval(page, (s, x) => s.movePage(x.r, x.p), { r: anc.report, p: parent })
    await saveAgent(page, { id: 'ag-notes', name: 'Notes keeper', scope: { everything: false, pages: [parent], databases: [] }, write: 'stage' })
    await saveAgent(page, { id: 'ag-all', name: 'Everything', scope: { everything: true, pages: [], databases: [] }, write: 'apply' })
    // "Notes keeper" may change everything below "Team notes", the kept page too: a new page
    const made = await useIt(page, 'Anc')
    expect(made).toHaveLength(1)
    await expect(editorOf(page).getByTestId('agx-editor-intro')).toContainText('“Anc” was there already; the page “Anc · Report (2)” is new.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Discard, page to the trash' }).click()
    await expect(editorOf(page)).toHaveCount(0)
    // read only: it may read below "Team notes", never change it — the kept page comes back
    await wsEval(page, (s) => s.upsertAgent({ ...s.agents['ag-notes'], write: 'none' }))
    expect(await useIt(page, 'Anc')).toEqual([])
    await expect(draftReport(page)).toHaveText('Anc · Report')
    expect(await trashedOf(page, [anc.report])).toEqual([false])
  })

  test('C3 several pages per database: a deleted agent’s report comes back once the page made in its place is in the trash', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const { report } = await keepBoth(page, 'Tracker')
    await saveAgent(page, { id: 'ag-digest', name: 'Digest', output: { pageId: report, mode: 'append' } })
    // the digest uses the kept page: "Use" makes another one, which goes to the trash again
    const made = await useIt(page, 'Tracker')
    expect(made).toHaveLength(1)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Discard, page to the trash' }).click()
    await expect(editorOf(page)).toHaveCount(0)
    await wsEval(page, (s) => s.deleteAgent('ag-digest'))
    // the digest is gone: its report is free again and comes back — no third page
    expect(await useIt(page, 'Tracker')).toEqual([])
    await expect(draftReport(page)).toHaveText('Tracker · Report')
    await expect(editorOf(page).getByTestId('agx-editor-intro')).toContainText('“Tracker” and the page “Tracker · Report” were there already.')
    expect(await titled(page, 'Tracker · Report (2)')).toEqual([])
    const mem = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY)
    expect(Object.values(mem as Record<string, string[]>)[0]).toEqual([report, made[0]])
  })

  test('C4 a marked mirror whose scope is "everything" still reaches its database here: the setup offers that agent, never "Use" (no second mirror)', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const editor = editorOf(page)
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)
    // the scope chip taken out, "Everything" chosen: still marked for the database, still reaching it
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], scope: { everything: true, pages: [], databases: [] } }), agent.id)
    const again = await openSetup(page)
    await again.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    const exists = again.getByTestId('agx-mir-exists')
    await expect(exists.getByRole('button', { name: 'Open “Mirror · Tracker”' })).toBeVisible()
    await expect(exists.getByRole('button', { name: 'Use “Tracker”' })).toHaveCount(0)
    await expect(again.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
  })

  test('C5 a database of that name in the trash that a saved agent mirrors into: the setup says so (German), “Wiederherstellen” brings it back, Create waits', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    let dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    const editor = editorOf(page)
    await editor.getByRole('switch', { name: 'Aktiv' }).click()
    await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)
    const db = agent.scope.databases[0]
    await wsEval(page, (s, id) => s.trashPage(id), db)
    const count = await pageIds(page)
    dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toContainText(`„Tracker“ liegt im Papierkorb, und der Agent „${agent.name}“ spiegelt hinein. Stell sie wieder her oder gib der neuen einen anderen Namen.`)
    await expect(dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })).toBeDisabled()
    await expect(exists.getByRole('button', { name: `„${agent.name}“ öffnen` })).toBeVisible()
    await exists.getByRole('button', { name: 'Wiederherstellen' }).click()
    expect(await trashedOf(page, [db])).toEqual([false])
    // back: the agent mirrors into it — open it, never a second database
    await expect(exists.getByRole('button', { name: `„${agent.name}“ öffnen` })).toBeVisible()
    await expect(exists.getByRole('button', { name: 'Wiederherstellen' })).toHaveCount(0)
    expect(await pageIds(page)).toEqual(count)
  })

  test('C7 the source list follows this device’s settings: a server switched off drops out; the picked one stays marked, the field says so and Create waits', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const dialog = await openSetup(page)
    const servers = dialog.locator('.agx-mir__server')
    await expect(servers).toHaveCount(2)
    const create = dialog.getByRole('button', { name: 'Create database and agent' })
    const setEnabled = (name: string, enabled: boolean) => wsEval(page, (s, x) => s.updateSettings({ mcpServers: s.settings.mcpServers.map((m: AnyState) => (m.name === x.name ? { ...m, enabled: x.enabled } : m)) }), { name, enabled })
    // "wiki" (not picked) switched off: it drops out
    await setEnabled('wiki', false)
    await expect(servers).toHaveCount(1)
    await expect(dialog.getByRole('radio', { name: /WIKI/ })).toHaveCount(0)
    // the picked "tracker" switched off: marked, the field says so, Create waits
    await setEnabled('tracker', false)
    await expect(servers.filter({ hasText: 'TRACKER' })).toContainText('Switched off')
    await expect(dialog.getByTestId('agx-mir-server-err')).toHaveText('TRACKER was switched off in Settings. Pick another source, or switch it on again.')
    await expect(create).toBeDisabled()
    // "wiki" on again and picked: Create makes the mirror with it
    await setEnabled('wiki', true)
    await dialog.getByRole('radio', { name: /WIKI/ }).check()
    await expect(dialog.getByTestId('agx-mir-server-err')).toHaveCount(0)
    await expect(create).toBeEnabled()
    await create.click()
    await expect(editorOf(page)).toBeVisible()
    await expect(editorOf(page).getByRole('checkbox', { name: 'WIKI' })).toBeChecked()
  })

  test('C8 the discard prompt in plain sentences (English and German)', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(editorOf(page)).toBeVisible()
    await page.keyboard.press('Escape')
    const body = page.getByTestId('agx-discard-body')
    await expect(body).toHaveText(
      'The agent is not saved yet. The database “Tracker” and the page “Tracker · Report” were just created. If you keep them, the recipe offers them again when you set it up with the same name. Or move both to the trash.',
    )
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(body).toHaveText(
      'Der Agent ist noch nicht gespeichert. Die Datenbank „Tracker“ und die Seite „Tracker · Report“ wurden gerade angelegt. Behältst du sie, bietet das Rezept sie dir wieder an, wenn du es mit demselben Namen einrichtest. Oder leg beide in den Papierkorb.',
    )
    expect(await body.textContent()).not.toMatch(/—.*—/)
  })

  for (const [label, size] of [
    ['1440', { width: 1440, height: 900 }],
    ['390', { width: 390, height: 844 }],
  ] as const) {
    test(`C9 ${label}: the recipe card names the whole profile — a long name wraps, never cut`, async ({ page }) => {
      await page.setViewportSize(size)
      await openApp(page)
      await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
      await addProfile(page, trackerProfile({ name: 'Atlas · CNSX-Handoff', match: { host: '*.example.com' } }))
      await page.evaluate(() => (window.location.hash = '#/agents'))
      const code = page.locator(`.agx-start ${RECIPE} .agx-recipe__code`)
      await expect(code).toBeVisible()
      await expect(code).toHaveText(/Atlas · CNSX-Handoff/i)
      // nothing in it is cut: every part shows its whole text
      const cut = await code.evaluate((el) => [el, ...el.querySelectorAll('*')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.className))
      expect(cut).toEqual([])
      const box = (await code.boundingBox())!
      const card = (await page.locator(`.agx-start ${RECIPE}`).boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 1)
    })
  }
})

test.describe('Custom agents: pages an agent works with in the trash or gone', () => {
  const editorOf = (page: Page) => page.locator('.agx-editor')
  const agentsOf = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents ?? {}))) as AnyState[])
  const saveAgent = (page: Page, over: AnyState) =>
    wsEval(
      page,
      (s, a) => {
        const now = Date.now()
        s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
      },
      over,
    )

  test('C5 the agent page names each page in the trash or gone (Restore); a run does not start then — an error with the reason, never "done", a toast says why from elsewhere', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockClaude(context)
    const db = await wsEval(page, (s) => s.createDatabase({ title: 'Tracker' }) as string)
    const archive = await wsEval(page, (s) => s.createPage({ title: 'Archive' }) as string)
    const notes = await wsEval(page, (s, parentId) => s.createPage({ title: 'Agent notes', parentId }) as string, archive)
    await saveAgent(page, { id: 'ag-mirror', name: 'Tracker mirror', scope: { everything: false, pages: [], databases: [db] }, write: 'stage', output: { pageId: notes, mode: 'append' }, enabled: true })
    await flush(page)
    await wsEval(page, (s, id) => s.trashPage(id), db)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-mirror'))
    const lost = page.getByTestId('agx-lost')
    await expect(lost).toContainText('Pages this agent works with are in the trash or gone. Its runs do not start until you restore them or change the agent.')
    await expect(lost).toContainText('“Tracker” is in the trash.')
    await expect(lost.getByRole('button', { name: 'Restore “Tracker”' })).toBeVisible()

    // "Run now" on its page: an error that says why, Claude is never asked, no toast over the page
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'error')
    await expect(run.locator('.agx-run__err')).toContainText('Not started: nothing in “May use” can be used. “Tracker” is in the trash.')
    await expect(run.locator('.agx-run__status')).toHaveText('Error')
    await page.waitForTimeout(400)
    await expect(page.locator('.toast')).toHaveCount(0)
    expect(bodies).toHaveLength(0)

    // from the list: the toast says why
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.getByRole('button', { name: 'Run Tracker mirror now' }).click()
    await expect(page.locator('.toast').filter({ hasText: 'Tracker mirror: the run did not start. “Tracker” is in the trash.' })).toBeVisible()
    await expect(page.locator('.agx-card').filter({ hasText: 'Tracker mirror' }).getByTestId('agx-state')).toContainText('Fault')
    expect(bodies).toHaveLength(0)

    // Restore on the page; then the report page's parent goes to the trash: named, with Restore for "Archive"
    await page.evaluate(() => (window.location.hash = '#/agents/ag-mirror'))
    await lost.getByRole('button', { name: 'Restore “Tracker”' }).click()
    await expect(lost).toHaveCount(0)
    await wsEval(page, (s, id) => s.trashPage(id), archive)
    await expect(lost).toContainText('“Agent notes” is in “Archive”, and “Archive” is in the trash.')
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run')).toHaveCount(3)
    await expect(page.locator('.agx-run').first().locator('.agx-run__err')).toContainText('Not started: the report page is in the trash or gone. “Agent notes” is in “Archive”, and “Archive” is in the trash.')
    await lost.getByRole('button', { name: 'Restore “Archive”' }).click()
    await expect(lost).toHaveCount(0)
    // back: it runs
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run')).toHaveCount(4)
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', /ok|staged/, { timeout: 20_000 })
    expect(bodies.length).toBeGreaterThan(0)

    // deleted for good: named, nothing to restore
    await wsEval(page, (s, id) => s.deletePagePermanently(id), db)
    await expect(lost).toContainText('A database that was deleted for good.')
    await expect(lost.getByRole('button', { name: /Restore/ })).toHaveCount(0)
  })

  test('C6 the editor names the page in the trash that holds a page below it, and refuses a scope entry deleted for good (named, with its remove key)', async ({ page }) => {
    await openApp(page)
    const tracker = await wsEval(page, (s) => s.createDatabase({ title: 'Tracker' }) as string)
    const archive = await wsEval(page, (s) => s.createPage({ title: 'Archive' }) as string)
    const notes = await wsEval(page, (s, parentId) => s.createPage({ title: 'Agent notes', parentId }) as string, archive)
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-start [data-recipe="blank"]').click()
    const editor = editorOf(page)
    await editor.getByRole('textbox', { name: 'Name' }).fill('Watcher')
    await editor.getByLabel('Instructions').fill('Report on the tracker.')
    await editor.getByRole('radio', { name: 'Chosen pages' }).click()
    await editor.getByRole('button', { name: 'Add page or database' }).click()
    await page.getByRole('menuitem', { name: /^Tracker/ }).click()
    await editor.getByRole('button', { name: 'Add page or database' }).click()
    await page.getByRole('menuitem', { name: /^Agent notes/ }).click()
    await editor.getByRole('button', { name: 'Report page' }).click()
    await page.getByRole('menuitem', { name: 'Agent notes' }).click()
    const create = editor.getByRole('button', { name: 'Create agent', exact: true })

    // only below a page in the trash: that page is named (the trash lists only it)
    await wsEval(page, (s, id) => s.trashPage(id), archive)
    await create.click()
    await expect(editor.getByText('“Agent notes” is in “Archive”, and “Archive” is in the trash — remove it from “May use” or restore “Archive”.')).toBeVisible()
    await expect(editor.getByText('The report page “Agent notes” is in “Archive”, and “Archive” is in the trash — choose another one or restore “Archive”.')).toBeVisible()
    await expect(editor.locator('.agx-chipx[data-trashed]')).toContainText('In “Archive”, in the trash')
    expect(await agentsOf(page)).toHaveLength(0)
    await wsEval(page, (s, id) => s.restorePage(id), archive)

    // a scope database deleted for good while the editor is open: named by its title, refused, the chip takes it out
    await wsEval(page, (s, id) => s.trashPage(id), tracker)
    await wsEval(page, (s, id) => s.deletePagePermanently(id), tracker)
    await create.click()
    await expect(editor.getByText('“Tracker” does not exist any more — remove it from “May use”.')).toBeVisible()
    const chip = editor.locator('.agx-chipx[data-gone]')
    await expect(chip).toContainText('Tracker')
    await expect(chip).toContainText('Deleted')
    expect(await agentsOf(page)).toHaveLength(0)
    await chip.getByRole('button', { name: 'Remove Tracker' }).click()
    await create.click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const [agent] = await agentsOf(page)
    expect(agent.scope).toEqual({ everything: false, pages: [notes], databases: [] })
  })
})
