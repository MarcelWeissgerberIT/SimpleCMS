/**
 * One MCP, local bridge: the built bridge (public/mcp/one-mcp.mjs) runs as a child process, driven
 * by the MCP SDK client over stdio (Node side) — exactly like Claude Code would. The app tab (the
 * preview origin http://127.0.0.1:<port> is on the bridge's allowlist) connects to it and runs the
 * tools against the seeded workspace. Never talks to api.anthropic.com.
 *
 * Every test opens a fresh browser context — a new local workspace with its own id. The bridge runs
 * for the whole file and keeps calls without "workspace" in the workspace it last worked in, so each
 * test first names its own workspace once (connect → adopt), like an agent told by the person.
 *
 * Needs the bridge's dependencies once: `npm --prefix mcp install` (for the SDK client used here).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, waitForApp, wsEval, pageIdByTitle, flush } from './fixtures'

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47399
/** a stand-in for an older bridge (protocol v1 only) */
const OLD_PORT = 47396

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

let client: Client
let stderr = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(BRIDGE), 'public/mcp/one-mcp.mjs (npm run build:mcp)').toBe(true)
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIDGE],
    // a call made before the tab connected waits for it
    env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '8000' },
    stderr: 'pipe',
  })
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

async function openAgentsTab(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
}

type Listed = { id: string; name: string; kind: string; mode: string; newest: boolean }

/**
 * This test's workspace becomes the session's: once the previous test's tab is gone, name it in one
 * call (an earlier test's workspace was another one — calls without "workspace" would be refused).
 */
async function adopt(): Promise<Listed> {
  let list: { workspaces: Listed[]; lastUsed?: { id: string } } = { workspaces: [] }
  await expect
    .poll(async () => {
      list = json(await call('one_list_workspaces'))
      return list.workspaces.length
    })
    .toBe(1)
  const mine = list.workspaces[0]
  if (list.lastUsed && list.lastUsed.id !== mine.id) json(await call('one_list_databases', { workspace: mine.id }))
  return mine
}

