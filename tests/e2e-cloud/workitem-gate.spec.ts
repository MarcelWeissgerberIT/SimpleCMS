/**
 * Schema gate (docs/CLOUD.md § Schema gate) and the task block in a team workspace, against the real server:
 *  - the app connects with its document schema generation (`/collab?schema=1`) and edits normally;
 *  - a connection WITHOUT the number (an older build) reads a page but cannot change it — its delete of the task
 *    block it does not know never reaches the server;
 *  - the public API prints a task as its title + notes;
 *  - a tab the server finds outdated (its stateless notice) turns read-only and offers "Reload to keep editing";
 *    a reload brings the editor back;
 *  - local copies are per schema generation: the copy an older build left in this browser (holding its deletion
 *    of the task) is never replayed — its unconfirmed text edits are taken over, the task stays;
 *  - a task stored inside another task (a raw writer) and opened by two tabs at once is not doubled (no repair
 *    on mount in a shared document);
 *  - a write into a page this device has no copy of waits for the server (held, one record per hold): one tab's
 *    record is never written by another tab while the first lives — with Web Locks and without them (a server on
 *    plain http: the tabs ask each other) — two tabs' records never overwrite each other, and a record cut short by
 *    a role change stays until a boot that may write writes it (a later write never takes it along).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import { test, expect, api, email, signIn, openApp, waitForApp, waitOnline, wsEval, cloudEval, createWorkspace, gotoPage, editorOf, newPerson, join } from './fixtures'

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const task = (title: string, note: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before the tasks.' }] },
    {
      type: 'workItem',
      attrs: { itemId: 'wi_7f3a9c2d01', status: 'in_progress', due: '2031-10-17' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: title }] },
        { type: 'paragraph', content: [{ type: 'text', text: note }] },
      ],
    },
  ],
})

/** A collab client in Node with this page's session — as an older build (no ?schema=) or as `schema`. */
async function rawClient(page: Page, name: string, schema: number | null) {
  const origin = new URL(page.url()).origin
  const cookie = (await page.context().cookies(origin)).map((c) => `${c.name}=${c.value}`).join('; ')
  const headers = { cookie, origin }
  class CookieWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers } as unknown as string[])
    }
  }
  const url = `${origin.replace(/^http/, 'ws')}/collab${schema === null ? '' : `?schema=${schema}`}`
  const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 })
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc })
  const scope = new Promise<string>((resolve, reject) => {
    provider.on('authenticated', ({ scope }: { scope: string }) => resolve(scope))
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)))
  })
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  provider.attach()
  return {
    doc,
    scope,
    synced,
    destroy() {
      provider.destroy()
      socket.destroy()
    },
  }
}

/** Node names at the top of a page document. */
const names = (doc: Y.Doc) => doc.getXmlFragment('default').toArray().map((n) => (n as Y.XmlElement).nodeName)

/** A paragraph as y-prosemirror stores it. */
function yPara(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, text)
  p.insert(0, [t])
  return p
}

/** Write a Y update into a y-indexeddb database of this origin (as y-indexeddb stores it: one row per update). */
async function writeYCopy(page: Page, name: string, update: Uint8Array): Promise<void> {
  await page.evaluate(
    async ({ name, update }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name)
        r.onupgradeneeded = () => {
          const d = r.result
          if (!d.objectStoreNames.contains('updates')) d.createObjectStore('updates', { autoIncrement: true })
          if (!d.objectStoreNames.contains('custom')) d.createObjectStore('custom')
        }
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('updates', 'readwrite')
        tx.objectStore('updates').add(new Uint8Array(update))
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      })
      db.close()
    },
    { name, update: Array.from(update) as unknown as Uint8Array },
  )
}

const dbNames = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''))

/** What an older tab noted: the page has changes the server has not confirmed (cloud/local.ts overlay `pending`). */
const markPending = (page: Page, wsId: string, pageId: string) =>
  page.evaluate(
    async ({ wsId, pageId }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('one-cloud')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('kv', 'readwrite')
        const store = tx.objectStore('kv')
        const q = store.get(`overlay:${wsId}`)
        q.onsuccess = () => {
          const o = q.result ?? { settings: null, favorites: [], recent: [], pending: [] }
          store.put({ ...o, pending: [...(o.pending ?? []), pageId] }, `overlay:${wsId}`)
        }
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      })
      db.close()
    },
    { wsId, pageId },
  )

