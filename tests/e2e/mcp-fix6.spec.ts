/**
 * Review 6 of MCP T-a on the local bridge (MCP plan § 3.2 / § 3.3), driven like Claude Code drives it (the built
 * bridge through the MCP SDK's stdio client, its own port). Each test names the rule it guards:
 *  - Undo vs "changed since": a script run's page tree goes back whole; a property the person renamed, set up or built
 *    on — or whose database they locked — stays; a restored database set up again stays; a linked sub-page that stays
 *    keeps its link; the follows of an Undo that goes without running are released;
 *  - locked / One's own databases while the card waited: create_property, a two-way target, a moved row's new options,
 *    a replace or an icon of a page moved into the memory — nothing written;
 *  - what a call starts: a database block in a ROW's text names the autofill that fills again;
 *  - templates read as unknown: a template's row linking a row never keeps it from moving;
 *  - building blocks: a select bound to a shared list takes no option of its own (rows, options, type change);
 *  - two-way relations: the linked row links back (as in the app and on the team server), the card names it, the Undo
 *    takes it back; sub-items: one parent per row, never itself.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47378

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

const KEPT = 'Undone — parts edited since were kept'
const trashed = (page: Page, id: string) => wsEval(page, (s, id) => !!s.pages[id]?.trashed, id)
const propNames = (page: Page, db: string) => wsEval(page, (s, db) => ((s.databases[db]?.properties ?? []) as AnyState[]).map((p) => p.name as string), db)
const setLocked = (page: Page, db: string) => wsEval(page, (s, db: string) => s.updateDatabase(db, { locked: true }), db)

/* ------------------------------------------------------------------ Undo vs changed since */

test('one_run_script Undo of a run that made a page with a sub-page: both go back, nothing is said to be kept', async ({ page }) => {
  await openApp(page)
  await connect(page, 'Ask first')
  await wsEval(page, (s) => {
    const now = Date.now()
    s.upsertScript({ id: 'sc-tree', name: 'Make tree', code: 'let p = create.page(title: "Projekt Tessera")\ncreate.page(title: "Kapitel Eins", parent: p)\n', kind: 'script', createdAt: now, updatedAt: now })
  })
  await flush(page)
  const pending = call('one_run_script', { script: 'Make tree' })
  const card = page.getByRole('alertdialog')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /Approve/ }).click()
  json(await pending)
  const ids = await wsEval(page, (s) => {
    const all = Object.values(s.pages) as AnyState[]
    return { parent: all.find((p) => p.title === 'Projekt Tessera')?.id as string, child: all.find((p) => p.title === 'Kapitel Eins')?.id as string }
  })
  expect(ids.parent && ids.child).toBeTruthy()
  await flush(page)
  await undoLast(page, 'one_run_script')
  await expect.poll(() => trashed(page, ids.parent)).toBe(true)
  expect({ child: await trashed(page, ids.child), keptToast: await page.getByText(KEPT).count() }).toEqual({ child: true, keptToast: 0 })
})

