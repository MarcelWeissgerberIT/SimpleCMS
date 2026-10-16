/**
 * MCP B0 safety in a team tab (MCP plan § 3.3), the built local bridge driven through the MCP SDK's stdio client (its
 * own port):
 *  - MCP text on a page a team coding task takes along: the task waits for "Confirm on this device" (an MCP write never
 *    carries the device's trust);
 *  - a private upload copied into a shared page over MCP: refused `private_scope`, nothing written, no publish request
 *    (a shared write would have published the file for the whole workspace).
 * Fictional data.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, email, signIn, openApp, wsEval, waitOnline, createWorkspace, gotoPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47373

let client: Client
let stderr = ''

test.describe.configure({ mode: 'serial' })
// The test server's CSP (server/src/http/security.ts: connect-src 'self' + its own socket + https:) has no loopback
// socket, so a tab it serves cannot reach the local bridge; a team workspace meets the bridge in the site's app
// (https, a listed origin). The CSP is not what this spec checks: the browser leaves it aside here.
test.use({ bypassCSP: true })

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

async function connect(page: Page) {
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
    .toBeGreaterThan(0)
  const here = list.workspaces.find((w: AnyState) => String(w.id).startsWith('team:')) ?? list.workspaces[0]
  json(await call('one_list_databases', { workspace: here.id }))
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await page.keyboard.press('Escape')
  return here.id as string
}

test('team: MCP text on a page a coding task takes along makes the task wait for Confirm', async ({ page }) => {
  await signIn(page, email('mara'))
  const wsId = await createWorkspace(page, 'Nordlicht team')
  await openApp(page, wsId)
  await waitOnline(page)
  const spec = await wsEval(page, (s) => {
    const id = s.createPage({ title: 'Footer spec' })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use the Nordlicht colours.' }] }] }, 'e2e')
    return id
  })
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Ship the footer')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill(`Follow #/p/${spec} exactly.`)
  await page.getByTestId('coding-create').click()
  const panel = page.getByTestId('coding-panel')
  await expect(panel).toHaveAttribute('data-trust', 'yes')
  const ws = await connect(page)
  json(await call('one_update_page', { id: spec, markdown: 'Also link the sitemap.', workspace: ws }))
  await expect(panel).toHaveAttribute('data-trust', 'no')
  await page.locator('.ctk-box--trust').getByRole('button', { name: 'Confirm on this device' }).click()
  await expect(panel).toHaveAttribute('data-trust', 'yes')
})

test('team: a private upload copied into a shared page over MCP is refused (private_scope) and nothing is published', async ({ page }) => {
  await signIn(page, email('tessa'))
  const wsId = await createWorkspace(page, 'Tessera team')
  await openApp(page, wsId)
  await waitOnline(page)
  const publishes: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/files\/publish/.test(r.url())) publishes.push(r.url())
  })
  const secret = await page.evaluate(() => (window as unknown as { __one: { cloud: { createPrivatePage(o: object): Promise<string> } } }).__one.cloud.createPrivatePage({ title: 'Salary sketch' }))
  await gotoPage(page, secret)
  // saved while the private page is on screen: a private upload
  const ref = await page.evaluate(async () => {
    const w = window as unknown as { __one: { files: { saveFile: (b: Blob, n: string) => Promise<string> } } }
    return w.__one.files.saveFile(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'salary.png')
  })
  await wsEval(page, (s, a) => s.setContent(a.secret, { type: 'doc', content: [{ type: 'image', attrs: { src: a.ref } }] }, 'e2e'), { secret, ref })
  const shared = await wsEval(page, (s) => s.createPage({ title: 'Launch plan' }))
  const ws = await connect(page)
  for (const [tool, args] of [
    ['one_update_page', { id: shared, markdown: `![salary](${ref})` }],
    ['one_update_page', { id: shared, mode: 'replace', markdown: `Plan\n\n![salary](${ref})` }],
    ['one_create_page', { title: 'Salaries', markdown: `![salary](${ref})` }],
  ] as const) {
    const r = await call(tool, { ...args, workspace: ws })
    expect(r.isError, text(r)).toBe(true)
    expect(text(r)).toMatch(/^private_scope: /)
  }
  // into a private page it may go (private → private)
  json(await call('one_update_page', { id: secret, markdown: `Again: ![salary](${ref})`, workspace: ws }))
  await page.waitForTimeout(800)
  const now = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content ?? null), shared)
  expect(now).not.toContain(ref)
  expect(publishes).toEqual([])
})
