/**
 * MCP T-a, Weg 4 D2 on the local bridge (the owner's decision): an MCP call's Undo in Agent activity is ALL OR NOTHING,
 * driven like Claude Code drives it (the built bridge through the MCP SDK's stdio client, its own port):
 *  - untouched since: everything the call made or changed goes back in ONE store update (what it made to the trash —
 *    never deleted for good —, a parent's text with its database block as it was, row values as they were; an option
 *    the call added goes again unless a row still holds it);
 *  - anything of it changed since (a title, a page put below a page it made …): NOTHING is written, the toast and the
 *    activity row say what changed and point to Versions / the trash and, in a local workspace, the flight recorder's
 *    Eject; the entry keeps no Undo key and the call stays remembered (its repeat is answered as done);
 *  - the words in English and German, in the help too.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47381

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

/** Every store update from now on: the pages and databases it changed (window.__undoUpdates). */
async function countUpdates(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __one: { workspace: { subscribe: (fn: (s: AnyState, p: AnyState) => void) => () => void } }; __undoUpdates?: number; __undoStop?: () => void }
    w.__undoUpdates = 0
    w.__undoStop?.()
    w.__undoStop = w.__one.workspace.subscribe((s, p) => {
      if (s.pages !== p.pages || s.databases !== p.databases) w.__undoUpdates = (w.__undoUpdates ?? 0) + 1
    })
  })
  return async () =>
    page.evaluate(() => {
      const w = window as unknown as { __undoUpdates?: number; __undoStop?: () => void }
      w.__undoStop?.()
      w.__undoStop = undefined
      return w.__undoUpdates ?? 0
    })
}

/** The newest Undo of a tool in Agent activity, taken back (the row reads Undone). */
async function undoLast(page: Page, tool: string) {
  await openAgentsTab(page)
  const undone = page.locator('.mcp-log__row', { hasText: tool }).filter({ hasText: /Undone|Rückgängig/ })
  const before = await undone.count()
  await page.locator('.mcp-log__row').getByRole('button', { name: new RegExp(`^(Undo ${tool}|${tool} rückgängig machen)$`) }).first().click()
  await expect(undone).toHaveCount(before + 1)
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

test('untouched since: the whole call goes back in ONE store update — the board and its rows to the trash, its block out of the page, values as they were', async ({ page }) => {
  await openApp(page)
  const ids = await wsEval(page, (s) => {
    const host = s.createPage({ title: 'Launch plan' })
    s.setContent(host, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'lp-0001-intro' }, content: [{ type: 'text', text: 'Intro of the plan.' }] }] }, 'e2e')
    const db = s.createDatabase({ title: 'Nordlicht tasks', properties: [{ id: 'n-title', name: 'Name', type: 'title' }, { id: 'n-stage', name: 'Stage', type: 'select', options: [{ id: 'o-todo', name: 'Todo', color: 'gray' }, { id: 'o-done', name: 'Done', color: 'green' }] }] })
    const a = s.createRow(db, { title: 'Brief Mara Lind', properties: { 'n-stage': 'o-todo' } })
    const b = s.createRow(db, { title: 'Call Tessera', properties: { 'n-stage': 'o-todo' } })
    return { host, db, a, b }
  })
  await flush(page)
  await connect(page)
  const hostBefore = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), ids.host)

  // an inline board with three rows: a database, three rows and the host's text in one call
  const board = json(await call('one_create_database', { title: 'Sprint board', inline: { pageId: ids.host }, views: [{ type: 'board' }], rows: [{ title: 'Kick-off' }, { title: 'Review' }, { title: 'Retro' }] }))
  expect(board.rows).toHaveLength(3)
  expect(await wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).some((b) => b.type === 'databaseBlock'), ids.host)).toBe(true)
  await flush(page)
  let updates = await countUpdates(page)
  await undoLast(page, 'one_create_database')
  expect(await updates(), 'one store update for the whole Undo').toBe(1)
  const after = await wsEval(page, (s, a: { host: string; board: string; rows: string[] }) => ({ host: JSON.stringify(s.pages[a.host].content), board: !!s.pages[a.board]?.trashed, rows: a.rows.map((id) => !!s.pages[id] && !s.pages[id].trashed) }), { host: ids.host, board: board.id, rows: board.rows.map((r: AnyState) => r.id) })
  // the host's text as it was; the board in the trash with its rows inside it (they go along, never deleted for good)
  expect(after.host).toBe(hostBefore)
  expect(after.board).toBe(true)
  expect(after.rows).toEqual([true, true, true])
  await expect(page.locator('.toast', { hasText: 'Agent change undone' })).toBeVisible()

  // values: two rows changed and a new option "Review" — back as they were, the option gone with them
  json(await call('one_update_row', { rows: [{ id: ids.a, properties: { Stage: 'Done' } }, { id: ids.b, properties: { Stage: 'Review' } }] }))
  const stage = () => wsEval(page, (s, a: { db: string; rows: string[] }) => ({ values: a.rows.map((id) => s.pages[id].properties['n-stage']), options: ((s.databases[a.db].properties as AnyState[]).find((p) => p.id === 'n-stage')!.options as AnyState[]).map((o) => o.name) }), { db: ids.db, rows: [ids.a, ids.b] })
  expect((await stage()).options).toEqual(['Todo', 'Done', 'Review'])
  await flush(page)
  updates = await countUpdates(page)
  await undoLast(page, 'one_update_row')
  expect(await updates()).toBe(1)
  expect(await stage()).toEqual({ values: ['o-todo', 'o-todo'], options: ['Todo', 'Done'] })

  // an option the call added that a row of the person holds by now stays (no value left pointing at nothing) — the
  // row the call changed is untouched, so its Undo runs
  json(await call('one_update_row', { id: ids.b, properties: { Stage: 'Blocked' } }))
  const blocked = await wsEval(page, (s, db: string) => ((s.databases[db].properties as AnyState[]).find((p) => p.id === 'n-stage')!.options as AnyState[]).find((o) => o.name === 'Blocked')!.id, ids.db)
  const third = await wsEval(page, (s, a: { db: string; o: string }) => s.createRow(a.db, { title: 'Hand-made', properties: { 'n-stage': a.o } }), { db: ids.db, o: blocked })
  await flush(page)
  await undoLast(page, 'one_update_row')
  expect(await wsEval(page, (s, a: { b: string; third: string }) => [s.pages[a.b].properties['n-stage'], s.pages[a.third].properties['n-stage']], { b: ids.b, third })).toEqual(['o-todo', blocked])
  expect((await stage()).options).toEqual(['Todo', 'Done', 'Blocked'])
})

