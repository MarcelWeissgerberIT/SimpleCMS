/**
 * Review 7 of MCP T-a on the local bridge (MCP plan § 3.2 / § 3.3), driven like Claude Code drives it (the built
 * bridge through the MCP SDK's stdio client, its own port). Each test names the rule it guards:
 *  - One's own databases: a two-way relation value never writes their rows (create_row, update_row, upsert — refused as
 *    every two-way value since Weg 4, also a pair that turned into one while the card waited); a structure tool on a
 *    database moved into one while the card waited writes nothing; one_delete_property clears no rollup in a locked
 *    database or in One's own one;
 *  - building blocks: a select bound to a shared list takes no option of its own from one_move_row; one_run_script's
 *    dry run names the option it would add to the list;
 *  - Undo vs "changed since": the AI terminal's Undo never deletes for good a row the person filled in; a property the
 *    person made a form question (or a sub-items pair) refuses the MCP call's Undo whole (Weg 4 D2);
 *  - one rule and one code on both sides: colours, duplicates, an unknown property, the lock, a "Name" property.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Alpha).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47379

let client: Client
let stderr = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(BRIDGE), 'public/mcp/one-mcp.mjs (npm run build:mcp)').toBe(true)
  const transport = new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '8000' }, stderr: 'pipe' })
  transport.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  client = new Client({ name: 'claude-code', version: '2.0.0' })
  await client.connect(transport)
  await expect.poll(() => stderr).toContain(`ws://127.0.0.1:${PORT}`)
})

test.afterAll(async () => {
  await client?.close()
})

const text = (r: ToolResult) => (r.content ?? []).map((c) => c.text ?? '').join('')
const json = (r: ToolResult) => {
  expect(r.isError, text(r)).toBeFalsy()
  return JSON.parse(text(r))
}
const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<ToolResult>
const refused = async (name: string, args: Record<string, unknown>, pattern: RegExp) => {
  const r = await call(name, args)
  expect(r.isError, text(r)).toBe(true)
  expect(text(r)).toMatch(pattern)
  return text(r)
}

async function openAgentsTab(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function connect(page: Page, mode: 'Ask first' | 'Apply directly') {
  await openAgentsTab(page)
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Connected')
  let list: AnyState = { workspaces: [] }
  await expect
    .poll(async () => {
      list = json(await call('one_list_workspaces'))
      return list.workspaces.length
    })
    .toBe(1)
  if (list.lastUsed && list.lastUsed.id !== list.workspaces[0].id) json(await call('one_list_databases', { workspace: list.workspaces[0].id }))
  await page.getByRole('radio', { name: mode }).click()
  await closeSettings(page)
}

async function setMode(page: Page, mode: 'Ask first' | 'Apply directly') {
  await openAgentsTab(page)
  await page.getByRole('radio', { name: mode }).click()
  await closeSettings(page)
}

/** The newest Undo of a tool, refused whole (Weg 4 D2 — all or nothing): the toast names what changed; nothing is written. */
async function undoRefused(page: Page, tool: string, what: string) {
  const before = await wsEval(page, (s) => JSON.stringify([s.pages, s.databases]))
  await openAgentsTab(page)
  const keys = page.locator('.mcp-log__row').getByRole('button', { name: `Undo ${tool}` })
  const n = await keys.count()
  await keys.first().click()
  await expect(keys).toHaveCount(n - 1)
  // the parts it names (any order around `what`): "… changed since (title, values). Nothing was put back."
  await expect(page.locator('.toast', { hasText: 'Not undone:' }).last()).toContainText(new RegExp(`changed since \\([^)]*${what}[^)]*\\)\\. Nothing was put back\\.`))
  await closeSettings(page)
  expect(await wsEval(page, (s) => JSON.stringify([s.pages, s.databases])), 'a refused Undo writes nothing').toBe(before)
}

