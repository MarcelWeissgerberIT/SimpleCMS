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
  // lines count from 01 as people count ("$12" stays Claude's syntax in its arguments)
  await expect(card.locator('.mcp-line', { has: page.locator('dt', { hasText: /^13$/ }) })).toContainText('Kapitel 13 · under “Kapitel 5”')
  await expect(card.locator('.mcp-line dt', { hasText: /^\$/ })).toHaveCount(0)
  // the card fits the viewport: head, workspace, summary and keys in view; the lines scroll (1440×900, then 390×844)
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const part of ['.mcp-card__head', '.mcp-card__ws', '.mcp-card__sum', '.mcp-card__approve']) {
      const box = (await card.locator(part).boundingBox())!
      expect(box.y, `${part} top at ${w}×${h}`).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height, `${part} bottom at ${w}×${h}`).toBeLessThanOrEqual(h)
    }
    const scroll = card.locator('.mcp-card__scroll')
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await expect(scroll).toHaveAttribute('tabindex', '0')
    // the hint counts the pages the person approves (the summary's 50), not the card's other lines
    await expect(card.locator('.mcp-card__more')).toHaveText('50 entries — scroll to see all')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  // the text of EVERY page that has one, under its line (not only the first page's)
  await expect(card.locator('.mcp-line--md')).toHaveCount(3)
  await expect(card.locator('.mcp-line--md').first()).toContainText('Text of chapter 1 for Tessera.')
  await expect(card.locator('.mcp-line--md').nth(2)).toContainText('Content of “Kapitel 3”')
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

  // inline: a database block right after the first paragraph — by the ref a read handed out (B2: `#<prefix>~<hash>`)
  const read = json(await call('one_get_page', { id: ids.host, format: 'blocks' }))
  const intro: string = read.blocks[0].ref
  expect(intro).toMatch(/^#blk-in[\w-]*~[0-9a-f]{6}$/)
  // a ref whose block changed since the read is refused (its hash no longer fits) and names the ref it has now
  const stale = intro.replace(/~[0-9a-f]{6}$/, intro.endsWith('~000000') ? '~111111' : '~000000')
  await refused('one_create_database', { title: 'No', inline: { pageId: ids.host, afterBlock: stale } }, new RegExp(`^stale_ref: inline\\.afterBlock: .*changed since the read \\(it is ${intro.replace(/[-~]/g, '\\$&')} now\\)`))
  const inline = json(await call('one_create_database', { title: 'Plan board', inline: { pageId: ids.host, afterBlock: intro }, views: [{ type: 'board' }] }))
  expect(inline.pageId).toBe(ids.host)
  const blocks = (await contentOf(page, ids.host))?.content ?? []
  expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'databaseBlock', 'paragraph'])
  expect(blocks[1]?.attrs?.databaseId).toBe(inline.id)
  // the answer names the new block by its full ref — the one the next read hands out
  expect(inline.block).toMatch(/^#[\w-]+~[0-9a-f]{6}$/)
  expect(json(await call('one_get_page', { id: ids.host, format: 'blocks' })).blocks[1].ref).toBe(inline.block)
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
  await expect(card.locator('.mcp-line', { hasText: 'Neu 2' })).toContainText('Owner: Mara Lind')
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

test('Ask first: the summary says where the pages go and counts in the singular too', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => ({ plan: s.createPage({ title: 'Launch plan' }), wiki: s.createPage({ title: 'Wissensbasis' }) }))
  const { db, rows } = await cards(page, 2)
  await connect(page, 'Ask first')
  const card = page.getByRole('alertdialog')
  const ask = async (name: string, args: Record<string, unknown>, summary: string) => {
    const pending = call(name, args)
    await expect(card.locator('.mcp-card__sum')).toHaveText(summary)
    await page.keyboard.press('Escape')
    await pending
    await expect(card).toHaveCount(0)
  }
  await ask('one_create_page', { pages: [{ title: 'Kapitel A', parentId: ids.plan }, { title: 'Kapitel B', parentId: ids.wiki }] }, 'Create 2 pages under 2 pages')
  await ask('one_create_page', { pages: [{ title: 'Kapitel A', parentId: ids.plan }, { title: 'Kapitel B' }] }, 'Create 2 pages in 2 places')
  await ask('one_create_page', { pages: [{ title: 'Kapitel A', parentId: ids.plan }, { title: 'Kapitel B', parentId: '$0' }] }, 'Create 2 pages in Launch plan')
  await ask('one_create_page', { pages: [{ title: 'Kapitel A' }, { title: 'Kapitel B' }] }, 'Create 2 pages in the sidebar (top level)')
  await ask('one_create_page', { parentId: ids.plan, pages: [{ title: 'Only one' }] }, 'Create 1 page in Launch plan')
  await ask('one_create_row', { databaseId: db, rows: [{ title: 'Neu 1' }] }, 'Create 1 row in Cards')
  await ask('one_update_row', { rows: [{ id: rows[0], properties: { Owner: 'Tessera' } }] }, 'Change 1 row in Cards')
})

