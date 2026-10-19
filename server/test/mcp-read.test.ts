/**
 * MCP B2 on the team server — reading in full (MCP plan § 2.1): one_get_page with `format: 'blocks'` (the content
 * document's Y XML read into Blocks: every node type with its ref and data; the task block as its plain blocks until
 * phase 4), Markdown with ref labels, parts under 40,000 characters with a cursor, page_changed after a write between
 * parts, comments behind the token flag (off by default, set at creation), one_list_pages, urlBase in lists, full views,
 * inline / parentId / system, class on single reads, tree.more. Fictional data (Nordlicht, Tessera, Mara Lind).
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer } from './helpers.ts'
import { sha256Hex } from '../../src/shared/mcp/sha256.ts'
import { blockDigest, prefixesFor, stripRefLabels } from '../../src/shared/mcp/refs.ts'
import { createHash } from 'node:crypto'

/* ------------------------------------------------------------------ fixtures */

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

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], extra: Record<string, unknown> = {}, page: Record<string, unknown> = {}) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1, ...page }))
    const ydb = new Y.Map<unknown>()
    const pm = new Y.Map<unknown>()
    props.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
    ydb.set('properties', pm)
    const views = new Y.Map<unknown>()
    views.set('v-1', { id: 'v-1', name: 'Table', type: 'table', filter: null, sorts: [], visibleProperties: props.filter((p) => p.type !== 'title').map((p) => p.id), order: 0 })
    views.set('v-2', {
      id: 'v-2',
      name: 'Offen',
      type: 'board',
      groupBy: 'k-status',
      filter: { id: 'f', op: 'and', items: [{ id: 'f1', propertyId: 'k-status', operator: 'is_not', value: 'st-done' }] },
      sorts: [{ propertyId: 'k-title', direction: 'desc' }],
      visibleProperties: ['k-status'],
      order: 1,
    })
    ydb.set('views', views)
    ydb.set('nextUniqueId', 1)
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

type Spec = string | { type: string; attrs?: Record<string, unknown>; text?: Array<[string, Record<string, unknown>?]>; content?: Spec[] }
function toY(spec: Spec): Y.XmlElement {
  if (typeof spec === 'string') return toY({ type: 'paragraph', text: [[spec]] })
  const el = new Y.XmlElement(spec.type)
  for (const [k, v] of Object.entries(spec.attrs ?? {})) el.setAttribute(k, v as string)
  const kids: Array<Y.XmlElement | Y.XmlText> = []
  if (spec.text) {
    const t = new Y.XmlText()
    t.applyDelta(spec.text.map(([insert, attributes]) => ({ insert, attributes: attributes ?? {} })))
    kids.push(t)
  }
  for (const c of spec.content ?? []) kids.push(toY(c))
  if (kids.length) el.insert(0, kids)
  return el
}
const write = (d: Y.Doc, specs: Spec[]) => d.transact(() => d.getXmlFragment('default').insert(d.getXmlFragment('default').length, specs.map(toY)))

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  return client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function raw(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult
}

async function call(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<Any> {
  const res = await raw(client, name, args)
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text)
}

async function fails(client: McpClient, name: string, args: Record<string, unknown>, pattern: RegExp): Promise<string> {
  const res = await raw(client, name, args)
  assert.equal(res.isError, true, `${name} should fail: ${res.content[0]?.text}`)
  assert.match(res.content[0]!.text, pattern)
  return res.content[0]!.text
}