/** Ask first: the card shows, `meanwhile` runs while it waits, then Approve; the call's answer. */
async function approveAfter(page: Page, name: string, args: Record<string, unknown>, meanwhile: () => Promise<unknown>) {
  const card = page.getByRole('alertdialog')
  const pending = call(name, args)
  await expect(card).toBeVisible()
  await meanwhile()
  await flush(page)
  await card.getByRole('button', { name: /Approve/ }).click()
  const r = await pending
  await expect(card).toHaveCount(0)
  return r
}

/** Ask first: the card's text (whitespace folded), then Escape — nothing is written. */
async function cardText(page: Page, name: string, args: Record<string, unknown>) {
  const card = page.getByRole('alertdialog')
  const pending = call(name, args)
  await expect(card).toBeVisible()
  const body = (await card.innerText()).replace(/\s+/g, ' ')
  await page.keyboard.press('Escape')
  await pending
  await expect(card).toHaveCount(0)
  return body
}

/* ------------------------------------------------------------------ One's own databases */

test("a two-way relation value never writes One's own database's rows: update_row, create_row, upsert refused (two-way relations stay out of MCP — Weg 4), also when the pair turned into one while the card waited", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const mem = s.createDatabase({ title: 'Memory', properties: [{ id: 'm-title', name: 'Name', type: 'title' }] })
    s.updateDatabase(mem, { system: 'memory' } as never)
    const coding = s.createDatabase({ title: 'Coding', properties: [{ id: 'cd-title', name: 'Name', type: 'title' }] })
    s.updateDatabase(coding, { system: 'coding' } as never)
    const archive = s.createDatabase({ title: 'Archive', properties: [{ id: 'ar-title', name: 'Name', type: 'title' }] })
    const deals = s.createDatabase({ title: 'Deals', properties: [{ id: 'd-title', name: 'Name', type: 'title' }, { id: 'd-key', name: 'Ref', type: 'text' }] })
    // two-way pairs the person made in One (the app allows them): into the memory, the Coding pipeline and an archive
    s.addProperty(deals, { id: 'd-rel', name: 'Kontext', type: 'relation', relationDatabaseId: mem } as never)
    s.addProperty(mem, { id: 'd-rel.2way', name: 'Deals', type: 'relation', relationDatabaseId: deals } as never)
    s.addProperty(deals, { id: 'd-code', name: 'Coding task', type: 'relation', relationDatabaseId: coding } as never)
    s.addProperty(coding, { id: 'd-code.2way', name: 'Deals', type: 'relation', relationDatabaseId: deals } as never)
    // a one-way relation into an ordinary archive: it becomes a pair (and the archive One's memory) while the card waits
    s.addProperty(deals, { id: 'd-arch', name: 'Archived as', type: 'relation', relationDatabaseId: archive } as never)
    const m1 = s.createRow(mem, { title: 'Prefers short answers', properties: {} })
    const task = s.createRow(coding, { title: 'Ship the footer', properties: {} })
    const box = s.createRow(archive, { title: 'Box 7', properties: {} })
    const deal = s.createRow(deals, { title: 'Deal 1', properties: { 'd-key': 'D-1' } })
    return { mem, coding, archive, deals, m1, task, box, deal }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const sides = () =>
    wsEval(page, (s, a: { m1: string; task: string; box: string }) => JSON.stringify([s.pages[a.m1].properties['d-rel.2way'] ?? null, s.pages[a.task].properties['d-code.2way'] ?? null, s.pages[a.box].properties['d-arch.2way'] ?? null]), ids)
  const untouched = await sides()
  const deals = () => wsEval(page, (s, db: string) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, ids.deals)
  await refused('one_update_row', { id: ids.deal, properties: { Kontext: ['Prefers short answers'] } }, /^refused_type: properties\.Kontext: "Kontext" is two-way/)
  await refused('one_update_row', { id: ids.deal, properties: { 'Coding task': ['Ship the footer'] } }, /^refused_type: properties\.Coding task: "Coding task" is two-way/)
  await refused('one_create_row', { databaseId: ids.deals, title: 'Deal 2', properties: { Kontext: ['Prefers short answers'] } }, /^refused_type: properties\.Kontext: /)
  await refused('one_create_row', { databaseId: ids.deals, rows: [{ title: 'Deal 3' }, { title: 'Deal 4', properties: { Kontext: ['Prefers short answers'] } }] }, /^refused_type: rows\[1\]\.properties\.Kontext: /)
  await refused('one_upsert_rows', { databaseId: ids.deals, keyProperty: 'Ref', rows: [{ key: 'D-1', properties: { 'Coding task': ['Ship the footer'] } }] }, /^bad_argument: rows: 1 of 1 rows do not fit: rows\[0\] \(key "D-1"\): refused_type: properties\.Coding task: /)
  expect(await sides()).toBe(untouched)
  expect(await deals()).toBe(1)
  // the archive is an ordinary database while the card waits — it becomes One's memory before the Approve
  await setMode(page, 'Ask first')
  const late = await approveAfter(page, 'one_update_row', { id: ids.deal, properties: { 'Archived as': ['Box 7'] } }, () =>
    wsEval(page, (s, a: { archive: string; deals: string }) => {
      s.addProperty(a.archive, { id: 'd-arch.2way', name: 'Deals', type: 'relation', relationDatabaseId: a.deals } as never)
      s.updateDatabase(a.archive, { system: 'memory' } as never)
    }, ids),
  )
  expect(late.isError, text(late)).toBe(true)
  expect(text(late)).toMatch(/^refused_type: properties\.Archived as: "Archived as" is two-way/)
  expect(await sides()).toBe(untouched)
  expect(await wsEval(page, (s, d: string) => s.pages[d].properties['d-arch'] ?? null, ids.deal)).toBeNull()
})

