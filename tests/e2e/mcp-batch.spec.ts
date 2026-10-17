/**
 * MCP B3 on the local bridge (MCP plan § 2.2 / § 2.3 / § 3.2), driven like Claude Code drives it (the built bridge
 * through the MCP SDK's stdio client, its own port):
 *  - 50 sub-pages as a tree in ONE call: one card, one Approve, one Undo that puts every page into the trash;
 *  - a sub-page under a database ROW; one page placed (before / index); a link in the parent's text; `private` in a
 *    local workspace is a note, never a refusal;
 *  - a board grouped by Status with rows in ONE call (no groupable property → a Status is added, a table follows);
 *    an inline board after a block of a page's text;
 *  - 20 cards set to Done in ONE card; a bad row fails the whole call, nothing written;
 *  - one_upsert_rows: created / updated / unchanged, a refused row fails the whole call;
 *  - what a batch starts is named on the card (autofill), ≥ 5 such rows always asked — also in "Apply directly";
 *  - files values: this workspace's used files only (never a web address, never a file no page uses);
 *  - 50 pages apply in under a second.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan, Wissensbasis).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47376

let client: Client
let stderr = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(BRIDGE), 'public/mcp/one-mcp.mjs (npm run build:mcp)').toBe(true)
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIDGE],
    env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '8000' },
    stderr: 'pipe',
  })
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
const refused = async (name: string, args: Record<string, unknown>, re: RegExp) => {
  const r = await call(name, args)
  expect(r.isError, `${name} ${JSON.stringify(args).slice(0, 200)} → ${text(r)}`).toBe(true)
  expect(text(r)).toMatch(re)
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

/** Settings → Agents · MCP: the test port, switch on, this test's workspace adopted; then the approval mode. */
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

const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id]?.content ?? null, id) as Promise<JSONContent | null>

/** A tree of 50 chapters: $0 is the root, $1–$9 under it, the rest spread under $1–$9. */
const chapters = () =>
  Array.from({ length: 50 }, (_, i) => ({
    title: `Kapitel ${i + 1}`,
    ...(i === 0 ? {} : { parentId: i < 10 ? '$0' : `$${(i % 9) + 1}` }),
    ...(i < 3 ? { markdown: `Text of chapter ${i + 1} for Tessera.` } : {}),
  }))

test('Ask first: 50 sub-pages as a tree — ONE card, one Approve, one Undo that puts every page into the trash', async ({ page }) => {
  await openApp(page)
  const host = await wsEval(page, (s) => s.createPage({ title: 'Launch plan' }))
  await flush(page)
  await connect(page, 'Ask first')

  const pending = call('one_create_page', { parentId: host, pages: chapters() })
  const card = page.getByRole('alertdialog')
  await expect(card).toBeVisible()
  await expect(card).toContainText('New pages')
  await expect(card).toContainText('Create 50 pages in Launch plan')
  await expect(card.locator('.mcp-line', { hasText: '$12' })).toContainText('Kapitel 13 · under “Kapitel 5”')
  await expect(card.locator('.mcp-line--md')).toContainText('Text of chapter 1 for Tessera.')
  // one card for the whole call, nothing written before the OK
  await expect(page.getByRole('alertdialog')).toHaveCount(1)
  expect(await wsEval(page, (s) => Object.values(s.pages).filter((p: AnyState) => p.title.startsWith('Kapitel')).length)).toBe(0)
  await expect(card.getByRole('button', { name: /Approve/ })).toBeFocused()
  await page.keyboard.press('Enter')
  const out = json(await pending)
  await expect(card).toHaveCount(0)
  expect(out.pages).toHaveLength(50)
  expect(out.pages[0]).toMatchObject({ index: 0, title: 'Kapitel 1', parentId: host })
  expect(out.pages[5].parentId).toBe(out.pages[0].id)
  expect(out.pages[12].parentId).toBe(out.pages[4].id)
  const tree = await wsEval(page, (s, ids: string[]) => ids.map((id) => ({ parent: s.pages[id]?.parentId, origin: s.pages[id]?.contentOrigin, plain: s.pages[id]?.plain ?? '' })), out.pages.map((p: AnyState) => p.id))
  expect(tree[12].parent).toBe(out.pages[4].id)
  expect(tree[1].plain).toContain('Text of chapter 2')
  expect(tree[1].origin).toBe('ai')

  // the Undo: every page of the call to the trash (never deleted for good)
  await undoLast(page, 'one_create_page')
  const trashed = await wsEval(page, (s, ids: string[]) => ids.map((id) => s.pages[id]?.trashed === true), out.pages.map((p: AnyState) => p.id))
  expect(trashed.every(Boolean)).toBe(true)
})

