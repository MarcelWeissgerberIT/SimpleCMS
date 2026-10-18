/**
 * MCP T-a, Weg 4 D4 on the local bridge: the write gate (src/shared/mcp/targets.ts, features/mcp/gate.ts) — ONE table
 * over every write tool × { a template's id, one in the trash, One's own database, locked while the card waited, a page
 * the person limited with context marks } → the code the call ends with ('ok': allowed — a locked database keeps its
 * rows, title and icon writable; a locked page keeps its place, its title and its trash; an append never overwrites what
 * the marks hide). Plan-time refusals come before any card and write nothing; "locked while the card waited" is refused
 * right before the call writes. The team server runs the same rows (server/test/mcp-gate.test.ts). Driven like Claude
 * Code drives it (the built bridge through the MCP SDK's stdio client, its own port). Fictional data (Nordlicht, Tessera,
 * Mara Lind, Launch plan, Wissensbasis).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush, doc, para } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47373

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

async function connect(page: Page) {
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
  await page.getByRole('radio', { name: 'Ask first' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

const item = (itemId: string, title: string): JSONContent => ({ type: 'workItem', attrs: { itemId, status: 'todo' }, content: [para(title)] })
const block = (id: string, t: string): JSONContent => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: t }] })

/**
 * The workspace of the table: `tpl` a template (with `tplDb`, `tplRow`, a task `wi_gatetpl001`); `gone` a page in the trash,
 * `dbGone` a database in it, `rowGone` a row in it (a task `wi_gategone01` in `gone`); `dbSys` One's memory with `sysRow`
 * (a task `wi_gatesys001` in its text), `goneSys` a page in the trash holding One's memory log; `hb` the page locked
 * while a card waits (a task `wi_gatehb0001`), `dbL` the database locked while a card waits (`rowL`), `lkp` a row of `db`
 * whose page gets locked; `marked` a page the person limits with context marks (blocks `mk-1`, `mk-2`, a task
 * `wi_gatemk0001`); `pg` / `pg2` ordinary pages, `db` an ordinary database (`row1`), `db2` another.
 */
async function seed(page: Page) {
  const ids = await seedPages(page)
  // a second view on three databases (the store's state is read fresh: wsEval's `s` is the state when it started)
  await wsEval(page, (s, list: string[]) => list.forEach((id) => s.addView(id, { ...s.databases[id].views[0], id: `v-list-${id}`, name: 'List', type: 'list' })), [ids.dbL, ids.db2, ids.dbSys])
  return ids
}