test('one_create_property Undo keeps a property renamed and set up since, one a board groups by, one in a database locked since — an untouched one goes', async ({ page }) => {
  await openApp(page)
  const db = await wsEval(page, (s) => {
    const id = s.createDatabase({ title: 'Deals', properties: [{ id: 'd-title', name: 'Name', type: 'title' }] })
    s.createRow(id, { title: 'Deal 1', properties: {} })
    return id
  })
  const locked = await wsEval(page, (s) => s.createDatabase({ title: 'Locked deals', properties: [{ id: 'l-title', name: 'Name', type: 'title' }] }))
  await flush(page)
  await connect(page, 'Apply directly')
  const propOf = (dbId: string, name: string) => wsEval(page, (s, a: { db: string; name: string }) => ((s.databases[a.db]?.properties ?? []) as AnyState[]).find((p) => p.name === a.name)?.id ?? null, { db: dbId, name })
  const exists = (dbId: string, id: string) => wsEval(page, (s, a: { db: string; id: string }) => ((s.databases[a.db]?.properties ?? []) as AnyState[]).some((p) => p.id === a.id), { db: dbId, id })

  // renamed + an option added by the person (no row holds a value)
  json(await call('one_create_property', { databaseId: db, name: 'Phase', type: 'select', options: ['Lead', 'Won'] }))
  const phase = (await propOf(db, 'Phase'))!
  await wsEval(page, (s, a: { db: string; id: string }) => {
    const def = (s.databases[a.db].properties as AnyState[]).find((p) => p.id === a.id)!
    s.updateProperty(a.db, a.id, { name: 'Pipeline stage', options: [...def.options, { id: 'o-mara', name: 'Negotiation (Mara)', color: 'orange' }] })
  }, { db, id: phase })
  await flush(page)
  await undoLast(page, 'one_create_property')
  await expect.poll(() => page.getByText(KEPT).count()).toBeGreaterThan(0)
  expect(await exists(db, phase)).toBe(true)

  // a board grouped by it since
  json(await call('one_create_property', { databaseId: db, name: 'Region', type: 'select', options: ['Nord', 'Süd'] }))
  const region = (await propOf(db, 'Region'))!
  await wsEval(page, (s, a: { db: string; id: string }) => s.addView(a.db, { type: 'board', name: 'By region', groupBy: a.id }), { db, id: region })
  await flush(page)
  await undoLast(page, 'one_create_property')
  expect(await exists(db, region)).toBe(true)

  // in a database the person locked since: its schema stays as it is
  json(await call('one_create_property', { databaseId: locked, name: 'Owner', type: 'text' }))
  const owner = (await propOf(locked, 'Owner'))!
  await setLocked(page, locked)
  await flush(page)
  await undoLast(page, 'one_create_property')
  expect(await exists(locked, owner)).toBe(true)

  // the control: untouched, it goes
  json(await call('one_create_property', { databaseId: db, name: 'Budget', type: 'number' }))
  const budget = (await propOf(db, 'Budget'))!
  await flush(page)
  await undoLast(page, 'one_create_property')
  expect(await exists(db, budget)).toBe(false)
})

test('one_restore_page Undo keeps a restored database the person set up again (a column, a view)', async ({ page }) => {
  await openApp(page)
  const db = await wsEval(page, (s) => {
    const id = s.createDatabase({ title: 'Archive board', properties: [{ id: 'a-title', name: 'Name', type: 'title' }] })
    s.createRow(id, { title: 'Old card', properties: {} })
    s.trashPage(id)
    return id
  })
  await flush(page)
  await connect(page, 'Apply directly')
  json(await call('one_restore_page', { id: db }))
  expect(await trashed(page, db)).toBe(false)
  await wsEval(page, (s, db: string) => {
    s.addProperty(db, { id: 'a-owner', name: 'Owner (Mara)', type: 'text' })
    s.addView(db, { type: 'board', name: 'By owner' })
  }, db)
  await flush(page)
  await undoLast(page, 'one_restore_page')
  await expect.poll(() => page.getByText(KEPT).count()).toBeGreaterThan(0)
  expect(await trashed(page, db)).toBe(false)
})