test('Apply directly: 50 pages in under a second; a sub-page under a ROW; one page placed; links in the parent; private locally is a note', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const host = s.createPage({ title: 'Wissensbasis' })
    const locked = s.createPage({ title: 'Tessera charter' })
    s.updatePageSettings(locked, { locked: true })
    const db = s.createDatabase({ title: 'Nordlicht tasks' })
    const row = s.createRow(db, { title: 'Brief Mara Lind' })
    return { host, locked, db, row }
  })
  await flush(page)
  await connect(page, 'Apply directly')

  // perf: 50 pages (a tree) in one call
  const t0 = Date.now()
  const many = json(await call('one_create_page', { parentId: ids.host, pages: chapters() }))
  const took = Date.now() - t0
  expect(many.pages).toHaveLength(50)
  expect(took, `50 pages took ${took} ms`).toBeLessThan(1000)
  console.log(`[perf] one_create_page with 50 pages (Apply directly, bridge round trip): ${took} ms`)

  // a "$n" that is no earlier page, a database as parent: nothing is made
  const before = await wsEval(page, (s) => Object.keys(s.pages).length)
  await refused('one_create_page', { pages: [{ title: 'A', parentId: '$1' }, { title: 'B' }] }, /^bad_argument: pages\[0\]\.parentId: "\$1" is no earlier page/)
  await refused('one_create_page', { pages: [{ title: 'A' }, { title: 'B', parentId: ids.db }] }, /^bad_argument: pages\[1\]\.parentId: "Nordlicht tasks" is a database/)
  await refused('one_create_page', { pages: [{ title: 'A', markdown: 'x' }], title: 'B' }, /^bad_argument: title: with "pages" each page carries its own/)
  expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before)

  // a sub-page under a database row
  const sub = json(await call('one_create_page', { title: 'Notes on the brief', parentId: ids.row, markdown: 'Tessera follows up.' }))
  expect(sub.parentId).toBe(ids.row)
  expect(await wsEval(page, (s, id) => s.pages[id]?.parentId, sub.id)).toBe(ids.row)

  // one page placed: before the third chapter, then first of all
  const kids = (parent: string) => wsEval(page, (s, p) => Object.values(s.pages).filter((x: AnyState) => x.parentId === p && !x.trashed).sort((a: AnyState, b: AnyState) => a.order - b.order).map((x: AnyState) => x.id), parent)
  const root = many.pages[0].id
  const third = many.pages[3].id
  const vorwort = json(await call('one_create_page', { title: 'Vorwort', parentId: root, before: third }))
  const inhalt = json(await call('one_create_page', { title: 'Inhalt', parentId: root, index: 0 }))
  const order = await kids(root)
  expect(order[0]).toBe(inhalt.id)
  expect(order.indexOf(vorwort.id)).toBe(order.indexOf(third) - 1)
  await refused('one_create_page', { title: 'Nachwort', parentId: root, before: 'nope' }, /^not_found: before: "nope" is no page next to it/)

  // a link to each new page at the end of its parent's text (a page of the same call: in that page's own text)
  const linked = json(await call('one_create_page', { parentId: ids.host, linkInParent: 'block', pages: [{ title: 'Glossar' }, { title: 'FAQ' }, { title: 'Begriffe', parentId: '$0' }] }))
  const hostDoc = await contentOf(page, ids.host)
  const tail = (hostDoc?.content ?? []).slice(-2)
  expect(tail.map((n) => [n.type, n.attrs?.pageId])).toEqual([
    ['pageLink', linked.pages[0].id],
    ['pageLink', linked.pages[1].id],
  ])
  const glossar = await contentOf(page, linked.pages[0].id)
  expect(glossar?.content?.at(-1)).toMatchObject({ type: 'pageLink', attrs: { pageId: linked.pages[2].id } })
  const mention = json(await call('one_create_page', { title: 'Anhang', parentId: ids.host, linkInParent: 'mention' }))
  const last = (await contentOf(page, ids.host))?.content?.at(-1)
  expect(last?.content?.[0]).toMatchObject({ type: 'mention', attrs: { id: mention.id, kind: 'page', label: 'Anhang' } })
  await refused('one_create_page', { title: 'Anhang 2', parentId: ids.locked, linkInParent: 'block' }, /^locked: linkInParent: "Tessera charter" is locked in One/)
  // its Undo takes the link back with the page
  await undoLast(page, 'one_create_page')
  expect((await contentOf(page, ids.host))?.content?.some((n) => n.content?.[0]?.attrs?.id === mention.id)).toBe(false)
  expect(await wsEval(page, (s, id) => s.pages[id]?.trashed, mention.id)).toBe(true)

  // private in a local workspace: a normal page, and the answer says why
  const mine = json(await call('one_create_page', { title: 'Meine Notizen', private: true }))
  expect(mine.private).toBeUndefined()
  expect(mine.note).toMatch(/local workspace: it has no Private section/)
})

