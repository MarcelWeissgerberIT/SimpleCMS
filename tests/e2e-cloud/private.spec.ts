/**
 * Private pages in team workspaces (docs/CLOUD.md § Private pages), end to end against the real
 * server: Ada's private page, database and rows never reach Bob (store, sidebar, search, DOM, the
 * search excerpt, presence); a mention of it in a workspace page reads "No access" for him; moving it
 * to the workspace (after a confirmation) shows it to Bob live with its content, moving it back
 * takes it away again and purges the workspace's copies on the server; offline edits of a private
 * page sync on reconnect.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Cookie, Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, wsEval, cloudEval, cloudStatus, waitOnline, gotoPage, editorOf, createWorkspace, join as joinWorkspace } from './fixtures'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const PORT = Number(process.env.CLOUD_E2E_PORT) || 4500
const DB_FILE = join(process.cwd(), `node_modules/.cache/cloud-data-${PORT}`, 'one.sqlite')

/* Browser errors fail the test. Going offline on purpose makes the browser log failed socket attempts. */
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

const accounts = new Map<string, Cookie[]>()
async function person(page: Page, name: string, wsId?: string, hash = ''): Promise<void> {
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
    await openApp(page, wsId, hash)
    await waitOnline(page)
  }
}

const userId = (p: Page) => cloudEval(p, (c) => c.user.id as string)

/** Stored document names (the test server's SQLite file, read-only). */
function stored(prefix: string): string[] {
  const db = new DatabaseSync(DB_FILE, { readOnly: true })
  try {
    return (db.prepare('SELECT name FROM documents WHERE substr(name, 1, ?) = ?').all(prefix.length, prefix) as Array<{ name: string }>).map((r) => r.name)
  } finally {
    db.close()
  }
}
function tombstoned(name: string): boolean {
  const db = new DatabaseSync(DB_FILE, { readOnly: true })
  try {
    return !!db.prepare('SELECT 1 FROM document_tombstones WHERE name = ?').get(name)
  } finally {
    db.close()
  }
}

/** A workspace with Ada (owner) and Bob (member), both online in it. */
async function team(a: Page, context: Parameters<typeof newPerson>[0], name: string, hashA = '') {
  await person(a, 'ada')
  const wsId = await createWorkspace(a, name)
  const b = await newPerson(context)
  await person(b, 'bob')
  await joinWorkspace(a, b, wsId, 'member')
  await openApp(a, wsId, hashA)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)
  return { wsId, b }
}

/** A private page with text, a private database inside it with a row — all created like the UI does. */
async function privateSetup(a: Page) {
  const pageId = await a.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'Secret plan' })) // eslint-disable-line @typescript-eslint/no-explicit-any
  await gotoPage(a, pageId)
  await editorOf(a, pageId).click()
  await a.keyboard.type('TOP SECRET TEXT')
  const dbId = await wsEval(a, (s, parentId) => s.createDatabase({ parentId, title: 'Secret DB' }), pageId)
  const rowId = await wsEval(a, (s, dbId) => s.createRow(dbId, { title: 'Secret row' }), dbId)
  await expect.poll(() => wsEval(a, (s, ids) => ids.map((id: string) => !!s.pages[id]?.private), [pageId, dbId, rowId])).toEqual([true, true, true])
  return { pageId, dbId, rowId }
}

/** Nothing about the secret in Bob's tab: store, DOM. */
async function expectNoSecret(b: Page, ids: string[]) {
  expect(await wsEval(b, (s, ids) => ids.filter((id: string) => !!s.pages[id] || !!s.databases[id]), ids)).toEqual([])
  expect(await wsEval(b, (s) => JSON.stringify(Object.values(s.pages).map((p: any) => [p.title, p.plain, p.content])).includes('Secret'))).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(await b.content()).not.toContain('Secret plan')
  expect(await b.content()).not.toContain('TOP SECRET')
}