test('a batch names EVERY row that does not fit in one refusal (create rows, update rows, create_database rows)', async ({ page }) => {
  await openApp(page)
  const { db, rows } = await cards(page, 2)
  await connect(page, 'Apply directly')
  const n = await wsEval(page, (s) => Object.keys(s.pages).length)
  const msg = await refused('one_create_row', { databaseId: db, rows: [{ title: 'A', properties: { Status: 'Weird' } }, { title: 'B', properties: { Status: 'Weird2' } }, { title: 'C', properties: { Nope: 1 } }, { title: 'D' }] }, /^bad_argument: rows: 3 of 4 rows do not fit:\n/)
  expect(msg).toMatch(/- rows\[0\] \("A"\): .*Weird/)
  expect(msg).toMatch(/- rows\[1\] \("B"\): .*Weird2/)
  expect(msg).toMatch(/- rows\[2\] \("C"\): .*Nope/)
  expect(msg).not.toMatch(/rows\[3\]/)
  expect(msg).toMatch(/\nNothing was changed\. Fix those rows/)
  const upd = await refused('one_update_row', { rows: [{ id: rows[0], properties: { Status: 'Weird' } }, { id: rows[1], properties: { Status: 'Weird2' } }] }, /^bad_argument: rows: 2 of 2 rows do not fit:/)
  expect(upd).toMatch(/- rows\[0\] \("Card 1"\): /)
  expect(upd).toMatch(/- rows\[1\] \("Card 2"\): /)
  const mk = await refused('one_create_database', { title: 'Broken', properties: [{ name: 'Status', type: 'status', options: ['Todo'] }], rows: [{ title: 'X', properties: { Status: 'Nope' } }, { title: 'Ok' }, { title: 'Y', properties: { Status: 'Nope 2' } }] }, /^bad_argument: rows: 2 of 3 rows do not fit:/)
  expect(mk).toMatch(/- rows\[0\] \("X"\): /)
  expect(mk).toMatch(/- rows\[2\] \("Y"\): /)
  expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(n)
  expect(await statusOf(page, rows)).toEqual(['s-todo', 's-todo'])
})

test('≥ 5 rows starting outward work are always asked per CALL: new + changed rows together, several databases, a rename on a watched title', async ({ page }) => {
  await openApp(page)
  const { db, rows } = await cards(page, 6)
  const auto = (trigger: AnyState) => ({ id: `au-${Math.random().toString(36).slice(2, 8)}`, name: 'Send on', enabled: true, trigger, actions: [{ type: 'run_script', scriptId: null }], lastRunAt: null, lastStatus: null, lastMessage: null })
  const ab = await wsEval(
    page,
    (s, a: { db: string; any: AnyState; created: AnyState; title: AnyState }) => {
      s.updateDatabase(a.db, { automations: [a.any, a.created] })
      const mk = (title: string) => {
        const id = s.createDatabase({ title, properties: [{ id: `${title}-t`, name: 'Name', type: 'title' }, { id: `${title}-o`, name: 'Owner', type: 'text' }] })
        s.updateDatabase(id, { automations: [{ ...a.any, id: `au-${title}` }] })
        return { id, rows: [1, 2, 3].map((i) => s.createRow(id, { title: `${title} ${i}` })) }
      }
      const watched = s.createDatabase({ title: 'Watched', properties: [{ id: 'w-title', name: 'Name', type: 'title' }] })
      s.updateDatabase(watched, { automations: [{ ...a.title, id: 'au-watch' }] })
      return { alpha: mk('Alpha'), beta: mk('Beta'), watched: { id: watched, rows: [1, 2, 3, 4, 5].map((i) => s.createRow(watched, { title: `Item ${i}` })) } }
    },
    { db, any: auto({ type: 'property_changed', propertyId: null }), created: auto({ type: 'row_created' }), title: auto({ type: 'property_changed', propertyId: 'w-title' }) },
  )
  await flush(page)
  await connect(page, 'Apply directly')
  const card = page.getByRole('alertdialog')
  const askedThenReject = async (name: string, args: Record<string, unknown>, n: number) => {
    const pending = call(name, args)
    await expect(card).toBeVisible()
    await expect(card).toContainText(`Always asked: ${n} rows start paid AI work or send something out of One.`)
    await page.keyboard.press('Escape')
    expect(text(await pending)).toContain('The person rejected this change')
    await expect(card).toHaveCount(0)
  }
  // 4 changed + 4 new rows of one upsert: 8 rows that start outward work → asked
  const pages = await wsEval(page, (s) => Object.keys(s.pages).length)
  await askedThenReject('one_upsert_rows', { databaseId: db, keyProperty: 'Ticket', rows: [1, 2, 3, 4].map((i) => ({ key: `T-${i}`, properties: { Owner: 'Tessera' } })).concat([101, 102, 103, 104].map((i) => ({ key: `T-${i}`, properties: { Owner: 'Mara Lind' } }))) }, 8)
  expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(pages)
  expect(await wsEval(page, (s, id) => s.pages[id]?.properties['c-owner'] ?? null, rows[0])).toBeNull()
  // 3 rows of Alpha + 3 rows of Beta in one call → asked
  await askedThenReject('one_update_row', { rows: [...ab.alpha.rows, ...ab.beta.rows].map((id) => ({ id, properties: { Owner: 'Tessera' } })) }, 6)
  // renaming 5 rows whose title an automation watches → asked
  await askedThenReject('one_update_row', { rows: ab.watched.rows.map((id: string, i: number) => ({ id, properties: { Name: `Renamed ${i}` } })) }, 5)
  // below the line still applies at once
  json(await call('one_update_row', { rows: ab.alpha.rows.slice(0, 2).map((id: string) => ({ id, properties: { Owner: 'Tessera' } })) }))
  await expect(card).toHaveCount(0)
})