test('changed since: the Undo writes NOTHING, names what changed and where to take it back (Eject locally); the entry keeps no key and the call stays answered as done', async ({ page }) => {
  await openApp(page)
  const host = await wsEval(page, (s) => {
    const id = s.createPage({ title: 'Wissensbasis' })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start.' }] }] }, 'e2e')
    return id
  })
  await flush(page)
  await connect(page)
  const args = { title: 'Glossar', parentId: host, linkInParent: 'block', markdown: 'Begriffe von Nordlicht.' }
  const made = json(await call('one_create_page', args))
  // the person renames the new page
  await wsEval(page, (s, id) => s.updatePage(id, { title: 'Glossar (Mara)' }), made.id)
  await flush(page)
  const before = await snapshot(page)
  const words = await undoRefused(page, 'one_create_page')
  expect(words).toContain('Not undone: “Glossar (Mara)” changed since (title). Nothing was put back.')
  expect(words).toContain('Take it back by hand with Versions, the trash or Eject in the flight recorder.')
  expect(await snapshot(page)).toBe(before)
  // the row says so too
  await openAgentsTab(page)
  await expect(page.locator('.mcp-log__row', { hasText: 'one_create_page' }).first()).toContainText('Not undone: “Glossar (Mara)” changed since (title).')
  await closeSettings(page)
  // nothing was taken back: a repeat of the call is answered as done, nothing new is made
  const again = json(await call('one_create_page', args))
  expect(again.duplicateOf).toBe(made.id)
  expect(await wsEval(page, (s, host) => Object.values(s.pages as Record<string, AnyState>).filter((p) => p.parentId === host).length, host)).toBe(1)

  // a page put below a page the call made since: refused too (its Undo would take that page into the trash along)
  const plan = json(await call('one_create_page', { title: 'Launch plan', markdown: 'Phase 1.' }))
  await wsEval(page, (s, id) => s.createPage({ title: 'Notes by Mara', parentId: id }), plan.id)
  await flush(page)
  const before2 = await snapshot(page)
  expect(await undoRefused(page, 'one_create_page')).toContain('Not undone: “Launch plan” changed since (a page below). Nothing was put back.')
  expect(await snapshot(page)).toBe(before2)
  expect(await wsEval(page, (s, id) => !!s.pages[id].trashed, plan.id)).toBe(false)
})