async function seedPages(page: Page) {
  return wsEval(
    page,
    (s, a: { tasks: Record<string, JSONContent>; blocks: JSONContent[] }) => {
      const props = [
        { id: 'c', name: 'Code', type: 'text' },
      ] as never
      const pg = s.createPage({ title: 'Launch plan' })
      const pg2 = s.createPage({ title: 'Wissensbasis' })
      const hb = s.createPage({ title: 'Handbuch' })
      s.setContent(hb, { type: 'doc', content: [a.blocks[0], a.tasks.hb] }, 'e2e')
      const marked = s.createPage({ title: 'Nordlicht notes' })
      s.setContent(marked, { type: 'doc', content: [a.blocks[1], a.blocks[2], a.tasks.mk] }, 'e2e')
      const tpl = s.createPage({ title: 'Sprint kit' })
      s.setContent(tpl, { type: 'doc', content: [a.tasks.tpl] }, 'e2e')
      s.updatePage(tpl, { template: { name: 'Sprint kit' }, hidden: true } as never)
      const tplDb = s.createDatabase({ title: 'Sprint board', parentId: tpl, properties: [{ id: 'n', name: 'Name', type: 'title' }, ...(props as unknown as AnyState[])] as never })
      const tplRow = s.createRow(tplDb, { title: 'Sprint card', properties: { c: 'T1' } })
      const db = s.createDatabase({ title: 'Tessera', properties: [{ id: 'n', name: 'Name', type: 'title' }, ...(props as unknown as AnyState[])] as never })
      const row1 = s.createRow(db, { title: 'Mara Lind', properties: { c: 'ML' } })
      const lkp = s.createRow(db, { title: 'Tessera charter', properties: { c: 'LKP' } })
      const rowGone = s.createRow(db, { title: 'Old row', properties: { c: 'OLD' } })
      s.trashPage(rowGone)
      const db2 = s.createDatabase({ title: 'Nordlicht', properties: [{ id: 'n', name: 'Name', type: 'title' }, ...(props as unknown as AnyState[])] as never })
      const dbL = s.createDatabase({ title: 'Archiv', properties: [{ id: 'n', name: 'Name', type: 'title' }, ...(props as unknown as AnyState[])] as never })
      const rowL = s.createRow(dbL, { title: 'Archived', properties: { c: 'LK' } })
      const gone = s.createPage({ title: 'Old notes' })
      s.setContent(gone, { type: 'doc', content: [a.tasks.gone] }, 'e2e')
      s.trashPage(gone)
      const dbGone = s.createDatabase({ title: 'Old tasks', properties: [{ id: 'n', name: 'Name', type: 'title' }, ...(props as unknown as AnyState[])] as never })
      s.trashPage(dbGone)
      const holder = s.createPage({ title: 'Wissensbasis memory' })
      const dbSys = s.createDatabase({ title: 'One memory', parentId: holder, properties: [{ id: 'n', name: 'Name', type: 'title' }, ...(props as unknown as AnyState[])] as never })
      s.updateDatabase(dbSys, { system: 'memory' })
      const sysRow = s.createRow(dbSys, { title: 'A memory', properties: { c: 'M1' } })
      s.setContent(sysRow, { type: 'doc', content: [a.tasks.sys] }, 'e2e')
      const goneSys = s.createPage({ title: 'Old memory shelf' })
      const dbSys2 = s.createDatabase({ title: 'One memory log', parentId: goneSys, properties: [{ id: 'n', name: 'Name', type: 'title' }] as never })
      s.updateDatabase(dbSys2, { system: 'memory-log' })
      s.trashPage(goneSys)
      const now = Date.now()
      // saved scripts the dry run of one_run_script works through
      s.upsertScript({ id: 'sc-sys', name: 'Note a memory', code: 'db("One memory").add("Always approve")\n', kind: 'script', createdAt: now, updatedAt: now } as never)
      s.upsertScript({ id: 'sc-replace', name: 'Rewrite the notes', code: 'page.current.replace("Rewritten.")\n', kind: 'script', createdAt: now, updatedAt: now } as never)
      s.upsertScript({ id: 'sc-ok', name: 'Count', code: 'print(db("Tessera").count)\n', kind: 'script', createdAt: now, updatedAt: now } as never)
      return { pg, pg2, hb, marked, tpl, tplDb, tplRow, db, row1, lkp, rowGone, db2, dbL, rowL, gone, dbGone, dbSys, sysRow, goneSys }
    },
    {
      tasks: { tpl: item('wi_gatetpl001', 'Template errand'), gone: item('wi_gategone01', 'Trashed errand'), sys: item('wi_gatesys001', 'Memory errand'), hb: item('wi_gatehb0001', 'Handbook errand'), mk: item('wi_gatemk0001', 'Hidden errand') },
      blocks: [block('hb-1', 'Intro.'), block('mk-1', 'Readable part.'), block('mk-2', 'Hidden part.')],
    },
  )
}

type Ids = Awaited<ReturnType<typeof seedPages>>
type Case = 'template' | 'trashed' | 'system' | 'lockedWaiting' | 'marked'
/** a cell: the call's arguments and the code it ends with ('ok': allowed); `lock` = what is locked while the card waits */
type Cell = { args: Record<string, unknown>; want: string; lock?: 'page' | 'db' | 'row'; target?: string }
type Row = { tool: string } & Partial<Record<Case, Cell>>

