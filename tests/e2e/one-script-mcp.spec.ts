/**
 * One Script over the local MCP bridge: the built bridge (public/mcp/one-mcp.mjs) as a child process,
 * driven by the MCP SDK client over stdio, the app tab connected to it. one_run_query answers rows as JSON
 * (writes refused); one_run_script is a dry run only (Weg 4): no card, `ran: false`, nothing written or sent — the
 * person runs a script in One; a saved query answers at once; Read only refuses it. Never talks to api.anthropic.com
 * or Google. */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, pageIdByTitle, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47377

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
  await expect.poll(() => stderr).toContain(`waiting for One on ws://127.0.0.1:${PORT}`)
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

/** Settings → Agents · MCP: the test port, switched on, connected; this test's workspace adopted. */
async function connect(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Connected · Claude Code')
  let list: { workspaces: Array<{ id: string }>; lastUsed?: { id: string } } = { workspaces: [] }
  await expect
    .poll(async () => {
      list = json(await call('one_list_workspaces'))
      return list.workspaces.length
    })
    .toBe(1)
  if (list.lastUsed && list.lastUsed.id !== list.workspaces[0].id) json(await call('one_list_databases', { workspace: list.workspaces[0].id }))
}

async function makeTasks(page: Page): Promise<{ dbId: string; ids: string[] }> {
  return wsEval(page, (s) => {
    const dbId = s.createDatabase({
      title: 'Aufgaben',
      parentId: null,
      properties: [
        { id: 'p_name', name: 'Name', type: 'title' },
        { id: 'p_status', name: 'Status', type: 'select', options: [{ id: 'o_open', name: 'Offen', color: 'blue' }, { id: 'o_done', name: 'Erledigt', color: 'green' }] },
        { id: 'p_prio', name: 'Priorität', type: 'select', options: [{ id: 'o_high', name: 'Hoch', color: 'red' }, { id: 'o_low', name: 'Niedrig', color: 'gray' }] },
      ],
    })
    const ids = [
      ['Angebot schreiben', 'o_open'],
      ['Rechnung prüfen', 'o_open'],
      ['Website live', 'o_done'],
    ].map(([title, status]) => s.createRow(dbId, { title, properties: { p_status: status, p_prio: 'o_low' } }))
    return { dbId, ids }
  })
}

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

const prioOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id].properties.p_prio), ids)
const RAISE = 'for t in db("Aufgaben").where(Status = "Offen") {\n  t.set(Priorität: "Hoch")\n}\nprint("raised")\n'

test('one_run_query: rows as JSON, read-only; one_overview lists the scripts', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.keyboard.press('Escape')
  const { ids } = await makeTasks(page)
  await addScript(page, { id: 'sc-raise', name: 'Offene hochstufen', code: RAISE })

  const rows = json(await call('one_run_query', { code: 'db("Aufgaben").where(Status = "Offen").select(id, Name, Priorität)' }))
  expect(rows.count).toBe(2)
  expect(rows.rows).toEqual([
    { id: ids[0], Name: 'Angebot schreiben', Priorität: 'Niedrig' },
    { id: ids[1], Name: 'Rechnung prüfen', Priorität: 'Niedrig' },
  ])
  expect(rows.workspace.id).toMatch(/^local:/)
  expect(json(await call('one_run_query', { code: 'db("Aufgaben").count' })).value).toBe(3)
  expect(json(await call('one_run_query', { code: 'db("Aufgaben").rows', limit: 1 }))).toMatchObject({ count: 3, truncated: true })

  // a write is refused, nothing changes
  const refused = await call('one_run_query', { code: 'db("Aufgaben").first.set(Priorität: "Hoch")' })
  expect(refused.isError).toBe(true)
  expect(text(refused)).toContain('This run only reads')
  expect(await prioOf(page, ids)).toEqual(['o_low', 'o_low', 'o_low'])
  // every way to write, send, ask or move is refused in a query — nothing changes, nothing is sent
  const before = await wsEval(page, (s) => JSON.stringify(Object.values(s.pages).map((p: AnyState) => [p.id, p.title, p.trashed, p.contentRev, p.properties])))
  const writes = [
    't.set(Priorität: "Hoch")',
    't.Priorität = "Hoch"',
    't["Priorität"] = "Hoch"',
    't.append("x")',
    't.prepend("x")',
    't.replace("x")',
    'trash(t)',
    't.open()',
    'db("Aufgaben").add("Neu")',
    'create.page(title: "Neu")',
    'mail.send(to: "a@example.com", subject: "x", body: "y")',
    'claude("hi")',
    'http.post("https://example.com", {a: 1})',
    'notify("x")',
    'confirm("x")',
    'ask("x")',
    'modal("x")',
    'choose("x", ["a"])',
    'db("Aufgaben").rows.map(r => r.set(Priorität: "Hoch"))',
    'fn w(r) { r.set(Priorität: "Hoch") }\nw(t)',
  ]
  for (const w of writes) {
    const r = await call('one_run_query', { code: `let t = db("Aufgaben").first\n${w}` })
    expect(r.isError, w).toBe(true)
    expect(text(r), w).toContain('This run only reads')
  }
  expect(await wsEval(page, (s) => JSON.stringify(Object.values(s.pages).map((p: AnyState) => [p.id, p.title, p.trashed, p.contentRev, p.properties])))).toBe(before)
  // a syntax error says where
  expect(text(await call('one_run_query', { code: 'db("Aufgaben").where(' }))).toMatch(/Syntax error: 1:\d+/)

  const overview = json(await call('one_overview'))
  expect(overview.scripts).toEqual([{ id: 'sc-raise', name: 'Offene hochstufen', kind: 'script' }])
})

