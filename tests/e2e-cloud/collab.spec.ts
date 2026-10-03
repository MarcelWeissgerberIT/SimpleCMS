/**
 * Team cloud, end to end against the real server: workspaces, the store ⇄ meta document binding,
 * live editor collaboration (Yjs over Hocuspocus), presence, Y undo, automations firing once,
 * offline edits, viewers, reloads and uploading the local workspace.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, waitForApp, wsEval, cloudEval, cloudStatus, waitOnline, gotoPage, editorOf, createWorkspace, join } from './fixtures'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/* Browser errors fail the test (quality bar: no console errors). Going offline on purpose makes
   the browser log failed requests / socket attempts — those are expected. */
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
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors.filter((e) => !EXPECTED.some((re) => re.test(e))), 'browser errors').toEqual([])
})

/** A signed-in person with the team workspace open. */
async function person(page: Page, name: string, wsId?: string): Promise<string> {
  watch(page, name)
  const address = email(name)
  await signIn(page, address)
  await api(page, 'PATCH', '/api/me', { name: name[0].toUpperCase() + name.slice(1) })
  if (wsId) {
    await openApp(page, wsId)
    await waitOnline(page)
  }
  return address
}

async function newPageWithText(page: Page, title: string): Promise<string> {
  const id = await wsEval(page, (s, title) => s.createPage({ title }), title)
  await gotoPage(page, id)
  return id
}