test("structure tools on a database moved below a row of One's own database while the card waited write nothing (update_database, create_view, update_property)", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const mem = s.createDatabase({ title: 'Memory', properties: [{ id: 'm-title', name: 'Name', type: 'title' }] })
    s.updateDatabase(mem, { system: 'memory' } as never)
    const memRow = s.createRow(mem, { title: 'A memory', properties: {} })
    const d = s.createDatabase({ title: 'Notizen', properties: [{ id: 'n-title', name: 'Name', type: 'title' }, { id: 'n-text', name: 'Kommentar', type: 'text' }] })
    return { mem, memRow, d }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const into = () => wsEval(page, (s, a: { d: string; memRow: string }) => s.updatePage(a.d, { parentId: a.memRow }), ids)
  const back = async () => {
    await wsEval(page, (s, d: string) => s.updatePage(d, { parentId: null }), ids.d)
    await flush(page)
  }
  const r = await approveAfter(page, 'one_update_database', { id: ids.d, title: 'Umbenannt' }, into)
  expect(text(r)).toMatch(/^system_database: /)
  await back()
  const v = await approveAfter(page, 'one_create_view', { databaseId: ids.d, type: 'list', name: 'Liste' }, into)
  expect(text(v)).toMatch(/^system_database: /)
  await back()
  const p = await approveAfter(page, 'one_update_property', { databaseId: ids.d, property: 'Kommentar', name: 'Notiz' }, into)
  expect(text(p)).toMatch(/^system_database: /)
  const now = await wsEval(page, (s, d: string) => ({ title: s.pages[d].title, views: (s.databases[d].views as AnyState[]).map((x) => x.name), props: (s.databases[d].properties as AnyState[]).map((x) => x.name) }), ids.d)
  expect(now.title).toBe('Notizen')
  expect(now.views).not.toContain('Liste')
  expect(now.props).toContain('Kommentar')
})

