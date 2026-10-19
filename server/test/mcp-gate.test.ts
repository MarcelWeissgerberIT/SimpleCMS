/**
 * MCP T-a, Weg 4 D4 on the team server: the write gate (src/shared/mcp/targets.ts, server/src/mcp/gate.ts) — every write
 * tool × { a template's page, one in the trash, One's own database, locked } → the code the call is refused with (or that
 * the call is allowed: a locked database keeps its rows, title and icon writable; a locked page keeps its place and
 * title). The same table runs on the local bridge (tests/e2e/mcp-gate.spec.ts; there also "locked while the card waited"
 * and "context-marked page" — a team server has neither a card nor the tab's marks). Nothing a refused call names is
 * written. Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan, Wissensbasis).
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer } from './helpers.ts'

function pageEntry(fields: Record<string, unknown>, properties: Record<string, unknown> = {}): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  yp.set('createdBy', 'seed')
  yp.set('updatedBy', 'seed')
  const props = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(properties)) props.set(k, v)
  yp.set('properties', props)
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

type Def = { id: string; name: string; type: string; [k: string]: unknown }
const SCHEMA: Def[] = [
  { id: 'n', name: 'Name', type: 'title' },
  { id: 'c', name: 'Code', type: 'text' },
]

function addDatabase(doc: Y.Doc, id: string, title: string, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1, ...fields }))
    const ydb = new Y.Map<unknown>()
    const pm = new Y.Map<unknown>()
    SCHEMA.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
    ydb.set('properties', pm)
    const views = new Y.Map<unknown>()
    views.set('v-1', { id: 'v-1', name: 'Table', type: 'table', filter: null, sorts: [], visibleProperties: ['c'], order: 0 })
    views.set('v-2', { id: 'v-2', name: 'List', type: 'list', filter: null, sorts: [], visibleProperties: ['c'], order: 1 })
    ydb.set('views', views)
    ydb.set('nextUniqueId', 1)
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-gate', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

type Case = 'template' | 'trashed' | 'system' | 'locked'
/** the code a call is refused with, or 'ok' (allowed: run it) */
type Want = string
type Row = { tool: string } & Partial<Record<Case, [Record<string, unknown>, Want]>>

/**
 * The table (the bridge's spec runs the same rows): ids — `tpl` a template's page, `tpl-db` a database in it, `tpl-row` its
 * row; `gone` a page in the trash, `db-gone` a database in the trash, `row-gone` a row in the trash; `db-sys` One's own
 * memory database, `sys-row` its row; `locked` a locked page, `db-locked` a locked database, `row-locked` a row whose page is
 * locked; `pg` / `pg-2` ordinary pages, `db` an ordinary database with `row-1`.
 */