/** Settings → Agents · MCP: the test port, switch on, wait for the bridge; then adopt the workspace. */
async function connect(page: Page, own = true): Promise<void> {
  await openAgentsTab(page)
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Connected · Claude Code · 0 calls')
  if (own) await adopt()
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('connects and reads: overview, search, page Markdown, schema, filtered rows', async ({ page }) => {
  await openApp(page)
  await connect(page)

  const overview = json(await call('one_overview'))
  expect(overview.workspace.kind).toBe('local')
  expect(overview.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(overview.access).toBe('read-write')
  expect(overview.approval).toMatch(/approve/)
  const projects = overview.databases.find((d: { title: string }) => d.title === 'Projects')
  expect(projects.rows).toBeGreaterThan(3)
  expect(overview.pages.map((n: { title: string }) => n.title)).toContain('Welcome to One')

  const search = json(await call('one_search', { query: 'Team wiki', limit: 5 }))
  expect(search.results[0]).toMatchObject({ title: 'Team wiki', kind: 'page' })

  const welcome = json(await call('one_get_page', { title: 'Welcome to One' }))
  expect(welcome.kind).toBe('page')
  expect(welcome.markdown).toContain('## Quick tour — tick them off')
  expect(welcome.markdown).toMatch(/- \[ \] Type `\/`/)
  expect(welcome.url).toContain(`#/p/${welcome.id}`)

  const schema = json(await call('one_get_database', { id: projects.id }))
  const status = schema.properties.find((p: { name: string }) => p.name === 'Status')
  expect(status.type).toBe('status')
  expect(status.options.map((o: { name: string }) => o.name)).toEqual(['Backlog', 'In progress', 'Review', 'Done'])
  expect(schema.properties.find((p: { name: string }) => p.name === 'ID')).toMatchObject({ type: 'unique_id', readOnly: true, prefix: 'PRJ' })

  const inProgress = json(await call('one_query_database', { databaseId: projects.id, filter: [{ property: 'Status', op: 'equals', value: 'in progress' }], sort: '-Budget' }))
  const expected = await wsEval(page, (s, id) => {
    const db = s.databases[id]
    const prop = db.properties.find((p: { name: string }) => p.name === 'Status')
    const opt = prop.options.find((o: { name: string }) => o.name === 'In progress').id
    return Object.values(s.pages).filter((p: any) => p.databaseId === id && !p.trashed && p.properties[prop.id] === opt).length // eslint-disable-line @typescript-eslint/no-explicit-any
  }, projects.id)
  expect(inProgress.total).toBe(expected)
  expect(inProgress.rows.length).toBe(expected)
  for (const r of inProgress.rows) expect(r.properties.Status).toBe('In progress')
  const budgets = inProgress.rows.map((r: { properties: { Budget: number | null } }) => r.properties.Budget).filter((b: number | null) => b !== null)
  expect(budgets).toEqual([...budgets].sort((a: number, b: number) => b - a))

  // paging
  const first = json(await call('one_query_database', { databaseId: projects.id, limit: 2 }))
  expect(first.rows).toHaveLength(2)
  expect(first.next).toBeTruthy()
  const second = json(await call('one_query_database', { databaseId: projects.id, limit: 2, cursor: first.next }))
  expect(second.rows[0].id).not.toBe(first.rows[0].id)

  // a mistake comes back as a readable tool error
  const bad = await call('one_get_page', { id: 'nope' })
  expect(bad.isError).toBe(true)
  expect(text(bad)).toContain('No page with id "nope". Use one_search')

  // activity log + status bar
  const log = page.locator('.mcp-log__row')
  await expect(log).toHaveCount(8)
  await expect(log.first()).toContainText('one_get_page')
  await expect(log.first()).toContainText('Error')
  await expect(page.locator('.mcp-log__row', { hasText: 'one_query_database' }).first()).toContainText('OK')
  await expect(page.getByTestId('mcp-state')).toContainText('Connected · Claude Code · 8 calls')
  await closeSettings(page)
  await expect(page.locator('.status .mcp-status')).toHaveText('Agent')
})

test('Ask first: the card shows the change; Approve writes it, Reject tells the agent', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await closeSettings(page)
  const dbId = await pageIdByTitle(page, 'Projects')

  const pending = call('one_create_row', { databaseId: dbId, title: 'Q4 launch', properties: { Status: 'In progress', Tags: ['Web', 'Launch'] }, markdown: '## Plan\n\n- [ ] brief' })
  const card = page.getByRole('alertdialog')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Agent · Claude Code')
  await expect(card).toContainText('New row')
  await expect(card).toContainText('Create row “Q4 launch” in Projects · Status: In progress')
  await expect(card.locator('.mcp-line', { hasText: 'Tags' })).toContainText('Web, Launch')
  await expect(card.locator('.mcp-line', { hasText: 'Tags' })).toContainText('New option')
  await expect(card.locator('.mcp-md')).toContainText('- [ ] brief')
  await expect(page.locator('.status .mcp-status')).toHaveText('Agent · 1 to approve')
  // nothing is written before the OK
  expect(await wsEval(page, (s) => Object.values(s.pages).some((p: any) => p.title === 'Q4 launch'))).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any
  // the card took focus: ↵ approves
  await expect(card.getByRole('button', { name: /Approve/ })).toBeFocused()
  await page.keyboard.press('Enter')
  const row = json(await pending)
  await expect(card).toHaveCount(0)
  expect(row).toMatchObject({ databaseId: dbId, title: 'Q4 launch', properties: { Status: 'In progress', Tags: ['Web', 'Launch'] } })
  expect(row.properties.ID).toMatch(/^PRJ-\d+$/)
  const stored = await wsEval(page, (s, id) => ({ title: s.pages[id]?.title, origin: s.pages[id]?.contentOrigin, plain: s.pages[id]?.plain }), row.id)
  expect(stored).toMatchObject({ title: 'Q4 launch', origin: 'ai' })
  expect(stored.plain).toContain('brief')
  await expect(page.locator('.toast', { hasText: 'Done: Create row “Q4 launch” in Projects' })).toBeVisible()

  // Reject: Esc on the card; the agent gets an error, nothing changes
  const rejected = call('one_update_row', { id: row.id, properties: { Status: 'Done', Project: 'Q4 launch (renamed)' } })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Change row “Q4 launch” in Projects')
  await expect(card.locator('.mcp-line', { hasText: 'Status' })).toContainText('In progress→Done')
  await expect(card.locator('.mcp-line', { hasText: 'Project' }).first()).toContainText('Q4 launch (renamed)')
  await page.keyboard.press('Escape')
  const res = await rejected
  expect(res.isError).toBe(true)
  expect(text(res)).toContain('The person rejected this change in One')
  expect(await wsEval(page, (s, id) => s.pages[id].title, row.id)).toBe('Q4 launch')

  // the log: the approved write (with undo), the refused one
  await openAgentsTab(page)
  await expect(page.locator('.mcp-log__row').nth(0)).toContainText('Refused')
  await expect(page.locator('.mcp-log__row').nth(1)).toContainText('OK')
  await page.locator('.mcp-log__row').nth(1).getByRole('button', { name: 'Undo one_create_row' }).click()
  await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id], row.id)).toBe(false)
  await expect(page.locator('.mcp-log__row').nth(1)).toContainText('Undone')
})