test.describe('team cloud — private pages', () => {
  test('a private page, its database and rows never reach another member', async ({ page: a, context }) => {
    const { wsId, b } = await team(a, context, 'Acme')
    const { pageId, dbId, rowId } = await privateSetup(a)

    // Ada: PRIVATE section with the page; the workspace section doesn't list it
    const priv = a.getByTestId('private-section')
    await expect(priv).toBeVisible()
    await expect(priv.locator('.sb-row__title', { hasText: 'Secret plan' })).toBeVisible()
    await expect(a.locator('.sb-section').first().locator('.sb-row__title', { hasText: 'Secret plan' })).toHaveCount(0)

    // a workspace page that mentions it — the mention arrives with a title (the editor's menu leaves
    // it out; a pasted / imported one carries it), the title must not travel
    const notes = await wsEval(a, (s, mention) => {
      const id = s.createPage({ title: 'Team notes' })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'mention', attrs: { id: mention, label: 'Secret plan', kind: 'page' } }] }] }, 'import')
      return id
    }, pageId)
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.title ?? null, notes), { timeout: 15_000 }).toBe('Team notes')

    // Bob: nothing in his store, his sidebar, his DOM
    await expectNoSecret(b, [pageId, dbId, rowId])
    await expect(b.getByTestId('private-section')).toBeVisible() // his own (empty) section
    await expect(b.getByTestId('private-section').locator('.sb-row')).toHaveCount(0)

    // the mention in the workspace page: "No access", and neither its label nor the search excerpt holds the title
    await gotoPage(b, notes)
    const chip = editorOf(b, notes).locator('.mention__page[data-no-access]')
    await expect(chip).toHaveText('No access')
    await expect.poll(() => wsEval(b, (s, id) => JSON.stringify(s.pages[id].content), notes), { timeout: 15_000 }).toContain('"label":""')
    expect(await wsEval(b, (s, id) => s.pages[id].plain, notes)).not.toContain('Secret')
    // Ada still sees it by its title
    await gotoPage(a, notes)
    await expect(editorOf(a, notes).locator('.mention__title')).toHaveText('Secret plan')
    await expectNoSecret(b, [pageId, dbId, rowId])

    // search (⌘K) finds nothing
    await b.keyboard.press(`${mod}+k`)
    await b.keyboard.type('Secret')
    await b.waitForTimeout(400)
    await expect(b.locator('[cmdk-item]', { hasText: /Secret (plan|DB|row)|TOP SECRET/ })).toHaveCount(0)
    await b.keyboard.press('Escape')

    // presence: on her private page Ada is in the workspace, but on no page; on a shared page Bob sees which
    await gotoPage(a, pageId)
    const adaId = await userId(a)
    await expect.poll(() => cloudEval(b, (c, id) => c.peers.filter((p: any) => p.userId === id).map((p: any) => p.pageId), adaId)).toEqual([null]) // eslint-disable-line @typescript-eslint/no-explicit-any
    await gotoPage(a, notes)
    await expect.poll(() => cloudEval(b, (c, id) => c.peers.filter((p: any) => p.userId === id).map((p: any) => p.pageId), adaId)).toEqual([notes]) // eslint-disable-line @typescript-eslint/no-explicit-any

    // the server never stored any of it under the workspace's names
    const ada = await userId(a)
    await expect.poll(() => stored(`ws:${wsId}:u:${ada}:p:${pageId}`).length, { timeout: 15_000 }).toBe(1)
    expect(stored(`ws:${wsId}:p:${pageId}`)).toEqual([])

    // a plain store move under the private page is refused (pages change documents only via a move)
    await wsEval(a, (s, [id, parent]) => s.movePage(id, parent), [notes, pageId])
    await expect.poll(() => wsEval(a, (s, id) => s.pages[id].parentId, notes)).toBe(null)
    await expect(a.locator('.toast', { hasText: 'Move to' })).toBeVisible()
    expect(await wsEval(b, (s, id) => (s.pages[id] ? s.pages[id].parentId : 'gone'), notes)).toBe(null)
    await b.context().close()
  })

  test('moving to the workspace shows it to everyone live; moving back takes it away again', async ({ page: a, context }) => {
    const { wsId, b } = await team(a, context, 'Moves')
    const { pageId, dbId, rowId } = await privateSetup(a)
    await expect.poll(() => wsEval(a, (s, id) => JSON.stringify(s.pages[id].content ?? ''), pageId)).toContain('TOP SECRET TEXT')
    const ada = await userId(a)

    // Ada: row menu → "Move to Moves" → confirmation names everyone
    const row = a.getByTestId('private-section').locator('.sb-row', { hasText: 'Secret plan' })
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
    await a.getByRole('menuitem', { name: 'Move to Moves' }).click()
    await expect(a.locator('.confirm__title')).toHaveText('Move “Secret plan” to Moves?')
    await expect(a.locator('.confirm__text')).toContainText('Everyone in Moves will see it')
    await a.getByRole('button', { name: 'Move to workspace' }).click()
    await expect(a.locator('.toast', { hasText: '“Secret plan” is in Moves now.' })).toBeVisible({ timeout: 20_000 })

    // Bob sees page, database and row live, with the content
    await expect.poll(() => wsEval(b, (s, ids) => ids.map((id: string) => s.pages[id]?.title ?? null), [pageId, dbId, rowId]), { timeout: 15_000 }).toEqual(['Secret plan', 'Secret DB', 'Secret row'])
    expect(await wsEval(b, (s, id) => !!s.pages[id].private, pageId)).toBe(false)
    await expect(b.locator('.sb-row__title', { hasText: 'Secret plan' })).toBeVisible()
    await gotoPage(b, pageId)
    await expect(editorOf(b, pageId)).toContainText('TOP SECRET TEXT')
    // Ada's side: it left her private section, the private content document is purged on the server
    expect(await wsEval(a, (s, ids) => ids.map((id: string) => !!s.pages[id].private), [pageId, dbId, rowId])).toEqual([false, false, false])
    await expect(a.getByTestId('private-section').locator('.sb-row', { hasText: 'Secret plan' })).toHaveCount(0)
    await expect.poll(() => stored(`ws:${wsId}:u:${ada}:p:${pageId}`), { timeout: 15_000 }).toEqual([])
    expect(tombstoned(`ws:${wsId}:u:${ada}:p:${pageId}`)).toBe(true)

    // Bob edits it while it is shared
    await editorOf(b, pageId).click()
    await b.keyboard.press(`${mod}+End`)
    await b.keyboard.type(' — seen by Bob')
    await expect.poll(() => wsEval(a, (s, id) => JSON.stringify(s.pages[id].content ?? ''), pageId), { timeout: 15_000 }).toContain('seen by Bob')

    // back to Private (drag & drop onto the PRIVATE section)
    await gotoPage(a, pageId)
    const src = a.locator('.sb-section').filter({ hasText: 'Pages' }).locator('.sb-row', { hasText: 'Secret plan' })
    const head = a.getByTestId('private-section').locator('.sb-sect')
    const from = (await src.boundingBox())!
    const to = (await head.boundingBox())!
    await a.mouse.move(from.x + 40, from.y + from.height / 2)
    await a.mouse.down()
    await a.mouse.move(from.x + 50, from.y + from.height / 2 + 10, { steps: 4 })
    await a.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 10 })
    await expect(head).toHaveAttribute('data-drop', 'true')
    await a.mouse.up()
    // the others lose it: asked first too
    await expect(a.locator('.confirm__title')).toHaveText('Make “Secret plan” private?')
    await expect(a.locator('.confirm__text')).toContainText('Everyone else in Moves loses access')
    await a.getByRole('button', { name: 'Make private' }).click()
    await expect(a.locator('.toast', { hasText: '“Secret plan” is private now.' })).toBeVisible({ timeout: 20_000 })

    // gone for Bob (he had it open), with everything below it; Ada keeps her text and Bob's edit
    await expect.poll(() => wsEval(b, (s, ids) => ids.filter((id: string) => !!s.pages[id]), [pageId, dbId, rowId]), { timeout: 15_000 }).toEqual([])
    await expect(editorOf(b, pageId)).toHaveCount(0)
    await expectNoSecret(b, [pageId, dbId, rowId])
    await expect(editorOf(a, pageId)).toContainText('TOP SECRET TEXT — seen by Bob')
    expect(await wsEval(a, (s, ids) => ids.map((id: string) => !!s.pages[id].private), [pageId, dbId, rowId])).toEqual([true, true, true])
    // the workspace's content documents are purged (and tombstoned); the private ones are back
    for (const id of [pageId, rowId]) {
      await expect.poll(() => stored(`ws:${wsId}:p:${id}`), { timeout: 15_000 }).toEqual([])
      expect(tombstoned(`ws:${wsId}:p:${id}`)).toBe(true)
    }
    await expect.poll(() => stored(`ws:${wsId}:u:${ada}:p:${pageId}`).length, { timeout: 15_000 }).toBe(1)

    // Ada keeps editing privately — nothing reaches Bob
    await editorOf(a, pageId).click()
    await a.keyboard.press(`${mod}+End`)
    await a.keyboard.type(' (private again)')
    await a.waitForTimeout(1500)
    await expectNoSecret(b, [pageId, dbId, rowId])
    await b.context().close()
  })

  test('offline edits of a private page sync on reconnect', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Offline')
    await openApp(a, wsId)
    await waitOnline(a)
    const { pageId } = await privateSetup(a)
    await expect.poll(() => wsEval(a, (s, id) => JSON.stringify(s.pages[id].content ?? ''), pageId)).toContain('TOP SECRET TEXT')
    await a.waitForTimeout(800)

    await a.context().setOffline(true)
    await expect.poll(() => cloudStatus(a)).toBe('offline')
    await editorOf(a, pageId).click()
    await a.keyboard.press(`${mod}+End`)
    await a.keyboard.type(' Written offline.')
    await wsEval(a, (s, id) => s.updatePage(id, { title: 'Secret plan (offline)' }), pageId)
    // moving needs the server: refused while offline, nothing changes
    const refused = await a.evaluate((id) => (window as any).__one.cloud.movePagePrivacy(id, false).then(() => 'moved', (e: any) => e.code), pageId) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(refused).toBe('offline')
    expect(await wsEval(a, (s, id) => !!s.pages[id].private, pageId)).toBe(true)
    await a.context().setOffline(false)
    await waitOnline(a)
    await expect.poll(() => cloudEval(a, () => (window as any).__one.cloud.useCloudSync.getState().unsynced), { timeout: 20_000 }).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

    // another browser of Ada's: everything there (from the server)
    const a2 = await newPerson(context)
    await person(a2, 'ada', wsId)
    await expect.poll(() => wsEval(a2, (s, id) => s.pages[id]?.title ?? null, pageId), { timeout: 15_000 }).toBe('Secret plan (offline)')
    expect(await wsEval(a2, (s, id) => !!s.pages[id].private, pageId)).toBe(true)
    await gotoPage(a2, pageId)
    await expect(editorOf(a2, pageId)).toContainText('TOP SECRET TEXT Written offline.')
    await a2.context().close()
  })

  test('viewers get no Private section to write in', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Readers')
    const v = await newPerson(context)
    await person(v, 'vera')
    await joinWorkspace(a, v, wsId, 'viewer')
    await openApp(a, wsId)
    await waitOnline(a)
    const { pageId } = await privateSetup(a)
    await openApp(v, wsId)
    await waitOnline(v)
    await expect(v.getByTestId('private-section')).toHaveCount(0)
    expect(await wsEval(v, (s, id) => !!s.pages[id], pageId)).toBe(false)
    // the API refuses to create one for a viewer
    const code = await v.evaluate(() => {
      try {
        ;(window as any).__one.cloud.createPrivatePage({ title: 'Nope' }) // eslint-disable-line @typescript-eslint/no-explicit-any
        return 'created'
      } catch (e) {
        return (e as { code?: string }).code
      }
    })
    expect(code).toBe('forbidden')
    await v.context().close()
  })
})
