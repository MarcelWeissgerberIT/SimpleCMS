/**
 * MCP B8a — the German walk-through of train T-a (MCP plan § 5), through the BUILT bridge with the MCP SDK's stdio client
 * (as Claude Code drives it), in a German One tab set to "Erst fragen":
 *
 *   „Lege unter Projekt Nordlicht eine Unterseite mit einem Board Todo / Doing / Done an und trage diese fünf Aufgaben ein."
 *
 * Target: 2 calls (one_search, then one_create_database with views + properties + rows), 1 card in Ask first — the
 * calls a model makes from the tool descriptions and the instructions' routing line (MCP_LINE_BOARD). The board is a
 * sub-page of the project, grouped by Status, the five tasks in its Todo lane; one Undo takes the whole board back.
 * A second case records what happens when the model leaves Status out of the rows (they wait in the first lane too —
 * a status property starts every new row at its first option, as the app does).
 *
 * `WALK_OUT=<file>` writes what the client sent and got (for the notes); `WALK_SHOTS=<dir>` takes German screenshots of
 * the card and the board (1440×900 + 390×844, light + dark). Fictional data (Nordlicht, Tessera, Mara Lind, Launch
 * plan, Wissensbasis).
 */
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush, gotoPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47370

let client: Client
let stderr = ''
/** every call the "model" made: tool, arguments, answer */
const transcript: Array<{ tool: string; args: Record<string, unknown>; answer: unknown }> = []

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
  if (process.env.WALK_OUT) writeFileSync(process.env.WALK_OUT, JSON.stringify(transcript, null, 2))
})

const text = (r: ToolResult) => (r.content ?? []).map((c) => c.text ?? '').join('')
const json = (r: ToolResult) => {
  expect(r.isError, text(r)).toBeFalsy()
  return JSON.parse(text(r))
}
/** A call as the model makes it (recorded); setup calls go through `setup()` and are not counted. */
async function call(tool: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name: tool, arguments: args })) as ToolResult
  const answer = json(r)
  transcript.push({ tool, args, answer })
  return answer
}
const setup = async (tool: string, args: Record<string, unknown> = {}) => json((await client.callTool({ name: tool, arguments: args })) as ToolResult)

const card = (page: Page) => page.getByRole('alertdialog')