test('rows going to the trash or losing a value to a property change start their automations too: named, ≥ 5 always asked', async ({ page }) => {
  await openApp(page)
  const { db, rows } = await cards(page, 6)
  const auto = (id: string, name: string, trigger: AnyState) => ({ id, name, enabled: true, trigger, actions: [{ type: 'run_script', scriptId: null }], lastRunAt: null, lastStatus: null, lastMessage: null })
  await wsEval(page, (s, a: { db: string; list: AnyState[] }) => s.updateDatabase(a.db, { automations: a.list }), { db, list: [auto('au-del', 'On delete', { type: 'row_deleted' }), auto('au-status', 'On status', { type: 'property_changed', propertyId: 'c-status' })] })
  await flush(page)
  await connect(page, 'Apply directly')
  const card = page.getByRole('alertdialog')
  const askedThenReject = async (name: string, args: Record<string, unknown>, starts: string, not: string) => {
    const pending = call(name, args)
    await expect(card).toBeVisible()
    await expect(card.locator('.mcp-line', { hasText: 'Starts' })).toContainText(starts)
    await expect(card.locator('.mcp-line', { hasText: 'Starts' })).not.toContainText(not)
    await expect(card).toContainText('Always asked: 6 rows start paid AI work or send something out of One.')
    await page.keyboard.press('Escape')
    expect(text(await pending)).toContain('The person rejected this change')
    await expect(card).toHaveCount(0)
  }
  // six rows to the trash: their "row deleted" automation → asked although "Apply directly"
  await askedThenReject('one_trash_page', { ids: rows }, 'On delete', 'On status')
  expect(await wsEval(page, (s, ids: string[]) => ids.filter((id) => s.pages[id]?.trashed).length, rows)).toBe(0)
  // an option removed that six rows hold: their "Status changed" automation → asked
  await askedThenReject('one_update_property', { databaseId: db, property: 'Status', options: { remove: ['Todo'] } }, 'On status', 'On delete')
  expect(await statusOf(page, rows)).toEqual(rows.map(() => 's-todo'))
  // below the line: two rows to the trash apply at once
  json(await call('one_trash_page', { ids: rows.slice(0, 2) }))
  await expect(card).toHaveCount(0)
  expect(await wsEval(page, (s, ids: string[]) => ids.filter((id) => s.pages[id]?.trashed).length, rows)).toBe(2)
})

