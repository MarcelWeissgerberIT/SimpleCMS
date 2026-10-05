/**
 * Team cloud hardening, end to end against the real server: viewers can't change databases, a team
 * workspace's copy (not the local workspace) is what this browser can erase, backups merge into a
 * team workspace but never replace it, signing out on a shared computer removes the copies, a
 * signed-out boot logs no 401, the per-IP sign-in limit is raised for this suite, unique_id numbers
 * stay unique when two people create rows at once, and content documents of pages deleted for good
 * leave the server.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Cookie, Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, waitForApp, wsEval, cloudEval, cloudStatus, waitOnline, gotoPage, editorOf, createWorkspace, join as joinWorkspace } from './fixtures'

/* Browser errors fail the test (no console errors, no failed requests). Going offline on purpose
   makes the browser log failed socket attempts — those are expected. */
const errors: string[] = []
const EXPECTED = [/ERR_INTERNET_DISCONNECTED/, /WebSocket connection to .* failed/, /net::ERR_NETWORK_CHANGED/]
const watched = new WeakSet<Page>()
function watch(p: Page, who: string) {
  if (watched.has(p)) return
  watched.add(p)
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
  p.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${who} ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors.filter((e) => !EXPECTED.some((re) => re.test(e))), 'browser errors').toEqual([])
})

/** A signed-in person; one account per name for the file, a fresh browser (own IndexedDB) per test. */
const accounts = new Map<string, Cookie[]>()
async function person(page: Page, name: string, wsId?: string): Promise<void> {
  watch(page, name)
  const known = accounts.get(name)
  if (known) {
    await page.context().addCookies(known)
    await page.goto('/app/')
  } else {
    await signIn(page, email(name))
    await api(page, 'PATCH', '/api/me', { name: name[0].toUpperCase() + name.slice(1) })
    accounts.set(name, (await page.context().cookies()).filter((c) => c.name === 'one_session'))
  }
  if (wsId) {
    await openApp(page, wsId)
    await waitOnline(page)
  }
}

/** The server's SQLite file (playwright.cloud.config.ts: DATA_DIR = node_modules/.cache/cloud-data-<port>). */
function serverDb<T>(fn: (db: DatabaseSync) => T): T {
  const port = Number(process.env.CLOUD_E2E_PORT) || 4500
  const db = new DatabaseSync(join(process.cwd(), `node_modules/.cache/cloud-data-${port}/one.sqlite`), { readOnly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}
const storedDoc = (name: string) => serverDb((db) => !!db.prepare('SELECT 1 AS x FROM documents WHERE name = ?').get(name))
const tombstoned = (name: string) => serverDb((db) => !!db.prepare('SELECT 1 AS x FROM document_tombstones WHERE name = ?').get(name))

/** IndexedDB database names of this browser, and the one-cloud/kv keys. */
async function deviceData(p: Page): Promise<{ dbs: string[]; kv: string[] }> {
  return p.evaluate(async () => {
    const dbs = ((await indexedDB.databases()) ?? []).map((d) => d.name ?? '')
    if (!dbs.includes('one-cloud')) return { dbs, kv: [] }
    const kv = await new Promise<string[]>((resolve) => {
      const req = indexedDB.open('one-cloud')
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('kv')) {
          db.close()
          return resolve([])
        }
        const keys = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys()
        keys.onsuccess = () => {
          db.close()
          resolve((keys.result as IDBValidKey[]).map(String))
        }
        keys.onerror = () => resolve([])
      }
      req.onerror = () => resolve([])
    })
    return { dbs, kv }
  })
}

/** A database "Roadmap" with a status, a unique id, three rows, a board and a form view. */
async function roadmap(p: Page): Promise<{ dbId: string; rows: string[] }> {
  return wsEval(p, (s) => {
    const dbId = s.createDatabase({ title: 'Roadmap' })
    // `s` is the state before the call: read the new database from the store
    const fresh = (window as any).__one.workspace.getState() // eslint-disable-line @typescript-eslint/no-explicit-any
    const status = fresh.databases[dbId].properties.find((x: { type: string }) => x.type === 'status')
    s.addProperty(dbId, { type: 'unique_id', name: 'ID', idPrefix: 'RM' })
    s.addView(dbId, { type: 'board', name: 'Board', groupBy: status.id })
    s.addView(dbId, { type: 'form', name: 'Intake', form: {} })
    const rows = ['Ship the cloud', 'Write the guide', 'Plan Q4'].map((title) => s.createRow(dbId, { title }))
    return { dbId, rows }
  })
}