test.describe('team cloud — live collaboration', () => {
  test('a new team workspace opens empty; two people edit one page live', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Acme')

    // switch into it with the public API (persists the choice and reloads)
    await openApp(a)
    expect(await cloudStatus(a)).toBe('local')
    await a.evaluate((id) => (window as any).__one.cloud.switchWorkspace({ kind: 'cloud', id }), wsId) // eslint-disable-line @typescript-eslint/no-explicit-any
    await a.waitForURL((u) => !u.search.includes('w='))
    await waitForApp(a)
    await waitOnline(a)
    expect(await cloudEval(a, (c) => ({ kind: c.active.kind, id: c.active.id, role: c.role }))).toEqual({ kind: 'cloud', id: wsId, role: 'owner' })
    // nothing seeded: a fresh team workspace has no pages, databases or people but its members
    expect(await wsEval(a, (s) => Object.keys(s.pages).length)).toBe(0)
    expect(await wsEval(a, (s) => Object.keys(s.databases).length)).toBe(0)
    await expect.poll(() => wsEval(a, (s) => s.people.map((p: { name: string }) => p.name))).toEqual(['Ada'])

    // a colleague joins
    const b = await newPerson(context)
    await person(b, 'bob')
    await join(a, b, wsId)
    await openApp(b, wsId)
    await waitOnline(b)

    // A creates a page and types — B sees title and text live
    const pageId = await newPageWithText(a, 'Launch plan')
    await editorOf(a, pageId).click()
    await a.keyboard.type('Ship it on Monday')
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.title ?? null, pageId)).toBe('Launch plan')
    await gotoPage(b, pageId)
    await expect(editorOf(b, pageId)).toContainText('Ship it on Monday')
    await expect(b.locator('#main .pv-title')).toContainText('Launch plan')

    // both type in the same paragraph at the same time → both documents converge, nothing lost
    const para = (p: Page) => editorOf(p, pageId).locator('p').first()
    await para(a).click()
    await a.keyboard.press('End')
    await para(b).click()
    await b.keyboard.press('Home')
    await Promise.all([a.keyboard.type(' alpha alpha', { delay: 25 }), b.keyboard.type('bravo bravo ', { delay: 25 })])
    // the editor's text without other people's caret tags
    const textOf = (p: Page) =>
      editorOf(p, pageId).evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement
        copy.querySelectorAll('.collab-caret').forEach((c) => c.remove())
        return copy.textContent ?? ''
      })
    await expect
      .poll(async () => {
        const [ta, tb] = [await textOf(a), await textOf(b)]
        return ta === tb ? ta : `A: ${ta} | B: ${tb}`
      }, { timeout: 10_000 })
      .toContain('bravo bravo Ship it on Monday alpha alpha')
    expect(await textOf(a)).toBe(await textOf(b))

    // B's caret (a hairline with B's name) shows in A's editor
    const caret = editorOf(a, pageId).locator('.collab-caret')
    await expect(caret).toHaveCount(1)
    await expect(caret.locator('.collab-caret__label')).toHaveText('Bob')
    expect(await cloudEval(a, (c, id) => c.peers.filter((p: { pageId: string }) => p.pageId === id).map((p: { name: string }) => p.name), pageId)).toEqual(['Bob'])

    // undo only takes back your own typing
    await para(a).click()
    await a.keyboard.press('End')
    await a.keyboard.type(' Typo')
    await a.waitForTimeout(700)
    await b.keyboard.type('Kept ')
    await expect.poll(() => textOf(a)).toContain('bravo bravo Kept Ship')
    await a.keyboard.press(`${mod}+z`)
    await expect.poll(() => textOf(a)).toBe('bravo bravo Kept Ship it on Monday alpha alpha')
    await expect.poll(() => textOf(b)).toBe('bravo bravo Kept Ship it on Monday alpha alpha')

    // page.content in both stores follows the document (search, export, backlinks)
    await expect.poll(() => wsEval(a, (s, id) => s.pages[id].plain, pageId)).toContain('bravo bravo Kept Ship it on Monday alpha alpha')
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id].plain, pageId)).toContain('bravo bravo Kept Ship it on Monday alpha alpha')
  })

  test('database cells sync; an automation webhook fires exactly once, on the client that made the change', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Ops')
    await openApp(a, wsId)
    await waitOnline(a)
    const b = await newPerson(context)
    await person(b, 'bob')
    await join(a, b, wsId)
    await openApp(b, wsId)
    await waitOnline(b)

    // the webhook receiver, seen from both browsers
    const hits: Array<{ from: string; body: { event: string; changes: Array<{ to: string }> } }> = []
    for (const [who, p] of [['a', a], ['b', b]] as const) {
      await p.context().route('https://hooks.example.test/**', (route) => {
        const req = route.request()
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
        hits.push({ from: who, body: JSON.parse(req.postData() ?? '{}') })
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' })
      })
    }

    // A: a database, a row and an automation on its status
    const ids = await a.evaluate(() => {
      const ws = (window as any).__one.workspace // eslint-disable-line @typescript-eslint/no-explicit-any
      const dbId = ws.getState().createDatabase({ title: 'Tasks' })
      const status = ws.getState().databases[dbId].properties.find((p: { type: string }) => p.type === 'status')
      const rowId = ws.getState().createRow(dbId, { title: 'Write the spec' })
      ws.getState().updateDatabase(dbId, {
        automations: [
          { id: 'notify', name: 'Status changed', enabled: true, trigger: { type: 'property_changed', propertyId: status.id }, actions: [{ type: 'webhook', url: 'https://hooks.example.test/status', method: 'POST' }] },
        ],
      })
      return { dbId, rowId, statusId: status.id as string, options: status.options.map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })) as Array<{ id: string; name: string }> }
    })
    // B sees the database, the row and the automation
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.title ?? null, ids.rowId)).toBe('Write the spec')
    await expect.poll(() => wsEval(b, (s, id) => s.databases[id]?.automations?.length ?? 0, ids.dbId)).toBe(1)
    await expect.poll(() => wsEval(b, (s, id) => s.databases[id]?.properties.length ?? 0, ids.dbId)).toBe(4)

    // A changes a cell → B sees it; the webhook fires once, from A
    const [notStarted, inProgress, done] = ids.options
    await wsEval(a, (s, x) => s.setRowProperty(x.rowId, x.statusId, x.value), { rowId: ids.rowId, statusId: ids.statusId, value: done.id })
    await expect.poll(() => wsEval(b, (s, x) => s.pages[x.rowId].properties[x.statusId], ids)).toBe(done.id)
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBe(1)
    await b.waitForTimeout(2500)
    expect(hits.map((h) => h.from)).toEqual(['a'])
    expect(hits[0].body).toMatchObject({ event: 'property_changed', changes: [{ to: done.name }] })

    // B changes it back → once more, from B
    await wsEval(b, (s, x) => s.setRowProperty(x.rowId, x.statusId, x.value), { rowId: ids.rowId, statusId: ids.statusId, value: inProgress.id })
    await expect.poll(() => wsEval(a, (s, x) => s.pages[x.rowId].properties[x.statusId], ids)).toBe(inProgress.id)
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBe(2)
    await a.waitForTimeout(2500)
    expect(hits.map((h) => h.from)).toEqual(['a', 'b'])
    expect(notStarted).toBeTruthy()

    // the run status written by A's engine reaches B too
    await expect.poll(() => wsEval(b, (s, id) => s.databases[id].automations[0].lastStatus, ids.dbId)).toBe('ok')

    // the table on B shows A's row and value
    await b.evaluate((id) => (window.location.hash = `#/p/${id}`), ids.dbId)
    await expect(b.locator('#main section.db')).toContainText('Write the spec')
    await expect(b.locator('#main section.db')).toContainText(inProgress.name)
  })

  test('offline edits sync when the connection is back; viewers read only; a reload keeps everything', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Field')
    await openApp(a, wsId)
    await waitOnline(a)
    const b = await newPerson(context)
    await person(b, 'bob')
    await join(a, b, wsId)
    const v = await newPerson(context)
    await person(v, 'vera')
    await join(a, v, wsId, 'viewer')

    const pageId = await newPageWithText(a, 'Field notes')
    await editorOf(a, pageId).click()
    await a.keyboard.type('Before the tunnel.')
    await openApp(b, wsId, `/p/${pageId}`)
    await waitOnline(b)
    await expect(editorOf(b, pageId)).toContainText('Before the tunnel.')

    // A loses the connection and keeps working
    await a.context().setOffline(true)
    await expect.poll(() => cloudStatus(a)).toBe('offline')
    await editorOf(a, pageId).click()
    await a.keyboard.press(`${mod}+End`)
    await a.keyboard.press('Enter')
    await a.keyboard.type('Written offline.')
    await wsEval(a, (s, id) => s.updatePage(id, { title: 'Field notes (tunnel)' }), pageId)
    await b.waitForTimeout(1500)
    await expect(editorOf(b, pageId)).not.toContainText('Written offline.')
    expect(await wsEval(b, (s, id) => s.pages[id].title, pageId)).toBe('Field notes')

    // back online → B gets everything
    await a.context().setOffline(false)
    await waitOnline(a)
    await expect(editorOf(b, pageId)).toContainText('Written offline.', { timeout: 20_000 })
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id].title, pageId)).toBe('Field notes (tunnel)')

    // a viewer reads along but can't change anything
    await openApp(v, wsId, `/p/${pageId}`)
    await waitOnline(v)
    expect(await cloudEval(v, (c) => ({ role: c.role, readOnly: c.readOnly }))).toEqual({ role: 'viewer', readOnly: true })
    await expect(editorOf(v, pageId)).toContainText('Written offline.')
    await expect(editorOf(v, pageId)).toHaveAttribute('contenteditable', 'false')
    await editorOf(v, pageId).click()
    await v.keyboard.type('Viewer was here')
    await wsEval(v, (s, id) => s.updatePage(id, { title: 'Hijacked' }), pageId)
    await expect.poll(() => wsEval(v, (s, id) => s.pages[id].title, pageId)).toBe('Field notes (tunnel)')
    await a.waitForTimeout(1500)
    expect(await wsEval(a, (s, id) => s.pages[id].title, pageId)).toBe('Field notes (tunnel)')
    await expect(editorOf(a, pageId)).not.toContainText('Viewer was here')

    // a reload keeps everything (local copy + server)
    await a.reload()
    await waitForApp(a)
    await waitOnline(a)
    expect(await wsEval(a, (s, id) => s.pages[id]?.title, pageId)).toBe('Field notes (tunnel)')
    await gotoPage(a, pageId)
    await expect(editorOf(a, pageId)).toContainText('Before the tunnel.')
    await expect(editorOf(a, pageId)).toContainText('Written offline.')
    // and a person who never opened the page gets it from the server
    const c = await newPerson(context)
    await person(c, 'cleo')
    await join(a, c, wsId)
    await openApp(c, wsId)
    await waitOnline(c)
    await expect.poll(() => wsEval(c, (s, id) => s.pages[id]?.plain ?? '', pageId), { timeout: 20_000 }).toContain('Written offline.')
  })

  test('uploading the local (demo) workspace copies pages, databases, rows and content', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Imported')
    await openApp(a)
    // the local demo workspace
    await expect.poll(() => wsEval(a, (s) => Object.keys(s.pages).length)).toBeGreaterThan(5)
    const local = await wsEval(a, (s) => {
      const pages = Object.values(s.pages) as Array<{ id: string; title: string; plain?: string; databaseId: string | null; trashed: boolean }>
      const start = s.settings.startPageId as string
      return {
        count: pages.length,
        dbs: Object.keys(s.databases).length,
        rows: pages.filter((p) => p.databaseId).length,
        start,
        startTitle: s.pages[start]?.title as string,
        startText: (s.pages[start]?.plain ?? '').slice(0, 60) as string,
      }
    })
    const progress = await a.evaluate(async (id) => {
      const seen: number[] = []
      await (window as any).__one.cloud.uploadLocalWorkspace(id, (p: number) => seen.push(p)) // eslint-disable-line @typescript-eslint/no-explicit-any
      return seen
    }, wsId)
    expect(progress.at(-1)).toBe(1)
    // a second upload into the same (no longer empty) workspace is refused
    const again = await a.evaluate(async (id) => {
      try {
        await (window as any).__one.cloud.uploadLocalWorkspace(id) // eslint-disable-line @typescript-eslint/no-explicit-any
        return 'ok'
      } catch (e) {
        return (e as { code?: string }).code
      }
    }, wsId)
    expect(again).toBe('workspace_not_empty')

    // a colleague on another device sees all of it
    const b = await newPerson(context)
    await person(b, 'bob')
    await join(a, b, wsId)
    await openApp(b, wsId)
    await waitOnline(b)
    await expect.poll(() => wsEval(b, (s) => Object.keys(s.pages).length)).toBe(local.count)
    expect(await wsEval(b, (s) => Object.keys(s.databases).length)).toBe(local.dbs)
    expect(await wsEval(b, (s) => (Object.values(s.pages) as Array<{ databaseId: string | null }>).filter((p) => p.databaseId).length)).toBe(local.rows)
    expect(await wsEval(b, (s, id) => s.pages[id]?.title, local.start)).toBe(local.startTitle)
    await expect.poll(() => wsEval(b, (s, id) => (s.pages[id]?.plain ?? '').slice(0, 60), local.start), { timeout: 20_000 }).toBe(local.startText)
    await gotoPage(b, local.start)
    await expect(editorOf(b, local.start)).toContainText(local.startText.split('\n')[0].slice(0, 30))
    // the local workspace is untouched
    expect(await wsEval(a, (s) => Object.keys(s.pages).length)).toBe(local.count)
  })
})