/** One value of this origin's `one-cloud` kv store (cloud/local.ts). */
const cloudValue = (page: Page, key: string) =>
  page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-cloud')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      return await new Promise<unknown>((res, rej) => {
        const q = db.transaction('kv', 'readonly').objectStore('kv').get(key)
        q.onsuccess = () => res(q.result ?? null)
        q.onerror = () => rej(q.error)
      })
    } finally {
      db.close()
    }
  }, key)

/** The pages this device notes as not confirmed by the server. */
const pendingOf = async (page: Page, wsId: string) => (((await cloudValue(page, `overlay:${wsId}`)) as { pending?: string[] } | null)?.pending ?? [])

/** Writes held for a page's first server sync (content.ts holdWrite): their `held:<ws>:<page>:<rid>` keys. */
const heldKeys = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-cloud')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      const keys = await new Promise<IDBValidKey[]>((res, rej) => {
        const q = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys()
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      return keys.map(String).filter((k) => k.startsWith('held:'))
    } finally {
      db.close()
    }
  })

/** The held records of one page. */
const heldFor = async (page: Page, wsId: string, pageId: string) => (await heldKeys(page)).filter((k) => k.startsWith(`held:${wsId}:${pageId}:`))

/** This browser without Web Locks (no secure context: a team server on plain http; Safari before 15.4) — every tab. */
const withoutLocks = (context: BrowserContext) =>
  context.addInitScript(() => {
    delete (Navigator.prototype as unknown as { locks?: unknown }).locks
  })

/** A non-editor writer (AI, a template …) adds a line at the end of a page. */
const addLine = (page: Page, pageId: string, text: string) =>
  wsEval(
    page,
    (s, { id, text }) => {
      const c = s.pages[id].content ?? { type: 'doc', content: [] }
      s.setContent(id, { ...c, content: [...(c.content ?? []), { type: 'paragraph', content: [{ type: 'text', text }] }] }, 'ai')
    },
    { id: pageId, text },
  )

/**
 * A page whose text this device knows (the content cache) but whose document it has no copy of — as for a page never
 * opened here: a new one with `lines`, or one that exists with `text` (synced in the background), then this
 * generation's copy of its document goes. The tab is left on the landing page.
 */
async function blindPage(page: Page, wsId: string, spec: { title: string; lines: string[] } | { existing: string; text: string }): Promise<{ pageId: string; docName: string }> {
  await openApp(page, wsId)
  await waitOnline(page)
  const pageId = 'existing' in spec ? spec.existing : await wsEval(page, (s, title) => s.createPage({ title, parentId: null }) as string, spec.title)
  if ('lines' in spec) for (const line of spec.lines) await addLine(page, pageId, line)
  const text = 'text' in spec ? spec.text : spec.lines[spec.lines.length - 1]!
  const docName = `ws:${wsId}:p:${pageId}`
  await expect.poll(async () => JSON.stringify(((await cloudValue(page, `content:${wsId}:${pageId}`)) as { json?: unknown } | null)?.json ?? null), { timeout: 20_000 }).toContain(text)
  const origin = new URL(page.url()).origin
  await page.goto(`${origin}/`)
  await page.evaluate(
    (n) =>
      new Promise<void>((res) => {
        const r = indexedDB.deleteDatabase(n)
        r.onsuccess = r.onerror = r.onblocked = () => res()
      }),
    `one:g1:${docName}`,
  )
  return { pageId, docName }
}

/**
 * The collab socket refused until `open()`: the app boots and opens page documents before the server answers
 * (a slow first connection) — the socket retries by itself (socket.ts: 1 s, 2 s …).
 */
async function lateSocket(page: Page): Promise<{ open: () => void }> {
  let open = false
  await page.routeWebSocket(/\/collab/, (ws) => {
    if (open) ws.connectToServer()
    else ws.close()
  })
  return { open: () => void (open = true) }
}

/**
 * The collab sockets of these pages connect, but what the pages send is held until `open()` — then all of it goes
 * at once: every tab gets the server's state at the same moment (a slow server answering several tabs).
 */
async function heldSockets(pages: Page[]): Promise<{ open: () => void }> {
  let open = false
  const flushers: Array<() => void> = []
  for (const p of pages) {
    await p.routeWebSocket(/\/collab/, (ws) => {
      const server = ws.connectToServer()
      const queue: Array<string | Buffer> = []
      ws.onMessage((m) => (open ? server.send(m) : queue.push(m)))
      server.onMessage((m) => ws.send(m))
      flushers.push(() => queue.splice(0).forEach((m) => server.send(m)))
    })
  }
  return {
    open: () => {
      open = true
      flushers.forEach((f) => f())
    },
  }
}

const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1