test('one_create_page linkInParent Undo: a new page that stays keeps its link, also when nobody wrote in the parent', async ({ page }) => {
  await openApp(page)
  const host = await wsEval(page, (s) => {
    const id = s.createPage({ title: 'Launch plan' })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Intro.' }] }] }, 'e2e')
    return id
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const kept = json(await call('one_create_page', { title: 'Notizen', parentId: host, linkInParent: 'block' }))
  const gone = json(await call('one_create_page', { title: 'Entwurf', parentId: host, linkInParent: 'block' }))
  // the person writes into the first new page only (the host stays as the calls left it)
  await wsEval(page, (s, id: string) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Her notes.' }] }] }, 'e2e'), kept.id)
  await flush(page)
  // the second call's Undo first (its page untouched: page and link go), then the first's (kept: its link stays)
  await undoLast(page, 'one_create_page')
  await undoLast(page, 'one_create_page')
  const hostText = () => wsEval(page, (s, h: string) => JSON.stringify(s.pages[h].content), host)
  expect(await trashed(page, gone.id)).toBe(true)
  expect(await trashed(page, kept.id)).toBe(false)
  expect(await hostText()).toContain(kept.id)
  expect(await hostText()).not.toContain(gone.id)
  expect(await hostText()).toContain('Intro.')
})

/** Objects shaped like follow.ts MadeAs (a baseline a follow holds), alive after a full GC. */
async function madeAsAlive(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const proto = (await cdp.send('Runtime.evaluate', { expression: 'Object.prototype' })) as { result: { objectId: string } }
  const q = (await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId })) as { objects: { objectId: string } }
  const r = (await cdp.send('Runtime.callFunctionOn', {
    objectId: q.objects.objectId,
    functionDeclaration: 'function () { const want = "comments,cover,icon,key,props,rev,title"; let n = 0; for (const o of this) { try { if (Object.keys(o).sort().join(",") === want) n++ } catch {} } return n }',
    returnByValue: true,
  })) as { result: { value: number } }
  await cdp.detach()
  return r.result.value
}

test('the follows of an Undo that goes without running are released: cleared from Agent activity, none of 50 baselines stays', async ({ page }) => {
  await openApp(page)
  const db = await wsEval(page, (s) => s.createDatabase({ title: 'Leads', properties: [{ id: 'f-title', name: 'Name', type: 'title' }] }))
  await flush(page)
  await connect(page, 'Apply directly')
  const before = await madeAsAlive(page)
  json(await call('one_create_row', { databaseId: db, rows: Array.from({ length: 50 }, (_, i) => ({ title: `Lead ${i + 1}` })) }))
  expect((await madeAsAlive(page)) - before).toBeGreaterThanOrEqual(50)
  await openAgentsTab(page)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await closeSettings(page)
  await expect.poll(async () => (await madeAsAlive(page)) - before, { timeout: 10_000 }).toBeLessThan(50)
})

/* ------------------------------------------------------------------ locked / One's own databases while the card waited */

test('one_create_property: a database locked while the card waited takes no property, nor a two-way target locked meanwhile', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const a = s.createDatabase({ title: 'Deals', properties: [{ id: 'a-title', name: 'Name', type: 'title' }] })
    const b = s.createDatabase({ title: 'Firmen', properties: [{ id: 'b-title', name: 'Name', type: 'title' }] })
    return { a, b }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const r1 = await approveAfter(page, 'one_create_property', { databaseId: ids.a, name: 'Budget', type: 'text' }, () => setLocked(page, ids.a))
  expect(r1.isError, text(r1)).toBe(true)
  expect(text(r1)).toMatch(/^locked: /)
  expect(await propNames(page, ids.a)).toEqual(['Name'])
  await wsEval(page, (s, a: string) => s.updateDatabase(a, { locked: false }), ids.a)
  await flush(page)
  const r2 = await approveAfter(page, 'one_create_property', { databaseId: ids.a, name: 'Firma', type: 'relation', relation: { databaseId: ids.b, twoWay: true } }, () => setLocked(page, ids.b))
  expect(r2.isError, text(r2)).toBe(true)
  expect(text(r2)).toMatch(/^locked: relation\.twoWay/)
  expect({ a: await propNames(page, ids.a), b: await propNames(page, ids.b) }).toEqual({ a: ['Name'], b: ['Name'] })
})