test("one_create_database's Undo leaves what changed since alone: an edited row keeps the database, and nothing else is touched", async ({ page }) => {
  await openApp(page)
  const projects = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Projects', properties: [{ id: 'p-title', name: 'Name', type: 'title' }] })
    s.createRow(db, { title: 'Nordlicht' })
    return db
  })
  await flush(page)
  await connect(page, 'Apply directly')
  // case 1: a two-way relation, rows; the person renames one, adds their own row and links it from the reverse column
  const notes = json(await call('one_create_database', { title: 'Notes', properties: [{ name: 'Project', type: 'relation', relation: { databaseId: projects, twoWay: true } }], rows: [{ title: 'Kickoff' }, { title: 'Review' }] }))
  expect(notes.reverse).toHaveLength(1)
  const reverseId = await wsEval(page, (s, a: { db: string; name: string }) => s.databases[a.db].properties.find((p: AnyState) => p.name === a.name)?.id, { db: projects, name: notes.reverse[0].property })
  const own = await wsEval(
    page,
    (s, a: { notes: string; kick: string; projects: string; reverse: string }) => {
      s.updatePage(a.kick, { title: 'Kickoff (moved)' })
      const own = s.createRow(a.notes, { title: 'Mara own note' })
      const projectRow = Object.values(s.pages).find((p: AnyState) => p.databaseId === a.projects)!.id
      s.setRowProperty(projectRow, a.reverse, [own])
      return { own, projectRow }
    },
    { notes: notes.id, kick: notes.rows[0].id, projects, reverse: reverseId },
  )
  await flush(page)
  await undoLast(page, 'one_create_database')
  const after1 = await wsEval(
    page,
    (s, a: { id: string; review: string; projects: string; reverse: string; projectRow: string }) => ({
      dbTrashed: !!s.pages[a.id]?.trashed,
      reviewTrashed: !!s.pages[a.review]?.trashed,
      reverseStill: s.databases[a.projects].properties.some((p: AnyState) => p.id === a.reverse),
      link: s.pages[a.projectRow]?.properties[a.reverse] ?? null,
    }),
    { id: notes.id, review: notes.rows[1].id, projects, reverse: reverseId, projectRow: own.projectRow },
  )
  expect(after1).toEqual({ dbTrashed: false, reviewTrashed: false, reverseStill: true, link: [own.own] })
  // case 2: only a row of the call renamed — the database stays, with that row
  const retro = json(await call('one_create_database', { title: 'Retro', rows: [{ title: 'Went well' }, { title: 'To improve' }] }))
  await wsEval(page, (s, id) => s.updatePage(id, { title: 'Went really well' }), retro.rows[0].id)
  await flush(page)
  await undoLast(page, 'one_create_database')
  expect(await wsEval(page, (s, a: { id: string; row: string }) => [!!s.pages[a.id]?.trashed, !!s.pages[a.row]?.trashed], { id: retro.id, row: retro.rows[0].id })).toEqual([false, false])
  // untouched: the Undo takes the database (and an empty reverse column) back
  const clean = json(await call('one_create_database', { title: 'Clean', properties: [{ name: 'Project', type: 'relation', relation: { databaseId: projects, twoWay: true } }], rows: [{ title: 'One' }] }))
  const cleanReverse = await wsEval(page, (s, a: { db: string; name: string }) => s.databases[a.db].properties.find((p: AnyState) => p.name === a.name)?.id, { db: projects, name: clean.reverse[0].property })
  await undoLast(page, 'one_create_database')
  expect(await wsEval(page, (s, a: { id: string; projects: string; reverse: string }) => [!!s.pages[a.id]?.trashed, s.databases[a.projects].properties.some((p: AnyState) => p.id === a.reverse)], { id: clean.id, projects, reverse: cleanReverse })).toEqual([true, false])
})

test('the Undo of rows and pages a call made compares every value: a row the person changed since stays (kept); an untouched one goes', async ({ page }) => {
  await openApp(page)
  const { db } = await cards(page, 0)
  await connect(page, 'Apply directly')
  const made = json(await call('one_create_row', { databaseId: db, rows: [{ title: 'Neu 1', properties: { Ticket: 'T-101' } }, { title: 'Neu 2', properties: { Ticket: 'T-102' } }] }))
  const [edited, clean] = [made.rows[0].id as string, made.rows[1].id as string]
  // the person moves "Neu 1" to Done and fills its empty Owner
  await wsEval(page, (s, id) => {
    s.setRowProperty(id, 'c-status', 's-done')
    s.setRowProperty(id, 'c-owner', 'Mara Lind')
  }, edited)
  await flush(page)
  await undoLast(page, 'one_create_row')
  await expect(page.getByText('Undone — parts edited since were kept')).toBeVisible()
  expect(await wsEval(page, (s, a: { edited: string; clean: string }) => [!!s.pages[a.edited]?.trashed, s.pages[a.edited]?.properties['c-owner'], !!s.pages[a.clean]?.trashed], { edited, clean })).toEqual([false, 'Mara Lind', true])
  // a row one_upsert_rows made: the same
  const up = json(await call('one_upsert_rows', { databaseId: db, keyProperty: 'Ticket', rows: [{ key: 'T-300', title: 'Neues Ticket', properties: { Status: 'Doing' } }] }))
  await wsEval(page, (s, id) => s.setRowProperty(id, 'c-owner', 'Tessera'), up.rows[0].id)
  await flush(page)
  await undoLast(page, 'one_upsert_rows')
  expect(await wsEval(page, (s, id) => [!!s.pages[id]?.trashed, s.pages[id]?.properties['c-owner']], up.rows[0].id)).toEqual([false, 'Tessera'])
  // a row the person moved into another database since: kept where it is
  const other = await wsEval(page, (s) => s.createDatabase({ title: 'Archiv', properties: [{ id: 'a-title', name: 'Name', type: 'title' }] }))
  const moved = json(await call('one_create_row', { databaseId: db, title: 'Wandert', properties: { Ticket: 'T-500' } }))
  await wsEval(page, (s, a: { id: string; to: string }) => s.updatePage(a.id, { databaseId: a.to, parentId: a.to }), { id: moved.id, to: other })
  await flush(page)
  await undoLast(page, 'one_create_row')
  expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, moved.id)).toBe(false)
})