test("one_delete_property clears no rollup in a locked database or in One's own one; a template's is left alone; another database's rollup is named on the card", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const deals = s.createDatabase({ title: 'Deals', properties: [{ id: 'a-title', name: 'Name', type: 'title' }, { id: 'a-amt', name: 'Amount', type: 'number' }, { id: 'a-note', name: 'Note', type: 'number' }, { id: 'a-pages', name: 'Pages', type: 'number' }] })
    const mk = (title: string, pre: string, target: string) =>
      s.createDatabase({
        title,
        properties: [
          { id: `${pre}-title`, name: 'Name', type: 'title' },
          { id: `${pre}-rel`, name: 'Deals', type: 'relation', relationDatabaseId: deals },
          { id: `${pre}-sum`, name: 'Total', type: 'rollup', rollup: { relationPropertyId: `${pre}-rel`, targetPropertyId: target, fn: 'sum' } },
        ] as never,
      })
    const locked = mk('Reports', 'r', 'a-amt')
    s.updateDatabase(locked, { locked: true })
    const mem = mk('Memory', 'm', 'a-note')
    s.updateDatabase(mem, { system: 'memory' } as never)
    const tpl = s.createPage({ title: 'Report template' })
    s.updatePage(tpl, { hidden: true, template: { name: 'Report template' } } as never)
    const inTpl = mk('Template report', 't', 'a-pages')
    s.updatePage(inTpl, { parentId: tpl })
    const plain = mk('Quarterly', 'q', 'a-pages')
    return { deals, locked, mem, inTpl, plain }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const target = (db: string, id: string) => wsEval(page, (s, a: { db: string; id: string }) => ((s.databases[a.db].properties as AnyState[]).find((p) => p.id === a.id)?.rollup?.targetPropertyId as string) ?? null, { db, id })
  await refused('one_delete_property', { databaseId: ids.deals, property: 'Amount' }, /^locked: property: "Reports" is locked in One: its rollup "Total" rolls up "Amount"/)
  await refused('one_delete_property', { databaseId: ids.deals, property: 'Note' }, /^system_database: property: "Memory" is One's memory database/)
  expect([await target(ids.locked, 'r-sum'), await target(ids.mem, 'm-sum')]).toEqual(['a-amt', 'a-note'])
  // a rollup in another (ordinary) database is cleared with it — the card says so; a template's is not looked at
  await setMode(page, 'Ask first')
  const body = await cardText(page, 'one_delete_property', { databaseId: ids.deals, property: 'Pages' })
  expect(body).toContain('Also clears the rollup “Total” in Quarterly')
  expect(body).not.toContain('Template report')
  await setMode(page, 'Apply directly')
  json(await call('one_delete_property', { databaseId: ids.deals, property: 'Pages' }))
  expect([await target(ids.plain, 'q-sum'), await target(ids.inTpl, 't-sum')]).toEqual(['', 'a-pages'])
})

/* ------------------------------------------------------------------ shared lists */