test('one_create_database: a two-way target locked while the card waited — refused, nothing made', async ({ page }) => {
  await openApp(page)
  const b = await wsEval(page, (s) => s.createDatabase({ title: 'Firmen', properties: [{ id: 'b-title', name: 'Name', type: 'title' }] }))
  await flush(page)
  await connect(page, 'Ask first')
  const r = await approveAfter(page, 'one_create_database', { title: 'Projekte', properties: [{ name: 'Firma', type: 'relation', relation: { databaseId: b, twoWay: true } }] }, () => setLocked(page, b))
  expect(r.isError, text(r)).toBe(true)
  expect(text(r)).toMatch(/^locked: properties\[0\]\.relation\.twoWay/)
  expect(await propNames(page, b)).toEqual(['Name'])
  expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((p) => p.title === 'Projekte'))).toBe(false)
})

test('one_move_row: a target locked while the card waited takes no new option — refused, the row stays', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const from = s.createDatabase({ title: 'Leads', properties: [{ id: 'l-title', name: 'Name', type: 'title' }, { id: 'l-stage', name: 'Stage', type: 'select', options: [{ id: 'o-g', name: 'Gamma', color: 'blue' }] }] })
    const to = s.createDatabase({ title: 'Archiv', properties: [{ id: 'a-title', name: 'Name', type: 'title' }, { id: 'a-stage', name: 'Stage', type: 'select', options: [{ id: 'o-x', name: 'Alpha', color: 'red' }] }] })
    const row = s.createRow(from, { title: 'Lead 1', properties: { 'l-stage': 'o-g' } })
    return { from, to, row }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const r = await approveAfter(page, 'one_move_row', { id: ids.row, databaseId: ids.to }, () => setLocked(page, ids.to))
  expect(r.isError, text(r)).toBe(true)
  expect(text(r)).toMatch(/^locked: databaseId: .*Gamma/)
  expect(await wsEval(page, (s, to: string) => ((s.databases[to].properties[1].options ?? []) as AnyState[]).map((o) => o.name), ids.to)).toEqual(['Alpha'])
  expect(await wsEval(page, (s, row: string) => s.pages[row].databaseId, ids.row)).toBe(ids.from)
})

test("one_update_page: a page moved into One's memory while the card waited takes no replace and no icon", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Memory', properties: [{ id: 'm-title', name: 'Name', type: 'title' }] })
    s.updateDatabase(db, { system: 'memory' } as never)
    const p = s.createPage({ title: 'Notiz' })
    s.setContent(p, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'nz-0001-a' }, content: [{ type: 'text', text: 'Old text.' }] }] }, 'e2e')
    return { db, p }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const intoMemory = () => wsEval(page, (s, a: { db: string; p: string }) => s.updatePage(a.p, { parentId: a.db, databaseId: a.db }), ids)
  const back = () => wsEval(page, (s, a: { db: string; p: string }) => s.updatePage(a.p, { parentId: null, databaseId: null }), ids)
  const r = await approveAfter(page, 'one_update_page', { id: ids.p, markdown: 'Replaced by Claude.', mode: 'replace' }, intoMemory)
  expect(r.isError, text(r)).toBe(true)
  expect(text(r)).toMatch(/^system_database: /)
  expect(await wsEval(page, (s, p: string) => s.pages[p].plain as string, ids.p)).toBe('Old text.')
  await back()
  await flush(page)
  const i = await approveAfter(page, 'one_update_page', { id: ids.p, icon: '🧠' }, intoMemory)
  expect(i.isError, text(i)).toBe(true)
  expect(text(i)).toMatch(/^system_database: /)
  expect(await wsEval(page, (s, p: string) => s.pages[p].icon ?? null, ids.p)).toBeNull()
})

/* ------------------------------------------------------------------ what a call starts · templates */

