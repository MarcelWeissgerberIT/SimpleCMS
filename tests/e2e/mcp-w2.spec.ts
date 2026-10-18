/**
 * Weg 4 W2 review on the local bridge, driven like Claude Code drives it (the built bridge through the MCP SDK's stdio
 * client, its own port): an MCP call that changed a property's type keeps that property's values in EVERY row (the
 * trash too) as it left them — a value written since into a row the call did not convert (empty then) or into a row
 * made since refuses the call's Undo whole: the old type is never put back under values it cannot read.
 * Fictional data (Nordlicht, Mara Lind, Tessera).
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
const PORT = 47413

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
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await closeSettings(page)
}

/** The newest Undo of a tool, refused whole: the toast says what changed and where to take it back; the row keeps no key. */
async function undoRefused(page: Page, tool: string) {
  await openAgentsTab(page)
  const keys = page.locator('.mcp-log__row').getByRole('button', { name: new RegExp(`^(Undo ${tool}|${tool} rückgängig machen)$`) })
  const n = await keys.count()
  const refusedRows = page.locator('.mcp-log__row', { hasText: tool }).filter({ hasText: /Not undone|Nicht rückgängig gemacht/ })
  const before = await refusedRows.count()
  await keys.first().click()
  await expect(refusedRows).toHaveCount(before + 1)
  await expect(keys).toHaveCount(n - 1)
  const toast = page.locator('.toast', { hasText: /Not undone|Nicht rückgängig gemacht/ }).last()
  await expect(toast).toBeVisible()
  const words = (await toast.innerText()).replace(/\s+/g, ' ')
  await closeSettings(page)
  return words
}

/** The pages and databases as JSON (what a refused Undo must leave exactly as it is). */
const snapshot = (page: Page) => wsEval(page, (s) => JSON.stringify([s.pages, s.databases]))

test('text → select, then a row empty at the call is filled and a row is made with the new option: the Undo is refused whole', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht crew', properties: [{ id: 'r-title', name: 'Name', type: 'title' }, { id: 'r-role', name: 'Role', type: 'text' }] as never })
    const ada = s.createRow(db, { title: 'Mara Lind', properties: { 'r-role': 'Pilot' } })
    const ben = s.createRow(db, { title: 'Tessera', properties: {} })
    return { db, ada, ben }
  })
  await flush(page)
  await connect(page)
  json(await call('one_update_property', { databaseId: ids.db, property: 'Role', type: 'select' }))
  const role = () => wsEval(page, (s, db: string) => (s.databases[db].properties as AnyState[]).find((p) => p.id === 'r-role'), ids.db)
  const def = await role()
  expect(def?.type).toBe('select')
  const pilot = (def?.options as AnyState[]).find((o) => o.name === 'Pilot')?.id as string
  expect(pilot).toBeTruthy()
  // the person picks the new option in a row the call did not convert, and makes a row with it
  const cleo = await wsEval(
    page,
    (s, a: { db: string; ben: string; pilot: string }) => {
      s.setRowProperty(a.ben, 'r-role', a.pilot)
      return s.createRow(a.db, { title: 'Cleo', properties: { 'r-role': a.pilot } })
    },
    { ...ids, pilot },
  )
  await flush(page)
  const before = await snapshot(page)
  const words = await undoRefused(page, 'one_update_property')
  expect(words).toMatch(/Nordlicht crew/)
  expect(await snapshot(page)).toBe(before)
  expect((await role())?.type).toBe('select')
  expect(await wsEval(page, (s, a: string[]) => a.map((id) => s.pages[id].properties['r-role']), [ids.ben, cleo])).toEqual([pilot, pilot])
})

test('select → text, then text typed into a row that held no option at the call: the Undo is refused whole', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht shifts', properties: [{ id: 'h-title', name: 'Name', type: 'title' }, { id: 'h-slot', name: 'Slot', type: 'select', options: [{ id: 'o-early', name: 'Early', color: 'blue' }] }] as never })
    const one = s.createRow(db, { title: 'Monday', properties: { 'h-slot': 'o-early' } })
    const two = s.createRow(db, { title: 'Tuesday', properties: {} })
    return { db, one, two }
  })
  await flush(page)
  await connect(page)
  json(await call('one_update_property', { databaseId: ids.db, property: 'Slot', type: 'text' }))
  const type = () => wsEval(page, (s, db: string) => (s.databases[db].properties as AnyState[]).find((p) => p.id === 'h-slot')?.type, ids.db)
  expect(await type()).toBe('text')
  await wsEval(page, (s, id: string) => s.setRowProperty(id, 'h-slot', 'Late, with Tessera'), ids.two)
  await flush(page)
  const before = await snapshot(page)
  const words = await undoRefused(page, 'one_update_property')
  expect(words).toMatch(/Nordlicht shifts/)
  expect(await snapshot(page)).toBe(before)
  expect(await type()).toBe('text')
  expect(await wsEval(page, (s, id: string) => s.pages[id].properties['h-slot'], ids.two)).toBe('Late, with Tessera')
})
