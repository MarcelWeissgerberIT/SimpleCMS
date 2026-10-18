/**
 * Review 7 of MCP T-a on the local bridge (MCP plan § 3.2 / § 3.3), driven like Claude Code drives it (the built
 * bridge through the MCP SDK's stdio client, its own port). Each test names the rule it guards:
 *  - One's own databases: a two-way relation value never writes their rows (create_row, update_row, upsert — also a pair
 *    that turned into one while the card waited); a structure tool on a database moved into one while the card waited
 *    writes nothing; one_delete_property clears no rollup in a locked database or in One's own one;
 *  - building blocks: a select bound to a shared list takes no option of its own from one_move_row or one_run_script;
 *  - Undo vs "changed since": a row MCP's Undo put in the trash keeps its two-way links (restored, both sides agree); the
 *    AI terminal's Undo never deletes for good a row the person filled in; a property the person made a form question
 *    stays;
 *  - what a call writes besides its own rows is named on the card: a script's two-way links ("Links back" and what they
 *    start), a sub-items child's old parent;
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

async function undoLast(page: Page, tool: string) {
  await openAgentsTab(page)
  const undone = page.locator('.mcp-log__row', { hasText: tool }).filter({ hasText: 'Undone' })
  const before = await undone.count()
  await page.locator('.mcp-log__row').getByRole('button', { name: `Undo ${tool}` }).first().click()
  await expect(undone).toHaveCount(before + 1)
  await closeSettings(page)
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

test("a two-way relation value never writes One's own database's rows: update_row, create_row, upsert refused system_database, also when the pair turned into one while the card waited", async ({ page }) => {
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
    s.addProperty(deals, { id: 'd-arch', name: 'Archived as', type: 'relation', relationDatabaseId: archive } as never)
    s.addProperty(archive, { id: 'd-arch.2way', name: 'Deals', type: 'relation', relationDatabaseId: deals } as never)
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
  await refused('one_update_row', { id: ids.deal, properties: { Kontext: ['Prefers short answers'] } }, /^system_database: properties\.Kontext: "Memory" is One's memory database; .*this relation is two-way/)
  await refused('one_update_row', { id: ids.deal, properties: { 'Coding task': ['Ship the footer'] } }, /^system_database: properties\.Coding task: "Coding" is One's Coding pipeline database/)
  await refused('one_create_row', { databaseId: ids.deals, title: 'Deal 2', properties: { Kontext: ['Prefers short answers'] } }, /^system_database: properties\.Kontext: /)
  await refused('one_create_row', { databaseId: ids.deals, rows: [{ title: 'Deal 3' }, { title: 'Deal 4', properties: { Kontext: ['Prefers short answers'] } }] }, /^system_database: rows\[1\]\.properties\.Kontext: /)
  await refused('one_upsert_rows', { databaseId: ids.deals, keyProperty: 'Ref', rows: [{ key: 'D-1', properties: { 'Coding task': ['Ship the footer'] } }] }, /^system_database: rows\[0\]\.properties\.Coding task: /)
  expect(await sides()).toBe(untouched)
  expect(await deals()).toBe(1)
  // the archive is an ordinary database while the card waits — it becomes One's memory before the Approve
  await setMode(page, 'Ask first')
  const late = await approveAfter(page, 'one_update_row', { id: ids.deal, properties: { 'Archived as': ['Box 7'] } }, () => wsEval(page, (s, a: string) => s.updateDatabase(a, { system: 'memory' } as never), ids.archive))
  expect(late.isError, text(late)).toBe(true)
  expect(text(late)).toMatch(/^system_database: properties\.Archived as: "Archive" is One's memory database/)
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

test('a select bound to a shared list takes no option of its own: one_move_row and one_run_script refused (the run before any card), nothing moved or written', async ({ page }) => {
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
  await refused('one_run_script', { script: 'Set Omega' }, /^bad_argument: The dry run of "Set Omega" failed: [\s\S]*unknown option "Omega" — this property takes its options from the shared list "Stages"/)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(await opts()).toEqual(['Alpha', 'Beta'])
  expect(await wsEval(page, (s, a: { lead: string; row: string }) => [s.pages[a.lead].databaseId, s.pages[a.row].properties['p-stage']], ids)).toEqual([ids.from, 'o-a'])
})

/* ------------------------------------------------------------------ Undo vs changed since */

test('one_create_row with a two-way relation: its Undo puts the row in the trash with its links on both sides — restored from the trash, both sides agree', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const projects = s.createDatabase({ title: 'Projekte', properties: [{ id: 'pr-title', name: 'Name', type: 'title' }] })
    const tasks = s.createDatabase({ title: 'Aufgaben', properties: [{ id: 'tk-title', name: 'Name', type: 'title' }] })
    s.addProperty(tasks, { id: 't-rel', name: 'Projekt', type: 'relation', relationDatabaseId: projects } as never)
    s.addProperty(projects, { id: 't-rel.2way', name: 'Aufgaben', type: 'relation', relationDatabaseId: tasks } as never)
    const alpha = s.createRow(projects, { title: 'Alpha', properties: {} })
    return { projects, tasks, alpha }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const made = json(await call('one_create_row', { databaseId: ids.tasks, title: 'Task A', properties: { Projekt: ['Alpha'] } }))
  const state = () => wsEval(page, (s, a: { alpha: string; task: string }) => ({ task: s.pages[a.task]?.properties['t-rel'] ?? [], alpha: s.pages[a.alpha]?.properties['t-rel.2way'] ?? [], trashed: !!s.pages[a.task]?.trashed }), { alpha: ids.alpha, task: made.id as string })
  expect(await state()).toEqual({ task: [ids.alpha], alpha: [made.id], trashed: false })
  await flush(page)
  await undoLast(page, 'one_create_row')
  // in the trash, as the app's trash leaves it: the link stays on both sides
  expect(await state()).toEqual({ task: [ids.alpha], alpha: [made.id], trashed: true })
  await wsEval(page, (s, id: string) => s.restorePage(id), made.id as string)
  expect(await state()).toEqual({ task: [ids.alpha], alpha: [made.id], trashed: false })
})

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