test('a failed call takes back what it made for good: nothing of it waits in the trash ("Nothing was changed" is true)', async ({ page }) => {
  await openApp(page)
  const db = await wsEval(page, (s) => s.createDatabase({ title: 'Tickets', properties: [{ id: 't-title', name: 'Name', type: 'title' }, { id: 't-key', name: 'Ticket', type: 'text', key: true }] }))
  await flush(page)
  await connect(page, 'Ask first')
  const pending = call('one_create_row', { databaseId: db, rows: [{ title: 'Neu A', properties: { Ticket: 'T-1' } }, { title: 'Neu B', properties: { Ticket: 'T-2' } }] })
  const card = page.getByRole('alertdialog')
  await expect(card).toBeVisible()
  // while the card waits, the person makes a row with the key T-2
  await wsEval(page, (a: AnyState, db) => a.createRow(db, { title: 'Hand-made', properties: { 't-key': 'T-2' } }), db)
  await flush(page)
  await card.getByRole('button', { name: /Approve/ }).click()
  const r = await pending
  expect(r.isError).toBe(true)
  expect(text(r)).toMatch(/Nothing was changed/)
  const rows = await wsEval(page, (s, db) => Object.values(s.pages as Record<string, AnyState>).filter((p: AnyState) => p.databaseId === db).map((p: AnyState) => `${p.title}${p.trashed ? ':trash' : ''}`).sort(), db)
  expect(rows).toEqual(['Hand-made'])
})

test("the Undo takes back only the call's own block or link from a page the person wrote in since — never a block left pointing into the trash", async ({ page }) => {
  await openApp(page)
  const host = await wsEval(page, (s) => {
    const id = s.createPage({ title: 'Launch plan' })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'lp-0001-intro' }, content: [{ type: 'text', text: 'Intro.' }] }] }, 'e2e')
    return id
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const types = async (id: string) => ((await contentOf(page, id))?.content ?? []).map((b) => (b.type === 'databaseBlock' || b.type === 'pageLink' ? `${b.type}:${b.attrs?.databaseId ?? b.attrs?.pageId}` : (b.content ?? []).map((x) => x.text ?? x.type).join('')))
  // an inline board; the person adds a paragraph to the page; Undo: the board and its block go, the paragraph stays
  const sprint = json(await call('one_create_database', { title: 'Sprint', inline: { pageId: host }, views: [{ type: 'board' }], rows: [{ title: 'Kick-off' }] }))
  await wsEval(page, (s, id) => {
    const c = s.pages[id].content
    s.setContent(id, { ...c, content: [...c.content, { type: 'paragraph', content: [{ type: 'text', text: 'Typed by Mara.' }] }] }, 'e2e')
  }, host)
  await flush(page)
  expect(await types(host)).toEqual(['Intro.', `databaseBlock:${sprint.id}`, 'Typed by Mara.'])
  await undoLast(page, 'one_create_database')
  expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, sprint.id)).toBe(true)
  expect(await types(host)).toEqual(['Intro.', 'Typed by Mara.'])
  // a sub-page linked in its parent; the person writes in the parent; Undo: the page and its link go, the text stays
  const sub = json(await call('one_create_page', { title: 'Checkliste', parentId: host, linkInParent: 'block' }))
  await wsEval(page, (s, id) => {
    const c = s.pages[id].content
    s.setContent(id, { ...c, content: [...c.content, { type: 'paragraph', content: [{ type: 'text', text: 'More by Mara.' }] }] }, 'e2e')
  }, host)
  await flush(page)
  expect(await types(host)).toEqual(['Intro.', 'Typed by Mara.', `pageLink:${sub.id}`, 'More by Mara.'])
  await undoLast(page, 'one_create_page')
  expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, sub.id)).toBe(true)
  expect(await types(host)).toEqual(['Intro.', 'Typed by Mara.', 'More by Mara.'])
  // a linked sub-page the person wrote into stays — and so does its link
  const kept = json(await call('one_create_page', { title: 'Notizen', parentId: host, linkInParent: 'mention' }))
  await wsEval(page, (s, a: { host: string; kept: string }) => {
    s.setContent(a.kept, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Her notes.' }] }] }, 'e2e')
    const c = s.pages[a.host].content
    s.setContent(a.host, { ...c, content: [...c.content, { type: 'paragraph', content: [{ type: 'text', text: 'Last line.' }] }] }, 'e2e')
  }, { host, kept: kept.id })
  await flush(page)
  await undoLast(page, 'one_create_page')
  expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, kept.id)).toBe(false)
  expect(await wsEval(page, (s, a: { host: string; kept: string }) => JSON.stringify(s.pages[a.host].content).includes(a.kept), { host, kept: kept.id })).toBe(true)
})