test('German UI: the refusal in German — what changed, Versionen, Papierkorb, Auswerfen im Flugschreiber', async ({ page }) => {
  await openApp(page)
  await flush(page)
  await connect(page)
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  const made = json(await call('one_create_page', { title: 'Tessera Notizen', markdown: 'Erste Zeile.' }))
  await wsEval(page, (s, id) => {
    s.updatePage(id, { icon: { type: 'emoji', value: '📌' } })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Von Mara umgeschrieben.' }] }] }, 'e2e')
  }, made.id)
  await flush(page)
  const words = await undoRefused(page, 'one_create_page')
  expect(words).toContain('Nicht rückgängig gemacht: „Tessera Notizen“ wurde seither geändert (Text, Symbol). Nichts wurde zurückgesetzt.')
  expect(words).toContain('Von Hand zurücknehmen: mit Versionen, dem Papierkorb oder Auswerfen im Flugschreiber.')
  expect(await wsEval(page, (s, id) => [!!s.pages[id].trashed, s.pages[id].plain], made.id)).toEqual([false, 'Von Mara umgeschrieben.'])
})

test('the help says it in English and German: the whole call back, or nothing, with Versions / the trash / Eject', async () => {
  const read = (lang: string) => readFileSync(fileURLToPath(new URL(`../../src/app/help/articles/${lang}/mcp-bridge.md`, import.meta.url)), 'utf8')
  expect(read('en')).toContain('takes the whole call back')
  expect(read('en')).toContain('nothing at all: it says what changed')
  expect(read('en')).toContain('**Eject** in the [flight recorder](help:flight-recorder)')
  expect(read('de')).toContain('nimmt den ganzen Aufruf zurück')
  expect(read('de')).toContain('gar nichts: Es sagt, was sich geändert hat')
  expect(read('de')).toContain('**Auswerfen** im [Flugschreiber](help:flight-recorder)')
})

/**
 * `W4_SHOTS=<dir>`: screenshots of a refused Undo — its toast over Agent activity, the refused row and a dry-run row of
 * one_run_script beside it (EN + DE, 1440×900 and 390×844, light and dark). Not part of the suite.
 */
test('screenshots: a refused Undo — toast and Agent activity rows', async ({ page }) => {
  const dir = process.env.W4_SHOTS
  test.skip(!dir, 'W4_SHOTS not set')
  await openApp(page)
  await wsEval(page, (s) => {
    const now = Date.now()
    const db = s.createDatabase({ title: 'Nordlicht tasks', properties: [{ id: 'n-title', name: 'Name', type: 'title' }, { id: 'n-code', name: 'Code', type: 'text' }] })
    s.createRow(db, { title: 'Launch plan', properties: { 'n-code': 'LP' } })
    s.upsertScript({ id: 'sc-raise', name: 'Raise codes', code: 'for t in db("Nordlicht tasks").where(Code = "LP") {\n  t.set(Code: "LP-1")\n}\n', kind: 'script', createdAt: now, updatedAt: now })
  })
  await flush(page)
  await connect(page)
  for (const lang of ['en', 'de'] as const) {
    await wsEval(page, (s, l) => s.updateSettings({ language: l }), lang)
    for (const [w, h, tag] of [
      [1440, 900, 'desktop'],
      [390, 844, 'phone'],
    ] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width: w, height: h })
        await page.emulateMedia({ colorScheme: theme })
        await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
        json(await call('one_run_script', { script: 'Raise codes' }))
        const made = json(await call('one_create_page', { title: lang === 'de' ? `Wissensbasis ${tag} ${theme}` : `Launch notes ${tag} ${theme}`, markdown: 'Tessera, Mara Lind.' }))
        await wsEval(page, (s, a: { id: string; t: string }) => s.updatePage(a.id, { title: a.t }), { id: made.id, t: lang === 'de' ? `Wissensbasis (Mara) ${tag} ${theme}` : `Launch notes (Mara) ${tag} ${theme}` })
        await flush(page)
        await openAgentsTab(page)
        const keys = page.locator('.mcp-log__row').getByRole('button', { name: /^(Undo one_create_page|one_create_page rückgängig machen)$/ })
        await keys.first().click()
        const toast = page.locator('.toast', { hasText: /Not undone|Nicht rückgängig gemacht/ }).last()
        await expect(toast).toBeVisible()
        const row = page.locator('.mcp-log__row', { hasText: /Not undone|Nicht rückgängig gemacht/ }).first()
        await expect(row).toBeVisible()
        await row.evaluate((el) => el.closest('.mcp-log')!.scrollIntoView({ block: 'end' }))
        await page.screenshot({ path: `${dir}/undo-refused-${lang}-${tag}-${theme}.png` })
        // the rows alone: the toast taken away (the next shot shows its own toast only)
        await page.evaluate(() => {
          const ui = (window as unknown as { __one: { ui: { getState: () => { toasts: { id: string }[]; dismissToast: (id: string) => void } } } }).__one.ui.getState()
          for (const t of ui.toasts) ui.dismissToast(t.id)
        })
        await expect(toast).toHaveCount(0)
        await page.screenshot({ path: `${dir}/activity-rows-${lang}-${tag}-${theme}.png` })
        await closeSettings(page)
      }
    }
  }
  await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
})
