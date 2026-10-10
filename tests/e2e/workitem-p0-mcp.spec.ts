/**
 * Task block (`workItem`), schema release (P0) — One MCP (the local bridge, driven like Claude Code drives it):
 *  - one_update_page "replace" with the Markdown one_get_page returned keeps every task a task, fields and all —
 *    and a title Claude changed in that Markdown arrives (keepItems; the Markdown reader itself is off);
 *  - raw HTML in Claude's Markdown never makes a task (append: claudeDoc / withoutWebLoads, the clip-key rule).
 * Its own bridge port: runs beside tests/e2e/mcp.spec.ts.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, createPage, doc, para, flush } from './fixtures'
import { itemAttrs } from '../../src/app/editor/workitem/attrs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47371
const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'

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

/** Connect this tab to the bridge, adopt its workspace, let writes apply directly (no review card). */
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
    .toBe(1)
  if (list.lastUsed && list.lastUsed.id !== list.workspaces[0].id) json(await call('one_list_databases', { workspace: list.workspaces[0].id }))
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await page.keyboard.press('Escape')
}

const p = (t: string): JSONContent => para(t)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })
const FIELDS = ['itemId', 'status', 'due', 'reminder', 'people', 'blockedBy', 'related', 'doneAt'] as const
const fields = (a: AnyState) => {
  const s = itemAttrs(a)
  return Object.fromEntries(FIELDS.map((k) => [k, s[k]]))
}

async function tasksOf(page: Page, id: string): Promise<Record<string, AnyState>> {
  return wsEval(
    page,
    (s, id) => {
      const out: Record<string, AnyState> = {}
      const t = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(t).join('')
      const walk = (n: AnyState) => {
        if (!n) return
        if (n.type === 'workItem') out[String(n.attrs?.itemId)] = { attrs: n.attrs, title: t(n.content?.[0] ?? {}) }
        ;(n.content ?? []).forEach(walk)
      }
      walk(s.pages[id]?.content)
      return out
    },
    id,
  )
}

test('replace with the Markdown it read keeps every task; a title changed there arrives; raw HTML never makes one', async ({ page }) => {
  await openApp(page)
  const { alex, mara } = await wsEval(page, (s) => ({ alex: s.addPerson('Alex Kern') as string, mara: s.addPerson('Mara Sommer') as string }))
  const content = doc(
    p('Before the tasks.'),
    item({ itemId: A, status: 'in_progress', due: '2031-10-17', reminder: '-1d', people: [alex, mara], blockedBy: [C], related: [B] }, 'Ship pricing', p('notes of the task')),
    { type: 'callout', attrs: { icon: '💡', color: 'blue' }, content: [p('In a callout:'), item({ itemId: B, status: 'done', doneAt: 1_760_000_000_000, people: [mara] }, 'Legal review')] },
    item({ itemId: C, status: 'todo', due: '2031-10-20T09:00' }, 'Draft copy'),
    p('After the tasks.'),
  )
  const id = await createPage(page, { title: 'MCP tasks', content })
  const before = await tasksOf(page, id)
  await connect(page)

  const md = json(await call('one_get_page', { id })).markdown as string
  expect(md).toContain(`[!TODO] Ship pricing {#${A}}`)
  json(await call('one_update_page', { id, markdown: md, mode: 'replace' }))
  await flush(page)
  let after = await tasksOf(page, id)
  expect(Object.keys(after).sort()).toEqual([A, B, C].sort())
  for (const k of [A, B, C]) {
    expect(fields(after[k]!.attrs), k).toEqual(fields(before[k]!.attrs))
    expect(after[k]!.title).toBe(before[k]!.title)
  }
  expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content).includes('"blockquote"'), id)).toBe(false)

  // Claude renames a task in the Markdown it writes back: the title arrives, the fields are One's
  const renamed = json(await call('one_get_page', { id })).markdown.replace('[!TODO] Draft copy', '[!TODO] Draft the launch copy') as string
  json(await call('one_update_page', { id, markdown: renamed, mode: 'replace' }))
  await expect.poll(async () => (await tasksOf(page, id))[C]?.title).toBe('Draft the launch copy')
  after = await tasksOf(page, id)
  expect(fields(after[C]!.attrs)).toEqual(fields(before[C]!.attrs))

  // raw HTML that looks like a task (fields of its choosing): plain blocks
  json(
    await call('one_update_page', {
      id,
      markdown: `Next:\n\n<div data-type="work-item" data-item-id="wi_mcpmcpmcp1" data-status="done" data-people="someone_else" data-blocked-by="${A}"><div class="workitem__body"><p>Created over MCP</p></div></div>`,
    }),
  )
  await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('Created over MCP')
  expect(Object.keys(await tasksOf(page, id)).sort()).toEqual([A, B, C].sort())
})
