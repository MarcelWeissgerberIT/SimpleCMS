/**
 * MCP T-a, Weg 4 D1 on the local bridge (the owner's decision), driven like Claude Code drives it (the built bridge
 * through the MCP SDK's stdio client, its own port):
 *  - two-way relations stay out of MCP until T-b: a value of a two-way relation (an explicit pair, a sub-items or a
 *    dependencies pair) is refused on every row tool — refused_type, the words the team server uses, before any card,
 *    nothing written; a relation made two-way while the card waited is refused at apply; `twoWay: true` is refused by
 *    one_create_property and one_create_database; a one-way relation stays fine;
 *  - one_run_script is a dry run only: no card (also in Ask first), `ran: false` and the remedy (the person runs it in
 *    One → Scripts), nothing changed; Agent activity says so in English and German;
 *  - a select bound to a shared list: the person's own script run puts a new option into the list (as the option picker
 *    does); an MCP dry run reports it (addsToList) and writes nothing;
 *  - the help says both, in English and German.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47380

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

/** The shared words of a refused two-way value (src/shared/mcp/twoWay.ts) after its path — the team server's too. */
const twoWayWords = (name: string) => `${JSON.stringify(name)} is two-way (or a sub-items / dependencies pair); set it in One. Nothing was changed. A one-way relation is fine`
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** Projects ⇄ Tasks: Project two-way (Projects.Tasks), Reference one-way, sub-items and dependencies on Tasks. */
async function seed(page: Page) {
  return wsEval(page, (s) => {
    const proj = s.createDatabase({ title: 'Projects', properties: [{ id: 'p-title', name: 'Name', type: 'title' }] })
    const tasks = s.createDatabase({
      title: 'Tasks',
      properties: [
        { id: 't-title', name: 'Name', type: 'title' },
        { id: 't-code', name: 'Code', type: 'text' },
        { id: 't-proj', name: 'Project', type: 'relation', relationDatabaseId: proj },
        { id: 't-ref', name: 'Reference', type: 'relation', relationDatabaseId: proj },
        { id: 't-parent', name: 'Parent item', type: 'relation', relationDatabaseId: '' },
        { id: 't-parent.2way', name: 'Sub-items', type: 'relation', relationDatabaseId: '' },
        { id: 't-blk', name: 'Blocked by', type: 'relation', relationDatabaseId: '' },
        { id: 't-blk.2way', name: 'Blocking', type: 'relation', relationDatabaseId: '' },
      ] as never,
    })
    // the self-relations point at Tasks itself; Projects gets the reverse side of Project
    for (const id of ['t-parent', 't-parent.2way', 't-blk', 't-blk.2way']) s.updateProperty(tasks, id, { relationDatabaseId: tasks } as never)
    s.addProperty(proj, { id: 't-proj.2way', name: 'Tasks', type: 'relation', relationDatabaseId: tasks } as never)
    s.updateDatabase(tasks, {
      subItems: { enabled: true, parentPropertyId: 't-parent', childPropertyId: 't-parent.2way' },
      dependencies: { enabled: true, blockedByPropertyId: 't-blk', blockingPropertyId: 't-blk.2way', onConflict: 'warn' },
    } as never)
    const nordlicht = s.createRow(proj, { title: 'Nordlicht', properties: {} })
    const launch = s.createRow(tasks, { title: 'Launch plan', properties: { 't-code': 'LP' } })
    const tessera = s.createRow(tasks, { title: 'Tessera', properties: { 't-code': 'TS' } })
    return { proj, tasks, nordlicht, launch, tessera }
  })
}

/** What a refused call could have written: every value of both databases' rows, both schemas, the page count. */
const snapshot = (page: Page, ids: { proj: string; tasks: string }) =>
  wsEval(page, (s, a: { proj: string; tasks: string }) =>
    JSON.stringify([
      Object.values(s.pages as Record<string, AnyState>)
        .filter((p) => p.databaseId === a.proj || p.databaseId === a.tasks)
        .map((p) => [p.id, p.title, p.properties])
        .sort(),
      s.databases[a.proj].properties.map((p: AnyState) => p.id),
      s.databases[a.tasks].properties.map((p: AnyState) => p.id),
      Object.keys(s.pages).length,
    ]),
  ids)

