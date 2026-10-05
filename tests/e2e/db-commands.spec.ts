/**
 * Database commands (features/commands): a database's menu of things to run — the ⌘ key on its sidebar row,
 * the row's ⋯ / right-click menu (section "Commands · <db>"), the database toolbar's key and ⌘K entries
 * "<db>: <command>". Defaults are computed (New entry, From template ▸, Open view ▸, Import / Export CSV, Copy
 * link · Mails: Sync now … · agents watching the database: Run "<agent>" now); "Edit commands…" hides /
 * reorders them and adds own commands (actions, agent, view) stored in Database.commands.
 *
 * Everything external is mocked: Google's sign-in script, the Gmail REST API (an in-memory mailbox) and
 * Claude (api.anthropic.com) — nothing real is ever called.
 */
import type { Locator, Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, reloadApp, pageIdByTitle, escapeRe, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"], .sb section[aria-label="Seiten"]')
const row = (page: Page, title: string) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
const menu = (page: Page) => page.locator('.popover.cmd-menu')
const item = (scope: Locator, name: string | RegExp) => scope.getByRole('menuitem', { name })

/** Hover a database's sidebar row and open its command key's menu. */
async function openCommands(page: Page, title: string): Promise<Locator> {
  const r = row(page, title)
  await r.hover()
  await r.getByTestId('tree-commands').click()
  await expect(menu(page)).toBeVisible()
  return menu(page)
}

/** The labels of the menu's items, in order. */
const labels = (m: Locator) => m.locator('.menu-item .menu-item__label').allInnerTexts()

const rowsOf = (page: Page, dbId: string) => wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === id && !p.trashed).length, dbId)

/** A select / status value of a row by option name. */
const optionOf = (page: Page, rowId: string, prop: string) =>
  wsEval(
    page,
    (s, a) => {
      const row = s.pages[a.rowId]
      const def = s.databases[row.databaseId].properties.find((p: AnyState) => p.name === a.prop)
      return def.options.find((o: AnyState) => o.id === row.properties[def.id])?.name ?? null
    },
    { rowId, prop },
  )

/* ------------------------------------------------------------------ */
/* Gmail + Google sign-in mocks (as in mail-gmail.spec)                */
/* ------------------------------------------------------------------ */

const CLIENT_ID = '123456789012-e2etestclientid0001.apps.googleusercontent.com'
const ACCOUNT = 'ada@example.com'
const DAY = 86_400_000

const GIS_JS = `
(() => {
  let n = 0
  window.__gis = { calls: 0 }
  window.google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      return { requestAccessToken() { window.__gis.calls++; setTimeout(() => cfg.callback({ access_token: 'ya29.e2e-cmd-' + (++n), expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' }), 40) } }
    },
    hasGrantedAllScopes(r, ...scopes) { return scopes.every((s) => String(r.scope || '').split(' ').includes(s)) },
    revoke(token, done) { done && done() },
  } } }
})()`

interface Mail {
  id: string
  date: number
  subject: string
  from: string
  text: string
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

class Mailbox {
  historyId = 1000
  history: Array<{ id: number; messagesAdded: AnyState[] }> = []
  constructor(public mails: Mail[]) {}

  add(m: Mail) {
    this.mails.push(m)
    this.history.push({ id: ++this.historyId, messagesAdded: [{ message: { id: m.id, threadId: `t-${m.id}`, labelIds: ['INBOX'] } }] })
  }

