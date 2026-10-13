/**
 * Regler G0 in a team workspace (against the real server): the governor lives in the meta document's `workspace` map,
 * key `governor` (owners / admins only — server/src/collab/workspace-governor.ts). Every tab READS it (binding.ts: the
 * remote read and readAll at boot, sanitized) and no other edit sends it back: neither the owner's tab nor a member's
 * writes the key while they edit something else. (Writes through setGovernor — B1 — are tests/e2e-cloud/governor-team.)
 * A switch to another workspace takes that workspace's (none), a switch back reads it again.
 * The owner's value is written by a collab client in Node with the owner's session (what a later build would write).
 * The server guard itself is covered by server/test/workspace-governor.test.ts. No AI host is reached; values are fictional.
 */
import type { Page } from '@playwright/test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, waitForApp, wsEval, cloudEval, createWorkspace, join } from './fixtures'
import { DOC_SCHEMA_VERSION } from '../../src/app/store/generations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** A collab client in Node with this page's session. */
async function rawClient(page: Page, name: string) {
  const origin = new URL(page.url()).origin
  const cookie = (await page.context().cookies(origin)).map((c) => `${c.name}=${c.value}`).join('; ')
  const headers = { cookie, origin }
  class CookieWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers } as unknown as string[])
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: `${origin.replace(/^http/, 'ws')}/collab?schema=${DOC_SCHEMA_VERSION}`, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 })
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc })
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  provider.attach()
  await synced
  return {
    doc,
    destroy() {
      provider.destroy()
      socket.destroy()
    },
  }
}

const VALUE = { v: 1, autonomy: 'propose', day: 6, month: 120 }
const NEXT = { v: 1, day: 8, month: 150 }

const govOf = (p: Page) => wsEval(p, (s) => (s.governor ? JSON.parse(JSON.stringify(s.governor)) : null) as AnyState | null)

/** Reload into another workspace with the app's own switch (cloud/index.ts switchWorkspace). */
async function switchTo(p: Page, ref: { kind: 'local' | 'cloud'; id: string }) {
  await Promise.all([p.waitForEvent('load'), p.evaluate((ref) => (window as any).__one.cloud.switchWorkspace(ref), ref)]) // eslint-disable-line @typescript-eslint/no-explicit-any
  await waitForApp(p)
  await expect.poll(() => cloudEval(p, (c) => `${c.active.kind}:${c.active.id}`)).toBe(`${ref.kind}:${ref.id}`)
}

test('a member’s tab reads the owner’s governor from the meta map; other edits never write it; a switch takes the other workspace’s', async ({ page, context }) => {
  await signIn(page, email('gia'))
  const wsId = await createWorkspace(page, 'Regler Team')
  const member = await newPerson(context)
  await signIn(member, email('nils'))
  await join(page, member, wsId, 'member')
  await openApp(page, wsId)
  await waitOnline(page)
  await openApp(member, wsId)
  await waitOnline(member)
  // the server announces that it guards the key
  expect(await cloudEval(page, (c) => c.supports ?? [])).toContain('governor')
  expect(await govOf(member)).toBeNull()

  // the owner's value, written into the meta document (the owner's session) — the server stamps who wrote it
  const raw = await rawClient(page, `ws:${wsId}`)
  const wsMap = raw.doc.getMap('workspace')
  wsMap.set('governor', VALUE)
  await expect.poll(() => typeof (wsMap.get('governor') as AnyState | undefined)?.updatedBy).toBe('string')
  const stamped = JSON.parse(JSON.stringify(wsMap.get('governor')))

  // both tabs read it (sanitized: the same value, the server's stamp kept)
  await expect.poll(() => govOf(member)).toEqual(stamped)
  await expect.poll(() => govOf(page)).toEqual(stamped)

  // from now on: every change of the key in the shared document
  const seen: unknown[] = []
  wsMap.observe((e) => {
    if (e.keysChanged.has('governor')) seen.push(wsMap.get('governor') ?? null)
  })

  // the tabs edit the workspace — the governor is not sent along: not by the member, not by the owner (who may write it)
  await wsEval(member, (s) => s.createPage({ title: 'Harbour notes', parentId: null }))
  await wsEval(page, (s) => s.createPage({ title: 'Budget review', parentId: null }))
  // (the other edits did go out — the document is live)
  const titles = () => [...raw.doc.getMap('pages').values()].map((p) => (p as Y.Map<unknown>).get?.('title'))
  await expect.poll(titles).toEqual(expect.arrayContaining(['Harbour notes', 'Budget review']))
  await page.waitForTimeout(800)
  expect(seen).toEqual([])
  expect(wsMap.get('governor')).toEqual(stamped)

  // positive control: the owner's next value reaches both tabs (the remote read wins over a store's own value)
  wsMap.set('governor', NEXT)
  await expect.poll(() => govOf(member)).toMatchObject(NEXT)
  await expect.poll(() => govOf(page)).toMatchObject(NEXT)
  // removed in the document: gone in the tabs
  wsMap.delete('governor')
  await expect.poll(() => govOf(member)).toBeNull()

  // a switch: the local workspace has none (the team's never travels along); back in the team, read again at boot
  wsMap.set('governor', VALUE)
  await expect.poll(() => govOf(member)).toMatchObject(VALUE)
  await switchTo(member, { kind: 'local', id: 'local' })
  expect(await govOf(member)).toBeNull()
  await switchTo(member, { kind: 'cloud', id: wsId })
  await waitOnline(member)
  await expect.poll(() => govOf(member)).toMatchObject(VALUE)
  raw.destroy()
  await member.context().close()
})