test('Apply directly: a board grouped by Status with rows in ONE call; nothing to group by → a Status is added; an inline board after a block', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const host = s.createPage({ title: 'Launch plan' })
    s.setContent(host, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'blk-intro-001' }, content: [{ type: 'text', text: 'Intro of the plan.' }] }, { type: 'paragraph', attrs: { id: 'blk-second-002' }, content: [{ type: 'text', text: 'Second paragraph.' }] }] }, 'e2e')
    return { host }
  })
  await flush(page)
  await connect(page, 'Apply directly')

  const board = json(
    await call('one_create_database', {
      title: 'Sprint board',
      parentId: ids.host,
      icon: '🗂️',
      properties: [{ name: 'Status', type: 'status', options: ['Todo', 'Doing', 'Done'] }, { name: 'Owner', type: 'text' }],
      views: [{ type: 'board', groupBy: 'Status' }],
      rows: [
        { title: 'Kick-off', properties: { Status: 'Doing', Owner: 'Mara Lind' } },
        { title: 'Brief', properties: { Status: 'Todo' } },
        { title: 'Retro', properties: { Status: 'Done' } },
      ],
    }),
  )
  expect(board.views.map((v: AnyState) => [v.type, v.groupBy])).toEqual([
    ['board', 'Status'],
    ['table', null],
  ])
  expect(board.note).toMatch(/table view was added/)
  expect(board.rows.map((r: AnyState) => r.title)).toEqual(['Kick-off', 'Brief', 'Retro'])
  const stored = await wsEval(
    page,
    (s, b: AnyState) => {
      const db = s.databases[b.id]
      const status = db.properties.find((p: AnyState) => p.name === 'Status')
      const row = s.pages[b.rows[0].id]
      return { first: db.views[0].type, groupBy: db.views[0].groupBy === status.id, value: status.options.find((o: AnyState) => o.id === row.properties[status.id])?.name, icon: s.pages[b.id].icon }
    },
    board,
  )
  expect(stored).toEqual({ first: 'board', groupBy: true, value: 'Doing', icon: { type: 'emoji', value: '🗂️' } })

  // nothing to group by: a Status property is added and the answer says so
  const ideas = json(await call('one_create_database', { title: 'Ideen', properties: [{ name: 'Notes', type: 'text' }], views: [{ type: 'board' }] }))
  expect(ideas.properties.some((p: AnyState) => p.name === 'Status' && p.type === 'status')).toBe(true)
  expect(ideas.views[0].groupBy).toBe('Status')
  expect(ideas.note).toMatch(/"Status" property/)

  // a bad row writes nothing — not even the database
  const n = await wsEval(page, (s) => Object.keys(s.pages).length)
  await refused('one_create_database', { title: 'Broken', properties: [{ name: 'Status', type: 'status', options: ['Todo'] }], rows: [{ title: 'Ok' }, { title: 'Bad', properties: { Status: 'Nope' } }] }, /^bad_argument: rows\[1\]\.properties: /)
  expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(n)

  // inline: a database block right after the first paragraph
  const inline = json(await call('one_create_database', { title: 'Plan board', inline: { pageId: ids.host, afterBlock: '#blk-intro' }, views: [{ type: 'board' }] }))
  expect(inline.pageId).toBe(ids.host)
  const blocks = (await contentOf(page, ids.host))?.content ?? []
  expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'databaseBlock', 'paragraph'])
  expect(blocks[1]?.attrs?.databaseId).toBe(inline.id)
  expect(await wsEval(page, (s, id) => [s.pages[id]?.parentId, s.pages[id]?.inline ?? s.databases[id]?.inline ?? null], inline.id)).toEqual([ids.host, expect.anything()])
  await refused('one_create_database', { title: 'No', inline: { pageId: ids.host, afterBlock: '#zzzzzz' } }, /^stale_ref: inline\.afterBlock/)
  // its Undo: the block goes, the database to the trash
  await undoLast(page, 'one_create_database')
  expect(((await contentOf(page, ids.host))?.content ?? []).some((b) => b.type === 'databaseBlock')).toBe(false)
  expect(await wsEval(page, (s, id) => s.pages[id]?.trashed, inline.id)).toBe(true)
})