test('Apply directly writes at once; Read only refuses; a no-op needs no approval', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  await expect(page.locator('.mcp-hint', { hasText: 'Changes are written right away' })).toBeVisible()

  const created = json(await call('one_create_page', { title: 'Agent notes', icon: '🛰️', markdown: '# Findings\n\n- one\n- two' }))
  const page1 = await wsEval(page, (s, id) => ({ title: s.pages[id]?.title, icon: s.pages[id]?.icon, plain: s.pages[id]?.plain, parentId: s.pages[id]?.parentId }), created.id)
  expect(page1).toMatchObject({ title: 'Agent notes', icon: { type: 'emoji', value: '🛰️' }, parentId: null })
  expect(page1.plain).toContain('Findings')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  const appended = json(await call('one_update_page', { id: created.id, markdown: '## Next\n\nship it' }))
  expect(appended.changed).toEqual(['content'])
  const md = json(await call('one_get_page', { id: created.id })).markdown
  expect(md).toContain('- two')
  expect(md).toContain('## Next')

  const replaced = json(await call('one_update_page', { id: created.id, title: 'Agent report', markdown: 'Only this.', mode: 'replace' }))
  expect(replaced).toMatchObject({ title: 'Agent report', changed: ['title', 'content'] })
  expect(json(await call('one_get_page', { id: created.id })).markdown).toBe('Only this.')

  const db = json(await call('one_create_database', { title: 'Clients', parentId: created.id, properties: [{ name: 'Stage', type: 'select', options: ['Lead', 'Won'] }, { name: 'Since', type: 'date' }] }))
  expect(db.properties.map((p: { name: string; type: string }) => `${p.name}:${p.type}`)).toEqual(['Name:title', 'Stage:select', 'Since:date'])
  const prop = json(await call('one_create_property', { databaseId: db.id, name: 'Value', type: 'number' }))
  expect(prop.property).toMatchObject({ name: 'Value', type: 'number' })
  const client1 = json(await call('one_create_row', { databaseId: db.id, title: 'Acme', properties: { Stage: 'Won', Since: '2026-09-30', Value: '1200' } }))
  expect(client1.properties).toMatchObject({ Stage: 'Won', Since: { start: '2026-09-30', end: null }, Value: 1200 })

  // nothing to change: answered without a write
  const same = json(await call('one_update_row', { id: client1.id, properties: { Stage: 'won' } }))
  expect(same.note).toMatch(/No change/)

  // invalid values: every problem listed, nothing written
  const bad = await call('one_create_row', { databaseId: db.id, title: 'Bad', properties: { Since: 'tomorrow', Nope: 1 } })
  expect(bad.isError).toBe(true)
  expect(text(bad)).toContain('Nothing was changed')
  expect(text(bad)).toContain('"Since" (date)')
  expect(text(bad)).toContain('unknown property "Nope"')

  // Read only: every write is refused, reads still work
  await page.getByRole('radio', { name: 'Read only' }).click()
  const refused = await call('one_trash_page', { id: created.id })
  expect(refused.isError).toBe(true)
  expect(text(refused)).toContain('Agents can only read')
  expect(await wsEval(page, (s, id) => s.pages[id].trashed, created.id)).toBe(false)
  expect(json(await call('one_get_page', { id: created.id })).title).toBe('Agent report')
  await expect(page.locator('.mcp-log__row').first()).toContainText('one_get_page')
  await expect(page.locator('.mcp-log__row').nth(1)).toContainText('Refused')

  // back to Apply directly: trash (restorable)
  await page.getByRole('radio', { name: 'Apply directly' }).click()
  const trashed = json(await call('one_trash_page', { id: created.id }))
  expect(trashed).toMatchObject({ trashed: true, alsoTrashed: 2 })
  expect(await wsEval(page, (s, id) => s.pages[id].trashed, created.id)).toBe(true)
  await flush(page)
})

