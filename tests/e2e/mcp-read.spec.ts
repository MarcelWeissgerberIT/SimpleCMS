/**
 * MCP B2 — reading in full on the local bridge (MCP plan § 2.1), driven like Claude Code drives it (the built bridge
 * through the MCP SDK's stdio client, its own port):
 *  - one_get_page { format: 'blocks' }: every node type with its ref, attrs and data (databases, links, sheets with
 *    computed values, charts, buttons by kind only, synced blocks, meeting notes + transcript, media / files, tasks …);
 *    the Markdown read with refs labels the same blocks;
 *  - a 150k page reads in parts, each under 40,000 characters serialized; the refs stay the same across a reload; a write
 *    between two parts → page_changed;
 *  - context marks: a limited read hands out only the marked blocks and leaves out the files and comment threads of the
 *    others (`limited` counts them); comments off (the default) → comments_off, and no read carries them;
 *  - one_list_pages (sidebar order, depth, kinds, paging; templates and the trash never), urlBase in lists, full views,
 *    inline / parentId / system in one_list_databases, class on single reads, tree.more in the overview.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan, Wissensbasis).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, doc, para, flush, reloadApp } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47375

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
  expect(r.isError, `${name} ${JSON.stringify(args)} → ${text(r)}`).toBe(true)
  expect(text(r)).toMatch(re)
}

async function connected() {
  let list: AnyState = { workspaces: [] }
  await expect
    .poll(async () => {
      list = json(await call('one_list_workspaces'))
      return list.workspaces.length
    })
    .toBe(1)
  // the bridge answers for the newest tab: one read binds this connection to it
  json(await call('one_list_databases', { workspace: list.workspaces[0].id }))
}

async function connect(page: Page, comments?: 'off' | 'read' | 'write') {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Connected')
  await connected()
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  const row = page.getByTestId('mcp-comments')
  // comments over MCP: off unless the person switches them on
  await expect(row.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  if (comments && comments !== 'off') {
    await row.getByRole('radio', { name: comments === 'read' ? 'Read' : 'Read + write' }).click()
    await expect(row.getByRole('radio', { name: comments === 'read' ? 'Read' : 'Read + write' })).toHaveAttribute('aria-checked', 'true')
  }
  await page.keyboard.press('Escape')
}

const REF = /^[#@][A-Za-z0-9_.-]+~[0-9a-f]{6}$/

/** Every block of a Block tree, depth first. */
function flat(blocks: AnyState[]): AnyState[] {
  return blocks.flatMap((b) => [b, ...flat(b.children ?? [])])
}

/** All parts of a read: follows `next` until the end. */
async function readAll(args: Record<string, unknown>): Promise<{ parts: AnyState[]; sizes: number[] }> {
  const parts: AnyState[] = []
  const sizes: number[] = []
  let cursor: string | null | undefined
  for (let i = 0; i < 40; i++) {
    const r = await call('one_get_page', { ...args, ...(cursor ? { cursor } : {}) })
    sizes.push(text(r).length)
    const part = json(r)
    parts.push(part)
    cursor = part.next
    if (!cursor) break
  }
  return { parts, sizes }
}