/** "Cards": Status (Todo / Doing / Done), Ticket (text), Owner (text) and `count` cards "Card 1" … with Ticket T-1 … */
async function cards(page: Page, count: number) {
  const ids = await wsEval(
    page,
    (s, count: number) => {
      const db = s.createDatabase({
        title: 'Cards',
        properties: [
          { id: 'c-title', name: 'Name', type: 'title' },
          { id: 'c-status', name: 'Status', type: 'status', options: [{ id: 's-todo', name: 'Todo', color: 'gray', group: 'todo' }, { id: 's-doing', name: 'Doing', color: 'blue', group: 'in_progress' }, { id: 's-done', name: 'Done', color: 'green', group: 'done' }] },
          { id: 'c-ticket', name: 'Ticket', type: 'text' },
          { id: 'c-owner', name: 'Owner', type: 'text' },
        ],
      })
      const rows: string[] = []
      for (let i = 1; i <= count; i++) rows.push(s.createRow(db, { title: `Card ${i}`, properties: { 'c-status': 's-todo', 'c-ticket': `T-${i}` } }))
      return { db, rows }
    },
    count,
  )
  await flush(page)
  return ids
}

const statusOf = (page: Page, ids: string[]) => wsEval(page, (s, ids: string[]) => ids.map((id) => s.pages[id]?.properties?.['c-status']), ids)

