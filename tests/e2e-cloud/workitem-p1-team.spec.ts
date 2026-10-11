/**
 * Task block P1 in a team workspace, against the real server:
 *  - the creation gate: GET /api/config answers `schema_min` (the schema gate's minimum); the app creates tasks in a
 *    team workspace only when it is ≥ 1 and the tab may write — a server without the gate (no `schema_min`) or a
 *    viewer's tab shuts it; the last answer is kept per device (localStorage `one.cloud.schemaMin`) for an offline
 *    boot; never heard → shut.
 *  - two members: an assignment shows on the other member's tab; a task's reminder rings only for its people,
 *    an unassigned one for both;
 *  - CONCURRENT field edits (one tab offline, then back): a status change and a people change on the same task are
 *    both kept — through the editor (delta-only setNodeMarkup) and through writeItems with no editor open (the
 *    bridge: keepYRefs); a whole-attrs write in the same race loses the other member's change (the negative control
 *    — the writer is the tab Yjs lets win a race, the one with the higher clientID); a bridge status write sets only
 *    `status` (+ `doneAt`) on the task's Y element;
 *  - a shared task never links a private one (the picker greys it, a paste drops the link + notice);
 *  - a viewer's and an outdated tab: no keys, writeItems refused; Y undo: a key press is its own undo step.
 * Fictional people and titles; the real server, no other host.
 */
import type { Page } from '@playwright/test'
import * as encoding from 'lib0/encoding'
import { test, expect, api, email, signIn, openApp, waitOnline, wsEval, cloudEval, createWorkspace, newPerson, join, gotoPage, editorOf, cloudStatus } from './fixtures'

const canCreate = (page: Page) => page.evaluate(() => (window as unknown as { __oneItems: { canCreate: () => boolean } }).__oneItems.canCreate())

type Attrs = { itemId: string; status: string; people: string[]; blockedBy: string[]; related: string[]; doneAt: number | null; due: string | null; reminder: string | null }
type WriteResult = { results: Array<{ itemId: string; ok: boolean; refused?: string; pageId?: string }>; unblocked: string[] }

const X = 'wi_teamtask01'
const Y = 'wi_teamtask02'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const item = (attrs: Record<string, unknown>, title: string) => ({ type: 'workItem', attrs, content: [p(title)] })
const doc = (...content: unknown[]) => ({ type: 'doc', content })

const meId = (page: Page) => cloudEval(page, (c) => c.user.id as string)
const write = (page: Page, edits: Array<{ itemId: string; patch: Record<string, unknown> }>, opts: Record<string, unknown> = {}) =>
  page.evaluate(({ edits, opts }) => (window as any).__oneItems.write(edits, opts) as WriteResult, { edits, opts }) // eslint-disable-line @typescript-eslint/no-explicit-any

/** A page with these blocks, written through the store (as the bridge writes any non-editor change). */
async function taskPage(page: Page, title: string, ...blocks: unknown[]): Promise<string> {
  const id = await wsEval(page, (s, title) => s.createPage({ title, parentId: null }) as string, title)
  await wsEval(page, (s, { id, d }) => s.setContent(id, d, 'e2e'), { id, d: doc(...blocks) })
  return id
}

/** The task's attrs in the page's live editor (null without the editor or the task). */
const editorTask = (page: Page, pageId: string, itemId: string) =>
  page.evaluate(
    ({ pageId, itemId }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${pageId}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      let hit: Attrs | null = null
      el?.editor.state.doc.descendants((n: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!hit && n.type.name === 'workItem' && n.attrs.itemId === itemId) hit = JSON.parse(JSON.stringify(n.attrs))
        return !hit
      })
      return hit as Attrs | null
    },
    { pageId, itemId },
  )

/** The task's attrs in the store. */
const storeTask = (page: Page, pageId: string, itemId: string) =>
  wsEval(
    page,
    (s, { pageId, itemId }) => {
      let hit: unknown = null
      const walk = (n: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (hit) return
        if (n.type === 'workItem' && n.attrs?.itemId === itemId) hit = n.attrs
        for (const c of n.content ?? []) walk(c)
      }
      if (s.pages[pageId]?.content) walk(s.pages[pageId].content)
      return hit as Attrs | null
    },
    { pageId, itemId },
  )

/** The Y.Doc clientID of a page's content document in this tab (the higher one wins a concurrent attribute write). */
const clientIdOf = (page: Page, pageId: string) =>
  page.evaluate((id) => {
    const cloud = (window as any).__one.cloud // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = cloud.acquireContentDoc(id)
    const c = h?.doc.clientID as number
    cloud.releaseContentDoc(id)
    return c
  }, pageId)

