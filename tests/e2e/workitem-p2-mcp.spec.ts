/**
 * Task block P2 — One MCP (the local bridge, driven like Claude Code drives it): one_list_work_items and
 * one_update_work_item; task blocks in one_create_page / one_update_page through the same settle gate as the app
 * (ids One's, people never created, holds always asked — also in "Apply directly"); the replace checks the page did
 * not change while the card waited, writes first and rolls back once when a folded task change fails. Its own bridge
 * port. Fictional data.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, createPage, doc, para, flush, gotoPage, editorOf } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47387
const TERMINAL_NAMES = /\b(update_work_item|list_work_items|append_to_page|read_page)\b/

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

async function connect(page: Page, mode: 'Apply directly' | 'Ask first' = 'Apply directly') {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
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
  await page.keyboard.press('Escape')
}

const p = (t: string): JSONContent => para(t)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })
const card = (page: Page) => page.locator('.mcp-card')

function tasksIn(d: JSONContent | null | undefined): AnyState[] {
  const out: AnyState[] = []
  const t = (n: JSONContent): string => n.text ?? (n.content ?? []).map(t).join('')
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push({ ...(n.attrs ?? {}), title: t(n.content?.[0] ?? {}) })
    for (const c of n.content ?? []) walk(c)
  }
  if (d) walk(d)
  return out
}
const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id]?.content ?? null, id)
const people = (page: Page) => wsEval(page, (s) => Object.fromEntries((s.people as Array<{ id: string; name: string }>).map((x) => [x.name, x.id])))

test('the tool list and the instructions name the task tools', async () => {
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  expect(names).toEqual(expect.arrayContaining(['one_list_work_items', 'one_update_work_item']))
  expect(tools.find((t) => t.name === 'one_list_work_items')!.annotations?.readOnlyHint).toBe(true)
  expect(client.getInstructions() ?? '').toMatch(/one_list_work_items/)
  expect(tools.find((t) => t.name === 'one_get_page')!.description).toContain('[!TODO]')
})

test('get_page reads mentions as one: links; a replace with them keeps mentions and tasks; a web image becomes a link; one that removes a task is asked', async ({ page }) => {
  await openApp(page)
  const ppl = await people(page)
  const K = 'wi_mcpkeep001'
  const content = doc(
    { type: 'paragraph', content: [{ type: 'text', text: 'Ask ' }, { type: 'mention', attrs: { id: ppl.Alex, label: 'Alex', kind: 'person' } }, { type: 'text', text: ' first.' }] },
    item({ itemId: K, status: 'in_progress', people: [ppl.Mira], due: '2031-10-17' }, 'Ship pricing'),
  )
  const id = await createPage(page, { title: 'Nordlicht MCP', content })
  await connect(page)
  const md = json(await call('one_get_page', { id })).markdown as string
  expect(md).toContain(`[@Alex](one:person/${ppl.Alex})`)
  expect(md).toContain(`{#${K}}`)
  json(await call('one_update_page', { id, mode: 'replace', markdown: `${md}\n\n![x](https://tracker.example/p.png)` }))
  await flush(page)
  const after = await contentOf(page, id)
  expect(JSON.stringify(after)).toContain('"kind":"person"')
  expect(tasksIn(after)).toMatchObject([{ itemId: K, status: 'in_progress', people: [ppl.Mira], due: '2031-10-17' }])
  expect(JSON.stringify(after)).not.toContain('"type":"image"')
  expect(JSON.stringify(after)).toContain('https://tracker.example/p.png')
  // leaving the task out: asked even in Apply directly (removes)
  const pending = call('one_update_page', { id, mode: 'replace', markdown: 'Only text now.' })
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('.mcp-line--item[data-tag="removed"]')).toContainText('Ship pricing')
  await expect(card(page)).toContainText('Always asked: Removes tasks')
  await card(page).getByRole('button', { name: /Reject/ }).click()
  expect((await pending).isError).toBe(true)
  expect(tasksIn(await contentOf(page, id))).toHaveLength(1)
  // the page opened (its blocks carry ids — the inbox keys @mentions by them): a round trip writes every paragraph anew,
  // so Alex's mention lands in a new block (a ping) — asked, even in Apply directly
  await gotoPage(page, id)
  await expect(editorOf(page, id)).toContainText('Ship pricing')
  await expect.poll(() => wsEval(page, (s, id) => typeof s.pages[id].content.content[0].attrs?.id === 'string', id)).toBe(true)
  const md2 = json(await call('one_get_page', { id })).markdown as string
  const pinged = call('one_update_page', { id, mode: 'replace', markdown: md2.replace('first.', 'first, please.') })
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toContainText('Always asked: Names a person')
  await card(page).getByRole('button', { name: /Reject/ }).click()
  expect((await pinged).isError).toBe(true)
})

test('create_page in Apply directly: a plain task applies at once; an owner or a reminder is asked; the answer lists the ids; nobody is created', async ({ page }) => {
  await openApp(page)
  const ppl = await people(page)
  const before = await wsEval(page, (s) => s.people.length as number)
  await connect(page)
  const plain = json(await call('one_create_page', { title: 'Plain tasks', markdown: '> [!TODO] Book the bus' }))
  expect(plain.tasks).toEqual([{ id: expect.stringMatching(/^wi_/), title: 'Book the bus' }])
  expect(tasksIn(await contentOf(page, plain.id))).toMatchObject([{ itemId: plain.tasks[0].id }])
  await expect(card(page)).toHaveCount(0)
  // an owner: the card, with the task line and why it is asked; rejected → nothing
  const owned = call('one_create_page', { title: 'Owned task', markdown: '> [!TODO] Order shirts\n> Owner: Alex' })
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('.mcp-line--item[data-tag="new"]')).toContainText('Order shirts')
  await expect(card(page).locator('.mcp-line--item')).toContainText('Alex')
  await expect(card(page)).toContainText('Always asked: Names a person')
  await card(page).getByRole('button', { name: /Reject/ }).click()
  expect((await owned).isError).toBe(true)
  expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((p) => p.title === 'Owned task'))).toBe(false)
  // a reminder: asked; approved → written with it
  const reminded = call('one_create_page', { title: 'Reminder task', markdown: '> [!TODO] Call the caterer\n> Due: 2031-11-03 · Reminder: -1d' })
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toContainText('Sets a reminder')
  await card(page).getByRole('button', { name: /Approve/ }).click()
  const made = json(await reminded)
  expect(tasksIn(await contentOf(page, made.id))).toMatchObject([{ itemId: made.tasks[0].id, due: '2031-11-03', reminder: '-1d' }])
  // an unknown owner: refused with the names, nothing changed, no email ever
  const unknown = await call('one_create_page', { title: 'Bob task', markdown: '> [!TODO] Fix the sink\n> Owner: Bob' })
  expect(unknown.isError).toBe(true)
  expect(text(unknown)).toContain('Unknown person "Bob"')
  expect(text(unknown)).toContain('Nothing was changed.')
  expect(text(unknown)).not.toMatch(TERMINAL_NAMES)
  expect(await wsEval(page, (s) => s.people.length as number)).toBe(before)
  void ppl
})

test('replace: a page typed into while the card waits is not replaced; a folded Blocks: is one card and writes both; a failing folded change rolls the replace back', async ({ page }) => {
  await openApp(page)
  const L = 'wi_mcplegal01'
  const id = await createPage(page, { title: 'Tessera MCP', content: doc(p('Intro.'), item({ itemId: L, status: 'todo' }, 'Legal check')) })
  await connect(page, 'Ask first')
  // changed while waiting
  const md = json(await call('one_get_page', { id })).markdown as string
  const first = call('one_update_page', { id, mode: 'replace', markdown: `${md}\n\nAppended over MCP.` })
  await expect(card(page)).toBeVisible()
  await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [...s.pages[id].content.content, { type: 'paragraph', content: [{ type: 'text', text: 'Typed meanwhile.' }] }] }, 'e2e'), id)
  await card(page).getByRole('button', { name: /Approve/ }).click()
  const stale = await first
  expect(stale.isError).toBe(true)
  expect(text(stale)).toContain('changed while this call waited. Nothing was changed.')
  // the code first, as on the team server: an agent branches on page_changed (read again, call again)
  expect(text(stale)).toMatch(/^page_changed: id: /)
  expect(JSON.stringify(await contentOf(page, id))).not.toContain('Appended over MCP')
  // a new task that blocks the existing one: one card, both written
  const md2 = json(await call('one_get_page', { id })).markdown as string
  const both = call('one_update_page', { id, mode: 'replace', markdown: `${md2}\n\n> [!TODO] Draft copy\n> Blocks: Legal check` })
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('.mcp-line--item[data-tag="new"]')).toContainText('Draft copy')
  await expect(card(page).locator('.mcp-line--item[data-tag="changed"]')).toContainText('Legal check')
  await card(page).getByRole('button', { name: /Approve/ }).click()
  const res = json(await both)
  const draft = res.tasks.find((t: AnyState) => t.title === 'Draft copy').id
  await flush(page)
  const tasks = tasksIn(await contentOf(page, id))
  expect(tasks.find((t) => t.itemId === L)!.blockedBy).toEqual([draft])
  // Undo (the toast's key): the folded change wrote the page after the replace — both go back, the replace too
  await page.locator('.toast').filter({ hasText: /one_update_page|Tessera MCP/ }).getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.toast').filter({ hasText: 'Agent change undone' })).toBeVisible()
  await flush(page)
  const back = await contentOf(page, id)
  expect(JSON.stringify(back)).not.toContain('Draft copy')
  expect(tasksIn(back).map((t) => [t.itemId, t.blockedBy ?? []])).toEqual([[L, []]])
  // the folded change fails (its task went to the trash meanwhile): the replace is set back
  const other = await createPage(page, { title: 'Tessera side', content: doc(item({ itemId: 'wi_mcpside001', status: 'todo' }, 'Side check')) })
  const md3 = json(await call('one_get_page', { id })).markdown as string
  const rolled = call('one_update_page', { id, mode: 'replace', markdown: `${md3}\n\n> [!TODO] Late draft\n> Blocks: Side check` })
  await expect(card(page)).toBeVisible()
  await wsEval(page, (s, other) => s.trashPage(other), other)
  await card(page).getByRole('button', { name: /Approve/ }).click()
  const failed = await rolled
  expect(failed.isError).toBe(true)
  expect(text(failed)).toContain('Nothing was changed')
  expect(JSON.stringify(await contentOf(page, id))).not.toContain('Late draft')
})

test('one_update_work_item and one_list_work_items: JSON; an unassigned change applies, an assigned one is asked; a no-op answers without a card; read only refuses; no terminal names', async ({ page }) => {
  await openApp(page)
  const ppl = await people(page)
  const U = 'wi_mcpunas001'
  const AS = 'wi_mcpasgn001'
  const id = await createPage(page, { title: 'Nordlicht tasks', content: doc(item({ itemId: U, status: 'todo' }, 'Unassigned errand'), item({ itemId: AS, status: 'todo', due: '2031-10-01', people: [ppl.Sam] }, 'Assigned errand')) })
  await connect(page)
  const list = json(await call('one_list_work_items', { query: 'errand' }))
  expect(list.count).toBe(2)
  expect(list.items.find((t: AnyState) => t.id === AS)).toMatchObject({ title: 'Assigned errand', status: 'todo', due: '2031-10-01', people: [{ id: ppl.Sam, name: 'Sam' }], page: { id, title: 'Nordlicht tasks' } })
  expect(list.items[0].url).toContain(`#/p/${id}`)
  const mine = json(await call('one_list_work_items', { person: 'Sam' }))
  expect(mine.items.map((t: AnyState) => t.id)).toContain(AS)
  // unassigned: applied directly, the tasks after the change come back
  const done = json(await call('one_update_work_item', { updates: [{ item: U, status: 'done' }] }))
  expect(done.tasks).toMatchObject([{ id: U, status: 'done' }])
  await expect(card(page)).toHaveCount(0)
  // the same again: nothing to do, no card
  const noop = json(await call('one_update_work_item', { updates: [{ item: U, status: 'done' }] }))
  expect(noop.note).toContain('No change')
  // an assigned task's due date: asked (changes an assigned task)
  const asked = call('one_update_work_item', { updates: [{ item: AS, due: '2031-10-05' }] })
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toContainText('Changes an assigned task')
  await expect(card(page).locator('.mcp-line--item[data-tag="changed"]')).toContainText('Assigned errand')
  await card(page).getByRole('button', { name: /Approve/ }).click()
  expect(json(await asked).tasks).toMatchObject([{ id: AS, due: '2031-10-05' }])
  // refusals speak MCP
  const bad = await call('one_update_work_item', { updates: [{ item: 'wi_nosuchtask', status: 'done' }] })
  expect(bad.isError).toBe(true)
  expect(text(bad)).toContain('one_list_work_items')
  expect(text(bad)).not.toMatch(TERMINAL_NAMES)
  const who = await call('one_update_work_item', { updates: [{ item: U, people: { add: ['Bob'] } }] })
  expect(text(who)).toContain('Unknown person "Bob"')
  expect(text(who)).not.toContain('@example.test')
  // read only refuses every change
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
  await page.getByRole('radio', { name: 'Read only' }).click()
  await page.keyboard.press('Escape')
  const ro = await call('one_update_work_item', { updates: [{ item: U, status: 'todo' }] })
  expect(ro.isError).toBe(true)
  expect(tasksIn(await contentOf(page, id)).find((t) => t.itemId === U)!.status).toBe('done')
})