test('two-way values are refused on every row tool before any card — refused_type, the team server\'s words, nothing written; a one-way relation is fine', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await flush(page)
  await connect(page, 'Ask first')
  const before = await snapshot(page, ids)
  // one_create_row: an explicit pair, a sub-items parent, a cleared dependency
  await refused('one_create_row', { databaseId: ids.tasks, title: 'Mara Lind', properties: { Project: [ids.nordlicht] } }, new RegExp(`^refused_type: properties\\.Project: ${esc(twoWayWords('Project'))}`))
  await refused('one_create_row', { databaseId: ids.tasks, title: 'Mara Lind', properties: { 'Parent item': ['Launch plan'] } }, new RegExp(`^refused_type: properties\\.Parent item: ${esc(twoWayWords('Parent item'))}`))
  await refused('one_create_row', { databaseId: ids.tasks, title: 'Mara Lind', properties: { 'Blocked by': null } }, /^refused_type: properties\.Blocked by: "Blocked by" is two-way/)
  // rows[]: every row that does not fit is named, with the code they share
  await refused(
    'one_create_row',
    { databaseId: ids.tasks, rows: [{ title: 'Mara Lind' }, { title: 'Kick-off', properties: { 'Blocked by': [ids.launch] } }, { title: 'Review', properties: { Blocking: [] } }] },
    /^refused_type: rows: 2 of 3 rows do not fit:\n- rows\[1\] \("Kick-off"\): properties\.Blocked by: "Blocked by" is two-way \(or a sub-items \/ dependencies pair\); set it in One\.[^\n]*\n- rows\[2\] \("Review"\): properties\.Blocking: "Blocking" is two-way/,
  )
  // one_update_row: single (clearing too) and rows[]; the partner's side is two-way as well
  await refused('one_update_row', { id: ids.tessera, properties: { 'Sub-items': [ids.launch] } }, new RegExp(`^refused_type: properties\\.Sub-items: ${esc(twoWayWords('Sub-items'))}`))
  await refused('one_update_row', { id: ids.tessera, properties: { Project: null } }, /^refused_type: properties\.Project: "Project" is two-way/)
  await refused('one_update_row', { rows: [{ id: ids.launch, properties: { Code: 'LP-2' } }, { id: ids.tessera, properties: { 'Blocked by': [ids.launch] } }] }, /^refused_type: rows\[1\]\.properties\.Blocked by: "Blocked by" is two-way/)
  await refused('one_update_row', { id: ids.nordlicht, properties: { Tasks: [ids.launch] } }, new RegExp(`^refused_type: properties\\.Tasks: ${esc(twoWayWords('Tasks'))}`))
  // one_upsert_rows: a changed row and a new one — every row named on one line, as the team server lists them
  await refused(
    'one_upsert_rows',
    { databaseId: ids.tasks, keyProperty: 'Code', rows: [{ key: 'LP', properties: { Project: [ids.nordlicht] } }, { key: 'NEW', title: 'Mara Lind', properties: { 'Parent item': [ids.launch] } }] },
    /^bad_argument: rows: 2 of 2 rows do not fit: rows\[0\] \(key "LP"\): refused_type: properties\.Project: "Project" is two-way .*; rows\[1\] \(key "NEW"\): refused_type: properties\.Parent item: "Parent item" is two-way/,
  )
  // refused before any card: none was shown, nothing written
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await flush(page)
  expect(await snapshot(page, ids)).toBe(before)

  // a one-way relation: fine (the card, then the value; the project is not touched)
  await setMode(page, 'Apply directly')
  const made = json(await call('one_create_row', { databaseId: ids.tasks, title: 'Mara Lind', properties: { Reference: [ids.nordlicht] } }))
  expect(await wsEval(page, (s, a: { id: string; p: string }) => [s.pages[a.id].properties['t-ref'], s.pages[a.p].properties['t-proj.2way'] ?? null], { id: made.id, p: ids.nordlicht })).toEqual([[ids.nordlicht], null])
})

test('a relation made two-way while the card waited is refused at apply — nothing written', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await flush(page)
  await connect(page, 'Ask first')
  const card = page.getByRole('alertdialog')
  const pending = call('one_update_row', { id: ids.tessera, properties: { Reference: [ids.nordlicht] } })
  await expect(card).toBeVisible()
  // meanwhile the person makes Reference two-way (its reverse side on Projects)
  await wsEval(page, (s, a: { proj: string; tasks: string }) => s.addProperty(a.proj, { id: 't-ref.2way', name: 'Referenced by', type: 'relation', relationDatabaseId: a.tasks } as never), ids)
  await flush(page)
  await card.getByRole('button', { name: /Approve/ }).click()
  const r = await pending
  expect(r.isError, text(r)).toBe(true)
  expect(text(r)).toMatch(new RegExp(`^refused_type: properties\\.Reference: ${esc(twoWayWords('Reference'))}`))
  expect(await wsEval(page, (s, a: { t: string; p: string }) => [s.pages[a.t].properties['t-ref'] ?? null, s.pages[a.p].properties['t-ref.2way'] ?? null], { t: ids.tessera, p: ids.nordlicht })).toEqual([null, null])
})