test('German UI, Reject button, and the newest tab wins', async ({ page, context }) => {
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await openAgentsTab(page)
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'KI-Agenten auf diesem Computer erlauben' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Verbunden · Claude Code · 0 Aufrufe')
  await adopt()
  await expect(page.getByRole('radio', { name: 'Erst fragen' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Agenten-Protokoll')).toBeVisible()
  await closeSettings(page)

  // the demo was seeded in English: the database keeps its name
  const dbId = (json(await call('one_list_databases')).databases as Array<{ id: string; title: string }>).find((d) => d.title === 'Projects')!.id
  const pending = call('one_create_property', { databaseId: dbId, name: 'Risiko', type: 'select', options: ['Hoch', 'Niedrig'] })
  const card = page.getByRole('alertdialog')
  await expect(card).toContainText('Neue Eigenschaft')
  await expect(card).toContainText('Eigenschaft „Risiko“ zu Projects hinzufügen')
  await card.getByRole('button', { name: /Ablehnen/ }).click()
  expect((await pending).isError).toBe(true)

  // a second tab of the same browser connects on load (the setting is on) and takes over
  await flush(page)
  const second = await context.newPage()
  await openApp(second)
  await openAgentsTab(page)
  await expect(page.getByTestId('mcp-state')).toContainText('Ein anderer Tab ist verbunden')
  await expect(page.getByRole('button', { name: 'Diesen Tab nutzen' })).toBeVisible()
  const ov = json(await call('one_overview'))
  expect(ov.language).toBe('de')
  // and back
  await page.getByRole('button', { name: 'Diesen Tab nutzen' }).click()
  await expect(page.getByTestId('mcp-state')).toContainText('Verbunden · Claude Code')
  await second.close()
})

test.describe('workspaces', () => {
  test('name it once: renamed in the sidebar — window title, Settings, one_overview and one_list_workspaces follow', async ({ page }) => {
    await openApp(page)
    await connect(page)
    await closeSettings(page)
    const head = page.locator('aside.sb .sb-head__ws')
    const name = page.locator('aside.sb .sb-head__name')
    await expect(name).toHaveText('One')
    await expect(page).toHaveTitle(/ — One$/)

    // header menu → Rename workspace: the name becomes a field in place
    await head.click()
    await page.getByRole('menuitem', { name: /Rename workspace/ }).click()
    const field = page.getByRole('textbox', { name: 'Workspace name' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('One')
    await expect(page.locator('.sb-head__edit .sb-head__sub')).toContainText('03/60')
    // empty is refused (the field stays), then a messy name is cleaned: spaces trimmed and collapsed
    await field.fill('   ')
    await field.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'A name is needed' })).toBeVisible()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await field.fill('  Atlas    Labs ')
    await field.press('Enter')
    await expect(name).toHaveText('Atlas Labs')
    await expect(head).toBeFocused()
    await expect(page).toHaveTitle(/ — Atlas Labs$/)
    expect(await wsEval(page, (s) => s.settings.workspaceName)).toBe('Atlas Labs')

    // F2 on the header, then Esc: nothing changes; a double click opens the field too
    await head.press('F2')
    await field.fill('Nope')
    await field.press('Escape')
    await expect(name).toHaveText('Atlas Labs')
    // a person's double click: the first click opens the menu, the second lands on the name again
    const box = (await head.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(150)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect(field).toBeFocused()
    await field.press('Escape')
    await expect(page.locator('[data-popover][role="menu"]')).toHaveCount(0)

    // the bridge has the new name; every answer names the workspace
    await expect.poll(async () => (json(await call('one_list_workspaces')).workspaces as Listed[])[0]?.name).toBe('Atlas Labs')
    const ov = json(await call('one_overview'))
    expect(ov.workspace).toMatchObject({ name: 'Atlas Labs', kind: 'local' })
    expect(ov.workspace.id).toMatch(/^local:[0-9a-z]{11}$/)
    const found = json(await call('one_search', { query: 'Team wiki', workspace: 'atlas labs' }))
    expect(found.workspace).toEqual({ id: ov.workspace.id, name: 'Atlas Labs' })

    // Settings → Agents · MCP: "Connected as" with the id's short form; General has the same name (≤ 60)
    await openAgentsTab(page)
    const as = page.getByTestId('mcp-as')
    await expect(as).toContainText('Connected as')
    await expect(as).toContainText('Atlas Labs')
    await expect(as.locator('code')).toHaveText(`${ov.workspace.id.slice(0, 14)}…`)
    await page.getByRole('tab', { name: 'General' }).click()
    const setting = page.getByLabel('Workspace name')
    await expect(setting).toHaveValue('Atlas Labs')
    await expect(setting).toHaveAttribute('maxlength', '60')
  })

  test('two workspaces at once: addressed by name or id, never guessed; ids of one are not found in the other', async ({ page, browser, errors }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ workspaceName: 'Atlas' }))
    await connect(page)
    await page.getByRole('radio', { name: 'Apply directly' }).click()

    // a second browser profile: its own local workspace
    const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await ctx.newPage()
    errors.watch(p2)
    await p2.goto(page.url().replace(/#.*$/, ''))
    await waitForApp(p2)
    await wsEval(p2, (s) => s.updateSettings({ workspaceName: 'Borealis' }))
    await connect(p2, false)
    await p2.getByRole('radio', { name: 'Apply directly' }).click()

    const list = json(await call('one_list_workspaces')).workspaces as Listed[]
    expect(list.map((w) => [w.name, w.kind, w.mode, w.newest])).toEqual([
      ['Borealis', 'local', 'apply', true],
      ['Atlas', 'local', 'apply', false],
    ])
    const [b, a] = list
    expect(a.id).not.toBe(b.id)

    // the first tab notes the other workspace; the second the first
    await expect(page.getByTestId('mcp-peers')).toContainText('Also connected in another tab: “Borealis” (local)')
    await expect(p2.getByTestId('mcp-peers')).toContainText('“Atlas” (local)')

    // without "workspace": refused, nothing written anywhere
    const guess = await call('one_create_page', { title: 'Where am I?' })
    expect(guess.isError).toBe(true)
    expect(text(guess)).toMatch(/^workspace_required: 2 One workspaces are connected/)

    // by name: lands in Borealis only
    const made = json(await call('one_create_page', { title: 'Only in Borealis', workspace: 'borealis' }))
    expect(made.workspace).toEqual({ id: b.id, name: 'Borealis' })
    expect(await wsEval(p2, (s, id) => s.pages[id]?.title, made.id)).toBe('Only in Borealis')
    expect(await wsEval(page, (s, id) => !!s.pages[id] || Object.values(s.pages).some((p: any) => p.title === 'Only in Borealis'), made.id)).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

    // by id: Atlas — and Borealis' page id means nothing there
    const cross = await call('one_get_page', { id: made.id, workspace: a.id })
    expect(cross.isError).toBe(true)
    expect(text(cross)).toContain(`No page with id "${made.id}"`)
    const inA = json(await call('one_overview', { workspace: a.id }))
    expect(inA.workspace).toMatchObject({ id: a.id, name: 'Atlas' })
    expect(inA.counts.pages).toBe(await wsEval(page, (s) => Object.values(s.pages).filter((p: any) => p.kind === 'page' && !p.databaseId && !p.trashed).length)) // eslint-disable-line @typescript-eslint/no-explicit-any

    // Borealis leaves: Atlas is alone again, the note goes
    await ctx.close()
    await expect(page.getByTestId('mcp-peers')).toHaveCount(0)
    await expect.poll(async () => (json(await call('one_list_workspaces')).workspaces as Listed[]).map((w) => w.name)).toEqual(['Atlas'])
  })

  test('a change waiting for approval is cancelled when the tab switches workspace — nothing is written', async ({ page }) => {
    await openApp(page)
    await connect(page)
    await closeSettings(page)
    const pending = call('one_create_page', { title: 'Switch me' })
    const card = page.getByRole('alertdialog')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('mcp-card-workspace')).toHaveText(/Workspace\s*One/)

    // the tab now shows a team workspace (cloud state; this test build has no server)
    await page.evaluate(() =>
      (window as unknown as { __oneCloud: { set: (s: object) => void } }).__oneCloud.set({
        available: true,
        status: 'online',
        active: { kind: 'cloud', id: 'ws_acme123' },
        workspaces: [{ id: 'ws_acme123', name: 'Acme Studio', icon: null, role: 'owner' }],
        role: 'owner',
        readOnly: false,
      }),
    )
    const res = await pending
    expect(res.isError).toBe(true)
    expect(text(res)).toMatch(/^workspace_mismatch: /)
    await expect(card).toHaveCount(0)
    expect(await wsEval(page, (s) => Object.values(s.pages).some((p: any) => p.title === 'Switch me'))).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

    // the bridge lists the tab under its new workspace; the old one is gone
    const list = json(await call('one_list_workspaces')).workspaces as Listed[]
    expect(list.map((w) => [w.id, w.name, w.kind])).toEqual([['team:ws_acme123', 'Acme Studio', 'team']])
    // without "workspace" the agent is stopped: its session worked in the local workspace
    expect(text(await call('one_overview'))).toMatch(/^workspace_mismatch: the connected One tab now shows the workspace "Acme Studio"/)
    // named: the tab still refuses — it holds no data of that workspace
    expect(text(await call('one_overview', { workspace: 'Acme Studio' }))).toMatch(/^workspace_mismatch: .*between workspaces/)

    await openAgentsTab(page)
    await expect(page.locator('.mcp-log__row', { hasText: 'one_create_page' })).toContainText('Cancelled')
  })

  test('an older bridge (v1): calls run as before, answers name the workspace, the panel asks for an update', async ({ page }) => {
    const { WebSocketServer } = (await import('../../mcp/node_modules/ws/wrapper.mjs')) as typeof import('../../mcp/node_modules/@types/ws/index.d.ts')
    const seen: Array<Record<string, any>> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
    // like bridge 1.0.0: speaks one-mcp.v1 only, one tab, calls carry no workspace
    const wss = new WebSocketServer({ host: '127.0.0.1', port: OLD_PORT, handleProtocols: (p: Set<string>) => (p.has('one-mcp.v1') ? 'one-mcp.v1' : false) })
    wss.on('connection', (ws) => {
      ws.on('message', (d) => {
        const m = JSON.parse(String(d))
        seen.push(m)
        if (m.type !== 'hello') return
        ws.send(JSON.stringify({ type: 'welcome', bridge: '1.0.0', client: { name: 'claude-code', version: '1' } }))
        ws.send(JSON.stringify({ type: 'call', id: 'c1', tool: 'one_overview', args: {} }))
      })
    })
    try {
      await openApp(page)
      await openAgentsTab(page)
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(OLD_PORT))
      await port.press('Enter')
      await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
      await expect(page.getByTestId('mcp-state')).toContainText('Connected · Claude Code')
      await expect(page.getByTestId('mcp-legacy')).toContainText('older version')
      await expect.poll(() => seen.some((m) => m.type === 'result')).toBe(true)
      const hello = seen.find((m) => m.type === 'hello')!
      expect(hello.workspace).toMatchObject({ name: 'One', kind: 'local', readOnly: false })
      expect(hello.workspace.id).toMatch(/^local:/)
      const result = seen.find((m) => m.type === 'result')!
      expect(result.id).toBe('c1')
      expect(result.result.workspace).toMatchObject({ id: hello.workspace.id, name: 'One', kind: 'local' })
      expect(result.result.pages.length).toBeGreaterThan(0)
    } finally {
      await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
      await new Promise<void>((r) => wss.close(() => r()))
    }
  })
})