const flat = (blocks: Any[]): Any[] => blocks.flatMap((b) => [b, ...flat(b.children ?? [])])
const REF = /^[#@][A-Za-z0-9_.-]+~[0-9a-f]{6}$/
const STATUS = [
  { id: 'st-todo', name: 'Todo', color: 'gray', group: 'todo' },
  { id: 'st-done', name: 'Done', color: 'green', group: 'done' },
]

/* ------------------------------------------------------------------ pure parts */

describe('MCP read core (pure)', () => {
  test('sha256 equals node:crypto (ASCII, UTF-8, block boundaries)', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'Grüße ⟦#b3~a1b2c3⟧ 🚀', 'y'.repeat(70_000)]) assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'))
  })

  test('a block digest ignores ids and empty attrs, sees every change of text, marks and children', () => {
    const a = { type: 'paragraph', attrs: { id: 'one' }, content: [{ type: 'text', text: 'Nordlicht' }] }
    assert.equal(blockDigest(a), blockDigest({ type: 'paragraph', attrs: { id: 'two', textAlign: null }, content: [{ type: 'text', text: 'Nordlicht' }] }))
    assert.notEqual(blockDigest(a), blockDigest({ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht', marks: [{ type: 'bold' }] }] }))
    assert.notEqual(blockDigest(a), blockDigest({ type: 'paragraph', content: [{ type: 'text', text: 'Tessera' }] }))
    const list = (t: string) => ({ type: 'bulletList', content: [{ type: 'listItem', attrs: { id: 'i' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }] })
    assert.notEqual(blockDigest(list('a')), blockDigest(list('b')))
  })

  test('id prefixes are the shortest unique ones (≥ 6), duplicates get none', () => {
    const p = prefixesFor(['abcdef12', 'abcdef34', 'zzzzzzzz', 'dup0000x', 'dup0000x'])
    assert.equal(p.get('abcdef12'), 'abcdef1')
    assert.equal(p.get('zzzzzzzz'), 'zzzzzz')
    assert.equal(p.has('dup0000x'), false)
  })

  test('ref labels never reach content', () => {
    assert.equal(stripRefLabels('⟦#abc123~a1b2c3⟧\n# Title\n\n- ⟦@2.0~ffffff⟧ Item\n> ⟦#xyz987~000000⟧\n> Quote'), '# Title\n\n- Item\n> Quote')
  })
})

/* ------------------------------------------------------------------ suite */

describe('MCP reads in full (team server)', () => {
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let writer: McpClient
  let reader: McpClient
  const open: DocClient[] = []

  const doc = async (name: string) => {
    const d = openDoc(server, owner, name)
    open.push(d)
    await d.synced
    return d
  }
  const pages = () => meta.doc.getMap('pages')

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => {
      pages().set('root', pageEntry({ title: 'Nordlicht', order: 1, icon: { type: 'emoji', value: '🧭' } }))
      pages().set('alpha', pageEntry({ title: 'Alpha', parentId: 'root', order: 1 }))
      pages().set('beta', pageEntry({ title: 'Beta', parentId: 'root', order: 2 }))
      pages().set('beta-1', pageEntry({ title: 'Beta child', parentId: 'beta', order: 1 }))
      pages().set('beta-1-1', pageEntry({ title: 'Beta grandchild', parentId: 'beta-1', order: 1 }))
      pages().set('hidden-1', pageEntry({ title: 'Hidden helper', parentId: 'root', order: 9, hidden: true }))
      pages().set('trashed-1', pageEntry({ title: 'Old draft', parentId: 'root', order: 8, trashed: true }))
      pages().set('plan', pageEntry({ title: 'Launch plan', order: 2, cover: { type: 'image', value: 'assets/covers/dunes.webp', positionY: 50 } }))
      pages().set('notes', pageEntry({ title: 'Tessera notes', order: 3 }))
      pages().set('long', pageEntry({ title: 'Wissensbasis Langfassung', order: 4 }))
      pages().set('review', pageEntry({ title: 'Tessera review', order: 5 }))
    })
    addDatabase(meta.doc, 'db-kb', 'Wissensbasis', [{ id: 'k-title', name: 'Name', type: 'title' }, { id: 'k-status', name: 'Status', type: 'status', options: STATUS }], {}, { parentId: 'root', order: 3 })
    addDatabase(meta.doc, 'db-inline', 'Inline tasks', [{ id: 'k-title', name: 'Name', type: 'title' }, { id: 'k-status', name: 'Status', type: 'status', options: STATUS }], { inline: true }, { parentId: 'alpha' })
    addDatabase(meta.doc, 'db-mails', 'Mails', [{ id: 'm-title', name: 'Subject', type: 'title' }], { system: 'mails' })
    meta.doc.transact(() => {
      pages().set('row-1', pageEntry({ title: 'Glossar', parentId: 'db-kb', databaseId: 'db-kb', order: 1 }, { 'k-status': 'st-todo' }))
      pages().set('row-2', pageEntry({ title: 'Prozesse', parentId: 'db-kb', databaseId: 'db-kb', order: 2 }, { 'k-status': 'st-done' }))
      pages().set('row-1-sub', pageEntry({ title: 'Glossar notes', parentId: 'row-1', order: 1 }))
      pages().set('mail-1', pageEntry({ title: 'Hallo Mara', parentId: 'db-mails', databaseId: 'db-mails', order: 1 }))
      const comments = (pages().get('review') as Y.Map<unknown>).get('comments') as Y.Map<unknown>
      comments.set('th-1', { id: 'th-1', quote: 'budget', body: 'Is 40k enough?', author: 'Mara Lind', createdAt: 1000, updatedAt: 1000, resolved: false })
      comments.set('th-1/r/r1', { id: 'r1', body: 'Yes', author: 'Tessera', createdAt: 2000, updatedAt: 2000 })
    })
    await flushed(meta)

    const plan = await doc(`ws:${wsId}:p:plan`)
    const p = (text: string): Spec => ({ type: 'paragraph', text: [[text]] })
    write(plan.doc, [
      { type: 'heading', attrs: { id: 'blk-head-0001', level: 2 }, text: [['Plan']] },
      { type: 'paragraph', attrs: { id: 'blk-para-0001' }, text: [['Plain '], ['bold', { bold: {} }]] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('First'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Nested')] }] }] }, { type: 'listItem', content: [p('Second')] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('done')] }] },
      { type: 'blockquote', content: [p('Quoted')] },
      { type: 'codeBlock', attrs: { language: 'ts' }, text: [['const x = 1']] },
      { type: 'callout', attrs: { icon: '💡', color: 'blue' }, content: [p('Note')] },
      { type: 'details', attrs: { heading: 2 }, content: [{ type: 'detailsSummary', text: [['Toggle heading']] }, { type: 'detailsContent', content: [p('Inside')] }] },
      { type: 'columns', content: [{ type: 'column', content: [p('Left')] }, { type: 'column', content: [p('Right')] }] },
      { type: 'tabs', content: [{ type: 'tab', attrs: { title: 'One' }, content: [p('A')] }, { type: 'tab', attrs: { title: 'Two' }, content: [p('B')] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p('H')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p('x')] }] }] },
      { type: 'image', attrs: { src: 'https://nordlicht.example/cover.png', alt: 'Cover', width: 420 } },
      { type: 'fileBlock', attrs: { src: 'onefile:nofile00001', name: 'brief.pdf', display: 'file' } },
      { type: 'pageLink', attrs: { pageId: 'notes' } },
      { type: 'pageLink', attrs: { pageId: 'pg-private-elsewhere' } },
      { type: 'databaseBlock', attrs: { databaseId: 'db-kb', viewId: 'v-2' } },
      { type: 'bookmark', attrs: { url: 'https://nordlicht.example/', title: 'Nordlicht' } },
      { type: 'embed', attrs: { url: 'https://nordlicht.example/map', provider: 'maps' } },
      { type: 'blockMath', attrs: { latex: 'a^2+b^2' } },
      { type: 'mermaid', attrs: { code: 'graph TD; A-->B' } },
      { type: 'button', attrs: { label: 'Ping', variant: 'ink', actions: [{ id: 'a1', type: 'webhook', url: 'https://hooks.nordlicht.example/secret', method: 'POST' }] } },
      { type: 'syncedBlock', attrs: { syncId: 'sync-1' }, content: [p('Shared text')] },
      { type: 'meetingNotes', attrs: { title: 'Weekly', status: 'done', language: 'de-DE', duration: 60000, transcript: [{ t: 0, text: 'Mara: hallo' }, { t: 1000, text: 'Ende' }] }, content: [p('Notes stay')] },
      { type: 'workItem', attrs: { itemId: 'wi_launch0001', status: 'todo' }, content: [p('Send the plan'), p('A note')] },
      { type: 'spreadsheet', attrs: { id: 'sheet-1', title: 'Budget', active: 'sh1', sheets: [{ id: 'sh1', name: 'Q4', rows: 20, cols: 8, cells: { A1: { v: '2' }, A2: { v: '=A1*2' } } }] } },
      { type: 'chart', attrs: { spec: { kind: 'bar', title: 'Reach', source: { kind: 'manual', rows: [['Team', 'n'], ['Nordlicht', 3]] } } } },
      { type: 'toc' },
      { type: 'horizontalRule' },
      p('end'),
    ])
    await flushed(plan)

    const long = await doc(`ws:${wsId}:p:long`)
    const filler = 'Nordlicht und Tessera planen den Launch gemeinsam mit Mara Lind; die Wissensbasis wächst mit jedem Abschnitt weiter. '
    write(long.doc, Array.from({ length: 500 }, (_, i): Spec => ({ type: 'paragraph', attrs: { id: `para-${String(i).padStart(4, '0')}-nordlicht` }, text: [[`§${i} ${filler}${filler}${filler}`]] })))
    await flushed(long)

    const review = await doc(`ws:${wsId}:p:review`)
    write(review.doc, [{ type: 'paragraph', attrs: { id: 'rev-0001-tessera' }, text: [['Shared plan '], ['budget', { comment: { id: 'th-1' } }]] }])
    await flushed(review)

    const wtok = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body
    assert.equal(wtok.comments, 'off')
    writer = await connect(server.url, wtok.token)
    // a read token asking for comments to write gets read: a read token never writes
    const rtok = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Reader', scope: 'read', comments: 'write' })).body
    assert.equal(rtok.comments, 'read')
    reader = await connect(server.url, rtok.token)
    const listed = (await owner.get(`/api/workspaces/${wsId}/tokens`)).body as Any[]
    assert.deepEqual(listed.map((t) => [t.name, t.comments]).sort(), [
      ['Claude', 'off'],
      ['Reader', 'read'],
    ])
  })

  after(async () => {
    await writer?.close().catch(() => {})
    await reader?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('format "blocks": every node type with its ref and data; the task block reads as its plain blocks', async () => {
    const read = await call(writer, 'one_get_page', { id: 'plan', format: 'blocks' })
    assert.equal(read.next, null)
    assert.match(read.rev, /^[0-9a-f]{16}$/)
    assert.equal(read.class, 'page')
    assert.deepEqual(read.cover, { type: 'image', value: 'assets/covers/dunes.webp' })
    assert.deepEqual(read.settings, { fullWidth: false, font: 'sans', smallText: false, locked: false })
    const all = flat(read.blocks)
    for (const b of all) assert.match(b.ref, REF, JSON.stringify(b))
    assert.equal(new Set(all.map((b) => b.ref)).size, all.length)
    const one = (type: string) => {
      const hit = all.find((b) => b.type === type)
      assert.ok(hit, type)
      return hit
    }
    assert.match(one('heading').ref, /^#blk-he/)
    assert.deepEqual(one('heading').attrs, { level: 2 })
    assert.equal(one('paragraph').markdown, 'Plain **bold**')
    assert.deepEqual(one('bulletList').children.map((c: Any) => c.markdown), ['First', 'Second'])
    assert.equal(one('bulletList').children[0].children[0].children[0].markdown, 'Nested')
    assert.deepEqual(one('taskItem').attrs, { checked: true })
    assert.equal(one('callout').children[0].markdown, 'Note')
    assert.deepEqual(one('details').data, { summary: 'Toggle heading' })
    assert.deepEqual(one('columns').children.map((c: Any) => c.children[0].markdown), ['Left', 'Right'])
    assert.deepEqual(one('tabs').data, { tabs: [{ title: 'One' }, { title: 'Two' }] })
    assert.deepEqual(one('image').data, { file: null, url: 'https://nordlicht.example/cover.png' })
    assert.deepEqual(one('fileBlock').data, { file: { ref: 'onefile:nofile00001', name: 'brief.pdf', mime: null, size: null }, url: null, display: 'file' })
    assert.deepEqual(
      all.filter((b) => b.type === 'pageLink').map((b) => b.data),
      [
        { pageId: 'notes', title: 'Tessera notes' },
        { pageId: null, title: '(No access)' },
      ],
    )
    assert.deepEqual(one('databaseBlock').data, { databaseId: 'db-kb', viewId: 'v-2', title: 'Wissensbasis', viewType: 'board', rows: 2 })
    assert.deepEqual(one('bookmark').data, { url: 'https://nordlicht.example/', title: 'Nordlicht' })
    assert.deepEqual(one('embed').data, { url: 'https://nordlicht.example/map', provider: 'maps' })
    assert.deepEqual(one('blockMath').data, { latex: 'a^2+b^2' })
    assert.deepEqual(one('mermaid').data, { code: 'graph TD; A-->B' })
    assert.deepEqual(one('button').data, { label: 'Ping', variant: 'ink', actions: [{ kind: 'webhook' }] })
    assert.ok(!JSON.stringify(read).includes('hooks.nordlicht.example'))
    assert.deepEqual(one('syncedBlock').data, { syncId: 'sync-1', original: true, sourcePageId: null })
    assert.equal(one('meetingNotes').data.transcriptLines, 2)
    assert.equal(one('meetingNotes').data.transcript, undefined)
    // the server has no formula engine: inputs, no values
    assert.deepEqual(one('spreadsheet').data.sheets[0].cells, { A1: { input: '2', value: null }, A2: { input: '=A1*2', value: null } })
    assert.deepEqual(one('chart').data.data, { rows: [['Team', 'n'], ['Nordlicht', 3]] })
    // the task block: its plain blocks in place, never the task form (phase 4)
    assert.ok(!all.some((b) => b.type === 'workItem'))
    assert.ok(!JSON.stringify(read).includes('[!TODO]'))
    assert.ok(all.some((b) => b.markdown === 'Send the plan'))
    const lines = await call(writer, 'one_get_page', { id: 'plan', format: 'blocks', transcript: true })
    assert.deepEqual(flat(lines.blocks).find((b) => b.type === 'meetingNotes').data.transcript, [
      { t: 0, text: 'Mara: hallo' },
      { t: 1000, text: 'Ende' },
    ])
    // Markdown with refs: every top-level block under its label, the same refs
    const md = (await call(writer, 'one_get_page', { id: 'plan', refs: true })).markdown as string
    const labels = [...md.matchAll(/⟦([#@][^⟧]+)⟧/g)].map((m) => m[1])
    for (const b of read.blocks) assert.ok(labels.includes(b.ref), b.ref)
    assert.ok(labels.includes(one('bulletList').children[1].ref))
    assert.ok(!(await call(writer, 'one_get_page', { id: 'plan' })).markdown.includes('⟦'))
    // a label copied into a write never reaches content
    await call(writer, 'one_update_page', { id: 'notes', mode: 'replace', markdown: `⟦${labels[0]}⟧\nCopied line` })
    assert.equal((await call(writer, 'one_get_page', { id: 'notes' })).markdown, 'Copied line')
  })

  test('a long page reads in parts under 40,000 characters each; a write between parts → page_changed', async () => {
    const parts: Any[] = []
    let cursor: string | null = null
    for (let i = 0; i < 30; i++) {
      const res = await raw(writer, 'one_get_page', { id: 'long', format: 'blocks', ...(cursor ? { cursor } : {}) })
      assert.ok(!res.isError, res.content[0]?.text)
      assert.ok(res.content[0]!.text.length < 40_000, `part ${i}: ${res.content[0]!.text.length}`)
      const part = JSON.parse(res.content[0]!.text)
      parts.push(part)
      cursor = part.next
      if (!cursor) break
    }
    assert.ok(parts.length > 3)
    assert.equal(parts[1].title, undefined)
    const refs = parts.flatMap((p) => p.blocks.map((b: Any) => b.ref))
    assert.equal(refs.length, 500)
    assert.equal(new Set(refs).size, 500)
    // the same again: the refs come from the document
    const again = await call(writer, 'one_get_page', { id: 'long', format: 'blocks' })
    assert.deepEqual(again.blocks.map((b: Any) => b.ref), parts[0].blocks.map((b: Any) => b.ref))
    // a write between two parts
    const long = await doc(`ws:${wsId}:p:long`)
    write(long.doc, ['A new line'])
    await flushed(long)
    await fails(writer, 'one_get_page', { id: 'long', format: 'blocks', cursor: parts[0].next }, /^page_changed: cursor:/)
    await fails(writer, 'one_get_page', { id: 'long', cursor: parts[0].next }, /^bad_argument: cursor:.*another read/)
  })

  test('a pure deletion between two parts → page_changed too (rev = state vector + delete set, never a shifted offset)', async () => {
    const first = await call(writer, 'one_get_page', { id: 'long', format: 'blocks' })
    assert.ok(first.next)
    // a member deletes 20 blocks of the part already read — no insertion anywhere
    const long = await doc(`ws:${wsId}:p:long`)
    long.doc.transact(() => long.doc.getXmlFragment('default').delete(0, 20))
    await flushed(long)
    await fails(writer, 'one_get_page', { id: 'long', format: 'blocks', cursor: first.next }, /^page_changed: cursor:/)
    // a fresh read has another rev
    assert.notEqual((await call(writer, 'one_get_page', { id: 'long', format: 'blocks' })).rev, first.rev)
  })

  test('comments only behind the token flag: off → comments_off and no read carries them; read → threads with their ref', async () => {
    const off = await fails(writer, 'one_get_page', { id: 'review', comments: true }, /^comments_off: comments:/)
    // the next step is the server's (a token made with comments on), never the local bridge's device switch
    assert.match(off, /Nothing was changed\. An admin makes a token with comments on \(Workspace → Automation → API, Comments: Read\)/)
    assert.doesNotMatch(off, /Settings → Agents · MCP/)
    const plain = await call(writer, 'one_get_page', { id: 'review' })
    assert.equal(plain.comments, undefined)
    assert.ok(!JSON.stringify(plain).includes('40k'))
    const read = await call(reader, 'one_get_page', { id: 'review', format: 'blocks', comments: true })
    assert.deepEqual(read.comments, [
      { id: 'th-1', quote: 'budget', body: 'Is 40k enough?', author: 'Mara Lind', createdAt: new Date(1000).toISOString(), resolved: false, ref: read.blocks[0].ref, replies: [{ id: 'r1', body: 'Yes', author: 'Tessera', createdAt: new Date(2000).toISOString() }] },
    ])
  })

  test('one_list_pages: sidebar order, depth, rows on request, paging; hidden and trashed never', async () => {
    const one = await call(writer, 'one_list_pages', { parentId: 'root' })
    assert.match(one.urlBase, /\/app\/\?w=.*#\/p\/$/)
    assert.deepEqual(one.items.map((i: Any) => [i.title, i.kind, i.depth, i.children]), [
      ['Alpha', 'page', 1, 1],
      ['Beta', 'page', 1, 1],
      ['Wissensbasis', 'database', 1, 0],
    ])
    assert.ok(!JSON.stringify(one).match(/Hidden helper|Old draft/))
    const deep = await call(writer, 'one_list_pages', { parentId: 'root', depth: 3, kinds: ['page', 'database', 'row'] })
    assert.deepEqual(
      deep.items.map((i: Any) => `${'  '.repeat(i.depth - 1)}${i.title}`),
      ['Alpha', '  Inline tasks', 'Beta', '  Beta child', '    Beta grandchild', 'Wissensbasis', '  Glossar', '    Glossar notes', '  Prozesse'],
    )
    const p1 = await call(writer, 'one_list_pages', { parentId: 'root', depth: 3, kinds: ['page', 'database', 'row'], limit: 4 })
    const p2 = await call(writer, 'one_list_pages', { parentId: 'root', depth: 3, kinds: ['page', 'database', 'row'], limit: 4, cursor: p1.next })
    assert.equal(p2.items[0].title, 'Beta grandchild')
    assert.equal(p1.total, 9)
    await fails(writer, 'one_list_pages', { parentId: 'root', cursor: p1.next }, /^bad_argument: cursor:/)
    await fails(writer, 'one_list_pages', { parentId: 'nowhere-1' }, /^not_found: parentId:/)
    const top = await call(writer, 'one_list_pages', {})
    assert.deepEqual(top.items.map((i: Any) => i.title).slice(0, 2), ['Nordlicht', 'Launch plan'])
  })

  test('lists carry urlBase; full views; inline, parentId and system; class on single reads; tree.more', async () => {
    const dbs = await call(writer, 'one_list_databases')
    assert.match(dbs.urlBase, /#\/p\/$/)
    const kb = dbs.databases.find((d: Any) => d.id === 'db-kb')
    assert.deepEqual({ parentId: kb.parentId, inline: kb.inline, system: kb.system, url: kb.url }, { parentId: 'root', inline: false, system: null, url: undefined })
    assert.equal(dbs.databases.find((d: Any) => d.id === 'db-inline').inline, true)
    assert.equal(dbs.databases.find((d: Any) => d.id === 'db-mails').system, 'mails')
    const found = await call(writer, 'one_search', { query: 'Wissensbasis' })
    assert.equal(found.urlBase, dbs.urlBase)
    assert.equal(found.results[0].url, undefined)
    const rows = await call(writer, 'one_query_database', { databaseId: 'db-kb' })
    assert.equal(rows.urlBase, dbs.urlBase)
    assert.equal(rows.rows[0].url, undefined)
    const schema = await call(writer, 'one_get_database', { id: 'db-kb' })
    assert.equal(schema.class, 'page')
    assert.deepEqual(schema.views.find((v: Any) => v.id === 'v-2'), {
      id: 'v-2',
      name: 'Offen',
      type: 'board',
      groupBy: 'Status',
      filter: [{ property: 'Status', op: 'is_not', value: 'Done' }],
      sorts: [{ property: 'Name', direction: 'desc' }],
      properties: ['Status'],
      filtered: true,
    })
    assert.equal((await call(writer, 'one_get_page', { id: 'row-1' })).class, 'rows')
    assert.equal((await call(writer, 'one_get_page', { id: 'mail-1' })).class, 'mail')
    assert.deepEqual((await call(writer, 'one_overview')).tree, { more: true, use: 'one_list_pages' })
  })
})