  async handle(route: Route) {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization, accept', 'access-control-allow-methods': 'GET' } })
    const url = new URL(req.url())
    const path = url.pathname.replace('/gmail/v1/users/me/', '')
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!((await req.allHeaders()).authorization ?? '').startsWith('Bearer ya29.')) return json(401, { error: { code: 401 } })
    if (path === 'profile') return json(200, { emailAddress: ACCOUNT, messagesTotal: this.mails.length, historyId: String(this.historyId) })
    if (path === 'labels') return json(200, { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'UNREAD', name: 'UNREAD', type: 'system' }] })
    if (path === 'messages') {
      const after = Number((url.searchParams.get('q') ?? '').match(/after:(\d+)/)?.[1] ?? 0) * 1000
      const hits = this.mails.filter((m) => m.date >= after).sort((a, b) => b.date - a.date)
      return json(200, { messages: hits.map((m) => ({ id: m.id, threadId: `t-${m.id}` })), resultSizeEstimate: hits.length })
    }
    const one = path.match(/^messages\/([^/]+)$/)
    if (one) {
      const m = this.mails.find((x) => x.id === one[1])
      if (!m) return json(404, { error: { code: 404 } })
      const headers = [
        { name: 'Subject', value: m.subject },
        { name: 'From', value: m.from },
        { name: 'To', value: ACCOUNT },
        { name: 'Date', value: new Date(m.date).toUTCString() },
        { name: 'Content-Type', value: 'text/plain; charset="UTF-8"' },
      ]
      return json(200, { id: m.id, threadId: `t-${m.id}`, labelIds: ['INBOX'], snippet: m.text.slice(0, 60), historyId: String(this.historyId), internalDate: String(m.date), sizeEstimate: 1024, payload: { mimeType: 'text/plain', filename: '', headers, body: { size: m.text.length, data: b64url(m.text) } } })
    }
    if (path === 'history') {
      const start = Number(url.searchParams.get('startHistoryId'))
      return json(200, { history: this.history.filter((h) => h.id > start), historyId: String(this.historyId) })
    }
    return json(400, { error: { code: 400 } })
  }
}