/** Einstellungen → Agenten · MCP (German): the test port, the switch on, "Erst fragen". */
async function connectGerman(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: 'Agenten · MCP' }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'KI-Agenten auf diesem Computer erlauben' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Verbunden')
  let list: AnyState = { workspaces: [] }
  await expect
    .poll(async () => {
      list = await setup('one_list_workspaces')
      return list.workspaces.length
    })
    .toBe(1)
  // the MCP session worked in the previous test's workspace: name this one once (a model asks the person first)
  if (list.lastUsed && list.lastUsed.id !== list.workspaces[0].id) await setup('one_list_databases', { workspace: list.workspaces[0].id })
  await page.getByRole('radio', { name: 'Erst fragen' }).click()
  await expect(page.getByRole('radio', { name: 'Erst fragen' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** The workspace: the project the person means, a sibling with a similar name, a knowledge base. */
async function seed(page: Page) {
  const ids = await wsEval(page, (s) => {
    s.updateSettings({ language: 'de' })
    const project = s.createPage({ title: 'Projekt Nordlicht', icon: { type: 'emoji', value: '🧭' } })
    s.setContent(project, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Launch plan für Nordlicht — Ansprechpartnerin Mara Lind.' }] }] }, 'e2e')
    const sibling = s.createPage({ title: 'Projekt Tessera' })
    const kb = s.createPage({ title: 'Wissensbasis' })
    return { project, sibling, kb }
  })
  await flush(page)
  return ids
}

const FIVE = ['Kick-off mit Mara Lind', 'Launch plan abstimmen', 'Wissensbasis anlegen', 'Pressetext schreiben', 'Retro planen']

test('„Lege unter Projekt Nordlicht eine Unterseite mit einem Board Todo / Doing / Done an und trage diese fünf Aufgaben ein" — 2 calls, 1 card', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await connectGerman(page)
  // every card the tab shows during the walk-through (an alertdialog appearing), counted by the page itself
  await page.evaluate(() => {
    const w = window as unknown as { __walkCards: number }
    w.__walkCards = 0
    let shown = false
    new MutationObserver(() => {
      const now = !!document.querySelector('[role="alertdialog"]')
      if (now && !shown) w.__walkCards++
      shown = now
    }).observe(document.body, { childList: true, subtree: true })
  })
  const cardsShown = () => page.evaluate(() => (window as unknown as { __walkCards: number }).__walkCards)

  // call 1: find the project (a read: answered at once, no card)
  const found = await call('one_search', { query: 'Projekt Nordlicht' })
  const hit = found.results.find((r: AnyState) => r.title === 'Projekt Nordlicht')
  expect(hit?.id).toBe(ids.project)
  expect(await cardsShown()).toBe(0)

  // call 2: the board as its own sub-page, its lanes and the five tasks — exactly as the description's example
  const pending = call('one_create_database', {
    title: 'Board',
    parentId: hit.id,
    views: [{ type: 'board', groupBy: 'Status' }],
    properties: [{ name: 'Status', type: 'status', options: ['Todo', 'Doing', 'Done'] }],
    rows: FIVE.map((title) => ({ title, properties: { Status: 'Todo' } })),
  })
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toContainText('Board')
  await expect(card(page)).toContainText('Projekt Nordlicht')
  await expect(card(page)).toContainText('5 Zeilen')
  for (const t of FIVE) await expect(card(page)).toContainText(t)
  if (process.env.WALK_SHOTS) await shots(page, 'walk-card')
  await card(page).getByRole('button', { name: 'Freigeben' }).click()
  const board = await pending
  await expect(card(page)).toHaveCount(0)

  // the answer is enough for the next call: ids of the board, its views and every row
  expect(board.parentId).toBe(ids.project)
  expect(board.views.map((v: AnyState) => [v.type, v.groupBy])).toEqual([
    ['board', 'Status'],
    ['table', null],
  ])
  expect(board.rows.map((r: AnyState) => r.title)).toEqual(FIVE)
  expect(board.note).toMatch(/table view was added/)

  // 2 calls, 1 card
  expect(transcript.map((c) => c.tool)).toEqual(['one_search', 'one_create_database'])
  expect(await cardsShown()).toBe(1)

  // in One: a sub-page of the project, grouped by Status; lanes Todo · Doing · Done, the five tasks in Todo
  const stored = await wsEval(
    page,
    (s, b: AnyState) => {
      const db = s.databases[b.id]
      const status = db.properties.find((p: AnyState) => p.name === 'Status')
      return {
        parent: s.pages[b.id].parentId,
        lanes: status.options.map((o: AnyState) => o.name),
        groupBy: db.views[0].groupBy === status.id,
        values: b.rows.map((r: AnyState) => status.options.find((o: AnyState) => o.id === s.pages[r.id].properties[status.id])?.name),
      }
    },
    board,
  )
  expect(stored).toEqual({ parent: ids.project, lanes: ['Todo', 'Doing', 'Done'], groupBy: true, values: FIVE.map(() => 'Todo') })
  await gotoPage(page, board.id)
  const todo = page.locator('.dbb-col[aria-label="Todo"]')
  await expect(todo.locator('.dbc')).toHaveCount(5)
  await expect(page.locator('.dbb-col[aria-label="Doing"] .dbc')).toHaveCount(0)
  await expect(page.locator('.dbb-col[aria-label="Done"] .dbc')).toHaveCount(0)
  if (process.env.WALK_SHOTS) await shots(page, 'walk-board')

  // one Undo takes the whole board back (into the trash, with its rows)
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: 'Agenten · MCP' }).click()
  await page.locator('.mcp-log__row').getByRole('button', { name: /one_create_database/ }).first().click()
  await expect.poll(() => wsEval(page, (s, id: string) => !!s.pages[id]?.trashed, board.id)).toBe(true)
  expect(await wsEval(page, (s, rows: string[]) => rows.every((id) => !s.pages[id] || s.pages[id].trashed || s.pages[s.pages[id].parentId]?.trashed), board.rows.map((r: AnyState) => r.id))).toBe(true)
})

test('the same request without a Status per row: the rows still land in the first lane (Todo)', async ({ page }) => {
  await openApp(page)
  const ids = await seed(page)
  await connectGerman(page)
  const pending = setup('one_create_database', {
    title: 'Board',
    parentId: ids.project,
    views: [{ type: 'board', groupBy: 'Status' }],
    properties: [{ name: 'Status', type: 'status', options: ['Todo', 'Doing', 'Done'] }],
    rows: FIVE.map((title) => ({ title })),
  })
  await expect(card(page)).toContainText('5 Zeilen')
  await card(page).getByRole('button', { name: 'Freigeben' }).click()
  const board = await pending
  transcript.push({ tool: 'one_create_database (rows without Status)', args: { rows: FIVE.map((title) => ({ title })) }, answer: board })
  await gotoPage(page, board.id)
  await expect(page.locator('.dbb-col[aria-label="Todo"] .dbc')).toHaveCount(5)
})

/** German screenshots of what is on screen now: 1440×900 and 390×844, light and dark. */
async function shots(page: Page, name: string) {
  const dir = process.env.WALK_SHOTS!
  const before = page.viewportSize()!
  for (const [w, h, tag] of [
    [1440, 900, 'desktop'],
    [390, 844, 'phone'],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: w, height: h })
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${dir}/${name}-${tag}-${theme}.png` })
    }
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.setViewportSize(before)
}