test('a moved row and a renamed row name what they start: the target database\'s automations, a watched title', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const inbox = s.createDatabase({ title: 'Eingang', properties: [{ id: 'i-title', name: 'Name', type: 'title' }, { id: 'i-owner', name: 'Owner', type: 'text' }] })
    const archive = s.createDatabase({ title: 'Archiv', properties: [{ id: 'a-title', name: 'Name', type: 'title' }, { id: 'a-owner', name: 'Owner', type: 'text' }, { id: 'a-flag', name: 'Flag', type: 'text' }] })
    const auto = (id: string, name: string, propertyId: string | null, action: AnyState) => ({ id, name, enabled: true, trigger: { type: 'property_changed', propertyId }, actions: [action], lastRunAt: null, lastStatus: null, lastMessage: null })
    s.updateDatabase(inbox, { automations: [auto('au-title', 'Flag on rename', 'i-title', { type: 'run_script', scriptId: null })] })
    s.updateDatabase(archive, { automations: [auto('au-owner', 'Flag on owner', 'a-owner', { type: 'set_property', propertyId: 'a-flag', value: 'fired' })] })
    const row = s.createRow(inbox, { title: 'Kunde ruft an', properties: { 'i-owner': 'Tessera' } })
    const row2 = s.createRow(inbox, { title: 'Alter Name' })
    return { inbox, archive, row, row2 }
  })
  await flush(page)
  await connect(page, 'Ask first')
  const card = page.getByRole('alertdialog')
  // a rename through one_update_page: the title's automation, as one_update_row names it
  let pending = call('one_update_page', { id: ids.row2, title: 'Neuer Name' })
  await expect(card).toBeVisible()
  await expect(card.locator('.mcp-line', { hasText: 'Starts' })).toContainText('Flag on rename')
  await page.keyboard.press('Escape')
  await pending
  await expect(card).toHaveCount(0)
  // a text written into the row starts no property automation
  pending = call('one_update_page', { id: ids.row2, markdown: 'Notes.' })
  await expect(card).toBeVisible()
  await expect(card.locator('.mcp-line', { hasText: 'Starts' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await pending
  await expect(card).toHaveCount(0)
  // a move into the archive: its owner automation sees the value land
  pending = call('one_move_row', { id: ids.row, databaseId: ids.archive })
  await expect(card).toBeVisible()
  await expect(card.locator('.mcp-line', { hasText: 'Starts' })).toContainText('Flag on owner')
  await card.getByRole('button', { name: /Approve/ }).click()
  json(await pending)
  await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties['a-flag'] ?? null, ids.row), { timeout: 8000 }).toBe('fired')
})

test('inline.afterBlock naming a block INSIDE a column: bad_argument with its top-level ref, never a stale_ref loop', async ({ page }) => {
  await openApp(page)
  const host = await wsEval(page, (s) => {
    const host = s.createPage({ title: 'Spalten' })
    const p = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] })
    s.setContent(host, { type: 'doc', content: [{ type: 'columns', attrs: { id: 'cols-outer-01' }, content: [{ type: 'column', attrs: { id: 'colm-left-01' }, content: [p('para-left-01', 'Left side')] }, { type: 'column', attrs: { id: 'colm-right-1' }, content: [p('para-right-1', 'Right side')] }] }, p('para-after-1', 'After the columns.')] }, 'e2e')
    return host
  })
  await flush(page)
  await connect(page, 'Apply directly')
  const read = json(await call('one_get_page', { id: host, format: 'blocks' }))
  const top: string = read.blocks[0].ref
  const inner: string = read.blocks[0].children[0].children[0].ref
  const msg = await refused('one_create_database', { title: 'Board', inline: { pageId: host, afterBlock: inner } }, /^bad_argument: inline\.afterBlock: .*a block inside another one/)
  expect(msg).toContain(top)
  // the same read again hands out the same nested ref — the remedy is the top-level one, and it works
  expect(json(await call('one_get_page', { id: host, format: 'blocks' })).blocks[0].children[0].children[0].ref).toBe(inner)
  const ok = json(await call('one_create_database', { title: 'Board', inline: { pageId: host, afterBlock: top } }))
  expect(((await contentOf(page, host))?.content ?? []).map((b) => b.type)).toEqual(['columns', 'databaseBlock', 'paragraph'])
  expect(ok.pageId).toBe(host)
})