test('a select bound to a shared list takes no option of its own from one_move_row (refused); one_run_script only dry-runs and names the option it would add to the list — nothing moved or written', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    s.upsertList({ id: 'list-stages', name: 'Stages', items: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], createdAt: 1, updatedAt: 1 } as never)
    const from = s.createDatabase({ title: 'Inbox leads', properties: [{ id: 'f-title', name: 'Name', type: 'title' }, { id: 'f-stage', name: 'Stage', type: 'select', options: [{ id: 'o-x', name: 'Omega', color: 'red' }] } as never] })
    const to = s.createDatabase({ title: 'Pipeline', properties: [{ id: 'p-title', name: 'Name', type: 'title' }, { id: 'p-stage', name: 'Stage', type: 'select', options: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], listId: 'list-stages' } as never] })
    const lead = s.createRow(from, { title: 'Lead Tessera', properties: { 'f-stage': 'o-x' } })
    const row = s.createRow(to, { title: 'Lead 1', properties: { 'p-stage': 'o-a' } })
    const now = Date.now()
    s.upsertScript({ id: 'sc-omega', name: 'Set Omega', code: 'db("Pipeline").first.set(Stage: "Omega")\n', kind: 'script', createdAt: now, updatedAt: now })
    return { from, to, lead, row }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const opts = () => wsEval(page, (s, db: string) => ((s.databases[db].properties[1].options ?? []) as AnyState[]).map((o) => o.name), ids.to)
  // nothing to approve: both are refused while planning (no card)
  await refused('one_move_row', { id: ids.lead, databaseId: ids.to }, /^bad_argument: [\s\S]*"Stage": unknown option "Omega" — this property takes its options from the shared list "Stages"/)
  // the person's own run puts "Omega" into the list (as the option picker does); over MCP it is a dry run that says so
  const dry = json(await call('one_run_script', { script: 'Set Omega' }))
  expect(dry).toMatchObject({ ran: false, status: 'ok' })
  expect(dry.changes[0].properties[0]).toMatchObject({ name: 'Stage', after: 'Omega', addsToList: { list: 'Stages', options: ['Omega'] } })
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(await opts()).toEqual(['Alpha', 'Beta'])
  expect(await wsEval(page, (s, a: { lead: string; row: string }) => [s.pages[a.lead].databaseId, s.pages[a.row].properties['p-stage']], ids)).toEqual([ids.from, 'o-a'])
})

/* ------------------------------------------------------------------ Undo vs changed since */

let msgSeq = 0
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', { message: { id: `msg_f7_${++msgSeq}`, type: 'message', role: 'assistant', model: 'e2e-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
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
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 90 } })
  body += ev('message_stop', {})
  return body
}

test("the AI terminal's Undo never deletes for good a row the person filled in since (a value, a comment thread): it goes to the trash", async ({ page, context }) => {
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const projects = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Projects' && !p.trashed)!.id as string)
  let n = 0
  await context.route('https://api.anthropic.com/**', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    n += 1
    const sse = n === 1 ? sseMessage([{ type: 'tool_use', id: 'toolu_f7', name: 'create_row', input: { database_id: projects, title: 'NL-1430 Kick-off Tessera' } }]) : sseMessage([{ type: 'text', text: 'Staged one row.' }])
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse })
  })
  await page.keyboard.press(`${MOD}+j`)
  const term = page.getByRole('region', { name: 'AI terminal' })
  await expect(term).toBeVisible()
  const field = term.getByRole('textbox', { name: 'Task for the agent' })
  await field.fill('Add the kick-off row')
  await field.press('Enter')
  await expect(term.locator('.term-head__status')).toContainText('Done', { timeout: 20_000 })
  await field.fill('/apply')
  await field.press('Enter')
  const toast = page.locator('.toast', { hasText: '1 change applied' })
  await expect(toast).toBeVisible()
  const row = await wsEval(page, (s) => ((Object.values(s.pages) as AnyState[]).find((p) => p.title === 'NL-1430 Kick-off Tessera')?.id as string) ?? '')
  expect(row).toBeTruthy()
  // the person fills in a field (not the text or title) and adds a comment thread
  await wsEval(page, (s, a: { row: string; db: string }) => {
    const prop = (s.databases[a.db].properties as AnyState[]).find((p) => p.type === 'select' && p.options?.length)
    s.setRowProperty(a.row, prop.id, prop.options[0].id)
    s.addComment(a.row, { quote: '', body: 'Mara Lind: budget agreed' })
  }, { row, db: projects })
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.toast', { hasText: /^Undone/ })).toBeVisible()
  const after = await wsEval(page, (s, id: string) => (s.pages[id] ? { trashed: !!s.pages[id].trashed, comments: (s.pages[id].comments ?? []).length } : 'deleted for good'), row)
  expect(after).toEqual({ trashed: true, comments: 1 })
})

