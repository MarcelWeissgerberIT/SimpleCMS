/**
 * MCP T-a, Weg 4 D2 in a team tab: the bridge's Undo is all or nothing there too (the built local bridge driven through
 * the MCP SDK's stdio client, its own port):
 *  - untouched since (after the server confirmed the call's writes): the whole call back in ONE store update — the new
 *    page to the trash, its link out of the parent's text — and the team's documents follow;
 *  - changed since: nothing is written; the toast points to Versions and the trash (no Eject: the flight recorder ejects
 *    in the local workspace only).
 * Fictional data (Nordlicht, Tessera).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, email, signIn, openApp, wsEval, waitOnline, createWorkspace } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47382

let client: Client
let stderr = ''

test.describe.configure({ mode: 'serial' })
// as tests/e2e-cloud/mcp-safety.spec.ts: the test server's CSP has no loopback socket — the browser leaves it aside here
test.use({ bypassCSP: true })

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
    .toBeGreaterThan(0)
  const here = list.workspaces.find((w: AnyState) => String(w.id).startsWith('team:')) ?? list.workspaces[0]
  json(await call('one_list_databases', { workspace: here.id }))
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return here.id as string
}

const plainOf = (page: Page, id: string) => wsEval(page, (s, id) => (s.pages[id]?.plain as string) ?? '', id)

test('team: an untouched call goes back whole in ONE store update; a changed one writes nothing and points to Versions and the trash (no Eject)', async ({ page }) => {
  await signIn(page, email('nora'))
  const wsId = await createWorkspace(page, 'Nordlicht team')
  await openApp(page, wsId)
  await waitOnline(page)
  const host = await wsEval(page, (s) => {
    const id = s.createPage({ title: 'Launch plan' })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Intro of the plan.' }] }] }, 'e2e')
    return id
  })
  const ws = await connect(page)

  // untouched: a sub-page linked in its parent, then its Undo — the page to the trash, the link out, in one update
  const made = json(await call('one_create_page', { title: 'Glossar', parentId: host, linkInParent: 'block', markdown: 'Begriffe von Tessera.', workspace: ws }))
  await expect.poll(() => wsEval(page, (s, a: { host: string; id: string }) => JSON.stringify(s.pages[a.host].content).includes(a.id), { host, id: made.id })).toBe(true)
  // the server's echo of the call's writes is no change since
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const w = window as unknown as { __one: { workspace: { subscribe: (fn: (s: AnyState, p: AnyState) => void) => () => void } }; __undoUpdates?: number; __undoStop?: () => void }
    w.__undoUpdates = 0
    w.__undoStop = w.__one.workspace.subscribe((s, p) => {
      if (s.pages !== p.pages || s.databases !== p.databases) w.__undoUpdates = (w.__undoUpdates ?? 0) + 1
    })
  })
  await openAgentsTab(page)
  await page.locator('.mcp-log__row').getByRole('button', { name: 'Undo one_create_page' }).first().click()
  await expect(page.locator('.mcp-log__row', { hasText: 'one_create_page' }).first()).toContainText('Undone')
  const updates = await page.evaluate(() => {
    const w = window as unknown as { __undoUpdates?: number; __undoStop?: () => void }
    w.__undoStop?.()
    return w.__undoUpdates ?? 0
  })
  expect(updates, 'the Undo itself is one store update').toBe(1)
  await page.keyboard.press('Escape')
  expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, made.id)).toBe(true)
  expect(await wsEval(page, (s, a: { host: string; id: string }) => JSON.stringify(s.pages[a.host].content).includes(a.id), { host, id: made.id })).toBe(false)
  expect(await plainOf(page, host)).toBe('Intro of the plan.')

  // changed since: refused whole — nothing written, the remedy without Eject
  const again = json(await call('one_update_page', { id: host, markdown: 'Phase 2 by Claude.', workspace: ws }))
  expect(again.changed).toEqual(['content'])
  await page.waitForTimeout(1000)
  await wsEval(page, (s, id) => s.updatePage(id, { title: 'Launch plan (Nora)' }), host)
  await page.waitForTimeout(500)
  const before = await wsEval(page, (s) => JSON.stringify([s.pages, s.databases]))
  await openAgentsTab(page)
  await page.locator('.mcp-log__row').getByRole('button', { name: 'Undo one_update_page' }).first().click()
  const toast = page.locator('.toast', { hasText: 'Not undone:' }).last()
  await expect(toast).toContainText('Not undone: “Launch plan (Nora)” changed since (title). Nothing was put back.')
  await expect(toast).toContainText('Take it back by hand with Versions or the trash.')
  await expect(toast).not.toContainText('Eject')
  await page.keyboard.press('Escape')
  expect(await wsEval(page, (s) => JSON.stringify([s.pages, s.databases]))).toBe(before)
  expect(await plainOf(page, host)).toContain('Phase 2 by Claude.')
})
