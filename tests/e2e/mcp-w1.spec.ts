/**
 * Weg 4 W1 review on the local bridge, driven like Claude Code drives it (the built bridge through the MCP SDK's stdio
 * client, its own port):
 *  - one_delete_property leaves a rollup in a database in the trash alone (as the team server does): no false refusal,
 *    nothing of the trashed database is written;
 *  - an MCP call that changed a property's type: a value written into that property since (a row the person made)
 *    refuses the call's Undo whole — the type is not put back under a value that would no longer fit it.
 * Fictional data (Nordlicht, Mara Lind, Alpha).
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
const PORT = 47412

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

test('one_delete_property: a rollup in a database in the trash is left alone — the delete goes ahead, the trashed one is not written', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const tasks = s.createDatabase({ title: 'Nordlicht tasks', properties: [{ id: 'k-title', name: 'Name', type: 'title' }, { id: 'k-est', name: 'Estimate', type: 'number' }] })
    const old = s.createDatabase({
      title: 'Old report',
      properties: [
        { id: 'o-title', name: 'Name', type: 'title' },
        { id: 'o-rel', name: 'Tasks', type: 'relation', relationDatabaseId: tasks },
        { id: 'o-sum', name: 'Total', type: 'rollup', rollup: { relationPropertyId: 'o-rel', targetPropertyId: 'k-est', fn: 'sum' } },
      ] as never,
    })
    s.trashPage(old)
    return { tasks, old }
  })
  await flush(page)
  await connect(page)
  const out = json(await call('one_delete_property', { databaseId: ids.tasks, property: 'Estimate' }))
  expect(JSON.stringify(out)).not.toContain('Old report')
  const now = await wsEval(page, (s, a: { tasks: string; old: string }) => ({ props: (s.databases[a.tasks].properties as AnyState[]).map((p) => p.name), roll: (s.databases[a.old].properties as AnyState[]).find((p) => p.id === 'o-sum')?.rollup?.targetPropertyId, trashed: s.pages[a.old].trashed }), ids)
  expect(now).toEqual({ props: ['Name'], roll: 'k-est', trashed: true })
})

test('one_update_property changed a type, a row filled in that property since: the Undo is refused whole — the type stays, the value stays', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht log', properties: [{ id: 'l-title', name: 'Name', type: 'title' }, { id: 'l-note', name: 'Note', type: 'select', options: [{ id: 'o-alpha', name: 'Alpha', color: 'blue' }] }] as never })
    const row = s.createRow(db, { title: 'First', properties: { 'l-note': 'o-alpha' } })
    return { db, row }
  })
  await flush(page)
  await connect(page)
  json(await call('one_update_property', { databaseId: ids.db, property: 'Note', type: 'text' }))
  const type = () => wsEval(page, (s, db: string) => (s.databases[db].properties as AnyState[]).find((p) => p.id === 'l-note')?.type, ids.db)
  expect(await type()).toBe('text')
  const mine = await wsEval(page, (s, db: string) => s.createRow(db, { title: 'Mine', properties: { 'l-note': 'Call Mara Lind' } }), ids.db)
  await flush(page)
  const before = await snapshot(page)
  const words = await undoRefused(page, 'one_update_property')
  expect(words).toMatch(/Nordlicht log/)
  expect(await snapshot(page)).toBe(before)
  expect(await type()).toBe('text')
  expect(await wsEval(page, (s, id: string) => s.pages[id].properties['l-note'], mine)).toBe('Call Mara Lind')
})