/** A person's write to the first task of a page's live editor, as its key / a picker does (commitItem). */
const commit = (page: Page, pageId: string, itemId: string, blockId: string, patch: Record<string, unknown>) =>
  page.evaluate(
    ({ pageId, itemId, blockId, patch }) => {
      const seam = (window as any).__oneItemsEditor // eslint-disable-line @typescript-eslint/no-explicit-any
      return seam.commit(pageId, { pos: seam.itemPos(pageId, 0), itemId, blockId }, patch) as boolean
    },
    { pageId, itemId, blockId, patch },
  )

/** The negative control: the WHOLE attrs object, structured-cloned, written back with one change (never do this). */
const rawWholeAttrs = (page: Page, pageId: string, itemId: string, status: string) =>
  page.evaluate(
    ({ pageId, itemId, status }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${pageId}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const ed = el.editor
      let at = -1
      ed.state.doc.descendants((n: any, pos: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (at < 0 && n.type.name === 'workItem' && n.attrs.itemId === itemId) at = pos
        return at < 0
      })
      const attrs = structuredClone(ed.state.doc.nodeAt(at).attrs)
      attrs.status = status
      attrs.doneAt = status === 'done' ? Date.now() : null
      ed.view.dispatch(ed.state.tr.setNodeMarkup(at, undefined, attrs))
    },
    { pageId, itemId, status },
  )

/** Two members of one workspace, both online: A (owner) and B (member). */
async function twoMembers(a: Page, name: string) {
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, name)
  const b = await newPerson(a.context())
  await signIn(b, email('bo'))
  await join(a, b, wsId)
  await openApp(a, wsId)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)
  const aId = await meId(a)
  const bId = await meId(b)
  // members are mirrored as people (account ids)
  await expect.poll(() => wsEval(a, (s) => (s.people as Array<{ id: string }>).map((p) => p.id))).toEqual(expect.arrayContaining([aId, bId]))
  return { wsId, b, aId, bId }
}

const synced = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).__one.cloud.useCloudSync.getState().unsynced), { timeout: 15_000 }).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe('tasks in a team workspace: the creation gate', () => {
  test('schema_min 1 → tasks can be made; a config without it (an older server) or a viewer shuts the gate; the answer is kept per device', async ({ page, context }) => {
    await signIn(page, email('gatemin'))
    const wsId = await createWorkspace(page, 'Gate minimum')
    const cfg = await api<{ schema_min?: number }>(page, 'GET', '/api/config')
    expect(cfg.json.schema_min).toBe(1)

    await openApp(page, wsId)
    await waitOnline(page)
    expect(await cloudEval(page, (c) => c.schemaMin)).toBe(1)
    expect(await canCreate(page)).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('one.cloud.schemaMin'))).toBe('1')

    // a server without the gate: its config has no schema_min → 0 → no creation (and remembered so)
    await page.route('**/api/config', async (route) => {
      const res = await route.fetch()
      const json = (await res.json()) as Record<string, unknown>
      delete json.schema_min
      await route.fulfill({ response: res, json })
    })
    await openApp(page, wsId)
    await waitOnline(page)
    expect(await cloudEval(page, (c) => c.schemaMin)).toBe(0)
    expect(await canCreate(page)).toBe(false)
    expect(await page.evaluate(() => localStorage.getItem('one.cloud.schemaMin'))).toBe('0')
    // … and the slash menu shows Task disabled with its reason
    const pid = await taskPage(page, 'Gate notes', p('Start here'))
    await gotoPage(page, pid)
    await editorOf(page, pid).locator('p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/task')
    const row = page.locator('.slash .slash__item').filter({ hasText: 'Task' }).first()
    await expect(row).toHaveAttribute('aria-disabled', 'true')
    await expect(row).toContainText('This server is older — update it to create tasks.')
    await page.keyboard.press('Escape')
    await page.unroute('**/api/config')

    // never heard on this device, and the config does not answer (offline boot): shut
    await page.evaluate(() => localStorage.removeItem('one.cloud.schemaMin'))
    await page.route('**/api/config', (route) => route.abort())
    await openApp(page, wsId)
    expect(await cloudEval(page, (c) => c.schemaMin)).toBeNull()
    expect(await canCreate(page)).toBe(false)
    await page.unroute('**/api/config')

    // a viewer's tab never creates one
    const guest = await newPerson(context)
    await signIn(guest, email('viewer'))
    await join(page, guest, wsId, 'viewer')
    await openApp(guest, wsId)
    await waitOnline(guest)
    expect(await cloudEval(guest, (c) => c.schemaMin)).toBe(1)
    expect(await canCreate(guest)).toBe(false)
    await guest.context().close()
  })
})