test('twoWay: true is refused by one_create_property and one_create_database — nothing made on either side; twoWay: false is fine', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await flush(page)
  await connect(page, 'Ask first')
  const before = await snapshot(page, ids)
  const dbs = await wsEval(page, (s) => Object.keys(s.databases).length)
  await refused('one_create_property', { databaseId: ids.tasks, name: 'Owner project', type: 'relation', relation: { databaseId: ids.proj, twoWay: true, reverseName: 'Owned tasks' } }, /^refused_type: relation\.twoWay: two-way relations are set up in One; over MCP a relation is one-way\. Nothing was changed\. Leave out twoWay/)
  await refused('one_create_property', { databaseId: ids.tasks, name: 'Related', type: 'relation', relation: { databaseId: ids.tasks, twoWay: true } }, /^refused_type: relation\.twoWay: /)
  await refused('one_create_database', { title: 'Notes', properties: [{ name: 'Topic', type: 'text' }, { name: 'Project', type: 'relation', relation: { databaseId: ids.proj, twoWay: true } }] }, /^refused_type: properties\[1\]\.relation\.twoWay: two-way relations are set up in One/)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await flush(page)
  expect(await snapshot(page, ids)).toBe(before)
  expect(await wsEval(page, (s) => Object.keys(s.databases).length)).toBe(dbs)
  // one-way: fine, no reverse property
  await setMode(page, 'Apply directly')
  const one = json(await call('one_create_property', { databaseId: ids.tasks, name: 'Owner project', type: 'relation', relation: { databaseId: ids.proj, twoWay: false } }))
  expect(one.property.name).toBe('Owner project')
  expect(one.reverse).toBeUndefined()
  expect(await wsEval(page, (s, p: string) => (s.databases[p].properties as AnyState[]).length, ids.proj)).toBe(2)
})

/* ------------------------------------------------------------------ one_run_script: a dry run only */

const RAISE = 'for t in db("Tasks").where(Code = "LP") {\n  t.set(Code: "LP-1")\n}\nprint("raised")\n'

async function addScript(page: Page, input: { id: string; code: string; name: string; kind?: 'script' | 'query' }): Promise<void> {
  await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertScript({ id: a.id, name: a.name, code: a.code, kind: a.kind ?? 'script', createdAt: now, updatedAt: now })
    },
    input,
  )
}

/** Agent activity's newest row of a tool: its text. */
async function activityRow(page: Page, tool: string, target: string) {
  await openAgentsTab(page)
  const row = page.locator('.mcp-log__row', { hasText: tool }).filter({ hasText: target }).first()
  await expect(row).toBeVisible()
  const out = (await row.innerText()).replace(/\s+/g, ' ')
  await closeSettings(page)
  return out
}

test('one_run_script is a dry run only: no card (Ask first and Apply directly), ran: false and the remedy, nothing changed — Agent activity says so in English and German', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await addScript(page, { id: 'sc-raise', name: 'Raise codes', code: RAISE })
  await addScript(page, { id: 'sc-count', name: 'Count tasks', code: 'db("Tasks").count', kind: 'query' })
  await flush(page)
  await connect(page, 'Ask first')
  const codes = () => wsEval(page, (s, a: string[]) => a.map((id) => s.pages[id].properties['t-code']), [ids.launch, ids.tessera])
  for (const mode of ['Ask first', 'Apply directly'] as const) {
    await setMode(page, mode)
    const r = json(await call('one_run_script', { script: 'Raise codes' }))
    expect(r).toMatchObject({ ran: false, mode: 'dry', status: 'ok', printed: ['raised'], script: { id: 'sc-raise', name: 'Raise codes', kind: 'script' } })
    expect(r.changes.map((c: AnyState) => [c.kind, c.title, c.properties[0].after])).toEqual([['set', 'Launch plan', 'LP-1']])
    expect(r.note).toMatch(/^This was a dry run: nothing was changed\. Over MCP a saved script only dry-runs — to run it, ask the person to run it in One → Scripts\./)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(await codes()).toEqual(['LP', 'TS'])
  }
  // dryRun: true answers the same
  expect(json(await call('one_run_script', { script: 'sc-raise', dryRun: true }))).toMatchObject({ ran: false, mode: 'dry' })
  // a saved query still answers as before
  expect(json(await call('one_run_script', { script: 'Count tasks' }))).toMatchObject({ query: true, value: 2 })
  expect(await codes()).toEqual(['LP', 'TS'])
  // Agent activity: no change, a dry run only — in the UI's language
  expect(await activityRow(page, 'one_run_script', 'Raise codes')).toMatch(/Dry run only — the person runs it in One → Scripts.*No change/i)
  // a saved query only reads: no dry-run note on its row
  expect(await activityRow(page, 'one_run_script', 'Count tasks')).not.toMatch(/Dry run only/)
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  json(await call('one_run_script', { script: 'Raise codes' }))
  expect(await activityRow(page, 'one_run_script', 'Raise codes')).toMatch(/Nur Probelauf — ausführen kann ihn die Person in One → Skripte.*Keine Änderung/i)
  expect(await codes()).toEqual(['LP', 'TS'])
  // Read only still refuses it
  await openAgentsTab(page)
  await page.getByRole('radio', { name: /Nur lesen/ }).click()
  await closeSettings(page)
  await refused('one_run_script', { script: 'Raise codes' }, /^rejected: /)
})