test('Ask first: 20 cards set to Done in ONE card; a bad row fails the whole call and writes nothing; rows in bulk', async ({ page }) => {
  await openApp(page)
  const { db, rows } = await cards(page, 20)
  await connect(page, 'Ask first')

  const pending = call('one_update_row', { rows: rows.map((id) => ({ id, properties: { Status: 'Done' } })) })
  const card = page.getByRole('alertdialog')
  await expect(card).toContainText('Edit rows')
  await expect(card).toContainText('Change 20 rows in Cards')
  await expect(card.locator('.mcp-line', { hasText: 'Card 20' })).toContainText('Status: Todo → Done')
  await expect(page.getByRole('alertdialog')).toHaveCount(1)
  expect((await statusOf(page, rows)).every((v) => v === 's-todo')).toBe(true)
  await page.keyboard.press('Enter')
  const out = json(await pending)
  expect(out.rows).toHaveLength(20)
  expect(out.rows[0]).toEqual({ id: rows[0], changed: ['Status'] })
  expect((await statusOf(page, rows)).every((v) => v === 's-done')).toBe(true)

  // one bad row: refused before any card, nothing written
  await refused('one_update_row', { rows: [{ id: rows[0], properties: { Status: 'Doing' } }, { id: rows[1], properties: { Status: 'Nope' } }] }, /^bad_argument: rows\[1\]/)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect((await statusOf(page, rows.slice(0, 2))).every((v) => v === 's-done')).toBe(true)

  // rows in bulk: one card, then the ids in order
  const made = call('one_create_row', { databaseId: db, rows: [{ title: 'Neu 1', properties: { Ticket: 'T-101' } }, { title: 'Neu 2', properties: { Ticket: 'T-102', Owner: 'Mara Lind' } }] })
  await expect(card).toContainText('Create 2 rows in Cards')
  await expect(card.locator('.mcp-line', { hasText: '02 · Neu 2' })).toContainText('Owner: Mara Lind')
  await page.keyboard.press('Enter')
  const res = json(await made)
  expect(res.rows.map((r: AnyState) => [r.index, r.title])).toEqual([
    [0, 'Neu 1'],
    [1, 'Neu 2'],
  ])
  expect(await wsEval(page, (s, id) => s.pages[id]?.databaseId, res.rows[1].id)).toBe(db)
  // its Undo: both rows to the trash
  await undoLast(page, 'one_create_row')
  expect(await wsEval(page, (s, r: AnyState[]) => r.map((x) => s.pages[x.id]?.trashed), res.rows)).toEqual([true, true])
})

test('Apply directly: one_upsert_rows — created / updated / unchanged; a refused row fails the whole call', async ({ page }) => {
  await openApp(page)
  const { db, rows } = await cards(page, 3)
  await connect(page, 'Apply directly')

  const out = json(
    await call('one_upsert_rows', {
      databaseId: db,
      keyProperty: 'Ticket',
      rows: [
        { key: 'T-1', properties: { Owner: 'Mara Lind' } },
        { key: 'T-2', properties: { Status: 'Todo' } },
        { key: 'T-300', title: 'Neues Ticket', properties: { Status: 'Doing' } },
      ],
    }),
  )
  expect(out.rows.map((r: AnyState) => [r.key, r.action])).toEqual([
    ['T-1', 'updated'],
    ['T-2', 'unchanged'],
    ['T-300', 'created'],
  ])
  expect(out.rows[0].id).toBe(rows[0])
  expect(await wsEval(page, (s, id) => s.pages[id]?.properties['c-owner'], rows[0])).toBe('Mara Lind')
  const fresh = out.rows[2].id
  expect(await wsEval(page, (s, id) => [s.pages[id]?.title, s.pages[id]?.properties['c-ticket'], s.pages[id]?.properties['c-status']], fresh)).toEqual(['Neues Ticket', 'T-300', 's-doing'])

  // the same call again: nothing to change
  const again = json(await call('one_upsert_rows', { databaseId: db, keyProperty: 'Ticket', rows: [{ key: 'T-1', properties: { Owner: 'Mara Lind' } }] }))
  expect(again.rows[0].action).toBe('unchanged')

  // one refused row: the whole call fails, every reason named, nothing written
  const n = await wsEval(page, (s) => Object.keys(s.pages).length)
  await refused('one_upsert_rows', { databaseId: db, keyProperty: 'Ticket', rows: [{ key: 'T-400', title: 'Ok' }, { key: 'T-401', properties: { Status: 'Nope' } }] }, /^bad_argument: rows: 1 of 2 rows do not fit: rows\[1\] \(key "T-401"\)/)
  await refused('one_upsert_rows', { databaseId: db, keyProperty: 'Nope', rows: [{ key: 'T-1' }] }, /^bad_argument: keyProperty: /)
  expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(n)
})