test.describe('tasks in a team workspace: people, reminders, concurrent writes', () => {
  test('A assigns B: B sees it; the reminder rings on B\'s tab only — an unassigned one on both', async ({ page: a }) => {
    const { wsId, b, bId } = await twoMembers(a, 'Launch crew')
    const pageId = await taskPage(a, 'Launch plan', item({ id: 'bx', itemId: X, due: '2031-10-17T09:00', reminder: 'at' }, 'Run the checkout with test cards'), item({ id: 'by', itemId: Y, due: '2031-10-17T09:00', reminder: 'at' }, 'Approve the final pricing copy'))
    // A assigns B (writeItems: no editor open on A)
    const r = await write(a, [{ itemId: X, patch: { people: { add: [bId] } } }], { by: 'person', toasts: false })
    expect(r.results[0]).toMatchObject({ ok: true, pageId })
    await synced(a)
    // B sees the assignment: the chip on the task
    await openApp(b, wsId, `/p/${pageId}`)
    await waitOnline(b)
    const ed = editorOf(b, pageId)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(2)
    await expect(ed.locator('[data-type="work-item"]').first().locator('.workitem__chip--person')).toHaveCount(1)
    await expect.poll(async () => (await editorTask(b, pageId, X))?.people).toEqual([bId])

    // who it rings for: B — and the unassigned one for both
    const ringing = (page: Page) => page.evaluate(() => ((window as any).__oneInbox.ringing() as Array<{ itemId?: string }>).map((r) => r.itemId).filter(Boolean).sort()) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect.poll(() => ringing(b)).toEqual([X, Y])
    await expect.poll(() => ringing(a)).toEqual([Y])
    // the time comes (a pass just before, one just after): B's inbox gets both, A's only the unassigned one
    const dueAt = await b.evaluate(() => (window as any).__oneInbox.codes.dueAt('2031-10-17T09:00', 'at') as number) // eslint-disable-line @typescript-eslint/no-explicit-any
    const fired = async (page: Page) => {
      await page.evaluate((t) => (window as any).__oneInbox.run(t), dueAt - 5_000) // eslint-disable-line @typescript-eslint/no-explicit-any
      await page.evaluate((t) => (window as any).__oneInbox.run(t), dueAt + 5_000) // eslint-disable-line @typescript-eslint/no-explicit-any
      return page.evaluate(() => ((window as any).__oneInbox.data().items as Array<{ id: string }>).map((i) => i.id).filter((id) => id.startsWith('r:w:')).sort()) // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    expect(await fired(b)).toEqual([`r:w:${X}:2031-10-17T09:00:at`, `r:w:${Y}:2031-10-17T09:00:at`])
    expect(await fired(a)).toEqual([`r:w:${Y}:2031-10-17T09:00:at`])
    await b.context().close()
  })

  test('concurrent status + people edits are both kept — editor and bridge paths; a whole-attrs write loses the other\'s change; a bridge status write sets only status (+ doneAt)', async ({ page: a }) => {
    const { wsId, b, aId, bId } = await twoMembers(a, 'Race track')
    const pageId = await taskPage(a, 'Launch plan', item({ id: 'bx', itemId: X }, 'Switch the pricing page live'), p('After the task.'))
    await synced(a)
    await gotoPage(a, pageId)
    await openApp(b, wsId, `/p/${pageId}`)
    await waitOnline(b)
    await expect(editorOf(b, pageId).locator('[data-type="work-item"]')).toHaveCount(1)
    await expect(editorOf(a, pageId).locator('[data-type="work-item"]')).toHaveCount(1)
    // the writer W whose concurrent attribute write Yjs keeps (higher clientID) — the other, L, changes people
    const [ca, cb] = [await clientIdOf(a, pageId), await clientIdOf(b, pageId)]
    expect(ca).not.toBe(cb)
    const [W, L, lPerson, wPerson] = ca > cb ? [a, b, bId, aId] : [b, a, aId, bId]
    const both = async (check: (t: Attrs | null) => boolean) => {
      for (const page of [a, b]) await expect.poll(async () => check(await editorTask(page, pageId, X)), { timeout: 20_000 }).toBe(true)
    }
    const offline = async (page: Page) => {
      await page.context().setOffline(true)
      await expect.poll(() => cloudStatus(page)).toBe('offline')
    }
    const online = async (page: Page) => {
      await page.context().setOffline(false)
      await waitOnline(page)
    }

    // 1) the editor path: W (offline) marks it in progress, L adds a person — both kept
    await offline(W)
    expect(await commit(W, pageId, X, 'bx', { status: 'in_progress' })).toBe(true)
    expect(await commit(L, pageId, X, 'bx', { people: { add: [lPerson] } })).toBe(true)
    await L.waitForTimeout(1200)
    await online(W)
    await both((t) => t?.status === 'in_progress' && t.people.join() === lPerson)

    // 2) the negative control: W writes the WHOLE attrs object (cloned) while L adds a person — L's change is lost
    await offline(W)
    await rawWholeAttrs(W, pageId, X, 'done')
    expect(await commit(L, pageId, X, 'bx', { people: { add: [wPerson] } })).toBe(true)
    await L.waitForTimeout(1200)
    await online(W)
    await both((t) => t?.status === 'done' && t.people.join() === lPerson)

    // 3) the bridge: W has NO editor on the page (it holds the page's document only to watch it); W (offline) sets the
    //    status through writeItems, L adds a person — both kept, and W's write set exactly status + doneAt
    await W.evaluate(() => (window.location.hash = '#/'))
    await expect(editorOf(W, pageId)).toHaveCount(0)
    await W.evaluate((id) => {
      const cloud = (window as any).__one.cloud // eslint-disable-line @typescript-eslint/no-explicit-any
      const h = cloud.acquireContentDoc(id)
      const seen: Array<{ node: string; keys: string[] }> = []
      ;(window as any).__keysSeen = seen // eslint-disable-line @typescript-eslint/no-explicit-any
      h.doc.getXmlFragment('default').observeDeep((events: any[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const e of events) if (e.attributesChanged?.size) seen.push({ node: e.target.nodeName, keys: [...e.attributesChanged].sort() })
      })
    }, pageId)
    await offline(W)
    const res = await write(W, [{ itemId: X, patch: { status: 'todo' } }], { by: 'system', toasts: false })
    expect(res.results[0]).toMatchObject({ ok: true, pageId })
    await expect.poll(() => W.evaluate(() => (window as any).__keysSeen), { timeout: 10_000 }).toEqual([{ node: 'workItem', keys: ['doneAt', 'status'] }]) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await commit(L, pageId, X, 'bx', { people: { add: [wPerson] } })).toBe(true)
    await L.waitForTimeout(1200)
    await online(W)
    await expect.poll(async () => (await editorTask(L, pageId, X))?.status, { timeout: 20_000 }).toBe('todo')
    await expect.poll(async () => (await editorTask(L, pageId, X))?.people.slice().sort().join(), { timeout: 20_000 }).toBe([lPerson, wPerson].sort().join())
    await expect.poll(async () => (await storeTask(W, pageId, X))?.people.slice().sort().join(), { timeout: 20_000 }).toBe([lPerson, wPerson].sort().join())
    expect((await storeTask(W, pageId, X))?.status).toBe('todo')
    await W.evaluate((id) => (window as any).__one.cloud.releaseContentDoc(id), pageId) // eslint-disable-line @typescript-eslint/no-explicit-any
    await b.context().close()
  })

  test('a shared task never links a private one: the picker greys it, a paste drops the link with a notice', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await signIn(page, email('priv'))
    const wsId = await createWorkspace(page, 'Private corner')
    await openApp(page, wsId)
    await waitOnline(page)
    const P1 = 'wi_privtask01'
    const P2 = 'wi_privtask02'
    const priv = await page.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'My notes' }) as string) // eslint-disable-line @typescript-eslint/no-explicit-any
    await wsEval(page, (s, { id, d }) => s.setContent(id, d, 'e2e'), { id: priv, d: doc(item({ id: 'p1', itemId: P1 }, 'Private prep'), item({ id: 'p2', itemId: P2, blockedBy: [P1] }, 'Private follow-up')) })
    const shared = await taskPage(page, 'Team plan', item({ id: 's1', itemId: X }, 'Shared launch'), p('Bottom line'))
    await expect.poll(() => page.evaluate((id) => (window as any).__oneItems.index().byId[id]?.private, P1)).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any

    // the picker on the shared task: the private one is there but greyed, with its reason
    await gotoPage(page, shared)
    await page.evaluate((id) => {
      const seam = (window as any).__oneItemsEditor // eslint-disable-line @typescript-eslint/no-explicit-any
      seam.openPicker(id, seam.itemPos(id, 0), 'blockedBy')
    }, shared)
    const dialog = page.getByRole('dialog', { name: 'Waits for' })
    await expect(dialog).toBeVisible()
    const row = dialog.getByRole('option', { name: /Private prep/ })
    await expect(row).toHaveAttribute('aria-disabled', 'true')
    await expect(row).toContainText('Private — a shared task can’t wait for it')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // copy the private follow-up (waits for the private prep) into the shared page: the link is left out
    await gotoPage(page, priv)
    const html = await page.evaluate((id) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      let at = -1
      el.editor.state.doc.descendants((n: any, pos: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (at < 0 && n.type.name === 'workItem' && n.attrs.itemId === 'wi_privtask02') at = pos
        return at < 0
      })
      el.editor.commands.focus()
      el.editor.commands.setNodeSelection(at)
      const dt = new DataTransfer()
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
      return dt.getData('text/html')
    }, priv)
    expect(html).toContain('work-item')
    await gotoPage(page, shared)
    await page.evaluate(({ id, html }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      let at = -1
      el.editor.state.doc.descendants((n: any, pos: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (at < 0 && n.isTextblock && n.textContent === 'Bottom line') at = pos + n.nodeSize - 1
        return at < 0
      })
      el.editor.commands.focus(at)
      const dt = new DataTransfer()
      dt.setData('text/html', html)
      dt.setData('text/plain', 'task')
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, { id: shared, html })
    await expect(page.locator('.toast', { hasText: '1 link to a private task was left out.' })).toBeVisible()
    const pasted = await page.evaluate((id) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const out: Attrs[] = []
      el.editor.state.doc.descendants((n: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (n.type.name === 'workItem') out.push(JSON.parse(JSON.stringify(n.attrs)))
        return !n.isTextblock
      })
      return out
    }, shared)
    expect(pasted).toHaveLength(2)
    expect(pasted[1].itemId).not.toBe(P2)
    expect(pasted[1].blockedBy).toEqual([])
  })

  test('a viewer\'s and an outdated tab: no keys, writeItems refused; Y undo: a key press is its own step', async ({ page: a, context }) => {
    const routes: Array<{ send: (m: Buffer) => void }> = []
    await a.routeWebSocket(/\/collab/, (ws) => {
      ws.connectToServer()
      routes.push(ws)
    })
    await signIn(a, email('ro'))
    const wsId = await createWorkspace(a, 'Read rules')
    await openApp(a, wsId)
    await waitOnline(a)
    const pageId = await taskPage(a, 'Launch plan', item({ id: 'bx', itemId: X }, 'Ship it'), p('After.'))
    await synced(a)

    // Y undo: typing, then a key press — Mod+Z takes back only the key press
    await gotoPage(a, pageId)
    const ed = editorOf(a, pageId)
    await ed.locator('[data-type="work-item"] p').first().click()
    await a.keyboard.press('End')
    await a.keyboard.type(' now')
    await a.waitForTimeout(600)
    await ed.locator('.workitem__key').first().click()
    await expect.poll(async () => (await editorTask(a, pageId, X))?.status).toBe('done')
    await a.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`)
    await expect.poll(async () => (await editorTask(a, pageId, X))?.status).toBe('todo')
    await expect(ed.locator('[data-type="work-item"] p').first()).toHaveText('Ship it now')
    await synced(a)

    // a viewer: the placard has no keys, writeItems refuses
    const v = await newPerson(context)
    await signIn(v, email('vera'))
    await join(a, v, wsId, 'viewer')
    await openApp(v, wsId, `/p/${pageId}`)
    await waitOnline(v)
    const vt = editorOf(v, pageId).locator('[data-type="work-item"]')
    await expect(vt).toHaveCount(1)
    await expect(vt).not.toHaveAttribute('data-interactive', '')
    await expect(vt.locator('button.workitem__key')).toHaveCount(0)
    expect((await write(v, [{ itemId: X, patch: { status: 'done' } }], { toasts: false })).results[0].refused).toBe('readonly')
    await v.context().close()

    // an outdated tab (the server's notice): no keys, writeItems refuses
    const enc = encoding.createEncoder()
    encoding.writeVarString(enc, `ws:${wsId}`)
    encoding.writeVarUint(enc, 5) // Stateless
    encoding.writeVarString(enc, JSON.stringify({ type: 'one.schema', status: 'outdated', min: 2 }))
    routes[routes.length - 1]!.send(Buffer.from(encoding.toUint8Array(enc)))
    await expect.poll(() => cloudEval(a, (c) => !!c.outdated)).toBe(true)
    await expect(ed.locator('[data-type="work-item"]')).not.toHaveAttribute('data-interactive', '')
    await expect(ed.locator('button.workitem__key')).toHaveCount(0)
    expect((await write(a, [{ itemId: X, patch: { status: 'done' } }], { toasts: false })).results[0].refused).toBe('outdated')
    expect(await canCreate(a)).toBe(false)
  })
})
