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
import { mockOpenRouter } from '../e2e/helpers/providers'

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

test('two tabs of one team workspace: device AI rules and a key marker saved in one survive the other’s saves and reach it', async ({ page, context }) => {
  await signIn(page, email('ada'))
  const wsId = await createWorkspace(page, 'Tessera Team')
  await openApp(page, wsId)
  await waitOnline(page)
  const other = await context.newPage()
  await openApp(other, wsId)
  await waitOnline(other)

  // tab B narrows this device's rules at a generation this build does not know, and keeps a key (S2: sealed → its marker;
  // a marker this browser cannot open is dropped at the next boot, so the key is a real one here)
  await wsEval(other, (s) => s.updateSettings({ ai: { gen: 2 }, aiKeys: { openrouter: 'sk-or-v1-e2e-tessera-key-000000000000000000000000000000000000000000004c2a' } }))
  const MARKER = await wsEval(other, (s) => s.settings.aiKeys.openrouter as string)
  expect(MARKER).toMatch(/^vault:[0-9a-z]{12}:4c2a$/)
  const deviceOf = (p: Page) => wsEval(p, (s) => JSON.parse(JSON.stringify({ ai: s.settings.ai ?? null, keys: s.settings.aiKeys ?? null })))
  // tab A reads them (the overlay ping): its gate now sees generation 2
  await expect.poll(() => deviceOf(page)).toEqual({ ai: { gen: 2 }, keys: { openrouter: MARKER } })

  // tab A saves its overlay (a page, the theme): only its own keys go over the stored ones
  await wsEval(page, (s) => {
    s.createPage({ title: 'Launch plan', parentId: null })
    s.updateSettings({ theme: 'dark' })
  })
  await page.waitForTimeout(900)
  // tab B reloads: the rules and the marker are still there, tab A's theme too
  await openApp(other, wsId)
  await waitOnline(other)
  expect(await deviceOf(other)).toEqual({ ai: { gen: 2 }, keys: { openrouter: MARKER } })
  expect(await wsEval(other, (s) => s.settings.theme)).toBe('dark')
})

test('an OpenRouter key sealed in the local workspace opens in a new team workspace (the overlay inherits the seal)', async ({ page }) => {
  const KEY = 'sk-or-v1-e2e-nordlicht-key-00000000000000000000000000000000000000000009Kp2'
  const or = await mockOpenRouter(page.context())
  await signIn(page, email('ada'))
  // the local workspace: the key pasted there (sealed for "local")
  await openApp(page)
  await wsEval(page, (s, k) => s.updateSettings({ aiKeys: { openrouter: k } }), KEY)
  const marker = await wsEval(page, (s) => s.settings.aiKeys.openrouter as string)
  expect(marker).toMatch(/^vault:[0-9a-z]{12}:9Kp2$/)
  await page.evaluate(() => (window as unknown as { __one: { flushSave(): Promise<void> } }).__one.flushSave())
  // a new team workspace starts with the local settings: the same marker, opened through the local seal
  const wsId = await createWorkspace(page, 'Nordlicht Team')
  await openApp(page, wsId)
  await waitOnline(page)
  expect(await wsEval(page, (s) => s.settings.aiKeys?.openrouter ?? null)).toBe(marker)
  const check = await page.evaluate(() => (window as unknown as { __oneAI: { verifyProvider(p: string): Promise<{ ok: boolean }> } }).__oneAI.verifyProvider('openrouter'))
  expect(check).toMatchObject({ ok: true })
  expect(or.to('/api/v1/key').map((r) => r.bearer)).toEqual([KEY])
  expect(or.posts()).toHaveLength(0)
  // … and sealed again for this team workspace (its own scope), never stored in the clear
  const vault = await page.evaluate(
    (ws) =>
      new Promise<{ team: boolean; keys: string[] }>((resolve) => {
        const r = indexedDB.open('one-vault')
        r.onsuccess = () => {
          const all = r.result.transaction('kv').objectStore('kv').getAllKeys()
          all.onsuccess = () => {
            const keys = (all.result as string[]).map(String)
            r.result.close()
            resolve({ team: keys.includes(`s:cloud:${ws}|ai-key:openrouter`), keys })
          }
        }
      }),
    wsId,
  )
  expect(vault.team).toBe(true)
  expect(vault.keys).toContain('s:local:local|ai-key:openrouter')
})