test('what a batch starts is on the card: autofill named; ≥ 5 such rows always asked, also in "Apply directly"', async ({ page }) => {
  await openApp(page)
  const { db, rows } = await cards(page, 6)
  await wsEval(
    page,
    (s, db: string) => {
      s.addProperty(db, { id: 'c-sum', name: 'Summary', type: 'text', autofill: { preset: 'summary', auto: true } })
    },
    db,
  )
  await flush(page)
  await connect(page, 'Apply directly')

  // 2 rows: written at once (below the line), the answer comes back
  json(await call('one_update_row', { rows: rows.slice(0, 2).map((id) => ({ id, properties: { Owner: 'Tessera' } })) }))
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // 5 rows that start autofill: asked although "Apply directly"
  const pending = call('one_update_row', { rows: rows.slice(0, 5).map((id) => ({ id, properties: { Owner: 'Mara Lind' } })) })
  const card = page.getByRole('alertdialog')
  await expect(card).toBeVisible()
  await expect(card.locator('.mcp-line', { hasText: 'Starts' })).toContainText('autofill on 5 rows (Summary)')
  await expect(card).toContainText('Always asked: 5 rows start paid AI work or send something out of One.')
  await page.keyboard.press('Escape')
  expect(text(await pending)).toContain('The person rejected this change')
  expect(await wsEval(page, (s, id) => s.pages[id]?.properties['c-owner'], rows[4])).not.toBe('Mara Lind')
})

test('files values: this workspace\'s used files only — never a web address, never a file no page uses', async ({ page }) => {
  await openApp(page)
  const refs = await page.evaluate(async () => {
    const w = window as unknown as { __one: { files: { saveFile: (b: Blob, n: string) => Promise<string> } } }
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
    return { used: await w.__one.files.saveFile(png, 'tessera.png'), loose: await w.__one.files.saveFile(png, 'loose.png') }
  })
  const ids = await wsEval(
    page,
    (s, r) => {
      const gallery = s.createPage({ title: 'Nordlicht gallery' })
      s.setContent(gallery, { type: 'doc', content: [{ type: 'image', attrs: { src: r.used } }] }, 'e2e')
      const db = s.createDatabase({ title: 'Assets' })
      s.addProperty(db, { id: 'a-files', name: 'Files', type: 'files' })
      return { db, row: s.createRow(db, { title: 'Logo' }) }
    },
    refs,
  )
  await flush(page)
  await connect(page, 'Apply directly')

  const made = json(await call('one_create_row', { databaseId: ids.db, rows: [{ title: 'Banner', properties: { Files: refs.used } }] }))
  expect(await wsEval(page, (s, id) => s.pages[id]?.properties['a-files'], made.rows[0].id)).toEqual([refs.used])
  json(await call('one_update_row', { rows: [{ id: ids.row, properties: { Files: [refs.used] } }] }))
  await refused('one_update_row', { rows: [{ id: ids.row, properties: { Files: 'https://cdn.example.test/logo.png' } }] }, /^refused_type: rows\[0\]\.properties\.Files: over MCP a files property takes only this workspace's files/)
  await refused('one_create_row', { databaseId: ids.db, rows: [{ title: 'Loose', properties: { Files: refs.loose } }] }, /^not_found: rows\[0\]\.properties\.Files: onefile:\S+ is no file of this workspace that a page uses/)
  await refused('one_create_row', { databaseId: ids.db, rows: [{ title: 'Odd', properties: { Files: 'logo.png' } }] }, /^refused_type: .*expected "onefile:<id>"/)
})

/** `B3_SHOTS=<dir>`: German screenshots of a batch card (1440×900 and 390×844, light and dark) — not part of the suite. */
test('screenshots: the batch card in German', async ({ page }) => {
  const dir = process.env.B3_SHOTS
  test.skip(!dir, 'B3_SHOTS not set')
  await openApp(page)
  const { rows } = await cards(page, 8)
  await connect(page, 'Ask first')
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  for (const [w, h, tag] of [
    [1440, 900, 'desktop'],
    [390, 844, 'phone'],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: w, height: h })
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      const pending = call('one_update_row', { rows: rows.map((id, i) => ({ id, properties: { Status: 'Done', ...(i < 3 ? { Owner: 'Mara Lind' } : {}) } })) })
      const card = page.getByRole('alertdialog')
      await expect(card).toContainText('8 Zeilen')
      await page.screenshot({ path: `${dir}/batch-card-${tag}-${theme}.png` })
      await page.keyboard.press('Escape')
      await pending
      await expect(card).toHaveCount(0)
    }
  }
})