test('one_create_property Undo keeps a property the person made a form question since (and a sub-items pair they set up)', async ({ page }) => {
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
  await undoLast(page, 'one_create_property')
  await expect(page.getByText('Undone — parts edited since were kept')).toBeVisible()
  expect(await wsEval(page, (s, a: { db: string; prop: string }) => s.databases[a.db].properties.some((p: AnyState) => p.id === a.prop), { db: ids.db, prop: propId })).toBe(true)
  // a two-way self-relation the person turned into sub-items since: kept too
  const pair = json(await call('one_create_property', { databaseId: ids.db, name: 'Parent', type: 'relation', relation: { databaseId: ids.db, twoWay: true, reverseName: 'Children' } }))
  const parentId = pair.property.id as string
  await wsEval(page, (s, a: { db: string; p: string }) => s.updateDatabase(a.db, { subItems: { enabled: true, parentPropertyId: a.p, childPropertyId: `${a.p}.2way` } } as never), { db: ids.db, p: parentId })
  await flush(page)
  await undoLast(page, 'one_create_property')
  expect(await wsEval(page, (s, a: { db: string; p: string }) => (s.databases[a.db].properties as AnyState[]).filter((x) => x.id === a.p || x.id === `${a.p}.2way`).length, { db: ids.db, p: parentId })).toBe(2)
})

/* ------------------------------------------------------------------ what the card names */

test("one_run_script's card names the rows a two-way relation links back and what that starts there (as one_update_row's does)", async ({ page }) => {
  await openApp(page)
  await wsEval(page, (s) => {
    const projects = s.createDatabase({ title: 'Projekte', properties: [{ id: 'pr-title', name: 'Name', type: 'title' }] })
    const tasks = s.createDatabase({ title: 'Aufgaben', properties: [{ id: 'tk-title', name: 'Name', type: 'title' }] })
    s.addProperty(tasks, { id: 't-rel', name: 'Projekt', type: 'relation', relationDatabaseId: projects } as never)
    s.addProperty(projects, { id: 't-rel.2way', name: 'Aufgaben', type: 'relation', relationDatabaseId: tasks } as never)
    s.createRow(projects, { title: 'Alpha', properties: {} })
    for (let i = 1; i <= 6; i++) s.createRow(tasks, { title: `Task ${i}`, properties: {} })
    s.updateDatabase(projects, { automations: [{ id: 'au-crm', name: 'Tell the CRM', enabled: true, trigger: { type: 'property_changed', propertyId: 't-rel.2way' }, actions: [{ type: 'webhook', url: 'https://hooks.e2e.test/x', method: 'POST' }], lastRunAt: null, lastStatus: null, lastMessage: null }] } as never)
    const now = Date.now()
    s.upsertScript({ id: 'sc-link', name: 'Link all', code: 'for t in db("Aufgaben").rows {\n  t.set(Projekt: "Alpha")\n}\n', kind: 'script', createdAt: now, updatedAt: now })
  })
  await flush(page)
  await connect(page, 'Ask first')
  const body = await cardText(page, 'one_run_script', { script: 'Link all' })
  expect(body).toMatch(/Links back Projekte · Aufgaben: "Alpha"/i)
  expect(body).toContain('Tell the CRM')
})

test("sub-items: taking a child from another parent names that old parent on the card (its Sub-items change too)", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const projects = s.createDatabase({ title: 'Projects', properties: [{ id: 'pr-title', name: 'Name', type: 'title' }] })
    s.addProperty(projects, { id: 'pr-parent', name: 'Parent item', type: 'relation', relationDatabaseId: projects } as never)
    s.addProperty(projects, { id: 'pr-parent.2way', name: 'Sub-items', type: 'relation', relationDatabaseId: projects } as never)
    s.updateDatabase(projects, { subItems: { enabled: true, parentPropertyId: 'pr-parent', childPropertyId: 'pr-parent.2way' } } as never)
    const zed = s.createRow(projects, { title: 'Old parent Z', properties: {} })
    const why = s.createRow(projects, { title: 'Child Y', properties: { 'pr-parent': [zed] } })
    s.setRowProperty(zed, 'pr-parent.2way', [why])
    const ex = s.createRow(projects, { title: 'New parent X', properties: {} })
    return { projects, zed, why, ex }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const body = await cardText(page, 'one_update_row', { id: ids.ex, properties: { 'Sub-items': ['Child Y'] } })
  expect(body).toMatch(/Links back Projects · Sub-items: "Old parent Z"/i)
  expect(body).toMatch(/Links back Projects · Parent item: "Child Y"/i)
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