test.describe('team cloud — hardening', () => {
  test('viewers read databases: no edits, rows, properties, views, drags or form answers', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Readers')
    await openApp(a, wsId)
    await waitOnline(a)
    const { dbId, rows } = await roadmap(a)
    const v = await newPerson(context)
    await person(v, 'vera')
    await joinWorkspace(a, v, wsId, 'viewer')
    await openApp(v, wsId, `/p/${dbId}`)
    await waitOnline(v)
    expect(await cloudEval(v, (c) => c.readOnly)).toBe(true)

    const db = v.locator('section.db')
    await expect(db.locator('.dbt-row').filter({ hasText: 'Plan Q4' })).toBeVisible()
    // the same VIEW ONLY cue as the shell, instead of "New"
    await expect(db.getByTestId('db-view-only')).toBeVisible()
    await expect(db.locator('.db-newbtn')).toHaveCount(0)
    for (const sel of ['.db-tabs__add', '.dbt-hcell--add button', '.dbt-grip', '.dbt-addrow', '.dbt-resize', '.dbt-gutter .db-check']) await expect(db.locator(sel), sel).toHaveCount(0)
    for (const name of ['Filter', 'Sort', 'Group', 'Properties', 'Automations']) await expect(db.getByRole('button', { name, exact: true }), name).toHaveCount(0)

    // a cell doesn't open an editor (click, typing, Enter on the header)
    const cell = db.locator('.dbt-row').filter({ hasText: 'Plan Q4' }).locator('.dbt-cell').first()
    await cell.click()
    await v.keyboard.type('x')
    await expect(v.locator('[data-popover]')).toHaveCount(0)
    const header = db.locator('.dbt-hcell__btn').nth(1)
    await expect(header).toHaveAttribute('aria-disabled', 'true')
    await header.click({ force: true })
    await expect(v.locator('[data-popover]')).toHaveCount(0)
    // the row menu only opens / copies
    await db.locator('.dbt-row').filter({ hasText: 'Plan Q4' }).click({ button: 'right' })
    const menu = v.locator('[data-popover][role="menu"]')
    await expect(menu.getByRole('menuitem', { name: /^Open$/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Duplicate|Delete/ })).toHaveCount(0)
    await v.keyboard.press('Escape')
    // the "more" menu keeps exports, drops layout and structure
    await db.getByRole('button', { name: 'More', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: /Export as CSV/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Layout/ })).toHaveCount(0)
    await v.keyboard.press('Escape')

    // board: cards open, they don't move; no "New" in the columns
    await db.getByRole('tab', { name: /Board/ }).click()
    await expect(db.locator('.dbc').first()).toBeVisible()
    await expect(db.locator('.dbb-add')).toHaveCount(0)
    const card = db.locator('.dbc').first()
    await expect(card).not.toHaveAttribute('aria-roledescription', 'sortable')
    await expect(card).not.toHaveAttribute('aria-disabled', 'true')
    // a drag does nothing (the card stays in its column, the row keeps its status)
    const cells = () => wsEval(v, (s, id) => JSON.stringify((Object.values(s.pages) as Array<{ databaseId: string | null; properties: unknown }>).filter((p) => p.databaseId === id).map((p) => p.properties)), dbId)
    const before = await cells()
    const target = db.locator('.dbb-col').nth(2)
    await card.dragTo(target)
    await v.waitForTimeout(400)
    expect(await cells()).toBe(before)
    // a form can be looked at, not built or answered
    await db.getByRole('tab', { name: /Intake/ }).click()
    await expect(db.getByRole('radio', { name: /Build/ })).toBeDisabled()
    await expect(db.locator('.fm-submit')).toBeDisabled()
    await expect(db.locator('.fm-fail')).toContainText('View only')
    await expect(db.locator('.dbf-bar__share')).toHaveCount(0)

    // the row page: values read, nothing opens
    await v.evaluate((id) => (window.location.hash = `#/p/${id}`), rows[0])
    await expect(v.locator('.db-props')).toBeVisible()
    await expect(v.locator('.db-props__btn').filter({ hasText: /Add a property/ })).toHaveCount(0)
    await v.locator('.db-prow__value').first().click()
    await expect(v.locator('[data-popover]')).toHaveCount(0)

    // and nothing changed for the team
    await a.waitForTimeout(800)
    expect(await wsEval(a, (s, id) => (Object.values(s.pages) as Array<{ databaseId: string | null; trashed: boolean }>).filter((p) => p.databaseId === id && !p.trashed).length, dbId)).toBe(3)
    expect(await wsEval(a, (s, id) => s.databases[id].views.length, dbId)).toBe(3)

    // viewers can't import at all
    await v.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'import' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(v.getByTestId('import-view-only')).toBeVisible()
  })

  test('a backup merges into a team workspace but never replaces it', async ({ page: a }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Merging')
    await openApp(a, wsId)
    await waitOnline(a)
    const kept = await wsEval(a, (s) => s.createPage({ title: 'Already here' }))
    const page = { id: 'bk1page', kind: 'page', title: 'From the backup', icon: null, cover: null, parentId: null, databaseId: null, properties: {}, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restored text' }] }] }, contentRev: 1, contentOrigin: null, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 2, order: 0, settings: {} }
    const backup = { format: 'simplecms-one-backup', version: 1, exportedAt: new Date().toISOString(), scope: 'workspace', rootId: null, files: [], workspace: { version: 1, pages: { bk1page: page }, databases: {}, people: [], settings: {}, recent: [] } }

    await a.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'import' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    const dialog = a.getByRole('dialog')
    const chooser = a.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }])
    // "replace" would swap the workspace out for everyone: not offered, and it says why
    const replace = dialog.getByRole('radio', { name: /Replace workspace/ })
    await expect(replace).toBeDisabled()
    await expect(replace).toContainText('for everyone')
    await expect(dialog.getByRole('radio', { name: /Merge into this workspace/ })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('button', { name: 'Merge backup' }).click()
    await expect(dialog.getByText(/Backup merged/)).toBeVisible()
    expect(await wsEval(a, (s) => s.pages.bk1page?.title ?? null)).toBe('From the backup')
    expect(await wsEval(a, (s, id) => !!s.pages[id], kept)).toBe(true)
    await a.keyboard.press('Escape')
    // merged pages reach the team (another tab of the workspace, via the server)
    await a.reload()
    await waitForApp(a)
    await waitOnline(a)
    expect(await wsEval(a, (s) => s.pages.bk1page?.title ?? null)).toBe('From the backup')
  })

  test('Settings: a team workspace offers "remove this copy", never "erase" — the local workspace stays', async ({ page: a }) => {
    await person(a, 'ada')
    // the local workspace (seeded demo) first: remember a page of it
    await openApp(a)
    const localPage = await wsEval(a, (s) => s.createPage({ title: 'Local canary' }))
    await a.evaluate(() => (window as any).__one.flushSave()) // eslint-disable-line @typescript-eslint/no-explicit-any
    const wsId = await createWorkspace(a, 'Copyable')
    await openApp(a, wsId)
    await waitOnline(a)
    const teamPage = await wsEval(a, (s) => s.createPage({ title: 'Team page' }))
    await gotoPage(a, teamPage)
    await editorOf(a, teamPage).click()
    await a.keyboard.type('Team words.')
    await expect.poll(() => a.evaluate(() => (window as any).__one.cloud.useCloudSync.getState().unsynced), { timeout: 15_000 }).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any
    await a.waitForTimeout(800)
    let device = await deviceData(a)
    expect(device.dbs).toContain(`one:ws:${wsId}`)
    expect(device.kv.some((k) => k.startsWith(`content:${wsId}:`) || k === `overlay:${wsId}`)).toBe(true)
    // a background AI result of each workspace on this device (features/ai/runs.ts)
    const aiRuns = (op: 'seed' | 'list', ws: string) =>
      a.evaluate(
        ({ op, ws }) =>
          new Promise<string[]>((resolve, reject) => {
            const r = indexedDB.open('one-ai-runs')
            r.onupgradeneeded = () => r.result.createObjectStore('runs')
            r.onerror = () => reject(r.error)
            r.onsuccess = () => {
              const db = r.result
              const tx = db.transaction('runs', op === 'seed' ? 'readwrite' : 'readonly')
              const os = tx.objectStore('runs')
              let out: string[] = []
              if (op === 'seed') {
                os.put({ id: 'r-team', scope: `cloud:${ws}`, output: 'Team words.' }, `cloud:${ws}|r-team`)
                os.put({ id: 'r-local', scope: 'local:local', output: 'Local words.' }, 'local:local|r-local')
              } else {
                const k = os.getAllKeys()
                k.onsuccess = () => (out = k.result.map(String))
              }
              tx.oncomplete = () => {
                db.close()
                resolve(out)
              }
              tx.onerror = () => reject(tx.error)
            }
          }),
        { op, ws },
      )
    await aiRuns('seed', wsId)

    await a.keyboard.press('Control+,')
    const settings = a.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: /Data/ }).click()
    await expect(settings.getByRole('button', { name: 'Reset workspace' })).toHaveCount(0)
    const remove = settings.getByTestId('remove-copy')
    await expect(remove).toContainText('Remove this workspace’s copy from this browser')
    await remove.getByRole('button', { name: 'Remove copy' }).click()
    const confirm = a.getByRole('dialog').filter({ hasText: 'Remove the copy of' })
    await expect(confirm).toBeVisible()
    await Promise.all([a.waitForEvent('load'), confirm.getByRole('button', { name: 'Remove copy' }).click()])
    await waitForApp(a)
    expect(await cloudStatus(a)).toBe('local')
    expect(await wsEval(a, (s, id) => s.pages[id]?.title ?? null, localPage)).toBe('Local canary')
    await expect
      .poll(async () => {
        device = await deviceData(a)
        return device.dbs.filter((n) => n.startsWith(`one:ws:${wsId}`)).length + device.kv.filter((k) => k.includes(wsId)).length
      })
      .toBe(0)
    expect(await aiRuns('list', wsId)).toEqual(['local:local|r-local'])
    // the team workspace itself is untouched: opening it again downloads it
    await openApp(a, wsId)
    await waitOnline(a)
    await expect.poll(() => wsEval(a, (s, id) => s.pages[id]?.plain ?? '', teamPage), { timeout: 20_000 }).toContain('Team words.')
  })

  test('signing out offers to remove the team workspace copies (on by default)', async ({ page: a }) => {
    await signIn(a, email('shared'))
    watch(a, 'shared')
    const wsId = await createWorkspace(a, 'Shared desk')
    await openApp(a, wsId)
    await waitOnline(a)
    const id = await wsEval(a, (s) => s.createPage({ title: 'Secret plans' }))
    await wsEval(a, (s) => s.updateSettings({ aiApiKey: 'sk-ant-shared-computer' }))
    await gotoPage(a, id)
    await a.waitForTimeout(1200)
    expect((await deviceData(a)).dbs).toContain(`one:ws:${wsId}`)

    await a.locator('aside.sb .sb-head__ws').click()
    await a.getByRole('menuitem', { name: /Sign out/ }).click()
    const dialog = a.getByRole('dialog', { name: 'Sign out' })
    const box = dialog.getByRole('checkbox', { name: /Also remove the team workspace copies/ })
    await expect(box).toBeChecked()
    await expect(dialog).toContainText('Your local workspace stays as it is.')
    await Promise.all([a.waitForEvent('load'), dialog.getByRole('button', { name: 'Sign out', exact: true }).click()])
    await waitForApp(a)
    expect(await cloudStatus(a)).toBe('local')
    expect(await cloudEval(a, (c) => c.user)).toBe(null)
    await expect
      .poll(async () => {
        const d = await deviceData(a)
        return [...d.dbs.filter((n) => n.startsWith('one:ws:')), ...d.kv]
      })
      .toEqual([])
    // the session is gone on the server too
    expect((await api(a, 'GET', '/api/session')).json).toEqual({ user: null, workspaces: [] })
  })

  test('a signed-out boot asks /api/session (no 401); the sign-in limit per IP is raised for tests', async ({ page }) => {
    watch(page, 'anon')
    await page.goto('/app/?e2e')
    await waitForApp(page)
    // the browser remembers a team workspace, but nobody is signed in
    await page.evaluate(() => localStorage.setItem('one.cloud.active', 'ws_nobodyhere1'))
    const asked: string[] = []
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (path.startsWith('/api/')) asked.push(path)
    })
    await page.reload()
    await waitForApp(page)
    expect(await cloudStatus(page)).toBe('signed-out')
    expect(asked).toContain('/api/session')
    expect(asked).not.toContain('/api/me')

    // AUTH_IP_LIMIT=1000 (playwright.cloud.config.ts): more than the default 20 requests from one IP
    const statuses = await page.evaluate(async () => {
      const out: number[] = []
      for (let i = 0; i < 25; i++) {
        const res = await fetch('/api/auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `burst${i}.${Date.now()}@example.test` }) })
        out.push(res.status)
      }
      return out
    })
    expect(statuses.every((s) => s === 204)).toBe(true)
  })

  test('two people number rows at the same moment: unique ids stay unique', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Numbers')
    await openApp(a, wsId)
    await waitOnline(a)
    const { dbId, rows } = await wsEval(a, (s) => {
      const dbId = s.createDatabase({ title: 'Bugs' })
      s.addProperty(dbId, { type: 'unique_id', name: 'ID', idPrefix: 'BUG' })
      return { dbId, rows: [s.createRow(dbId, { title: 'First' })] }
    })
    const b = await newPerson(context)
    await person(b, 'bob')
    await joinWorkspace(a, b, wsId)
    await openApp(b, wsId, `/p/${dbId}`)
    await waitOnline(b)
    await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], rows[0])).toBe(true)
    const uidOf = (p: Page, rowId: string) =>
      wsEval(p, (s, { dbId, rowId }) => {
        const prop = s.databases[dbId].properties.find((x: { type: string }) => x.type === 'unique_id')
        return s.pages[rowId]?.properties[prop.id] ?? null
      }, { dbId, rowId })
    expect(await uidOf(b, rows[0])).toBe(1)

    // B is offline while both of them create a row: both take number 2
    await b.context().setOffline(true)
    await expect.poll(() => cloudStatus(b)).toBe('offline')
    const fromA = await wsEval(a, (s, id) => s.createRow(id, { title: 'From Ada' }), dbId)
    await a.waitForTimeout(50)
    const fromB = await wsEval(b, (s, id) => s.createRow(id, { title: 'From Bob' }), dbId)
    expect(await uidOf(a, fromA)).toBe(2)
    expect(await uidOf(b, fromB)).toBe(2)

    // back online: the row created first keeps 2, the later one moves on — the same on both sides
    await b.context().setOffline(false)
    await waitOnline(b)
    for (const p of [a, b]) {
      await expect.poll(async () => [await uidOf(p, fromA), await uidOf(p, fromB)], { timeout: 20_000 }).toEqual([2, 3])
      await expect.poll(() => wsEval(p, (s, id) => s.databases[id].nextUniqueId, dbId)).toBe(4)
    }
    // the next row on either side gets 4
    const next = await wsEval(a, (s, id) => s.createRow(id, { title: 'After' }), dbId)
    expect(await uidOf(a, next)).toBe(4)
  })

  test('deleting a page for good removes its content document from the server', async ({ page: a }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Tidy')
    await openApp(a, wsId)
    await waitOnline(a)
    const id = await wsEval(a, (s) => s.createPage({ title: 'Ephemeral' }))
    await gotoPage(a, id)
    await editorOf(a, id).click()
    await a.keyboard.type('Gone soon.')
    const name = `ws:${wsId}:p:${id}`
    await expect.poll(() => storedDoc(name), { timeout: 20_000 }).toBe(true)

    // the trash keeps it (restorable) …
    await wsEval(a, (s, id) => s.trashPage(id), id)
    await a.waitForTimeout(1500)
    expect(storedDoc(name)).toBe(true)
    // … deleting it for good removes it on the server too
    await a.evaluate(() => (window.location.hash = '#/'))
    await wsEval(a, (s) => s.emptyTrash())
    await expect.poll(() => storedDoc(name), { timeout: 20_000 }).toBe(false)
    expect(tombstoned(name)).toBe(true)
    // and the device's purge queue is empty again
    await expect.poll(async () => (await deviceData(a)).kv.filter((k) => k.startsWith('purge:')).length).toBe(0)
  })
})