/** `B3_SHOTS=<dir>`: German screenshots of a batch card (1440×900 and 390×844, light and dark) — not part of the suite. */
test('Ask first: a batch card shows EVERY value and each row\'s text; upsert lines name the title, a rename and before → after; the scroll hint counts entries', async ({ page }) => {
  await openApp(page)
  const leads = await wsEval(page, (s) =>
    s.createDatabase({
      title: 'Leads',
      properties: [
        { id: 'l-title', name: 'Name', type: 'title' },
        { id: 'l-a', name: 'Alpha', type: 'text' },
        { id: 'l-b', name: 'Beta', type: 'text' },
        { id: 'l-c', name: 'Gamma', type: 'text' },
        { id: 'l-d', name: 'Delta', type: 'text' },
      ],
    }),
  )
  const { db } = await cards(page, 0)
  await connect(page, 'Ask first')
  const card = page.getByRole('alertdialog')

  // create_row { rows }: the fourth value and the body are on the card (they were cut before)
  const rows = call('one_create_row', {
    databaseId: leads,
    rows: [
      { title: 'Row one', properties: { Alpha: 'a1', Beta: 'b1', Gamma: 'c1', Delta: 'HIDDENVALUE-delta' }, markdown: 'HIDDENBODY wire 5000 EUR to IBAN DE00 1234' },
      { title: 'Row two', properties: { Alpha: 'a2' } },
    ],
  })
  await expect(card).toContainText('Create 2 rows in Leads')
  await expect(card.locator('.mcp-line', { has: page.locator('dt', { hasText: /^01$/ }) })).toContainText('Row one — Alpha: a1 · Beta: b1 · Gamma: c1 · Delta: HIDDENVALUE-delta')
  await expect(card.locator('.mcp-line--md')).toHaveCount(1)
  await expect(card.locator('.mcp-line--md')).toContainText('Content of “Row one”')
  await expect(card.locator('.mcp-line--md')).toContainText('HIDDENBODY wire 5000 EUR to IBAN DE00 1234')
  await page.keyboard.press('Escape')
  expect(text(await rows)).toMatch(/^rejected: /)

  // create_database { rows }: the same (every value, the text)
  const made = call('one_create_database', { title: 'Termine', properties: [{ name: 'Name', type: 'title' }, { name: 'Ort', type: 'text' }, { name: 'Raum', type: 'text' }, { name: 'Wer', type: 'text' }, { name: 'Wann', type: 'text' }], rows: [{ title: 'Kick-off', properties: { Ort: 'Köln', Raum: '4.12', Wer: 'Mara Lind', Wann: 'HIDDEN-wann' }, markdown: 'Agenda HIDDENAGENDA' }] })
  await expect(card.locator('.mcp-line', { has: page.locator('dt', { hasText: /^01$/ }) })).toContainText('Wann: HIDDEN-wann')
  await expect(card.locator('.mcp-line--md')).toContainText('Agenda HIDDENAGENDA')
  await page.keyboard.press('Escape')
  expect(text(await made)).toMatch(/^rejected: /)

  // one_upsert_rows: 30 new rows — each line names its title and values (never the key twice); the hint counts 30
  await page.setViewportSize({ width: 1440, height: 760 })
  const fresh = call('one_upsert_rows', { databaseId: db, keyProperty: 'Ticket', rows: Array.from({ length: 30 }, (_, i) => ({ key: `T-${4100 + i}`, title: `Ticket ${4100 + i}: Login-Fehler ${i}`, properties: { Status: 'Todo', Owner: 'Tessera' } })) })
  await expect(card).toContainText('30 new')
  const first = card.locator('.mcp-line', { has: page.locator('dt', { hasText: 'New · T-4100' }) })
  await expect(first).toContainText('Ticket 4100: Login-Fehler 0 — Status: Todo · Owner: Tessera')
  await expect(first).not.toContainText('Ticket: T-4100')
  await expect(card.locator('.mcp-card__more')).toHaveText('30 entries — scroll to see all')
  await page.keyboard.press('Enter')
  const out = json(await fresh)
  expect(out.rows.filter((r: AnyState) => r.action === 'created')).toHaveLength(30)

  // a rename with a value change, a value alone, a text into an empty page: old → new, before → after, the text
  const changed = call('one_upsert_rows', {
    databaseId: db,
    keyProperty: 'Ticket',
    rows: [
      { key: 'T-4100', title: 'Kunde kündigt', properties: { Status: 'Done' } },
      { key: 'T-4101', properties: { Owner: 'Mara Lind' } },
      { key: 'T-4102', markdown: 'Notiz HIDDENNOTE für Nordlicht' },
    ],
  })
  await expect(card.locator('.mcp-line', { has: page.locator('dt', { hasText: 'Changed · T-4100' }) })).toContainText('Ticket 4100: Login-Fehler 0 → Kunde kündigt — Status: Todo → Done')
  await expect(card.locator('.mcp-line', { has: page.locator('dt', { hasText: 'Changed · T-4101' }) })).toContainText('Ticket 4101: Login-Fehler 1 — Owner: Tessera → Mara Lind')
  await expect(card.locator('.mcp-line--md')).toContainText('Content of “Ticket 4102: Login-Fehler 2”')
  await expect(card.locator('.mcp-line--md')).toContainText('Notiz HIDDENNOTE für Nordlicht')
  await expect(card).not.toContainText('renamed or text added')
  await page.keyboard.press('Enter')
  expect(json(await changed).rows.map((r: AnyState) => r.action)).toEqual(['updated', 'updated', 'updated'])
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('one default schema: a German workspace makes Name, Status (Not started / In progress / Done), Tags, Date — the call that follows the description fits', async ({ page }) => {
  await openApp(page)
  const host = await wsEval(page, (s) => s.createPage({ title: 'Projekt Polaris' }))
  await flush(page)
  await connect(page, 'Apply directly')
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  // as the description says: Date and the status "Done" exist without naming any property
  const out = json(await call('one_create_database', { title: 'Termine', parentId: host, views: [{ type: 'board' }], rows: [{ title: 'Kick-off', properties: { Date: '2026-11-02', Status: 'Done' } }] }))
  expect(out.properties.map((p: AnyState) => p.name)).toEqual(['Name', 'Status', 'Tags', 'Date'])
  const status = out.properties.find((p: AnyState) => p.name === 'Status')
  expect(status.options.map((o: AnyState) => o.name ?? o)).toEqual(['Not started', 'In progress', 'Done'])
  // a status made without options: the same three
  const prop = json(await call('one_create_property', { databaseId: out.id, name: 'Phase', type: 'status' }))
  expect(JSON.stringify(prop)).toContain('Not started')
  await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
})

/** `FIX2_SHOTS=<dir>`: German screenshots of an upsert card and a rows card with text (1440×900 and 390×844, light and dark). */
test('screenshots: upsert and rows-with-text cards in German', async ({ page }) => {
  const dir = process.env.FIX2_SHOTS
  test.skip(!dir, 'FIX2_SHOTS not set')
  await openApp(page)
  const { db } = await cards(page, 2)
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
      const card = page.getByRole('alertdialog')
      const upsert = call('one_upsert_rows', {
        databaseId: db,
        keyProperty: 'Ticket',
        rows: [{ key: 'T-1', title: 'Kunde kündigt', properties: { Status: 'Done' } }, ...Array.from({ length: 30 }, (_, i) => ({ key: `T-${4100 + i}`, title: `Ticket ${4100 + i}: Login-Fehler ${i}`, properties: { Status: 'Todo', Owner: 'Tessera' } }))],
      })
      await expect(card).toContainText('30 neu')
      await page.screenshot({ path: `${dir}/upsert-${tag}-${theme}.png` })
      await page.keyboard.press('Escape')
      await upsert
      const rows = call('one_create_row', { databaseId: db, rows: [{ title: 'Kick-off Nordlicht', properties: { Ticket: 'T-900', Owner: 'Mara Lind', Status: 'Doing' }, markdown: '## Agenda\n- Ziele für Q4\n- Budget mit Tessera\n- Nächste Schritte' }, { title: 'Retro', properties: { Ticket: 'T-901' } }] })
      await expect(card).toContainText('2 Zeilen')
      await page.screenshot({ path: `${dir}/rows-text-${tag}-${theme}.png` })
      await page.keyboard.press('Escape')
      await rows
      await expect(card).toHaveCount(0)
    }
  }
  await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
})

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

/** `FIX_SHOTS=<dir>`: German screenshots of a 50-row card that fits the screen (1440×900 and 390×844, light and dark). */
test('screenshots: a 50-row card in German — capped at the viewport, its lines scroll', async ({ page }) => {
  const dir = process.env.FIX_SHOTS
  test.skip(!dir, 'FIX_SHOTS not set')
  await openApp(page)
  const { rows } = await cards(page, 50)
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
      const pending = call('one_update_row', { rows: rows.map((id) => ({ id, properties: { Status: 'Done' } })) })
      const card = page.getByRole('alertdialog')
      await expect(card).toContainText('50 Zeilen in Cards ändern')
      await page.screenshot({ path: `${dir}/rows50-${tag}-${theme}.png` })
      // scrolled to the end with the keyboard: the summary and the keys stay
      const scroll = card.locator('.mcp-card__scroll')
      await scroll.focus()
      await page.keyboard.press('End')
      await expect.poll(() => scroll.evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight)).toBe(true)
      await page.screenshot({ path: `${dir}/rows50-end-${tag}-${theme}.png` })
      await page.keyboard.press('Escape')
      await pending
      await expect(card).toHaveCount(0)
    }
  }
})