/** Claude: agents get a short report; anything else is refused (and recorded). */
async function mockClaude(page: Page): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await page.route('https://api.anthropic.com/**', (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    const sse =
      ev('message_start', { message: { id: 'msg_cmd', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }) +
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Checked the projects. Nothing to change.' } }) +
      ev('content_block_stop', { index: 0 }) +
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } }) +
      ev('message_stop', {})
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse })
  })
  return bodies
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test.describe('Database commands', () => {
  test('sidebar key: the defaults in order; New entry, Open view, Export CSV run', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    const m = await openCommands(page, 'Projects')
    await expect(m.locator('.menu-section')).toHaveText(/Commands · Projects/i)
    expect(await labels(m)).toEqual(['New entry', 'Open view', 'Import CSV…', 'Export CSV', 'Copy link', 'Edit commands…'])
    // the key holds the row open while its menu is open
    await expect(row(page, 'Projects')).toHaveAttribute('data-menu-open', 'true')

    // New entry: a row with the first view's presets, opened
    const before = await rowsOf(page, dbId)
    await item(m, 'New entry').click()
    await expect.poll(() => rowsOf(page, dbId)).toBe(before + 1)
    const created = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === id && !p.trashed).sort((a, b) => b.createdAt - a.createdAt)[0].id, dbId)
    await expect.poll(() => page.evaluate(() => location.hash)).toContain(created)

    // Open view ▸ Timeline: the database page on that view
    await item(await openCommands(page, 'Projects'), 'Open view').click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Timeline' }).click()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/p/${dbId}`)
    await expect(page.locator('#main [role="tab"][aria-selected="true"]')).toContainText('Timeline')
    // … and switches it in place while the page is open
    await item(await openCommands(page, 'Projects'), 'Open view').click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Calendar' }).click()
    await expect(page.locator('#main [role="tab"][aria-selected="true"]')).toContainText('Calendar')

    // Export CSV: a download + the outcome as a toast
    const download = page.waitForEvent('download')
    await item(await openCommands(page, 'Projects'), 'Export CSV').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.csv$/)
    await expect(page.locator('.toast', { hasText: /Projects · Export CSV · \d+ rows exported/ })).toBeVisible()
  })

  test('templates: From template ▸ creates an entry from a row template', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Meetings')
    const m = await openCommands(page, 'Meetings')
    expect(await labels(m)).toEqual(['New entry', 'From template', 'Open view', 'Import CSV…', 'Export CSV', 'Copy link', 'Edit commands…'])
    const before = await rowsOf(page, dbId)
    await item(m, 'From template').click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Weekly sync' }).click()
    await expect.poll(() => rowsOf(page, dbId)).toBe(before + 1)
    const tplIcon = await wsEval(page, (s, id) => JSON.stringify(s.databases[id].templates[0].icon ?? null), dbId)
    const newest = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === id && !p.trashed).sort((a, b) => b.createdAt - a.createdAt)[0], dbId)
    expect(JSON.stringify(newest.icon ?? null)).toBe(tplIcon)
    expect(newest.content).not.toBeNull()
  })

  test('right-click menu: the commands section on top of the row’s own entries; ⌘K finds "<db>: <command>"', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Reading list')
    await row(page, 'Reading list').click({ button: 'right' })
    const m = menu(page)
    await expect(m.locator('.menu-section').first()).toHaveText(/Commands · Reading list/i)
    const all = await labels(m)
    // the commands first (the row menu keeps its own "Copy link"), then the row's entries
    expect(all.slice(0, 5)).toEqual(['New entry', 'Open view', 'Import CSV…', 'Export CSV', 'Edit commands…'])
    expect(all).toContain('Rename')
    expect(all.filter((x) => x === 'Copy link')).toHaveLength(1)
    await page.keyboard.press('Escape')

    // ⌘K: found by typing
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.locator('.pal')
    await pal.locator('input').fill('Reading list: new')
    const hit = pal.locator('.pal-item', { hasText: 'Reading list: New entry' })
    await expect(hit).toBeVisible()
    // typing the name alone still opens the page first, not a command
    await pal.locator('input').fill('Reading list')
    await expect(pal.locator('.pal-item').first()).toContainText('Reading list')
    await expect(pal.locator('.pal-item').first()).not.toContainText(':')
    // the empty ">" list stays without them
    await pal.locator('input').fill('>')
    await expect(pal.locator('.pal-item', { hasText: 'Reading list:' })).toHaveCount(0)
    await pal.locator('input').fill('Reading list: new entry')
    const before = await rowsOf(page, dbId)
    await page.keyboard.press('Enter')
    await expect.poll(() => rowsOf(page, dbId)).toBe(before + 1)
  })

  test('Mails: Sync now signs in (mocked Google) and syncs; ⌘K "Mails: Sync now"', async ({ page }) => {
    const now = Date.now()
    const box = new Mailbox([
      { id: 'm1', date: now - 2 * DAY, subject: 'Draft review', from: 'Bob <bob@example.test>', text: 'Can you review the draft by Friday?' },
      { id: 'm2', date: now - 3 * DAY, subject: 'Quarterly numbers', from: 'cfo@example.test', text: 'Numbers attached.' },
    ])
    await page.route('https://gmail.googleapis.com/**', (r) => box.handle(r))
    await page.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: GIS_JS }))
    const claude = await mockClaude(page)
    await openApp(page)
    await wsEval(page, (s, p) => s.updateSettings({ mail: { ...(s.settings.mail ?? {}), ...p } }), { clientId: CLIENT_ID, from: new Date(now - 10 * DAY).toISOString().slice(0, 10), people: { enabled: false, freemail: [] } })
    // the first sync creates the Mails database (a token without Google's window: the test hook)
    await page.evaluate((a) => (window as AnyState).__oneMail.setToken('ya29.e2e-first', a), ACCOUNT)
    await page.evaluate(() => (window as AnyState).__oneMail.sync())
    await expect.poll(() => page.evaluate(() => (window as AnyState).__oneMail.state().phase)).toBe('idle')
    const dbId = await wsEval(page, (s) => s.settings.mail?.databaseId as string)
    expect(await rowsOf(page, dbId)).toBe(2)
    const title = await wsEval(page, (s, id) => s.pages[id].title as string, dbId)
    await flush(page)

    // a new mail arrives; after a reload the token (memory only) is gone
    box.add({ id: 'm3', date: Date.now() - 60_000, subject: 'Lunch on Thursday?', from: 'Mira <mira@example.test>', text: 'Lunch at 12:30?' })
    await reloadApp(page)
    const m = await openCommands(page, title)
    // the database's defaults, then the mail group
    const all = await labels(m)
    expect(all.slice(all.indexOf('Copy link'))).toEqual(['Copy link', 'Sync now', 'Mail settings…', 'Edit commands…'])
    // the last sync's time as the item's read-out, an LED in its glyph
    const sync = item(m, 'Sync now')
    await expect(sync.locator('.menu-item__hint')).toHaveText(/^\d\d:\d\d$/)
    await expect(sync.locator('.cmd-glyph__led')).toHaveClass(/led--ok/)
    await sync.click()
    await expect(page.locator('.toast', { hasText: '1 new mail' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => rowsOf(page, dbId)).toBe(3)
    expect(await page.evaluate(() => (window as AnyState).__gis.calls)).toBe(1)

    // ⌘K: the same command
    box.add({ id: 'm4', date: Date.now() - 30_000, subject: 'Invoice 114', from: 'billing@example.test', text: 'Your invoice.' })
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.locator('.pal')
    await pal.locator('input').fill('sync now')
    await expect(pal.locator('.pal-item', { hasText: `${title}: Sync now` })).toBeVisible()
    await pal.locator('.pal-item', { hasText: `${title}: Sync now` }).click()
    await expect.poll(() => rowsOf(page, dbId)).toBe(4)
    // nothing went to Claude (organising is off)
    expect(claude).toHaveLength(0)
  })

  test('agents watching a database: Run "<agent>" now (mocked Claude)', async ({ page }) => {
    const claude = await mockClaude(page)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const dbId = await pageIdByTitle(page, 'Projects')
    await wsEval(
      page,
      (s, db) => {
        const now = Date.now()
        s.upsertAgent({ id: 'ag-cmd', name: 'Status reader', instructions: 'Report the status of the projects.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [db] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
      },
      dbId,
    )
    await flush(page)
    const m = await openCommands(page, 'Projects')
    await expect(m.locator('.menu-sep')).not.toHaveCount(0)
    await item(m, 'Run “Status reader” now').click()
    await expect(page.getByText('Status reader: run finished')).toBeVisible({ timeout: 20_000 })
    expect(claude.length).toBeGreaterThan(0)
    // other databases don't list it
    const other = await openCommands(page, 'Reading list')
    expect((await labels(other)).some((x) => x.includes('Status reader'))).toBe(false)
  })

  test('Edit commands: hide a default, add an Actions command (preset Status) that runs, reorder persists', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    await item(await openCommands(page, 'Projects'), 'Edit commands…').click()
    const dlg = page.getByRole('dialog', { name: /Commands · Projects/ })
    await expect(dlg).toBeVisible()
    // hide "Import CSV…"
    await dlg.getByRole('switch', { name: 'Show “Import CSV…” in the menu' }).click()
    // add an own command: Actions → Add a page with Status = Done
    await dlg.getByRole('button', { name: 'Add command' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Actions' }).click()
    await dlg.getByLabel('Label').fill('Log a finished task')
    await dlg.getByRole('button', { name: 'Add action' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Add a page to a database' }).click()
    // the database is preset to this one
    await expect(dlg.locator('.bcfg-card')).toContainText('Projects')
    await dlg.getByLabel('Page title').fill('Done item')
    await dlg.getByRole('button', { name: 'Add value' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Status' }).click()
    await dlg.getByRole('button', { name: 'Value of Status' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Done' }).click()
    await dlg.getByRole('button', { name: 'All commands' }).click()
    // the new command is last; Alt+↑ moves it above "Copy link"
    const own = dlg.locator('.dbc-row', { hasText: 'Log a finished task' })
    await expect(own).toBeVisible()
    await own.locator('.dbc-grip').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await dlg.getByRole('button', { name: 'Done' }).click()
    await expect(dlg).toHaveCount(0)

    const stored = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].commands)), dbId)
    expect(stored.find((c: AnyState) => c.id === 'import-csv')).toMatchObject({ kind: 'default', hidden: true })
    expect(stored.find((c: AnyState) => c.kind === 'actions')).toMatchObject({ label: 'Log a finished task' })

    const m = await openCommands(page, 'Projects')
    expect(await labels(m)).toEqual(['New entry', 'Open view', 'Export CSV', 'Log a finished task', 'Copy link', 'Edit commands…'])
    const before = await rowsOf(page, dbId)
    await item(m, 'Log a finished task').click()
    await expect.poll(() => rowsOf(page, dbId)).toBe(before + 1)
    await expect(page.locator('.toast', { hasText: '“Done item” added to Projects' })).toBeVisible()
    const added = await pageIdByTitle(page, 'Done item')
    expect(await optionOf(page, added, 'Status')).toBe('Done')

    // the order survives a reload
    await reloadApp(page)
    expect(await labels(await openCommands(page, 'Projects'))).toEqual(['New entry', 'Open view', 'Export CSV', 'Log a finished task', 'Copy link', 'Edit commands…'])
  })

  test('toolbar key: an Actions command edits the rows selected in the table; the sidebar says "select rows"', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    await wsEval(
      page,
      (s, db) => {
        const status = s.databases[db].properties.find((p: AnyState) => p.name === 'Status')
        const done = status.options.find((o: AnyState) => o.name === 'Done').id
        s.updateDatabase(db, { commands: [{ id: 'cmd-done', kind: 'actions', label: 'Mark done', icon: null, config: { actions: [{ id: 'a1', type: 'edit_properties', values: [{ propertyId: status.id, value: done }] }] } }] })
      },
      dbId,
    )
    // the sidebar has no selection: the command shows why it can't run
    const side = await openCommands(page, 'Projects')
    await expect(item(side, 'Mark done')).toHaveAttribute('aria-disabled', 'true')
    await expect(item(side, 'Mark done').locator('.menu-item__hint')).toHaveText('SELECT ROWS')
    await page.keyboard.press('Escape')

    await page.evaluate((id) => (location.hash = `#/p/${id}`), dbId)
    await page.locator('#main [role="tab"]', { hasText: 'All projects' }).click()
    const rows = page.locator('#main .dbt-row[role="row"]:not(.dbt-row--head)')
    for (const i of [0, 1]) {
      await rows.nth(i).hover()
      await rows.nth(i).getByRole('checkbox', { name: 'Select row' }).click()
    }
    await expect(page.locator('#main .dbt-row[aria-selected="true"]')).toHaveCount(2)
    const key = page.getByTestId('db-commands')
    await key.click()
    const m = menu(page)
    await expect(item(m, 'Mark done')).not.toHaveAttribute('aria-disabled', 'true')
    await item(m, 'Mark done').click()
    await expect(page.locator('.toast', { hasText: 'Projects · Mark done · 2 rows updated' })).toBeVisible()
    const doneCount = await wsEval(page, (s, db) => {
      const status = s.databases[db].properties.find((p: AnyState) => p.name === 'Status')
      const done = status.options.find((o: AnyState) => o.name === 'Done').id
      return (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed && p.properties[status.id] === done).length
    }, dbId)
    expect(doneCount).toBeGreaterThanOrEqual(2)
  })

  test('a locked database: the editor refuses changes, running still works', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    await wsEval(page, (s, id) => s.updateDatabase(id, { locked: true }), dbId)
    const m = await openCommands(page, 'Projects')
    await expect(item(m, 'Edit commands…').locator('.menu-item__hint')).toHaveText('LOCKED')
    await item(m, 'Edit commands…').click()
    const dlg = page.getByRole('dialog', { name: /Commands · Projects/ })
    await expect(dlg.getByTestId('dbc-lock')).toContainText('Locked')
    await expect(dlg.getByRole('switch', { name: 'Show “Export CSV” in the menu' })).toBeDisabled()
    await expect(dlg.getByRole('button', { name: 'Add command' })).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(await wsEval(page, (s, id) => s.databases[id].commands ?? null, dbId)).toBeNull()
    // running stays allowed
    const before = await rowsOf(page, dbId)
    await item(await openCommands(page, 'Projects'), 'New entry').click()
    await expect.poll(() => rowsOf(page, dbId)).toBe(before + 1)
  })

  test('German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const m = await openCommands(page, 'Meetings')
    await expect(m.locator('.menu-section')).toHaveText(/Befehle · Meetings/i)
    expect(await labels(m)).toEqual(['Neuer Eintrag', 'Aus Vorlage', 'Ansicht öffnen', 'CSV importieren…', 'Als CSV exportieren', 'Link kopieren', 'Befehle bearbeiten…'])
    await item(m, 'Befehle bearbeiten…').click()
    const dlg = page.getByRole('dialog', { name: /Befehle · Meetings/ })
    await expect(dlg.getByText('Im Menü')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Befehl hinzufügen' })).toBeVisible()
  })
})

test.describe('database commands at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('touch: no extra key in the row — the ⋯ menu has the commands; New entry works', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const r = row(page, 'Projects')
    await expect(r.getByTestId('tree-commands')).toBeHidden()
    await r.getByRole('button', { name: 'More' }).tap()
    const m = menu(page)
    await expect(m.locator('.menu-section').first()).toHaveText(/Commands · Projects/i)
    const before = await rowsOf(page, dbId)
    await item(m, 'New entry').tap()
    await expect.poll(() => rowsOf(page, dbId)).toBe(before + 1)
    await expect(page.locator('aside.sb')).toHaveAttribute('data-state', 'drawer')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