test('format "blocks": every node type with its ref, attrs and data; the labelled Markdown names the same blocks', async ({ page }) => {
  await openApp(page)
  const files = await page.evaluate(async () => {
    const w = window as unknown as { __one: { files: { saveFile: (b: Blob, n: string) => Promise<string> } } }
    return {
      video: await w.__one.files.saveFile(new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }), 'launch.mp4'),
      pdf: await w.__one.files.saveFile(new Blob([new TextEncoder().encode('%PDF-1.4 Nordlicht')], { type: 'application/pdf' }), 'Nordlicht brief.pdf'),
    }
  })
  const ids = await wsEval(page, (s) => {
    const mara = s.addPerson('Mara Lind')
    const plan = s.createPage({ title: 'Launch plan' })
    const notes = s.createPage({ title: 'Tessera notes' })
    const db = s.createDatabase({ title: 'Wissensbasis', parentId: plan })
    s.createRow(db, { title: 'Glossar' })
    s.createRow(db, { title: 'Prozesse' })
    return { mara, plan, notes, db }
  })
  const view = await wsEval(page, (s, db) => s.databases[db].views[0].id as string, ids.db)
  const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })
  const p = (...c: JSONContent[]): JSONContent => ({ type: 'paragraph', content: c })
  const cells = { A1: { v: '2' }, A2: { v: '3' }, A3: { v: '=A1+A2' }, B1: { v: 'Nordlicht' } }
  const every: JSONContent = doc(
    { type: 'heading', attrs: { id: 'blk-head-0001', level: 2 }, content: [t('Plan')] },
    { type: 'paragraph', attrs: { id: 'blk-para-0001' }, content: [t('bold', [{ type: 'bold' }]), t(' and '), { type: 'mention', attrs: { id: ids.mara, label: 'Mara Lind', kind: 'person' } }] },
    { type: 'bulletList', attrs: { id: 'blk-list-0001' }, content: [{ type: 'listItem', content: [p(t('First')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('Nested'))] }] }] }, { type: 'listItem', content: [p(t('Second'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }] },
    { type: 'blockquote', content: [p(t('Quoted'))] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const x = 1')] },
    { type: 'callout', attrs: { icon: '💡', color: 'blue' }, content: [p(t('Note'))] },
    { type: 'details', attrs: { heading: 2 }, content: [{ type: 'detailsSummary', content: [t('Toggle heading')] }, { type: 'detailsContent', content: [p(t('Inside'))] }] },
    { type: 'columns', content: [{ type: 'column', content: [p(t('Left'))] }, { type: 'column', content: [p(t('Right'))] }] },
    { type: 'tabs', content: [{ type: 'tab', attrs: { title: 'One' }, content: [p(t('A'))] }, { type: 'tab', attrs: { title: 'Two' }, content: [p(t('B'))] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('H'))] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('x'))] }] }] },
    { type: 'image', attrs: { src: 'https://nordlicht.example/cover.png', alt: 'Cover', width: 420, align: 'center' } },
    { type: 'video', attrs: { src: files.video, name: 'launch.mp4', caption: 'Launch' } },
    { type: 'fileBlock', attrs: { src: files.pdf, name: 'Nordlicht brief.pdf', display: 'viewer' } },
    { type: 'audio', attrs: { src: 'onefile:missing0001', name: 'memo.mp3' } },
    { type: 'bookmark', attrs: { url: 'https://nordlicht.example/', title: 'Nordlicht', description: 'Our site' } },
    { type: 'embed', attrs: { url: 'https://nordlicht.example/map', provider: 'maps' } },
    { type: 'pageLink', attrs: { pageId: ids.notes } },
    { type: 'pageLink', attrs: { pageId: 'pg_gone_nowhere' } },
    { type: 'databaseBlock', attrs: { databaseId: ids.db, viewId: view } },
    { type: 'blockMath', attrs: { latex: 'a^2+b^2' } },
    { type: 'mermaid', attrs: { code: 'graph TD; A-->B' } },
    { type: 'button', attrs: { label: 'Ping', variant: 'ink', actions: [{ id: 'a1', type: 'webhook', url: 'https://hooks.nordlicht.example/secret-path', method: 'POST' }, { id: 'a2', type: 'message', text: 'Sent' }] } },
    { type: 'syncedBlock', attrs: { syncId: 'sync-1', sourcePageId: null }, content: [p(t('Shared text'))] },
    { type: 'meetingNotes', attrs: { title: 'Weekly', status: 'done', language: 'de-DE', startedAt: 1760252400000, endedAt: 1760256000000, duration: 3_600_000, transcript: [{ t: 0, text: 'Mara: hallo' }, { t: 4000, text: 'Tessera ist live' }, { t: 9000, text: 'Ende' }] }, content: [p(t('Notes stay'))] },
    { type: 'workItem', attrs: { itemId: 'wi_launch0001', status: 'todo', due: '2026-10-20', people: [ids.mara] }, content: [p(t('Send the plan')), p(t('A note'))] },
    { type: 'spreadsheet', attrs: { id: 'sheet-1', title: 'Budget', sheets: [{ id: 'sh1', name: 'Q4', rows: 20, cols: 8, cells, colWidths: {} }], active: 'sh1', datasets: [], charts: [] } },
    { type: 'chart', attrs: { spec: { kind: 'bar', title: 'Reach', source: { kind: 'manual', rows: [['Team', 'n'], ['Nordlicht', 3], ['Tessera', 5]] } } } },
    { type: 'toc' },
    { type: 'breadcrumb' },
    { type: 'horizontalRule' },
    p(t('end')),
  )
  await wsEval(page, (s, a) => s.setContent(a.id, a.every, 'e2e'), { id: ids.plan, every })
  await flush(page)
  await connect(page)

  const read = json(await call('one_get_page', { id: ids.plan, format: 'blocks' }))
  expect(read.next).toBeNull()
  expect(read.rev).toMatch(/^\d+$/)
  expect(read.class).toBe('page')
  expect(read.settings).toEqual({ fullWidth: false, font: 'sans', smallText: false, locked: false })
  expect(read.children).toEqual({ items: [{ id: ids.db, title: 'Wissensbasis', kind: 'database' }], more: 0 })
  expect(read.markdown).toBeUndefined()
  const all = flat(read.blocks)
  for (const b of all) expect(b.ref, JSON.stringify(b).slice(0, 200)).toMatch(REF)
  // refs are unique on the page
  expect(new Set(all.map((b) => b.ref)).size).toBe(all.length)
  const of = (type: string) => all.filter((b) => b.type === type)
  const one = (type: string) => {
    const list = of(type)
    expect(list.length, type).toBeGreaterThan(0)
    return list[0]
  }
  // a block with an id carries its id's prefix; one without an id its path
  expect(one('heading').ref).toMatch(/^#blk-he[a-z-]*~/)
  expect(one('heading')).toMatchObject({ markdown: '## Plan', attrs: { level: 2 } })
  expect(one('paragraph').markdown).toContain('[@Mara Lind](one:person/')
  const list = one('bulletList')
  expect(list.children.map((c: AnyState) => c.markdown)).toEqual(['First', 'Second'])
  expect(list.children[0].children[0].type).toBe('orderedList')
  expect(list.children[0].children[0].children[0]).toMatchObject({ type: 'listItem', markdown: 'Nested' })
  expect(one('taskItem')).toMatchObject({ attrs: { checked: true } })
  expect(one('codeBlock')).toMatchObject({ attrs: { language: 'ts' } })
  expect(one('callout')).toMatchObject({ attrs: { icon: '💡', color: 'blue' } })
  expect(one('callout').children[0].markdown).toBe('Note')
  expect(one('details')).toMatchObject({ attrs: { heading: 2 }, data: { summary: 'Toggle heading' } })
  expect(one('details').children[0].markdown).toBe('Inside')
  expect(one('columns').children.map((c: AnyState) => [c.type, c.children[0].markdown])).toEqual([
    ['column', 'Left'],
    ['column', 'Right'],
  ])
  expect(one('columns').children[0].ref).toMatch(/^@\d+\.0~/)
  expect(one('tabs').data).toEqual({ tabs: [{ title: 'One' }, { title: 'Two' }] })
  expect(one('tab').data).toEqual({ title: 'One' })
  expect(one('table').markdown).toMatch(/\| H +\|/)
  expect(one('image')).toMatchObject({ attrs: { alt: 'Cover', width: 420, align: 'center' }, data: { file: null, url: 'https://nordlicht.example/cover.png' } })
  expect(one('video').data).toMatchObject({ file: { ref: files.video, name: 'launch.mp4', mime: 'video/mp4', size: 4 }, url: null })
  expect(one('fileBlock').data).toMatchObject({ file: { ref: files.pdf, name: 'Nordlicht brief.pdf', mime: 'application/pdf' }, display: 'viewer' })
  expect(one('audio').data).toMatchObject({ file: { ref: 'onefile:missing0001', name: 'memo.mp3', mime: null, size: null } })
  expect(one('bookmark').data).toEqual({ url: 'https://nordlicht.example/', title: 'Nordlicht', description: 'Our site' })
  expect(one('embed').data).toEqual({ url: 'https://nordlicht.example/map', provider: 'maps' })
  expect(of('pageLink').map((b) => b.data)).toEqual([
    { pageId: ids.notes, title: 'Tessera notes' },
    { pageId: null, title: '(No access)' },
  ])
  expect(one('databaseBlock').data).toEqual({ databaseId: ids.db, viewId: view, title: 'Wissensbasis', viewType: 'table', rows: 2 })
  expect(one('blockMath').data).toEqual({ latex: 'a^2+b^2' })
  expect(one('mermaid').data).toEqual({ code: 'graph TD; A-->B' })
  // a button says what kinds of actions it has — never where a webhook goes
  expect(one('button').data).toEqual({ label: 'Ping', variant: 'ink', actions: [{ kind: 'webhook' }, { kind: 'message' }] })
  expect(JSON.stringify(read)).not.toContain('hooks.nordlicht.example')
  expect(one('syncedBlock').data).toEqual({ syncId: 'sync-1', original: true, sourcePageId: null })
  expect(one('syncedBlock').children[0].markdown).toBe('Shared text')
  expect(one('meetingNotes').data).toMatchObject({ title: 'Weekly', status: 'done', language: 'de-DE', duration: 3_600_000, transcriptLines: 3 })
  expect(one('meetingNotes').data.transcript).toBeUndefined()
  expect(one('workItem').data).toMatchObject({ itemId: 'wi_launch0001', status: 'todo', due: '2026-10-20', people: ['Mara Lind'], blockedBy: [], related: [] })
  expect(one('workItem').markdown).toContain('[!TODO] Send the plan')
  expect(one('workItem').children.map((c: AnyState) => c.markdown)).toEqual(['A note'])
  // a sheet's inputs and the values One computes
  expect(one('spreadsheet').data).toMatchObject({ title: 'Budget', active: 'Q4', sheets: [{ name: 'Q4', rows: 20, cols: 8, frozenRows: 0 }] })
  expect(one('spreadsheet').data.sheets[0].cells).toEqual({ A1: { input: '2', value: 2 }, A2: { input: '3', value: 3 }, A3: { input: '=A1+A2', value: 5 }, B1: { input: 'Nordlicht', value: 'Nordlicht' } })
  expect(one('chart').data.spec).toMatchObject({ kind: 'bar', title: 'Reach' })
  expect(one('chart').data.data.labels).toEqual(['Nordlicht', 'Tessera'])
  for (const type of ['toc', 'breadcrumb', 'horizontalRule']) expect(one(type).data).toBeUndefined()

  // the transcript on request
  const withLines = json(await call('one_get_page', { id: ids.plan, format: 'blocks', transcript: true }))
  expect(flat(withLines.blocks).find((b) => b.type === 'meetingNotes')!.data.transcript).toEqual([
    { t: 0, text: 'Mara: hallo' },
    { t: 4000, text: 'Tessera ist live' },
    { t: 9000, text: 'Ende' },
  ])

  // Markdown with refs: every top-level block under its own label, items and container children labelled too
  const md = json(await call('one_get_page', { id: ids.plan, refs: true })).markdown as string
  const labels = [...md.matchAll(/⟦([#@][^⟧]+)⟧/g)].map((m) => m[1])
  for (const b of read.blocks) expect(labels).toContain(b.ref)
  expect(labels).toContain(list.children[1].ref)
  expect(labels).toContain(one('callout').children[0].ref)
  expect(md).toMatch(new RegExp(`^⟦${list.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧\\n- ⟦`, 'm'))
  // the same Markdown without refs reads as before (the file form, no labels)
  const plain = json(await call('one_get_page', { id: ids.plan })).markdown as string
  expect(plain).not.toContain('⟦')
  expect(plain).toContain('## Plan')
  // a client that copies a label into a write never writes it
  json(await call('one_update_page', { id: ids.notes, mode: 'replace', markdown: `${labels[0] ? `⟦${labels[0]}⟧\n` : ''}Copied line` }))
  await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, ids.notes)).toBe('Copied line')

  // bad arguments are refused in the contract's shape
  await refused('one_get_page', { id: ids.plan, format: 'html' }, /^bad_argument: format:/)
  await refused('one_get_page', { id: ids.plan, cursor: 'nonsense' }, /^bad_argument: cursor:/)
})

test('a 150k page reads in parts under 40,000 characters each; refs stay across a reload; a write between parts → page_changed', async ({ page }) => {
  test.slow()
  await openApp(page)
  const filler = 'Nordlicht und Tessera planen den Launch gemeinsam mit Mara Lind; die Wissensbasis wächst mit jedem Abschnitt weiter. '
  const id = await wsEval(
    page,
    (s, a) => {
      const id = s.createPage({ title: 'Wissensbasis Langfassung' })
      const content = Array.from({ length: 600 }, (_, i) => ({ type: 'paragraph', attrs: { id: `para-${String(i).padStart(4, '0')}-nordlicht` }, content: [{ type: 'text', text: `§${i} ${a.filler}${a.filler}${a.filler}` }] }))
      s.setContent(id, { type: 'doc', content }, 'e2e')
      return id
    },
    { filler },
  )
  await flush(page)
  await connect(page)

  const md = await readAll({ id })
  expect(md.parts.length).toBeGreaterThan(3)
  for (const size of md.sizes) expect(size).toBeLessThan(40_000)
  // the head comes once; the later parts carry id + rev
  expect(md.parts[0].title).toBe('Wissensbasis Langfassung')
  expect(md.parts[1]).toEqual({ id, rev: md.parts[0].rev, markdown: expect.any(String), next: md.parts[1].next, workspace: expect.any(Object) })
  const text = md.parts.map((p) => p.markdown).join('\n\n')
  expect(text.length).toBeGreaterThan(150_000)
  for (const i of [0, 299, 599]) expect(text.split(`§${i} `).length - 1, `§${i}`).toBe(1)

  const blocks = await readAll({ id, format: 'blocks' })
  for (const size of blocks.sizes) expect(size).toBeLessThan(40_000)
  const refs = blocks.parts.flatMap((p) => p.blocks.map((b: AnyState) => b.ref))
  expect(refs).toHaveLength(600)
  expect(new Set(refs).size).toBe(600)

  // the refs come from the document: the same after a reload
  await reloadApp(page)
  await connected()
  const again = await readAll({ id, format: 'blocks' })
  expect(again.parts.flatMap((p) => p.blocks.map((b: AnyState) => b.ref))).toEqual(refs)

  // a change between two parts: the next part refuses (read again from the start)
  const first = json(await call('one_get_page', { id }))
  expect(first.next).toBeTruthy()
  await wsEval(page, (s, id) => s.setContent(id, { ...s.pages[id].content, content: [...s.pages[id].content.content, { type: 'paragraph', content: [{ type: 'text', text: 'Neu' }] }] }, 'e2e'), id)
  await refused('one_get_page', { id, cursor: first.next }, /^page_changed: cursor:/)
  // a cursor of another read is no cursor for this one
  await refused('one_get_page', { id, format: 'blocks', cursor: first.next }, /^bad_argument: cursor:.*another read/)
})

test('context marks limit the read: only the marked blocks, their files and threads; comments are off until switched on', async ({ page }) => {
  await openApp(page)
  const img = await page.evaluate(async () => {
    const w = window as unknown as { __one: { files: { saveFile: (b: Blob, n: string) => Promise<string> } } }
    return w.__one.files.saveFile(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'tessera.png')
  })
  const id = await wsEval(
    page,
    (s, img) => {
      const id = s.createPage({ title: 'Tessera review' })
      const c = (text: string, thread: string) => ({ type: 'text', text, marks: [{ type: 'comment', attrs: { id: thread } }] })
      s.setContent(
        id,
        {
          type: 'doc',
          content: [
            { type: 'paragraph', attrs: { id: 'keep-0001-tessera' }, content: [{ type: 'text', text: 'Shared plan ' }, c('budget', 'th-open')] },
            { type: 'paragraph', attrs: { id: 'hide-0001-tessera' }, content: [{ type: 'text', text: 'Private salary line ' }, c('raise', 'th-hidden')] },
            { type: 'image', attrs: { id: 'hide-0002-tessera', src: img, alt: 'Scan' } },
            { type: 'paragraph', attrs: { id: 'keep-0002-tessera' }, content: [{ type: 'text', text: 'Launch date' }] },
          ],
        },
        'e2e',
      )
      const at = Date.now()
      s.updatePage(id, {
        comments: [
          { id: 'th-open', quote: 'budget', body: 'Is 40k enough?', author: 'Mara Lind', createdAt: at, updatedAt: at, resolved: false, replies: [{ id: 'r1', author: 'Tessera', body: 'Yes', createdAt: at + 1, updatedAt: at + 1 }] },
          { id: 'th-hidden', quote: 'raise', body: 'Confidential', author: 'Mara Lind', createdAt: at, updatedAt: at, resolved: true, replies: [] },
        ],
      })
      return id
    },
    img,
  )
  await flush(page)
  await connect(page)

  // comments are off by default: asking for them is refused, and no read carries them
  await refused('one_get_page', { id, comments: true }, /^comments_off: comments:.*Settings → Agents · MCP/)
  const plain = json(await call('one_get_page', { id, format: 'blocks' }))
  expect(plain.comments).toBeUndefined()
  expect(JSON.stringify(plain)).not.toContain('Is 40k enough')

  // switched on (read)
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
  await page.getByTestId('mcp-comments').getByRole('radio', { name: 'Read', exact: true }).click()
  await page.keyboard.press('Escape')
  const full = json(await call('one_get_page', { id, format: 'blocks', comments: true }))
  expect(full.limited).toBeUndefined()
  expect(full.comments.map((c: AnyState) => [c.id, c.resolved, c.ref])).toEqual([
    ['th-open', false, full.blocks[0].ref],
    ['th-hidden', true, full.blocks[1].ref],
  ])
  expect(full.comments[0].replies).toEqual([{ id: 'r1', body: 'Yes', author: 'Tessera', createdAt: expect.any(String) }])

  // the person marks two blocks for Claude: the read hands out only those, with their threads and files
  await page.evaluate((id) => (window as unknown as { __oneMcp: { context: (id: string, ids: string[] | null) => Promise<void> } }).__oneMcp.context(id, ['keep-0001-tessera', 'keep-0002-tessera']), id)
  const limited = json(await call('one_get_page', { id, format: 'blocks', comments: true }))
  expect(limited.blocks.map((b: AnyState) => b.ref.slice(0, 5))).toEqual(['#keep', '#keep'])
  expect(limited.limited).toMatchObject({ blocks: 2, files: 1, comments: 1 })
  expect(limited.comments.map((c: AnyState) => c.id)).toEqual(['th-open'])
  const leaked = JSON.stringify(limited)
  for (const secret of ['salary', 'Confidential', img, 'Scan']) expect(leaked).not.toContain(secret)
  const mdRead = json(await call('one_get_page', { id }))
  // in Markdown too: the threads of the blocks left out are counted, never those it shows
  expect(mdRead.limited).toMatchObject({ blocks: 2, files: 1, comments: 1 })
  const md = mdRead.markdown as string
  expect(md).toContain('Shared plan')
  expect(md).not.toContain('salary')
  // nothing marked for Claude: no text at all
  await page.evaluate((id) => (window as unknown as { __oneMcp: { context: (id: string, ids: string[] | null) => Promise<void> } }).__oneMcp.context(id, []), id)
  const none = json(await call('one_get_page', { id }))
  expect(none.markdown).toBe('')
  expect(none.limited).toMatchObject({ blocks: 4 })
})

test('one_list_pages, urlBase in lists, full views, inline / system / class on reads, tree.more in the overview', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const root = s.createPage({ title: 'Nordlicht' })
    const a = s.createPage({ title: 'Alpha', parentId: root })
    const b = s.createPage({ title: 'Beta', parentId: root })
    const b1 = s.createPage({ title: 'Beta child', parentId: b })
    const db = s.createDatabase({ title: 'Wissensbasis', parentId: root })
    const rows = ['Glossar', 'Prozesse', 'Rollen'].map((title) => s.createRow(db, { title }))
    const sub = s.createPage({ title: 'Glossar notes', parentId: rows[0] })
    const tpl = s.createPage({ title: 'Sprint kit', parentId: root })
    s.updatePage(tpl, { template: { name: 'Sprint kit' }, hidden: true })
    const gone = s.createPage({ title: 'Old draft', parentId: root })
    s.trashPage(gone)
    const inline = s.createDatabase({ title: 'Inline tasks', parentId: a, inline: true })
    return { root, a, b, b1, db, rows, sub, inline }
  })
  await flush(page)
  await connect(page)

  const one = json(await call('one_list_pages', { parentId: ids.root }))
  expect(one.urlBase).toMatch(/#\/p\/$/)
  expect(one.items.map((i: AnyState) => [i.title, i.kind, i.depth, i.children])).toEqual([
    ['Alpha', 'page', 1, 1],
    ['Beta', 'page', 1, 1],
    ['Wissensbasis', 'database', 1, 0],
  ])
  expect(one.items[0]).not.toHaveProperty('url')
  expect(JSON.stringify(one)).not.toMatch(/Sprint kit|Old draft/)
  const deep = json(await call('one_list_pages', { parentId: ids.root, depth: 3, kinds: ['page', 'database', 'row'] }))
  expect(deep.items.map((i: AnyState) => `${'  '.repeat(i.depth - 1)}${i.title}`)).toEqual([
    'Alpha',
    '  Inline tasks',
    'Beta',
    '  Beta child',
    'Wissensbasis',
    '  Glossar',
    '    Glossar notes',
    '  Prozesse',
    '  Rollen',
  ])
  expect(deep.items.find((i: AnyState) => i.title === 'Glossar').kind).toBe('row')
  // paged
  const p1 = json(await call('one_list_pages', { parentId: ids.root, depth: 3, kinds: ['page', 'database', 'row'], limit: 4 }))
  expect(p1.items).toHaveLength(4)
  expect(p1.total).toBe(9)
  const p2 = json(await call('one_list_pages', { parentId: ids.root, depth: 3, kinds: ['page', 'database', 'row'], limit: 4, cursor: p1.next }))
  expect(p2.items[0].title).toBe('Wissensbasis')
  await refused('one_list_pages', { parentId: ids.root, cursor: p1.next }, /^bad_argument: cursor:/)
  await refused('one_list_pages', { parentId: 'pg_nowhere' }, /^not_found: parentId:/)
  await refused('one_list_pages', { depth: 4 }, /depth/)

  // lists carry urlBase once, no link per item
  const dbs = json(await call('one_list_databases'))
  expect(dbs.urlBase).toBe(one.urlBase)
  const kb = dbs.databases.find((d: AnyState) => d.id === ids.db)
  expect(kb).toMatchObject({ parentId: ids.root, inline: false, system: null, rows: 3 })
  expect(kb).not.toHaveProperty('url')
  expect(dbs.databases.find((d: AnyState) => d.id === ids.inline)).toMatchObject({ parentId: ids.a, inline: true })
  const found = json(await call('one_search', { query: 'Wissensbasis' }))
  expect(found.urlBase).toBe(one.urlBase)
  expect(found.results[0]).not.toHaveProperty('url')
  const rows = json(await call('one_query_database', { databaseId: ids.db }))
  expect(rows.urlBase).toBe(one.urlBase)
  expect(rows.rows[0]).not.toHaveProperty('url')

  // views in full: a board's filter as one_create_view takes it, the visible properties in order
  const made = json(await call('one_create_view', { databaseId: ids.db, type: 'board', name: 'Offen', groupBy: 'Status', filter: [{ property: 'Status', op: 'not_equals', value: 'Done' }], properties: ['Tags', 'Status'] }))
  const schema = json(await call('one_get_database', { id: ids.db }))
  expect(schema.class).toBe('page')
  expect(schema.inline).toBe(false)
  const board = schema.views.find((v: AnyState) => v.id === made.view.id)
  expect(board).toMatchObject({ name: 'Offen', type: 'board', groupBy: 'Status', filter: [{ property: 'Status', op: 'is_not', value: 'Done' }], properties: ['Tags', 'Status'], filtered: true })

  // single reads carry the data class; rows are rows
  expect(json(await call('one_get_page', { id: ids.rows[0] })).class).toBe('rows')
  // the overview's tree is cut below the first level: it points to one_list_pages
  expect(json(await call('one_overview')).tree).toEqual({ more: true, use: 'one_list_pages' })
})
