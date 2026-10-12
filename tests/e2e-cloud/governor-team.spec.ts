/**
 * Regler B1 in a team workspace (against the real server): the governor is the owners' and admins' —
 *  - an owner's setGovernor writes `workspace.governor` AND the AI stamp it needs (`workspace.ai.gen` = GEN.budget) in one
 *    document transaction; a member's tab reads both;
 *  - a member's setter is refused ('rights', the store unchanged); a member's store that holds another value anyway gets
 *    the team's back (the binding's put-back) and the document never sees it;
 *  - a server that does not announce 'governor' refuses the owner's setter ('server') — positive control: announced
 *    again, it writes;
 *  - removing the budget removes the key and lowers the stamp for everyone.
 * No AI host is reached; values are fictional (Nordlicht).
 */
import type { Page } from '@playwright/test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, wsEval, cloudEval, createWorkspace, join } from './fixtures'
import { DOC_SCHEMA_VERSION } from '../../src/app/store/generations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Hook = { __one: { workspace: { setState: (x: object) => void }; cloud: { useCloud: { setState: (x: object) => void; getState: () => AnyState } } } }

/** A collab client in Node with this page's session (it only watches the meta document here). */
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

const bare = (g: AnyState | null) => {
  if (!g) return g
  const { updatedAt: _a, updatedBy: _b, ...rest } = g
  return rest
}
const govOf = async (p: Page) => bare(await wsEval(p, (s) => (s.governor ? JSON.parse(JSON.stringify(s.governor)) : null) as AnyState | null))
const genOf = (p: Page) => wsEval(p, (s) => (s.ai?.gen ?? null) as number | null)
const setGovernor = (p: Page, v: object | null) => wsEval(p, (s, g) => s.setGovernor(g) as { ok: boolean; why?: string }, v)

test('an owner’s budget reaches a member with its AI stamp; a member’s write is refused and put back; a server without the key refuses', async ({ page, context }) => {
  await signIn(page, email('mara'))
  const wsId = await createWorkspace(page, 'Nordlicht Team')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  await join(page, member, wsId, 'member')
  await openApp(page, wsId)
  await waitOnline(page)
  await openApp(member, wsId)
  await waitOnline(member)
  expect(await cloudEval(page, (c) => c.supports ?? [])).toEqual(expect.arrayContaining(['ai', 'governor']))

  const raw = await rawClient(page, `ws:${wsId}`)
  const wsMap = raw.doc.getMap('workspace')
  const changes: string[] = []
  wsMap.observe((e) => {
    for (const k of e.keysChanged) if (k === 'governor' || k === 'ai') changes.push(k)
  })

  // the owner sets a day + month budget: the key and the stamp arrive together (one transaction), the server stamps who
  const BUDGET = { v: 1, day: 6, month: 120 }
  expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
  await expect.poll(() => typeof (wsMap.get('governor') as AnyState | undefined)?.updatedBy).toBe('string')
  expect(bare(JSON.parse(JSON.stringify(wsMap.get('governor'))))).toEqual(BUDGET)
  expect((wsMap.get('ai') as AnyState | undefined)?.gen).toBe(3)
  expect(await genOf(page)).toBe(3)
  // the member reads both
  await expect.poll(() => govOf(member)).toEqual(BUDGET)
  await expect.poll(() => genOf(member)).toBe(3)

  // a member may not: refused by the setter, nothing changes anywhere
  const before = changes.length
  expect(await setGovernor(member, { v: 1, day: 9000 })).toEqual({ ok: false, why: 'rights' })
  expect(await govOf(member)).toEqual(BUDGET)
  // a member's store holding another value anyway (any path): the binding puts the team's back — the document never sees it
  await member.evaluate(() => (window as unknown as Hook).__one.workspace.setState({ governor: { v: 1, day: 9000 }, ai: { gen: 3 } }))
  await expect.poll(() => govOf(member)).toEqual(BUDGET)
  await member.waitForTimeout(600)
  expect(changes.length).toBe(before)
  expect(bare(JSON.parse(JSON.stringify(wsMap.get('governor'))))).toEqual(BUDGET)

  // a server that does not guard the key (its /api/config without 'governor'): the owner's setter refuses — 'server'
  await page.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: (c.getState().supports as string[]).filter((x) => x !== 'governor') })
  })
  expect(await setGovernor(page, { v: 1, day: 4 })).toEqual({ ok: false, why: 'server' })
  expect(await govOf(page)).toEqual(BUDGET)
  // positive control: announced again, the owner writes
  await page.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: [...(c.getState().supports as string[]), 'governor'] })
  })
  expect(await setGovernor(page, { v: 1, day: 4, month: 120 })).toEqual({ ok: true })
  await expect.poll(() => govOf(member)).toEqual({ v: 1, day: 4, month: 120 })

  // the budget removed: the key goes and the stamp follows for everyone (older tabs work again)
  expect(await setGovernor(page, null)).toEqual({ ok: true })
  await expect.poll(() => wsMap.has('governor')).toBe(false)
  await expect.poll(() => (wsMap.get('ai') as AnyState | undefined)?.gen ?? null).toBeNull()
  await expect.poll(() => govOf(member)).toBeNull()
  await expect.poll(() => genOf(member)).toBeNull()
  raw.destroy()
  await member.context().close()
})
