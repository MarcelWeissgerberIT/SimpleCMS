/**
 * Multi-provider S1 in a team workspace (against the real server): the workspace's AI rules (meta map `workspace`, key
 * `ai`) and an agent's route fields are kept by this build — read through the shared sanitizers, never written or
 * deleted — while a tab edits the workspace (pages, the name, agents). A newer build or another client wrote them;
 * an S1 tab must not erase them. The server guard itself is covered by server/test/workspace-ai.test.ts.
 */
import type { Page } from '@playwright/test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { test, expect, email, signIn, openApp, waitOnline, wsEval, createWorkspace } from './fixtures'
import { DOC_SCHEMA_VERSION } from '../../src/app/store/generations'

/** A collab client in Node with this page's session (a client other than the app: what a newer build would write). */
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

const RULES = {
  gen: 1,
  routes: { '*': [{ p: 'anthropic', m: 'claude-sonnet-5-5' }], bulk: [{ p: 'openrouter', m: 'x/y' }] },
  policy: { providers: { openrouter: { allow: ['public', 'structure', 'selection'] } }, restricted: [] },
}
const ROUTED = { route: [{ p: 'openrouter', m: 'x/y' }, { p: 'anthropic', m: 'claude-opus-5-5' }], applyOn: 'anthropic:claude-opus-5-5', routeSig: 'sig-nordlicht-1' }

test('workspace.ai and agent routes written elsewhere survive an S1 tab’s edits', async ({ page }) => {
  await signIn(page, email('mara'))
  const wsId = await createWorkspace(page, 'Nordlicht Team')
  await openApp(page, wsId)
  await waitOnline(page)

  // another client (a newer build) writes the rules and an agent with routes into the meta document
  const raw = await rawClient(page, `ws:${wsId}`)
  const now = Date.now()
  raw.doc.transact(() => {
    raw.doc.getMap('workspace').set('ai', RULES)
    raw.doc.getMap('agents').set('ag-routed', { id: 'ag-routed', name: 'Tessera router', instructions: 'Summarise the launch plan.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...ROUTED })
  })

  // this tab reads them (sanitized) …
  // (the server stamps who wrote the rules: updatedBy)
  const rulesOf = (p: Page) => wsEval(p, (s) => (s.ai ? JSON.parse(JSON.stringify({ gen: s.ai.gen, routes: s.ai.routes, policy: s.ai.policy })) : null))
  await expect.poll(() => rulesOf(page)).toEqual(RULES)
  await expect.poll(() => wsEval(page, (s) => typeof s.ai?.updatedBy)).toBe('string')
  await expect.poll(() => wsEval(page, (s) => s.agents?.['ag-routed']?.route?.[0]?.p ?? null)).toBe('openrouter')

  // … and edits the workspace: a page, the name, an agent of its own, the routed agent's name
  await wsEval(page, (s) => {
    s.createPage({ title: 'Launch plan', parentId: null })
    s.updateSettings({ workspaceName: 'Nordlicht Team (renamed)' })
    const a = s.agents['ag-routed']
    s.upsertAgent({ ...a, name: 'Tessera router (renamed)' })
    const t = Date.now()
    s.upsertAgent({ id: 'ag-local', name: 'Local one', instructions: 'Look around.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: t, updatedAt: t })
  })
  await expect.poll(() => (raw.doc.getMap('agents').get('ag-routed') as { name?: string } | undefined)?.name).toBe('Tessera router (renamed)')
  await expect.poll(() => raw.doc.getMap('agents').has('ag-local')).toBe(true)
  await page.waitForTimeout(500)

  // the rules are untouched in the shared document; the renamed agent kept its routes
  expect(raw.doc.getMap('workspace').get('ai')).toMatchObject(RULES)
  expect(raw.doc.getMap('agents').get('ag-routed')).toMatchObject(ROUTED)
  // a reload reads them again
  await openApp(page, wsId)
  await waitOnline(page)
  await expect.poll(() => rulesOf(page)).toEqual(RULES)
  raw.destroy()
})