const TABLE: Row[] = [
  {
    tool: 'one_create_page',
    template: [{ title: 'Wissensbasis', parentId: 'tpl' }, 'not_found'],
    trashed: [{ title: 'Wissensbasis', parentId: 'gone' }, 'not_found'],
    system: [{ title: 'Wissensbasis', parentId: 'sys-row' }, 'system_database'],
    locked: [{ title: 'Wissensbasis', parentId: 'locked', linkInParent: 'block' }, 'locked'],
  },
  {
    tool: 'one_update_page',
    template: [{ id: 'tpl', title: 'Wissensbasis' }, 'not_found'],
    trashed: [{ id: 'gone', title: 'Wissensbasis' }, 'not_found'],
    system: [{ id: 'sys-row', title: 'Wissensbasis' }, 'system_database'],
    locked: [{ id: 'locked', markdown: 'Launch plan notes.' }, 'locked'],
  },
  {
    tool: 'one_create_row',
    template: [{ databaseId: 'tpl-db', title: 'Mara Lind' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', title: 'Mara Lind' }, 'not_found'],
    system: [{ databaseId: 'db-sys', title: 'Mara Lind' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', title: 'Mara Lind' }, 'ok'],
  },
  {
    tool: 'one_update_row',
    template: [{ id: 'tpl-row', properties: { Code: 'X' } }, 'not_found'],
    trashed: [{ id: 'row-gone', properties: { Code: 'X' } }, 'not_found'],
    system: [{ id: 'sys-row', properties: { Code: 'X' } }, 'system_database'],
    locked: [{ id: 'row-l', properties: { Code: 'LK-2' } }, 'ok'],
  },
  {
    tool: 'one_upsert_rows',
    template: [{ databaseId: 'tpl-db', keyProperty: 'Code', rows: [{ key: 'X', title: 'Tessera' }] }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', keyProperty: 'Code', rows: [{ key: 'X', title: 'Tessera' }] }, 'not_found'],
    system: [{ databaseId: 'db-sys', keyProperty: 'Code', rows: [{ key: 'X', title: 'Tessera' }] }, 'system_database'],
    locked: [{ databaseId: 'db', keyProperty: 'Code', rows: [{ key: 'LKP', markdown: 'Launch plan notes.' }] }, 'locked'],
  },
  {
    tool: 'one_create_property',
    template: [{ databaseId: 'tpl-db', name: 'Owner', type: 'text' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', name: 'Owner', type: 'text' }, 'not_found'],
    system: [{ databaseId: 'db-sys', name: 'Owner', type: 'text' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', name: 'Owner', type: 'text' }, 'locked'],
  },
  {
    tool: 'one_update_property',
    template: [{ databaseId: 'tpl-db', property: 'Code', name: 'Key' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', property: 'Code', name: 'Key' }, 'not_found'],
    system: [{ databaseId: 'db-sys', property: 'Code', name: 'Key' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', property: 'Code', name: 'Key' }, 'locked'],
  },
  {
    tool: 'one_delete_property',
    template: [{ databaseId: 'tpl-db', property: 'Code' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', property: 'Code' }, 'not_found'],
    system: [{ databaseId: 'db-sys', property: 'Code' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', property: 'Code' }, 'locked'],
  },
  {
    tool: 'one_create_database',
    template: [{ title: 'Wissensbasis', parentId: 'tpl' }, 'not_found'],
    trashed: [{ title: 'Wissensbasis', parentId: 'gone' }, 'not_found'],
    system: [{ title: 'Wissensbasis', parentId: 'sys-row' }, 'system_database'],
    locked: [{ title: 'Wissensbasis', inline: { pageId: 'locked' } }, 'locked'],
  },
  {
    tool: 'one_update_database',
    template: [{ id: 'tpl-db', title: 'Wissensbasis' }, 'not_found'],
    trashed: [{ id: 'db-gone', title: 'Wissensbasis' }, 'not_found'],
    system: [{ id: 'db-sys', title: 'Wissensbasis' }, 'system_database'],
    locked: [{ id: 'db-locked', title: 'Archiv Tessera' }, 'ok'],
  },
  {
    tool: 'one_create_view',
    template: [{ databaseId: 'tpl-db', type: 'list' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', type: 'list' }, 'not_found'],
    system: [{ databaseId: 'db-sys', type: 'list' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', type: 'list' }, 'locked'],
  },
  {
    tool: 'one_update_view',
    template: [{ databaseId: 'tpl-db', view: 'Table', name: 'Grid' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', view: 'Table', name: 'Grid' }, 'not_found'],
    system: [{ databaseId: 'db-sys', view: 'Table', name: 'Grid' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', view: 'Table', name: 'Grid' }, 'locked'],
  },
  {
    tool: 'one_delete_view',
    template: [{ databaseId: 'tpl-db', view: 'List' }, 'not_found'],
    trashed: [{ databaseId: 'db-gone', view: 'List' }, 'not_found'],
    system: [{ databaseId: 'db-sys', view: 'List' }, 'system_database'],
    locked: [{ databaseId: 'db-locked', view: 'List' }, 'locked'],
  },
  {
    tool: 'one_move_page',
    template: [{ id: 'tpl', parentId: 'pg' }, 'not_found'],
    trashed: [{ id: 'gone', parentId: 'pg' }, 'not_found'],
    system: [{ id: 'pg-2', parentId: 'sys-row' }, 'system_database'],
    locked: [{ id: 'pg-2', parentId: 'locked' }, 'ok'],
  },
  {
    tool: 'one_move_row',
    template: [{ id: 'tpl-row', databaseId: 'db' }, 'not_found'],
    trashed: [{ id: 'row-gone', databaseId: 'db-locked' }, 'not_found'],
    system: [{ id: 'row-1', databaseId: 'db-sys' }, 'system_database'],
    locked: [{ id: 'row-1', databaseId: 'db-locked' }, 'ok'],
  },
  {
    tool: 'one_trash_page',
    template: [{ id: 'tpl' }, 'not_found'],
    trashed: [{ id: 'gone' }, 'not_found'],
    system: [{ id: 'db-sys' }, 'system_database'],
    locked: [{ id: 'locked' }, 'ok'],
  },
  {
    tool: 'one_restore_page',
    template: [{ id: 'tpl' }, 'not_found'],
    system: [{ id: 'gone-sys' }, 'system_database'],
  },
]

describe('Weg 4 D4: the write gate on the team server — every write tool × template · trash · One\'s own · locked', () => {
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let writer: McpClient
  const pages = () => meta.doc.getMap('pages')
  /** everything a refused call could have written */
  const snapshot = () => JSON.stringify([meta.doc.getMap('pages').toJSON(), meta.doc.getMap('databases').toJSON()])

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht-gate.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = openDoc(server, owner, `ws:${wsId}`)
    await meta.synced
    meta.doc.transact(() => {
      pages().set('pg', pageEntry({ title: 'Launch plan', order: 1 }))
      pages().set('pg-2', pageEntry({ title: 'Wissensbasis', order: 2 }))
      pages().set('locked', pageEntry({ title: 'Handbuch', order: 3, settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } }))
      pages().set('gone', pageEntry({ title: 'Old notes', order: 4, trashed: true, trashedAt: Date.now() }))
      pages().set('gone-sys', pageEntry({ title: 'Old memory shelf', order: 5, trashed: true, trashedAt: Date.now() }))
      // a template (the gallery's blueprint): its root, a database inside it and a row of that
      pages().set('tpl', pageEntry({ title: 'Sprint kit', order: 6, hidden: true, template: { name: 'Sprint kit' } }))
    })
    addDatabase(meta.doc, 'db', 'Tessera')
    addDatabase(meta.doc, 'db-locked', 'Archiv', {}, { locked: true })
    addDatabase(meta.doc, 'db-gone', 'Old tasks', { trashed: true, trashedAt: Date.now() })
    addDatabase(meta.doc, 'db-sys', 'Memory', {}, { system: 'memory' })
    addDatabase(meta.doc, 'db-sys-2', 'Memory log', { parentId: 'gone-sys' }, { system: 'memory-log' })
    addDatabase(meta.doc, 'tpl-db', 'Sprint board', { parentId: 'tpl' })
    meta.doc.transact(() => {
      pages().set('row-1', pageEntry({ title: 'Mara Lind', parentId: 'db', databaseId: 'db', order: 1 }, { c: 'ML' }))
      pages().set('row-lkp', pageEntry({ title: 'Tessera charter', parentId: 'db', databaseId: 'db', order: 2, settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } }, { c: 'LKP' }))
      pages().set('row-gone', pageEntry({ title: 'Old row', parentId: 'db', databaseId: 'db', order: 3, trashed: true, trashedAt: Date.now() }, { c: 'OLD' }))
      pages().set('row-l', pageEntry({ title: 'Archived', parentId: 'db-locked', databaseId: 'db-locked', order: 1 }, { c: 'LK' }))
      pages().set('sys-row', pageEntry({ title: 'A memory', parentId: 'db-sys', databaseId: 'db-sys', order: 1 }, { c: 'M1' }))
      pages().set('tpl-row', pageEntry({ title: 'Sprint row', parentId: 'tpl-db', databaseId: 'tpl-db', order: 1 }, { c: 'T1' }))
    })
    await flushed(meta)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    meta?.destroy()
    await server?.stop()
  })

  test('every refusal: the expected code, nothing written', async () => {
    const before = snapshot()
    const seen: string[] = []
    for (const row of TABLE) {
      for (const c of ['template', 'trashed', 'system', 'locked'] as const) {
        const cell = row[c]
        if (!cell || cell[1] === 'ok') continue
        const res = (await writer.callTool({ name: row.tool, arguments: cell[0] })) as ToolResult
        const text = res.content[0]?.text ?? ''
        assert.equal(res.isError, true, `${row.tool} × ${c} should be refused: ${text}`)
        assert.ok(text.startsWith(`${cell[1]}: `), `${row.tool} × ${c}: expected ${cell[1]}, got ${text}`)
        assert.match(text, /Nothing was (changed|restored|moved)/, `${row.tool} × ${c} says nothing was changed: ${text}`)
        // a template's page is never named (it reads like an unknown id)
        if (c === 'template') assert.doesNotMatch(text, /Sprint kit|Sprint board|Sprint row/, `${row.tool} × template names the template: ${text}`)
        seen.push(`${row.tool}×${c}`)
      }
    }
    assert.ok(seen.length >= 60, `the table ran ${seen.length} refusals`)
    await sleep(200)
    assert.equal(snapshot(), before, 'nothing a refused call names was written')
  })

  test('what stays allowed: a locked database keeps its rows, title and icon; a locked page its place and its trash', async () => {
    for (const row of TABLE) {
      const cell = row.locked
      if (!cell || cell[1] !== 'ok') continue
      const res = (await writer.callTool({ name: row.tool, arguments: cell[0] })) as ToolResult
      assert.ok(!res.isError, `${row.tool} × locked is allowed: ${res.content[0]?.text}`)
    }
  })

  test('a rollup the delete would clear in a locked database: refused with the reason, named by the gate', async () => {
    // a rollup in the locked database (renamed "Archiv Tessera" above) rolls up Tessera.Code through a relation
    meta.doc.transact(() => {
      const pm = (meta.doc.getMap('databases').get('db-locked') as Y.Map<unknown>).get('properties') as Y.Map<unknown>
      pm.set('rel', { id: 'rel', name: 'Project', type: 'relation', relationDatabaseId: 'db', order: 5 })
      pm.set('roll', { id: 'roll', name: 'Codes', type: 'rollup', rollup: { relationPropertyId: 'rel', targetPropertyId: 'c', fn: 'show_original' }, order: 6 })
    })
    await flushed(meta)
    const res = (await writer.callTool({ name: 'one_delete_property', arguments: { databaseId: 'db', property: 'Code' } })) as ToolResult
    assert.equal(res.isError, true)
    assert.match(res.content[0]!.text, /^locked: property: "Archiv Tessera" is locked in One: its rollup "Codes" rolls up "Code", and the delete would clear it/)
  })
})