test("a select bound to a shared list: the person's own script run puts a new option into the list (as the option picker does); an MCP dry run reports it and writes nothing", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const now = Date.now()
    s.upsertList({ id: 'list-stages', name: 'Stages', items: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], createdAt: now, updatedAt: now } as never)
    const db = s.createDatabase({ title: 'Pipeline', properties: [{ id: 'q-title', name: 'Name', type: 'title' }, { id: 'q-stage', name: 'Stage', type: 'select', listId: 'list-stages', options: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }] }] as never })
    const row = s.createRow(db, { title: 'Tessera', properties: { 'q-stage': 'o-a' } })
    s.upsertScript({ id: 'sc-omega', name: 'Set Omega', code: 'page("Tessera").set(Stage: "Omega")\n', kind: 'script', createdAt: now, updatedAt: now })
    return { db, row }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const state = () =>
    wsEval(page, (s, a: { db: string; row: string }) => ({
      list: (s.kit.lists['list-stages'].items as AnyState[]).map((o) => [o.id, o.name]),
      options: ((s.databases[a.db].properties as AnyState[]).find((p) => p.id === 'q-stage')!.options as AnyState[]).map((o) => [o.id, o.name]),
      value: s.pages[a.row].properties['q-stage'],
    }), ids)
  const was = await state()
  // over MCP: a dry run that names the option it would add to the list
  const dry = json(await call('one_run_script', { script: 'Set Omega' }))
  expect(dry).toMatchObject({ ran: false, status: 'ok' })
  expect(dry.changes[0].properties[0]).toEqual({ name: 'Stage', before: 'Alpha', after: 'Omega', addsToList: { list: 'Stages', options: ['Omega'] } })
  expect(await state()).toEqual(was)
  // the person runs it in One: the option goes into the list, the bound property gets it with the same id, the row has it
  const run = await page.evaluate(() => (window as unknown as { __oneScriptRuns: { run: (id: string) => Promise<AnyState | null> } }).__oneScriptRuns.run('sc-omega'))
  expect(run?.status).toBe('ok')
  const now = await state()
  const omega = now.list.find(([, name]: string[]) => name === 'Omega')
  expect(omega, JSON.stringify(now)).toBeTruthy()
  expect(now.options).toEqual(now.list)
  expect(now.value).toBe(omega[0])
})

test('the help says it in English and German: two-way relations are set in One, scripts only dry-run over MCP', async () => {
  const read = (lang: string, id: string) => readFileSync(fileURLToPath(new URL(`../../src/app/help/articles/${lang}/${id}.md`, import.meta.url)), 'utf8')
  const en = read('en', 'mcp-bridge')
  expect(en).toMatch(/two-way relations?[^.]*set (them )?in One/i)
  expect(en).toMatch(/dry run/i)
  const de = read('de', 'mcp-bridge')
  expect(de).toMatch(/beidseitige Relationen?[^.]*in One/i)
  expect(de).toMatch(/Probelauf/)
  expect(read('en', 'public-api')).toMatch(/two-way relations?[^.]*set (them )?in One/i)
  expect(read('de', 'public-api')).toMatch(/beidseitige Relationen?[^.]*in One/i)
})