test('one_create_property Undo is refused whole once the person made the property a form question (or a sub-items pair) — Weg 4', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => ({ db: s.createDatabase({ title: 'Anfragen', properties: [{ id: 'a-title', name: 'Name', type: 'title' }] }) }))
  await flush(page)
  await connect(page, 'Apply directly')
  const made = json(await call('one_create_property', { databaseId: ids.db, name: 'Budget', type: 'number' }))
  const propId = made.property.id as string
  await wsEval(page, (s, a: { db: string; prop: string }) => {
    const vid = s.addView(a.db, { type: 'form', name: 'Form' })
    s.updateView(a.db, vid, { form: { title: 'Anfrage', questions: { [a.prop]: { required: true, help: 'Your budget in EUR' } } } })
  }, { db: ids.db, prop: propId })
  await flush(page)
  await undoRefused(page, 'one_create_property', 'views')
  expect(await wsEval(page, (s, a: { db: string; prop: string }) => s.databases[a.db].properties.some((p: AnyState) => p.id === a.prop), { db: ids.db, prop: propId })).toBe(true)
  // a self-relation the person turned into a sub-items pair since (its other side added in One): refused whole too
  const pair = json(await call('one_create_property', { databaseId: ids.db, name: 'Parent', type: 'relation', relation: { databaseId: ids.db } }))
  const parentId = pair.property.id as string
  await wsEval(page, (s, a: { db: string; p: string }) => {
    s.addProperty(a.db, { id: `${a.p}.2way`, name: 'Children', type: 'relation', relationDatabaseId: a.db } as never)
    s.updateDatabase(a.db, { subItems: { enabled: true, parentPropertyId: a.p, childPropertyId: `${a.p}.2way` } } as never)
  }, { db: ids.db, p: parentId })
  await flush(page)
  await undoRefused(page, 'one_create_property', 'properties, settings')
  expect(await wsEval(page, (s, a: { db: string; p: string }) => (s.databases[a.db].properties as AnyState[]).filter((x) => x.id === a.p || x.id === `${a.p}.2way`).length, { db: ids.db, p: parentId })).toBe(2)
})

/* ------------------------------------------------------------------ one rule, one code */

test('options, codes and the title name as on the team server: colours lower-cased, an unknown colour / a duplicate refused, unknown property not_found, the lock rejected, a "Name" property refused', async ({ page }) => {
  await openApp(page)
  const db = await wsEval(page, (s) => s.createDatabase({ title: 'Opt probe', properties: [{ id: 'o-title', name: 'Name', type: 'title' }] }))
  await flush(page)
  await connect(page, 'Apply directly')
  const made = json(await call('one_create_property', { databaseId: db, name: 'Prio', type: 'select', options: [{ name: 'High', color: 'Red' }] }))
  expect(made.property.options[0].color).toBe('red')
  await refused('one_create_property', { databaseId: db, name: 'Prio2', type: 'select', options: ['A', 'a'] }, /^bad_argument: options\[1\]\.name: option "a" is listed twice/)
  await refused('one_create_property', { databaseId: db, name: 'Prio3', type: 'select', options: [{ name: 'X', color: 'teal' }] }, /^bad_argument: options\[0\]\.color: "teal" is not a colour/)
  await refused('one_update_property', { databaseId: db, property: 'Prio', options: { add: ['Low', 'low'] } }, /^bad_argument: options\.add\[1\]\.name: option "low" is listed twice/)
  await refused('one_delete_property', { databaseId: db, property: 'Budgte' }, /^not_found: property: "Opt probe" has no property "Budgte"/)
  await refused('one_update_database', { id: db, locked: true }, /^rejected: locked: /)
  await refused('one_create_database', { title: 'People', properties: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'email' }] }, /^bad_argument: properties\[0\]\.name: "Name" is the name of the title property/)
  const long = 'Ein sehr langer Optionsname, der weit über sechzig Zeichen hinausgeht und gekürzt wird'
  const renamed = json(await call('one_update_property', { databaseId: db, property: 'Prio', options: { update: [{ name: 'High', newName: long }] } }))
  expect(renamed.property.options[0].name).toBe(long.slice(0, 60).trim())
})
