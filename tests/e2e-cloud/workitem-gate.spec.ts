/**
 * Schema gate (docs/CLOUD.md § Schema gate) and the task block in a team workspace, against the real server:
 *  - the app connects with its document schema generation (`/collab?schema=1`) and edits normally;
 *  - a connection WITHOUT the number (an older build) reads a page but cannot change it — its delete of the task
 *    block it does not know never reaches the server;
 *  - the public API prints a task as its title + notes;
 *  - a tab the server finds outdated (its stateless notice) turns read-only and offers "Reload to keep editing";
 *    a reload brings the editor back.
 */
import type { Page } from '@playwright/test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import { test, expect, api, email, signIn, openApp, waitForApp, waitOnline, wsEval, cloudEval, createWorkspace, gotoPage, editorOf } from './fixtures'

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
})