test('one_run_script is a dry run only (Weg 4): no card, also in Apply directly; ran: false; a saved query answers; Read only refuses', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await page.keyboard.press('Escape')
  const { ids } = await makeTasks(page)
  await addScript(page, { id: 'sc-raise', name: 'Offene hochstufen', code: RAISE })
  await addScript(page, { id: 'sc-q', name: 'Offene zählen', code: 'db("Aufgaben").where(Status = "Offen").count', kind: 'query' })

  // what it would do — nothing changes, nothing is asked; dryRun: true answers the same
  for (const args of [{ script: 'Offene hochstufen' }, { script: 'Offene hochstufen', dryRun: true }]) {
    const dry = json(await call('one_run_script', args))
    expect(dry).toMatchObject({ ran: false, mode: 'dry', status: 'ok', printed: ['raised'] })
    expect(dry.note).toContain('ask the person to run it in One → Scripts')
    expect(dry.changes.map((c: AnyState) => [c.kind, c.title, c.properties[0].after])).toEqual([
      ['set', 'Angebot schreiben', 'Hoch'],
      ['set', 'Rechnung prüfen', 'Hoch'],
    ])
    expect(await prioOf(page, ids)).toEqual(['o_low', 'o_low', 'o_low'])
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  }

  // a saved query: its answer, at once
  expect(json(await call('one_run_script', { script: 'sc-q' }))).toMatchObject({ query: true, value: 2 })

  // unknown scripts list the ones there are
  const unknown = await call('one_run_script', { script: 'Nope' })
  expect(unknown.isError).toBe(true)
  expect(text(unknown)).toContain('"Offene hochstufen" (id: sc-raise, script)')

  // Read only: refused
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP/ }).click()
  await page.getByRole('radio', { name: 'Read only' }).click()
  const ro = await call('one_run_script', { script: 'sc-raise' })
  expect(ro.isError).toBe(true)
  expect(text(ro)).toContain('Agents can only read')
})

test('one_run_script with a mail: the dry run names it, nothing is sent and nothing written', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] }
    w.__opened = []
    window.open = ((url?: string | URL) => {
      w.__opened.push(String(url))
      return null
    }) as typeof window.open
  })
  await openApp(page)
  await connect(page)
  await page.keyboard.press('Escape')
  const welcome = await pageIdByTitle(page, 'Welcome to One')
  await addScript(page, { id: 'sc-mail', name: 'Weiterleiten', code: 'mail.send(to: "bob@example.com", subject: page.current.title, body: "Siehe One")\npage.current.append("- weitergeleitet")\n' })

  const dry = json(await call('one_run_script', { script: 'Weiterleiten', pageId: welcome }))
  expect(dry).toMatchObject({ ran: false, mode: 'dry' })
  expect(dry.effects).toEqual([expect.objectContaining({ kind: 'mail', label: 'bob@example.com · Welcome to One' })])
  expect(dry.changes.map((c: AnyState) => [c.kind, c.title])).toEqual([['content', 'Welcome to One']])
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Before this run' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([])
  expect(await wsEval(page, (s, id) => s.pages[id].plain, welcome)).not.toContain('weitergeleitet')
})

const lines = (...texts: string[]) => ({ type: 'doc', content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })

test('one_run_script into a locked page (review 5): the dry run is refused, nothing written', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.keyboard.press('Escape')
  const id = await wsEval(page, (s, doc) => {
    const id = s.createPage({ title: 'Handbuch' })
    s.setContent(id, doc, 'e2e')
    s.updatePage(id, { settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } })
    return id
  }, lines('Do not change.'))
  await addScript(page, { id: 'sc-lock', name: 'Lock test', code: 'page("Handbuch").append("Changed by a script.")\n' })
  await flush(page)
  const plain = () => wsEval(page, (s, id) => (s.pages[id]?.plain as string) ?? '', id)
  const r = await call('one_run_script', { script: 'Lock test' })
  expect(r.isError, text(r)).toBe(true)
  expect(text(r)).toMatch(/^locked: script: the script "Lock test" writes into "Handbuch", which is locked in One: its content cannot change over MCP\. Nothing was changed\./)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(await plain()).toBe('Do not change.')
})