test("one_create_database inline into a ROW names what its text starts there (the row's autofill), as an append to it does", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Accounts', properties: [{ id: 'a-title', name: 'Name', type: 'title' }] })
    s.addProperty(db, { id: 'a-sum', name: 'Summary', type: 'text', autofill: { preset: 'summary', auto: true } } as never)
    const row = s.createRow(db, { title: 'Account 1' })
    s.setContent(row, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'acc-1-p0001' }, content: [{ type: 'text', text: 'Notes on account 1.' }] }] }, 'e2e')
    return { db, row }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const card = page.getByRole('alertdialog')
  const pending = call('one_create_database', { title: 'Kontakte', inline: { pageId: ids.row } })
  await expect(card).toBeVisible()
  await expect(card.locator('.mcp-line', { hasText: 'Starts' })).toHaveCount(1)
  await expect(card).toContainText('Summary')
  await page.keyboard.press('Escape')
  await pending
})

test("one_move_row: a template's row linking the row never keeps it from moving (templates read as unknown)", async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const leads = s.createDatabase({ title: 'Leads', properties: [{ id: 'l-title', name: 'Name', type: 'title' }] })
    const archive = s.createDatabase({ title: 'Archive', properties: [{ id: 'r-title', name: 'Name', type: 'title' }] })
    const acme = s.createRow(leads, { title: 'ACME', properties: {} })
    const tpl = s.createPage({ title: 'Accounts kit' })
    s.updatePage(tpl, { template: { name: 'Accounts kit' }, hidden: true })
    const inner = s.createDatabase({ title: 'Accounts (template)', parentId: tpl, properties: [{ id: 't-title', name: 'Name', type: 'title' }, { id: 't-lead', name: 'Lead', type: 'relation', relationDatabaseId: leads }] })
    s.createRow(inner, { title: 'Sample account', properties: { 't-lead': [acme] } })
    return { leads, archive, acme }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const moved = json(await call('one_move_row', { id: ids.acme, databaseId: ids.archive }))
  expect(moved.databaseId).toBe(ids.archive)
})

/* ------------------------------------------------------------------ building blocks: a list owns its options */

test('a select bound to a shared list takes no option of its own: rows, one_update_property options refused; a type change unbinds it', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    s.upsertList({ id: 'list-stages', name: 'Stages', items: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], createdAt: 1, updatedAt: 1 } as never)
    const db = s.createDatabase({ title: 'Pipeline', properties: [{ id: 'p-title', name: 'Name', type: 'title' }, { id: 'p-stage', name: 'Stage', type: 'select', options: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], listId: 'list-stages' } as never] })
    const row = s.createRow(db, { title: 'Lead 1', properties: { 'p-stage': 'o-a' } })
    return { db, row }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const rows = () => wsEval(page, (s, db: string) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db).length, ids.db)
  const opts = () => wsEval(page, (s, db: string) => ((s.databases[db].properties[1].options ?? []) as AnyState[]).map((o) => o.name), ids.db)
  const c = await call('one_create_row', { databaseId: ids.db, title: 'Lead 9', properties: { Stage: 'Omega' } })
  expect(c.isError, text(c)).toBe(true)
  expect(text(c)).toMatch(/^bad_argument: [\s\S]*shared list "Stages"/)
  expect(await rows()).toBe(1)
  const u = await call('one_update_row', { id: ids.row, properties: { Stage: 'Gamma' } })
  expect(u.isError, text(u)).toBe(true)
  expect(text(u)).toContain('shared list "Stages"')
  const o = await call('one_update_property', { databaseId: ids.db, property: 'Stage', options: { add: ['Gamma'] } })
  expect(o.isError, text(o)).toBe(true)
  expect(text(o)).toMatch(/^bad_argument: options: .*shared list "Stages"/)
  expect(await opts()).toEqual(['Alpha', 'Beta'])
  // an existing option is still fine
  json(await call('one_update_row', { id: ids.row, properties: { Stage: 'Beta' } }))
  // a type change makes it a plain property (as the app converts one): the next list edit no longer rewrites it
  json(await call('one_update_property', { databaseId: ids.db, property: 'Stage', type: 'multi_select' }))
  expect(await wsEval(page, (s, db: string) => (s.databases[db].properties[1] as AnyState).listId ?? null, ids.db)).toBeNull()
  await wsEval(page, (s) => {
    const l = s.kit!.lists['list-stages']!
    s.upsertList({ ...l, items: [...l.items, { id: 'o-d', name: 'Delta', color: 'red' }] })
  })
  expect(await opts()).toEqual(['Alpha', 'Beta'])
})