/** The server's API text of a page (a read token made by the signed-in owner). */
async function apiText(page: Page, token: string, pageId: string): Promise<string> {
  const res = await page.request.get(`/api/v1/pages/${pageId}`, { headers: bearer(token) })
  return res.ok() ? (((await res.json()) as { text?: string }).text ?? '') : `HTTP ${res.status()}`
}

test.describe('schema gate + task block (team cloud)', () => {
  test('the app writes with schema=1; an older connection reads but cannot delete the task; the API prints title + notes', async ({ page }) => {
    const sockets: string[] = []
    page.on('websocket', (ws) => sockets.push(ws.url()))
    await signIn(page, email('gate'))
    const wsId = await createWorkspace(page, 'Gate HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    expect(sockets.some((u) => /\/collab\?schema=1$/.test(u)), sockets.join(', ')).toBe(true)
    expect(await cloudEval(page, (c) => ({ readOnly: c.readOnly, outdated: !!c.outdated }))).toEqual({ readOnly: false, outdated: false })

    // a page with a task (injected through the store — nothing in the UI creates one yet)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Launch plan', parentId: null }) as string)
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: task('Ship the pricing page', 'The last draft is in the wiki.') })
    await gotoPage(page, pageId)
    const ed = editorOf(page, pageId)
    await expect(ed.locator('.workitem')).toHaveCount(1)
    // the current client edits normally: the title, typed
    await ed.locator('.workitem p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' now')
    await expect.poll(() => page.evaluate(() => (window as any).__one.cloud.useCloudSync.getState().unsynced), { timeout: 15_000 }).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

    // the public API prints the task as its blocks: title + notes
    const token = await api<{ token: string }>(page, 'POST', `/api/workspaces/${wsId}/tokens`, { name: 'Reader', scope: 'read' })
    expect(token.status).toBe(201)
    await expect.poll(() => apiText(page, token.json.token, pageId), { timeout: 15_000 }).toMatch(/Before the tasks\.\nShip the pricing page now\nThe last draft is in the wiki\./)

    // an older build (no schema number): reads the page, live — but what it does never reaches the server
    const old = await rawClient(page, `ws:${wsId}:p:${pageId}`, null)
    try {
      expect(await old.scope).toBe('readonly')
      await old.synced
      const frag = old.doc.getXmlFragment('default')
      await expect.poll(() => frag.toArray().map((n) => (n as Y.XmlElement).nodeName)).toContain('workItem')
      // what y-prosemirror does with a node its schema does not know: it deletes it
      const at = frag.toArray().findIndex((n) => (n as Y.XmlElement).nodeName === 'workItem')
      frag.delete(at, 1)
      await page.waitForTimeout(1200)
      await expect(ed.locator('.workitem')).toHaveCount(1)
      await expect(ed.locator('.workitem p').first()).toHaveText('Ship the pricing page now')
      expect(await apiText(page, token.json.token, pageId)).toMatch(/Ship the pricing page now\nThe last draft is in the wiki\./)
    } finally {
      old.destroy()
    }

    // a client with the current number may write (the gate is not a wall for everyone)
    const current = await rawClient(page, `ws:${wsId}:p:${pageId}`, 1)
    try {
      expect(await current.scope).toBe('read-write')
    } finally {
      current.destroy()
    }
    // the meta document: the same rule
    const oldMeta = await rawClient(page, `ws:${wsId}`, null)
    try {
      expect(await oldMeta.scope).toBe('readonly')
    } finally {
      oldMeta.destroy()
    }
  })

  test('the server says the tab is outdated: read-only, "Reload to keep editing"; a reload brings the editor back', async ({ page }) => {
    const routes: Array<{ send: (m: Buffer) => void; url: () => string }> = []
    await page.routeWebSocket(/\/collab/, (ws) => {
      ws.connectToServer()
      routes.push(ws)
    })
    await signIn(page, email('outdated'))
    const wsId = await createWorkspace(page, 'Outdated HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Read me', parentId: null }) as string)
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: task('A task to read', 'Notes stay readable.') })
    await gotoPage(page, pageId)
    const ed = editorOf(page, pageId)
    await expect(ed).toHaveAttribute('contenteditable', 'true')

    // the server's notice (server/src/collab/schema-gate.ts) on the meta document of this socket
    const enc = encoding.createEncoder()
    encoding.writeVarString(enc, `ws:${wsId}`)
    encoding.writeVarUint(enc, 5) // Stateless
    encoding.writeVarString(enc, JSON.stringify({ type: 'one.schema', status: 'outdated', min: 2 }))
    routes[routes.length - 1]!.send(Buffer.from(encoding.toUint8Array(enc)))

    await expect.poll(() => cloudEval(page, (c) => ({ readOnly: c.readOnly, outdated: !!c.outdated }))).toEqual({ readOnly: true, outdated: true })
    const key = page.getByTestId('outdated-reload')
    await expect(key).toBeVisible()
    await expect(key).toContainText('Reload to keep editing')
    await expect(page.getByText('This tab is out of date and now read-only. Reload to keep editing.')).toBeVisible()
    await expect(ed).toHaveAttribute('contenteditable', 'false')
    await expect(ed.locator('.workitem p').first()).toHaveText('A task to read')
    await expect(page.locator('.status__ro')).toHaveText('Outdated · read only')

    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(key).toContainText('Neu laden, um weiter zu bearbeiten')
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))

    // reload (the key): a current tab again
    await Promise.all([page.waitForEvent('load'), key.click()])
    await waitForApp(page)
    await expect.poll(() => cloudEval(page, (c) => c.status as string), { timeout: 20_000 }).toBe('online')
    expect(await cloudEval(page, (c) => ({ readOnly: c.readOnly, outdated: !!c.outdated }))).toEqual({ readOnly: false, outdated: false })
    await gotoPage(page, pageId)
    await expect(editorOf(page, pageId)).toHaveAttribute('contenteditable', 'true')
  })

  test('the copy of a page an older build left in this browser never deletes its task on the server', async ({ page }) => {
    await signIn(page, email('stale'))
    const wsId = await createWorkspace(page, 'Stale HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Launch plan', parentId: null }) as string)
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: task('Ship the pricing page', 'The last draft is in the wiki.') })
    const docName = `ws:${wsId}:p:${pageId}`
    const reader = await rawClient(page, docName, 1)
    await reader.synced
    await expect.poll(() => names(reader.doc)).toContain('workItem')
    // what a tab of an older build (before generation 1) kept of the page: the task deleted (y-prosemirror)
    const stale = new Y.Doc()
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(reader.doc))
    reader.destroy()
    const frag = stale.getXmlFragment('default')
    frag.delete(names(stale).indexOf('workItem'), 1)
    const origin = new URL(page.url()).origin
    // a page of this origin that is not the app (the app is closed while the older copy is written)
    await page.goto(`${origin}/`)
    await writeYCopy(page, `one:${docName}`, Y.encodeStateAsUpdate(stale))

    // this build opens the page: its own generation's copy — the older one is never replayed, and goes
    await openApp(page, wsId)
    await waitOnline(page)
    await gotoPage(page, pageId)
    await expect(editorOf(page, pageId).locator('.workitem')).toHaveCount(1)
    await expect.poll(() => dbNames(page)).not.toContain(`one:${docName}`)
    expect(await dbNames(page)).toContain(`one:g1:${docName}`)
    await page.waitForTimeout(1000)
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      expect(names(check.doc)).toContain('workItem')
    } finally {
      check.destroy()
    }
  })

  test('unconfirmed edits in a copy an older build left are taken over — its deletion of the task is not', async ({ page }) => {
    await signIn(page, email('pending'))
    const wsId = await createWorkspace(page, 'Pending HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Offline plan', parentId: null }) as string)
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: task('Ship the pricing page', 'Notes.') })
    const docName = `ws:${wsId}:p:${pageId}`
    const reader = await rawClient(page, docName, 1)
    await reader.synced
    await expect.poll(() => names(reader.doc)).toContain('workItem')
    // the older tab: it deleted the task (it could not read it) and the person typed a line — offline, unconfirmed
    const stale = new Y.Doc()
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(reader.doc))
    reader.destroy()
    const frag = stale.getXmlFragment('default')
    frag.delete(names(stale).indexOf('workItem'), 1)
    frag.insert(frag.length, [yPara('Typed offline in the older tab.')])
    const origin = new URL(page.url()).origin
    // a page of this origin that is not the app (the app is closed while the older copy is written)
    await page.goto(`${origin}/`)
    await writeYCopy(page, `one:${docName}`, Y.encodeStateAsUpdate(stale))
    // …and it noted the page as having changes the server has not confirmed (cloud/local.ts overlay)
    await markPending(page, wsId, pageId)

    await openApp(page, wsId)
    await waitOnline(page)
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      await expect.poll(() => check.doc.getXmlFragment('default').toString(), { timeout: 20_000 }).toContain('Typed offline in the older tab.')
      expect(names(check.doc)).toContain('workItem')
    } finally {
      check.destroy()
    }
    await gotoPage(page, pageId)
    await expect(editorOf(page, pageId).locator('.workitem')).toHaveCount(1)
    await expect(editorOf(page, pageId)).toContainText('Typed offline in the older tab.')
    await expect.poll(() => dbNames(page)).not.toContain(`one:${docName}`)
  })

  test('a first sync that comes late: the older copy waits for it, is taken over once, and goes only after; pending stays until then', async ({ page }) => {
    await signIn(page, email('late'))
    const wsId = await createWorkspace(page, 'Late HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Late plan', parentId: null }) as string)
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: task('Ship the pricing page', 'Notes.') })
    const docName = `ws:${wsId}:p:${pageId}`
    const reader = await rawClient(page, docName, 1)
    await reader.synced
    await expect.poll(() => names(reader.doc)).toContain('workItem')
    // the older tab: the task deleted (it could not read it), a line typed — offline, unconfirmed, noted as pending
    const stale = new Y.Doc()
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(reader.doc))
    reader.destroy()
    const frag = stale.getXmlFragment('default')
    frag.delete(names(stale).indexOf('workItem'), 1)
    frag.insert(frag.length, [yPara('Typed before the update.')])
    const origin = new URL(page.url()).origin
    await page.goto(`${origin}/`)
    await writeYCopy(page, `one:${docName}`, Y.encodeStateAsUpdate(stale))
    await markPending(page, wsId, pageId)
    // right after the update there is no copy of this build's generation yet (this one was made by the setup above)
    await page.evaluate((n) => new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(n)
      r.onsuccess = r.onerror = r.onblocked = () => res()
    }), `one:g1:${docName}`)

    // the collab socket gets in only later: the page's document opens (and is looked at) before the server answers
    const socket = await lateSocket(page)
    await openApp(page, wsId, `/p/${pageId}`)
    await expect(page.getByTestId('waiting-doc')).toBeVisible()
    await expect(page.getByTestId('waiting-doc')).toContainText('Ship the pricing page')
    await expect(editorOf(page, pageId)).toHaveCount(0)
    await page.waitForTimeout(2500)
    // nothing judged without the server: the copy and the page's pending stay
    expect(await dbNames(page)).toContain(`one:${docName}`)
    expect(await pendingOf(page, wsId)).toContain(pageId)

    socket.open()
    await waitOnline(page)
    const ed = editorOf(page, pageId)
    await expect(ed).toBeVisible()
    await expect(ed).toHaveAttribute('contenteditable', 'true')
    await expect(ed.locator('.workitem')).toHaveCount(1)
    await expect(ed).toContainText('Typed before the update.')
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      await expect.poll(() => occurrences(check.doc.getXmlFragment('default').toString(), 'Typed before the update.'), { timeout: 15_000 }).toBe(1)
      expect(names(check.doc)).toContain('workItem')
    } finally {
      check.destroy()
    }
    // gone after its takeover, and the page confirmed after that
    await expect.poll(() => dbNames(page)).not.toContain(`one:${docName}`)
    await expect.poll(() => pendingOf(page, wsId), { timeout: 15_000 }).not.toContain(pageId)

    // a reload takes nothing over a second time
    await page.reload()
    await waitForApp(page)
    await waitOnline(page)
    await gotoPage(page, pageId)
    await page.waitForTimeout(1500)
    const again = await rawClient(page, docName, 1)
    try {
      await again.synced
      expect(occurrences(again.doc.getXmlFragment('default').toString(), 'Typed before the update.')).toBe(1)
    } finally {
      again.destroy()
    }
    expect(occurrences(await editorOf(page, pageId).innerText(), 'Typed before the update.')).toBe(1)
  })

  test('two tabs of the update open the same older copy at once: its merged edits come once', async ({ page }) => {
    await signIn(page, email('twotabs'))
    const wsId = await createWorkspace(page, 'Two tabs HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Twice', parentId: null }) as string)
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: task('Ship the pricing page', 'Notes.') })
    const docName = `ws:${wsId}:p:${pageId}`
    const reader = await rawClient(page, docName, 1)
    await reader.synced
    await expect.poll(() => names(reader.doc)).toContain('workItem')
    // the older tab deleted the task (so its edits are merged, not replayed) and typed a line
    const stale = new Y.Doc()
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(reader.doc))
    reader.destroy()
    const frag = stale.getXmlFragment('default')
    frag.delete(names(stale).indexOf('workItem'), 1)
    frag.insert(frag.length, [yPara('Typed in the older tab.')])
    const origin = new URL(page.url()).origin
    await page.goto(`${origin}/`)
    await writeYCopy(page, `one:${docName}`, Y.encodeStateAsUpdate(stale))
    await markPending(page, wsId, pageId)
    await page.evaluate((n) => new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(n)
      r.onsuccess = r.onerror = r.onblocked = () => res()
    }), `one:g1:${docName}`)

    // two tabs of this browser on the page, both waiting for the server — which answers both at the same moment
    const second = await page.context().newPage()
    const server = await heldSockets([page, second])
    await Promise.all([page, second].map((p) => p.goto(`/app/?e2e&w=${wsId}#/p/${pageId}`)))
    await Promise.all([page, second].map((p) => waitForApp(p)))
    for (const p of [page, second]) await expect(p.getByTestId('waiting-doc')).toBeVisible()
    server.open()
    await Promise.all([page, second].map((p) => waitOnline(p)))
    for (const p of [page, second]) await expect(editorOf(p, pageId)).toContainText('Typed in the older tab.')
    await page.waitForTimeout(2500)
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      const xml = check.doc.getXmlFragment('default').toString()
      expect(occurrences(xml, 'Typed in the older tab.')).toBe(1)
      expect(names(check.doc).filter((n) => n === 'workItem')).toHaveLength(1)
    } finally {
      check.destroy()
    }
    for (const p of [page, second]) expect(occurrences(await editorOf(p, pageId).innerText(), 'Typed in the older tab.')).toBe(1)
    await expect.poll(() => dbNames(page)).not.toContain(`one:${docName}`)
    await second.close()
  })

  test('a write into a page this device has no copy of waits for the server — kept over a reload, then merged once', async ({ page }) => {
    await signIn(page, email('blind'))
    const wsId = await createWorkspace(page, 'Blind HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Blind plan', parentId: null }) as string)
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id: pageId, doc: { type: 'doc', content: [para('First line.'), para('Second line.')] } })
    const docName = `ws:${wsId}:p:${pageId}`
    const reader = await rawClient(page, docName, 1)
    await reader.synced
    await expect.poll(() => reader.doc.getXmlFragment('default').toString()).toContain('Second line.')
    reader.destroy()
    // its text is known here (the content cache), its document is not: as for a page never opened on this device
    await expect.poll(async () => !!((await cloudValue(page, `content:${wsId}:${pageId}`)) as { json?: unknown } | null)?.json).toBe(true)
    const origin = new URL(page.url()).origin
    await page.goto(`${origin}/`)
    await page.evaluate((names) => Promise.all(names.map((n) => new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(n)
      r.onsuccess = r.onerror = r.onblocked = () => res()
    }))), [`one:g1:${docName}`, `one:${docName}`])

    const socket = await lateSocket(page)
    await openApp(page, wsId)
    expect(await wsEval(page, (s, id) => s.pages[id]?.plain as string, pageId)).toContain('Second line.')
    // a non-editor writer (AI, a template …) adds a line before the server has answered for the page
    await wsEval(page, (s, id) => {
      const c = s.pages[id].content
      s.setContent(id, { ...c, content: [...c.content, { type: 'paragraph', content: [{ type: 'text', text: 'Written before the server answered.' }] }] }, 'ai')
    }, pageId)
    await expect.poll(async () => (await heldFor(page, wsId, pageId)).length).toBe(1)
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), pageId)
    await expect(page.getByTestId('waiting-doc')).toContainText('Written before the server answered.')

    // the tab goes away while the write waits: the next one still has it
    await page.reload()
    await waitForApp(page)
    expect(await wsEval(page, (s, id) => s.pages[id]?.plain as string, pageId)).toContain('Written before the server answered.')
    expect(await heldFor(page, wsId, pageId)).toHaveLength(1)

    socket.open()
    await waitOnline(page)
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      const xml = () => check.doc.getXmlFragment('default').toString()
      await expect.poll(() => occurrences(xml(), 'Written before the server answered.'), { timeout: 15_000 }).toBe(1)
      await page.waitForTimeout(1500)
      expect([occurrences(xml(), 'First line.'), occurrences(xml(), 'Second line.'), occurrences(xml(), 'Written before the server answered.')]).toEqual([1, 1, 1])
    } finally {
      check.destroy()
    }
    await expect.poll(() => heldKeys(page)).toEqual([])
    const ed = editorOf(page, pageId)
    await expect(ed).toHaveAttribute('contenteditable', 'true')
    expect(occurrences(await ed.innerText(), 'First line.')).toBe(1)
    expect(occurrences(await ed.innerText(), 'Written before the server answered.')).toBe(1)
  })

  for (const locks of [true, false]) {
    for (const closes of [false, true]) {
      const how = locks ? '' : ' (no Web Locks: the tabs ask each other)'
      test(`a held write is one tab's${how}: another tab opened meanwhile ${closes ? 'takes it over when that tab closes' : 'leaves it to that tab'} — written once`, async ({ page }) => {
        if (!locks) await withoutLocks(page.context())
        await signIn(page, email(`${closes ? 'heldclose' : 'heldtwo'}${locks ? '' : 'nl'}`))
        if (!locks) expect(await page.evaluate(() => 'locks' in navigator)).toBe(false)
        const wsId = await createWorkspace(page, 'Held HQ')
        const { pageId, docName } = await blindPage(page, wsId, { title: 'Held plan', lines: ['Known line.'] })

        // tab 1 writes while the server has not answered: held
        const second = await page.context().newPage()
        const server = await heldSockets([page, second])
        await openApp(page, wsId)
        await addLine(page, pageId, 'Held in tab one.')
        await expect.poll(async () => (await heldFor(page, wsId, pageId)).length).toBe(1)
        // tab 2 boots meanwhile: it finds the record — tab 1's
        await openApp(second, wsId)
        expect(await wsEval(second, (s, id) => s.pages[id]?.plain as string, pageId)).toContain('Held in tab one.')
        await second.waitForTimeout(800)
        if (closes) await page.close()
        server.open()
        const alive = closes ? second : page
        await waitOnline(alive)
        if (!closes) await waitOnline(second)
        const check = await rawClient(alive, docName, 1)
        try {
          await check.synced
          const xml = () => check.doc.getXmlFragment('default').toString()
          await expect.poll(() => occurrences(xml(), 'Held in tab one.'), { timeout: 15_000 }).toBe(1)
          await alive.waitForTimeout(2500)
          expect([occurrences(xml(), 'Known line.'), occurrences(xml(), 'Held in tab one.')]).toEqual([1, 1])
        } finally {
          check.destroy()
        }
        await expect.poll(() => heldKeys(alive)).toEqual([])
        if (!closes) await second.close()
      })
    }

    test(`two tabs hold writes to the same page${locks ? '' : ' (no Web Locks)'}: each its own record — the closed tab's is written by the next boot, both once`, async ({ page }) => {
      if (!locks) await withoutLocks(page.context())
      await signIn(page, email(`heldboth${locks ? '' : 'nl'}`))
      const wsId = await createWorkspace(page, 'Held twice')
      const { pageId, docName } = await blindPage(page, wsId, { title: 'Held by both', lines: ['Known line.'] })

      const second = await page.context().newPage()
      const server = await heldSockets([page, second])
      await openApp(page, wsId)
      await openApp(second, wsId)
      // both tabs write before the server answered: two records — the second tab never writes over the first's
      await addLine(page, pageId, 'Written in tab one.')
      await expect.poll(async () => (await heldFor(page, wsId, pageId)).length).toBe(1)
      await addLine(second, pageId, 'Written in tab two.')
      await expect.poll(async () => (await heldFor(page, wsId, pageId)).length).toBe(2)

      // tab one goes before the server answers: its record stays on this device
      await page.close()
      server.open()
      await waitOnline(second)
      const check = await rawClient(second, docName, 1)
      try {
        await check.synced
        const xml = () => check.doc.getXmlFragment('default').toString()
        await expect.poll(() => occurrences(xml(), 'Written in tab two.'), { timeout: 15_000 }).toBe(1)
        await expect.poll(async () => (await heldFor(second, wsId, pageId)).length).toBe(1)
        // the next boot writes the closed tab's record
        await second.reload()
        await waitForApp(second)
        await waitOnline(second)
        await expect.poll(() => occurrences(xml(), 'Written in tab one.'), { timeout: 15_000 }).toBe(1)
        await second.waitForTimeout(2000)
        expect([occurrences(xml(), 'Known line.'), occurrences(xml(), 'Written in tab one.'), occurrences(xml(), 'Written in tab two.')]).toEqual([1, 1, 1])
      } finally {
        check.destroy()
      }
      await expect.poll(() => heldKeys(second)).toEqual([])
      await second.close()
    })
  }

  test('a held write cut short by a role change stays on this device: a later write never takes it along — the next boot that may write writes it once', async ({ page, context }) => {
    await signIn(page, email('heldowner'))
    const wsId = await createWorkspace(page, 'Held roles')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Held role plan', parentId: null }) as string)
    await addLine(page, pageId, 'Known line.')
    const docName = `ws:${wsId}:p:${pageId}`

    const member = await newPerson(context)
    await signIn(member, email('heldmember'))
    await join(page, member, wsId, 'member')
    const memberId = (await api<{ user: { id: string } }>(member, 'GET', '/api/me')).json.user.id
    await blindPage(member, wsId, { existing: pageId, text: 'Known line.' })

    // the member writes before the server answered (offline): held
    const socket = await lateSocket(member)
    await openApp(member, wsId)
    await addLine(member, pageId, 'Held before the role change.')
    await expect.poll(async () => (await heldFor(member, wsId, pageId)).length).toBe(1)

    // a viewer by the time the server answers: nothing written, the record stays
    expect((await api(page, 'PATCH', `/api/workspaces/${wsId}/members/${memberId}`, { role: 'viewer' })).status).toBe(200)
    socket.open()
    await expect.poll(() => cloudEval(member, (c) => c.readOnly as boolean), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => wsEval(member, (s, id) => s.pages[id]?.plain as string, pageId), { timeout: 15_000 }).not.toContain('Held before the role change.')
    await member.waitForTimeout(1000)
    expect(await heldFor(member, wsId, pageId)).toHaveLength(1)

    // a member again, the same session: a later write goes in on its own — the held record stays as it is
    expect((await api(page, 'PATCH', `/api/workspaces/${wsId}/members/${memberId}`, { role: 'member' })).status).toBe(200)
    await expect.poll(() => cloudEval(member, (c) => ({ role: c.role, readOnly: c.readOnly, status: c.status })), { timeout: 20_000 }).toEqual({ role: 'member', readOnly: false, status: 'online' })
    await addLine(member, pageId, 'Written once the role came back.')
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      const xml = () => check.doc.getXmlFragment('default').toString()
      await expect.poll(() => occurrences(xml(), 'Written once the role came back.'), { timeout: 15_000 }).toBe(1)
      await member.waitForTimeout(1500)
      expect(await heldFor(member, wsId, pageId)).toHaveLength(1)
      expect(occurrences(xml(), 'Held before the role change.')).toBe(0)

      // the next boot (it may write): the held write goes in — once, next to the later one
      await member.reload()
      await waitForApp(member)
      await waitOnline(member)
      await expect.poll(() => occurrences(xml(), 'Held before the role change.'), { timeout: 15_000 }).toBe(1)
      await member.waitForTimeout(2000)
      expect([occurrences(xml(), 'Known line.'), occurrences(xml(), 'Held before the role change.'), occurrences(xml(), 'Written once the role came back.')]).toEqual([1, 1, 1])
    } finally {
      check.destroy()
    }
    await expect.poll(() => heldFor(member, wsId, pageId)).toEqual([])
    await member.context().close()
  })

  test('a task stored inside another task, opened by two tabs at once, is not doubled', async ({ page }) => {
    await signIn(page, email('nested'))
    const wsId = await createWorkspace(page, 'Nested HQ')
    await openApp(page, wsId)
    await waitOnline(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Nested', parentId: null }) as string)
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'top' }] }] }, 'e2e'), pageId)
    // a raw writer puts a task inside a task (nothing in the app does)
    const docName = `ws:${wsId}:p:${pageId}`
    const writer = await rawClient(page, docName, 1)
    await writer.synced
    await expect.poll(() => names(writer.doc)).toContain('paragraph')
    writer.doc.transact(() => {
      const outer = new Y.XmlElement('workItem')
      outer.setAttribute('itemId', 'wi_outer00001')
      const inner = new Y.XmlElement('workItem')
      inner.setAttribute('itemId', 'wi_inner00001')
      inner.insert(0, [yPara('INNER TITLE'), yPara('inner note')])
      outer.insert(0, [yPara('OUTER TITLE'), inner])
      const frag = writer.doc.getXmlFragment('default')
      frag.insert(frag.length, [outer])
    })
    await page.waitForTimeout(800)
    writer.destroy()

    const second = await page.context().newPage()
    await openApp(second, wsId)
    await waitOnline(second)
    // both open the page at the same moment
    await Promise.all([page, second].map((p) => p.evaluate((id) => (window.location.hash = `#/p/${id}`), pageId)))
    await expect(editorOf(page, pageId)).toContainText('INNER TITLE')
    await expect(editorOf(second, pageId)).toContainText('INNER TITLE')
    await page.waitForTimeout(3000)
    const check = await rawClient(page, docName, 1)
    try {
      await check.synced
      const xml = check.doc.getXmlFragment('default').toString()
      expect(xml.split('INNER TITLE').length - 1).toBe(1)
      expect(xml.split('inner note').length - 1).toBe(1)
    } finally {
      check.destroy()
    }
    for (const p of [page, second]) expect((await editorOf(p, pageId).innerText()).split('INNER TITLE').length - 1).toBe(1)
    await second.close()
  })
})