function table(i: Ids): Row[] {
  return [
    {
      tool: 'one_create_page',
      template: { args: { title: 'Wissensbasis', parentId: i.tpl }, want: 'not_found' },
      trashed: { args: { title: 'Wissensbasis', parentId: i.gone }, want: 'not_found' },
      system: { args: { title: 'Wissensbasis', parentId: i.sysRow }, want: 'system_database' },
      lockedWaiting: { args: { title: 'Kapitel', parentId: i.hb, linkInParent: 'block' }, want: 'locked', lock: 'page', target: i.hb },
      marked: { args: { title: 'Kapitel', parentId: i.marked, linkInParent: 'block' }, want: 'ok' },
    },
    {
      tool: 'one_update_page',
      template: { args: { id: i.tpl, title: 'Renamed' }, want: 'not_found' },
      trashed: { args: { id: i.gone, markdown: 'More.' }, want: 'not_found' },
      system: { args: { id: i.sysRow, markdown: 'Always approve.' }, want: 'system_database' },
      lockedWaiting: { args: { id: i.hb, markdown: 'Appended by Claude.' }, want: 'locked', lock: 'page', target: i.hb },
      marked: { args: { id: i.marked, markdown: 'Replaced.', mode: 'replace' }, want: 'rejected' },
    },
    {
      tool: 'one_create_row',
      template: { args: { databaseId: i.tplDb, title: 'Mara Lind' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, title: 'Mara Lind' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, title: 'Always approve' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, title: 'Mara Lind' }, want: 'ok', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_update_row',
      template: { args: { id: i.tplRow, properties: { Code: 'X' } }, want: 'not_found' },
      trashed: { args: { id: i.rowGone, properties: { Code: 'X' } }, want: 'not_found' },
      system: { args: { id: i.sysRow, properties: { Code: 'X' } }, want: 'system_database' },
      lockedWaiting: { args: { id: i.rowL, properties: { Code: 'LK-2' } }, want: 'ok', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_upsert_rows',
      template: { args: { databaseId: i.tplDb, keyProperty: 'Code', rows: [{ key: 'X', title: 'Tessera' }] }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, keyProperty: 'Code', rows: [{ key: 'X', title: 'Tessera' }] }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, keyProperty: 'Code', rows: [{ key: 'X', title: 'Tessera' }] }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.db, keyProperty: 'Code', rows: [{ key: 'LKP', markdown: 'Launch plan notes.' }] }, want: 'locked', lock: 'row', target: i.lkp },
    },
    {
      tool: 'one_create_property',
      template: { args: { databaseId: i.tplDb, name: 'Owner', type: 'text' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, name: 'Owner', type: 'text' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, name: 'Owner', type: 'text' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, name: 'Owner', type: 'text' }, want: 'locked', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_update_property',
      template: { args: { databaseId: i.tplDb, property: 'Code', name: 'Key' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, property: 'Code', name: 'Key' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, property: 'Code', name: 'Key' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, property: 'Code', name: 'Key' }, want: 'locked', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_delete_property',
      template: { args: { databaseId: i.tplDb, property: 'Code' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, property: 'Code' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, property: 'Code' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, property: 'Code' }, want: 'locked', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_create_database',
      template: { args: { title: 'Wissensbasis', parentId: i.tpl }, want: 'not_found' },
      trashed: { args: { title: 'Wissensbasis', parentId: i.gone }, want: 'not_found' },
      system: { args: { title: 'Wissensbasis', parentId: i.sysRow }, want: 'system_database' },
      lockedWaiting: { args: { title: 'Wissensbasis', inline: { pageId: i.hb } }, want: 'locked', lock: 'page', target: i.hb },
      marked: { args: { title: 'Wissensbasis', inline: { pageId: i.marked, afterBlock: '#mk-2' } }, want: 'rejected' },
    },
    {
      tool: 'one_update_database',
      template: { args: { id: i.tplDb, title: 'Renamed' }, want: 'not_found' },
      trashed: { args: { id: i.dbGone, title: 'Renamed' }, want: 'not_found' },
      system: { args: { id: i.dbSys, title: 'Renamed' }, want: 'system_database' },
      lockedWaiting: { args: { id: i.dbL, title: 'Archiv Tessera' }, want: 'ok', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_create_view',
      template: { args: { databaseId: i.tplDb, type: 'list' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, type: 'list' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, type: 'list' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, type: 'list' }, want: 'locked', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_update_view',
      template: { args: { databaseId: i.tplDb, view: 'Table', name: 'Grid' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, view: 'Table', name: 'Grid' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, view: 'List', name: 'Grid' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, view: 'List', name: 'Grid' }, want: 'locked', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_delete_view',
      template: { args: { databaseId: i.tplDb, view: 'Table' }, want: 'not_found' },
      trashed: { args: { databaseId: i.dbGone, view: 'Table' }, want: 'not_found' },
      system: { args: { databaseId: i.dbSys, view: 'List' }, want: 'system_database' },
      lockedWaiting: { args: { databaseId: i.dbL, view: 'List' }, want: 'locked', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_move_page',
      template: { args: { id: i.tpl, parentId: i.pg }, want: 'not_found' },
      trashed: { args: { id: i.gone, parentId: i.pg }, want: 'not_found' },
      system: { args: { id: i.pg2, parentId: i.sysRow }, want: 'system_database' },
      lockedWaiting: { args: { id: i.pg2, parentId: i.hb }, want: 'ok', lock: 'page', target: i.hb },
      marked: { args: { id: i.pg, parentId: i.marked }, want: 'ok' },
    },
    {
      tool: 'one_move_row',
      template: { args: { id: i.tplRow, databaseId: i.db2 }, want: 'not_found' },
      trashed: { args: { id: i.rowGone, databaseId: i.db2 }, want: 'not_found' },
      system: { args: { id: i.row1, databaseId: i.dbSys }, want: 'system_database' },
      lockedWaiting: { args: { id: i.row1, databaseId: i.dbL }, want: 'ok', lock: 'db', target: i.dbL },
    },
    {
      tool: 'one_update_work_item',
      template: { args: { updates: [{ item: 'wi_gatetpl001', status: 'done' }] }, want: 'bad_argument' },
      trashed: { args: { updates: [{ item: 'wi_gategone01', status: 'done' }] }, want: 'bad_argument' },
      system: { args: { updates: [{ item: 'wi_gatesys001', status: 'done' }] }, want: 'system_database' },
      lockedWaiting: { args: { updates: [{ item: 'wi_gatehb0001', status: 'done' }] }, want: 'locked', lock: 'page', target: i.hb },
      marked: { args: { updates: [{ item: 'wi_gatemk0001', status: 'done' }] }, want: 'bad_argument' },
    },
    {
      tool: 'one_run_script',
      template: { args: { script: 'Count', pageId: i.tpl }, want: 'not_found' },
      trashed: { args: { script: 'Count', pageId: i.gone }, want: 'not_found' },
      system: { args: { script: 'Note a memory' }, want: 'system_database' },
      marked: { args: { script: 'Rewrite the notes', pageId: i.marked }, want: 'rejected' },
    },
    {
      tool: 'one_trash_page',
      template: { args: { id: i.tpl }, want: 'not_found' },
      trashed: { args: { id: i.gone }, want: 'not_found' },
      system: { args: { id: i.dbSys }, want: 'system_database' },
      lockedWaiting: { args: { id: i.pg2 }, want: 'ok', lock: 'page', target: i.pg2 },
    },
    {
      tool: 'one_restore_page',
      template: { args: { id: i.tpl }, want: 'not_found' },
      system: { args: { id: i.goneSys }, want: 'system_database' },
    },
  ]
}

const codeOf = (r: ToolResult): string => (r.isError ? (text(r).match(/^([a-z_]+):/)?.[1] ?? '?') : 'ok')

/** What a refused call could have written: every page and database (bookkeeping stamps aside). */
const snapshot = (page: Page) =>
  wsEval(page, (s) =>
    JSON.stringify([
      Object.values(s.pages as Record<string, AnyState>)
        .map((p) => [p.id, p.title, p.parentId, p.databaseId, !!p.trashed, p.properties, p.contentRev ?? 0, !!p.settings?.locked])
        .sort(),
      Object.values(s.databases as Record<string, AnyState>)
        .map((d) => [d.id, d.properties.map((p: AnyState) => [p.id, p.name]), d.views.map((v: AnyState) => [v.id, v.name]), !!d.locked])
        .sort(),
    ]),
  )

test('every write tool × template · trash · One\'s own · context marks: refused before any card with the table\'s code, nothing written', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await flush(page)
  await connect(page)
  // the person limits what Claude may read of "Nordlicht notes": only its first block
  await page.evaluate(([id]) => (window as unknown as { __oneMcp: { context: (p: string, ids: string[] | null) => Promise<void> } }).__oneMcp.context(id!, ['mk-1']), [ids.marked])
  const before = await snapshot(page)
  const got: string[] = []
  const want: string[] = []
  for (const row of table(ids)) {
    for (const c of ['template', 'trashed', 'system', 'marked'] as const) {
      const cell = row[c]
      if (!cell || cell.want === 'ok') continue
      const r = await call(row.tool, cell.args)
      got.push(`${row.tool} × ${c} → ${codeOf(r)}${r.isError ? '' : ` (${text(r).slice(0, 80)})`}`)
      want.push(`${row.tool} × ${c} → ${cell.want}`)
      if (r.isError && c === 'template') expect(text(r), `${row.tool} names the template`).not.toMatch(/Sprint kit|Sprint board|Sprint card|Template errand/)
      if (r.isError) expect.soft(text(r), `${row.tool} × ${c}`).toMatch(/Nothing was (changed|moved to the trash|restored)/)
    }
  }
  expect(got).toEqual(want)
  // refused before any card: none was shown, nothing written
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await flush(page)
  expect(await snapshot(page)).toBe(before)
})

test('locked while the card waited: refused right before the call writes (nothing written); what a lock leaves writable goes through', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await flush(page)
  await connect(page)
  const card = page.getByRole('alertdialog')
  const setLock = (kind: 'page' | 'db' | 'row', id: string, on: boolean) =>
    wsEval(page, (s, a: { kind: string; id: string; on: boolean }) => (a.kind === 'db' ? s.updateDatabase(a.id, { locked: a.on }) : s.updatePage(a.id, { settings: { ...s.pages[a.id].settings, locked: a.on } })), { kind, id, on })
  const got: string[] = []
  const want: string[] = []
  // refusals first (they write nothing), then the calls a lock leaves writable
  const rows = table(ids).filter((r) => r.lockedWaiting)
  const order = [...rows.filter((r) => r.lockedWaiting!.want !== 'ok'), ...rows.filter((r) => r.lockedWaiting!.want === 'ok')]
  for (const row of order) {
    const cell = row.lockedWaiting!
    const before = cell.want === 'ok' ? '' : await snapshot(page)
    const pending = call(row.tool, cell.args)
    await expect(card).toBeVisible()
    await setLock(cell.lock!, cell.target!, true)
    await flush(page)
    await card.getByRole('button', { name: /Approve/ }).click()
    const r = await pending
    got.push(`${row.tool} → ${codeOf(r)}`)
    want.push(`${row.tool} → ${cell.want}`)
    if (cell.want !== 'ok') {
      expect(text(r)).toMatch(/was locked meanwhile/)
      // nothing written (the lock aside)
      await setLock(cell.lock!, cell.target!, false)
      await flush(page)
      expect(await snapshot(page), `${row.tool} wrote nothing`).toBe(before)
    } else await setLock(cell.lock!, cell.target!, false)
    await expect(card).toHaveCount(0)
  }
  expect(got).toEqual(want)
})

test('trashed and made One\'s own while the card waited: the gate refuses right before the call writes', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await flush(page)
  await connect(page)
  const card = page.getByRole('alertdialog')
  // a parent going to the trash while the card waits
  let pending = call('one_create_page', { title: 'Kapitel', parentId: ids.pg })
  await expect(card).toBeVisible()
  await wsEval(page, (s, id: string) => s.trashPage(id), ids.pg)
  await flush(page)
  await card.getByRole('button', { name: /Approve/ }).click()
  let r = await pending
  expect(text(r)).toMatch(/^not_found: parentId: "Launch plan" went to the trash since the call was made\. Nothing was changed\./)
  expect(await wsEval(page, (s) => Object.values(s.pages as Record<string, AnyState>).some((p) => p.title === 'Kapitel'))).toBe(false)
  // a database made One's own while the card waits: its view stays as One made it
  pending = call('one_create_view', { databaseId: ids.db2, type: 'table', name: 'Grid' })
  await expect(card).toBeVisible()
  await wsEval(page, (s, id: string) => s.updateDatabase(id, { system: 'memory' }), ids.db2)
  await flush(page)
  await card.getByRole('button', { name: /Approve/ }).click()
  r = await pending
  expect(text(r)).toMatch(/^system_database: databaseId: "Nordlicht" is One's memory database/)
  expect(await wsEval(page, (s, id: string) => s.databases[id].views.length, ids.db2)).toBe(2)
})

test('the gate decides "always asked" from what a call touches too: 5 rows in a database that sends something out of One', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  // an automation that sends a webhook when a row is deleted: a row batch that only creates rows sets nothing off, but
  // the database sends something out of One — from 5 rows the call is asked, also in Apply directly
  await wsEval(page, (s, db: string) => s.updateDatabase(db, { automations: [{ id: 'au-1', name: 'Tell Tessera', enabled: true, trigger: { type: 'row_deleted' }, actions: [{ type: 'webhook', url: 'https://hooks.invalid/one' }] }] } as never), ids.db2)
  await flush(page)
  await connect(page)
  await openAgentsTab(page)
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await page.keyboard.press('Escape')
  const pending = call('one_create_row', { databaseId: ids.db2, rows: ['A', 'B', 'C', 'D', 'E'].map((t) => ({ title: `Mara Lind ${t}` })) })
  const card = page.getByRole('alertdialog')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Always asked: 5 rows start paid AI work or send something out of One.')
  await card.getByRole('button', { name: /Approve/ }).click()
  expect(json(await pending).rows).toHaveLength(5)
  // four rows: applied directly
  json(await call('one_create_row', { databaseId: ids.db2, rows: ['F', 'G', 'H', 'I'].map((t) => ({ title: `Mara Lind ${t}` })) }))
  await expect(card).toHaveCount(0)
})