/* ------------------------------------------------------------------ two-way relations and sub-items */

test('two-way relations: a new row links back from its partner row (card names it, Undo takes it back); sub-items keep one parent, never itself', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const projects = s.createDatabase({ title: 'Projects', properties: [{ id: 'pr-title', name: 'Name', type: 'title' }] })
    const tasks = s.createDatabase({ title: 'Tasks', properties: [{ id: 'tk-title', name: 'Name', type: 'title' }] })
    const nordlicht = s.createRow(projects, { title: 'Nordlicht', properties: {} })
    const tessera = s.createRow(projects, { title: 'Tessera', properties: {} })
    // sub-items on Projects: "Parent item" ↔ "Sub-items" (a two-way self-relation pair)
    s.addProperty(projects, { id: 'pr-parent', name: 'Parent item', type: 'relation', relationDatabaseId: projects } as never)
    s.addProperty(projects, { id: 'pr-parent.2way', name: 'Sub-items', type: 'relation', relationDatabaseId: projects } as never)
    s.updateDatabase(projects, { subItems: { enabled: true, parentPropertyId: 'pr-parent', childPropertyId: 'pr-parent.2way' } } as never)
    return { projects, tasks, nordlicht, tessera }
  })
  await flush(page)
  await connect(page, 'Apply directly')
  json(await call('one_create_property', { databaseId: ids.tasks, name: 'Project', type: 'relation', relation: { databaseId: ids.projects, twoWay: true, reverseName: 'Tasks' } }))
  const reverse = await wsEval(page, (s, p: string) => ((s.databases[p].properties as AnyState[]).find((x) => x.name === 'Tasks')?.id as string) ?? null, ids.projects)
  expect(reverse).toBeTruthy()
  // Ask first: the card names the partner row that links back
  await openAgentsTab(page)
  await page.getByRole('radio', { name: 'Ask first' }).click()
  await closeSettings(page)
  const card = page.getByRole('alertdialog')
  const pending = call('one_create_row', { databaseId: ids.tasks, title: 'Kick-off', properties: { Project: ['Nordlicht'] } })
  await expect(card).toBeVisible()
  await expect(card.locator('.mcp-line', { hasText: 'Links back' })).toContainText('Nordlicht')
  await card.getByRole('button', { name: /Approve/ }).click()
  const made = json(await pending)
  const backOf = (row: string) => wsEval(page, (s, a: { row: string; prop: string }) => (s.pages[a.row].properties[a.prop] as string[] | undefined) ?? [], { row, prop: reverse! })
  expect(await backOf(ids.nordlicht)).toEqual([made.id])
  // the Undo takes the row and its link on the other side back
  await flush(page)
  await undoLast(page, 'one_create_row')
  await expect.poll(() => backOf(ids.nordlicht)).toEqual([])
  // sub-items: at most one parent, never itself (the team server refuses the same)
  await openAgentsTab(page)
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await closeSettings(page)
  const two = await call('one_update_row', { id: ids.tessera, properties: { 'Parent item': ['Nordlicht', 'Tessera'] } })
  expect(two.isError, text(two)).toBe(true)
  expect(text(two)).toContain('at most one parent')
  const self = await call('one_update_row', { id: ids.tessera, properties: { 'Parent item': ['Tessera'] } })
  expect(self.isError, text(self)).toBe(true)
  expect(text(self)).toContain('its own parent')
  // one parent: the partner side lists the child
  json(await call('one_update_row', { id: ids.tessera, properties: { 'Parent item': ['Nordlicht'] } }))
  expect(await wsEval(page, (s, n: string) => s.pages[n].properties['pr-parent.2way'] ?? [], ids.nordlicht)).toEqual([ids.tessera])
})
