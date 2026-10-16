/**
 * The Patchbay in a team workspace — the store level of B9 (against the real server):
 *  - the allowed paths are the owners' and admins' (meta map `fuseSignoffs`): an owner's signOffFuse reaches a member's
 *    store at once, stamped by the server with the owner's account — the member reads the owner's name from it;
 *  - a member's writer is refused ('rights', naming the owners and admins); a member's store that holds other allowances
 *    anyway gets the team's back (the binding's put-back) and the document never sees them; the member's raw write into
 *    the document is put back by the server;
 *  - a server that does not announce 'signoffs' refuses the owner's writer ('server' — the Patchbay says
 *    `features.patchbay.key.serverOld`) and its map is never read (fix rest: any member may have written it, the
 *    account it names included) — not at the start, not live; positive control: announced again, it is read and the
 *    owner writes; a withdrawal reaches the member;
 *  - uploading the local workspace takes its allowances along (stamped for the uploader) — only onto a server that
 *    guards them;
 *  - removing a team workspace's copy from this browser takes its Patchbay stores along — every member's records of
 *    it in IndexedDB `one-patchbay`, its row orders, this tab's return chip — and keeps the local workspace's, another
 *    workspace's and the device's own switches.
 * Path keys and signatures are made-up hex; names are fictional (Mara Lind, Tessera, Nordlicht).
 */
import type { Page } from '@playwright/test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { test, expect, email, signIn, newPerson, openApp, waitForApp, waitOnline, wsEval, cloudEval, cloudStatus, createWorkspace, join, api } from './fixtures'
import { DOC_SCHEMA_VERSION } from '../../src/app/store/generations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Hook = { __one: { workspace: { setState: (x: object) => void }; cloud: { useCloud: { setState: (x: object) => void; getState: () => AnyState } } } }

const hex = (c: string) => c.repeat(64)
const K1 = hex('a')
const K2 = hex('b')
const PARTS = { d: 'd'.repeat(16), x: 'e'.repeat(16) }

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
    provider,
    destroy() {
      provider.destroy()
      socket.destroy()
    },
  }
}

const signOff = (p: Page, key: string, sig: string) => wsEval(p, (s, a) => s.signOffFuse(a.key, a.sig, a.parts) as AnyState, { key, sig, parts: PARTS })
const withdraw = (p: Page, key: string) => wsEval(p, (s, k) => s.withdrawSignoff(k) as AnyState, key)
const sigsOf = (p: Page) =>
  wsEval(p, (s) => (s.fuseSignoffs ? Object.fromEntries(Object.entries(s.fuseSignoffs as Record<string, AnyState>).map(([k, v]) => [k, v.sig as string])) : null) as Record<string, string> | null)
/** Who allowed a path, as the member's app names them: the stamped account → the workspace people the members mirror. */
const allowedBy = (p: Page, key: string) =>
  wsEval(p, (s, k) => {
    const by = (s.fuseSignoffs as Record<string, AnyState> | undefined)?.[k]?.updatedBy as string | undefined
    return by ? ((s.people as AnyState[]).find((x) => x.id === by)?.name ?? `?${by}`) : null
  }, key)

test('an owner’s allowed path reaches a member with the owner’s name; a member’s writes are refused and put back; a server without the key refuses', async ({ page, context }) => {
  await signIn(page, email('mara'))
  expect((await api(page, 'PATCH', '/api/me', { name: 'Mara Lind' })).status).toBe(200)
  const maraId = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id
  const wsId = await createWorkspace(page, 'Nordlicht Team')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  await join(page, member, wsId, 'member')
  await openApp(page, wsId)
  await waitOnline(page)
  await openApp(member, wsId)
  await waitOnline(member)
  expect(await cloudEval(page, (c) => c.supports ?? [])).toEqual(expect.arrayContaining(['signoffs']))

  const raw = await rawClient(page, `ws:${wsId}`)
  const map = raw.doc.getMap('fuseSignoffs')
  const changes: string[] = []
  map.observe((e) => {
    for (const k of e.keysChanged) changes.push(k)
  })

  // the owner allows a path: the server stamps her account; the member reads it, named
  expect(await signOff(page, K1, hex('1'))).toEqual({ ok: true })
  await expect.poll(() => (map.get(K1) as AnyState | undefined)?.updatedBy ?? null).toBe(maraId)
  expect((map.get(K1) as AnyState).sig).toBe(hex('1'))
  await expect.poll(() => sigsOf(member)).toEqual({ [K1]: hex('1') })
  await expect.poll(() => allowedBy(member, K1)).toBe('Mara Lind')

  // a member may not: refused (naming the owners and admins), nothing changes anywhere
  const before = changes.length
  await expect.poll(() => signOff(member, K2, hex('2'))).toEqual({ ok: false, why: 'rights', admins: ['Mara Lind'] })
  expect(await withdraw(member, K1)).toEqual({ ok: false, why: 'rights', admins: ['Mara Lind'] })
  expect(await sigsOf(member)).toEqual({ [K1]: hex('1') })
  // a member's store holding other allowances anyway (any path): the team's come back — the document never sees them
  await member.evaluate(
    ({ k1, k2, parts }) =>
      (window as unknown as Hook).__one.workspace.setState({
        fuseSignoffs: { [k1]: { sig: 'f'.repeat(64), parts, at: Date.now(), updatedBy: null }, [k2]: { sig: '2'.repeat(64), parts, at: Date.now(), updatedBy: null } },
      }),
    { k1: K1, k2: K2, parts: PARTS },
  )
  await expect.poll(() => sigsOf(member)).toEqual({ [K1]: hex('1') })
  await member.waitForTimeout(600)
  expect(changes.length).toBe(before)
  expect(await sigsOf(page)).toEqual({ [K1]: hex('1') })

  // the member writing the document directly (raw Yjs, no app): the server puts it back, the owner never gets it
  const rawMember = await rawClient(member, `ws:${wsId}`)
  rawMember.doc.getMap('fuseSignoffs').set(K2, { sig: hex('3'), parts: PARTS, at: Date.now(), updatedBy: maraId })
  await expect.poll(() => rawMember.doc.getMap('fuseSignoffs').has(K2)).toBe(false)
  await page.waitForTimeout(400)
  expect(await sigsOf(page)).toEqual({ [K1]: hex('1') })
  rawMember.destroy()

  // a server that does not guard the map (its /api/config without 'signoffs'): the owner's writer refuses — 'server' —
  // and the map is not read at all there (fix rest: any member could have written it): the store holds none
  await page.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: (c.getState().supports as string[]).filter((x) => x !== 'signoffs') })
  })
  expect(await signOff(page, K2, hex('4'))).toEqual({ ok: false, why: 'server' })
  expect(await withdraw(page, K1)).toEqual({ ok: false, why: 'server' })
  await expect.poll(() => sigsOf(page)).toBeNull()
  // … and the owner's own store holding another value then is put back too (the binding writes nothing)
  await page.evaluate(({ k2, parts }) => (window as unknown as Hook).__one.workspace.setState({ fuseSignoffs: { [k2]: { sig: '5'.repeat(64), parts, at: Date.now(), updatedBy: null } } }), { k2: K2, parts: PARTS })
  await expect.poll(() => sigsOf(page)).toBeNull()
  expect((map.get(K1) as AnyState | undefined)?.sig).toBe(hex('1'))
  expect(map.has(K2)).toBe(false)
  // positive control: announced again, the map is read again and the owner writes
  await page.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: [...(c.getState().supports as string[]), 'signoffs'] })
  })
  await expect.poll(() => sigsOf(page)).toEqual({ [K1]: hex('1') })
  expect(await signOff(page, K2, hex('6'))).toEqual({ ok: true })
  await expect.poll(() => sigsOf(member)).toEqual({ [K1]: hex('1'), [K2]: hex('6') })

  // the owner withdraws both: gone for the member too (none = no map at all)
  expect(await withdraw(page, K1)).toEqual({ ok: true })
  expect(await withdraw(page, K2)).toEqual({ ok: true })
  await expect.poll(() => map.size).toBe(0)
  await expect.poll(() => sigsOf(member)).toBeNull()
  raw.destroy()
  await member.context().close()
})

test('a server that does not guard the map: no entry reaches the store — at the start or live; announced, it is read (fix rest)', async ({ page, context }) => {
  await signIn(page, email('mara'))
  expect((await api(page, 'PATCH', '/api/me', { name: 'Mara Lind' })).status).toBe(200)
  const maraId = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id
  const wsId = await createWorkspace(page, 'Nordlicht Alt')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  await join(page, member, wsId, 'member')
  // an entry naming the owner is in the map before the member's app opens (on an older server anyone can write one)
  const raw = await rawClient(page, `ws:${wsId}`)
  const map = raw.doc.getMap('fuseSignoffs')
  map.set(K1, { sig: hex('1'), parts: PARTS, at: Date.now(), updatedBy: maraId })
  await expect.poll(() => (map.get(K1) as AnyState | undefined)?.updatedBy ?? null).toBe(maraId)
  // the member's app talks to "an older server": its /api/config does not list 'signoffs'
  await member.route('**/api/config', async (r) => {
    const res = await r.fetch()
    const json = (await res.json()) as AnyState
    await r.fulfill({ response: res, json: { ...json, supports: ((json.supports ?? []) as string[]).filter((x) => x !== 'signoffs') } })
  })
  await openApp(member, wsId)
  await waitOnline(member)
  expect(await cloudEval(member, (c) => c.supports ?? [])).not.toContain('signoffs')
  expect(await wsEval(member, (s, k) => (s.fuseSignoffs as Record<string, AnyState> | undefined)?.[k]?.updatedBy ?? null, K1)).toBeNull()
  // … nor live
  map.set(K2, { sig: hex('2'), parts: PARTS, at: Date.now(), updatedBy: maraId })
  await expect.poll(() => (map.get(K2) as AnyState | undefined)?.updatedBy ?? null).toBe(maraId)
  await member.waitForTimeout(1500)
  expect(await sigsOf(member)).toBeNull()
  // the server announces the guard (an update while the tab is open): the map is read now — and dropped again without it
  await member.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: [...(c.getState().supports as string[]), 'signoffs'] })
  })
  await expect.poll(() => sigsOf(member)).toEqual({ [K1]: hex('1'), [K2]: hex('2') })
  await member.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: (c.getState().supports as string[]).filter((x) => x !== 'signoffs') })
  })
  await expect.poll(() => sigsOf(member)).toBeNull()
  raw.destroy()
  await member.context().close()
})

/* ------------------------------------------------------------------ the upload */

test('uploading the local workspace takes its allowed paths along, stamped for the uploader — onto a server that guards them only', async ({ page: a }) => {
  await signIn(a, email('mara'))
  const uid = (await api<{ user: { id: string } }>(a, 'GET', '/api/me')).json.user.id
  const guarded = await createWorkspace(a, 'Nordlicht Upload')
  const older = await createWorkspace(a, 'Nordlicht Upload alt')
  await openApp(a)
  // the local workspace: the person allows (no team guard here)
  expect(await signOff(a, K1, hex('1'))).toEqual({ ok: true })
  const upload = (ws: string) =>
    a.evaluate(async (id) => {
      await (window as unknown as { __one: { cloud: { uploadLocalWorkspace: (id: string) => Promise<void> } } }).__one.cloud.uploadLocalWorkspace(id)
    }, ws)
  await upload(guarded)
  const raw = await rawClient(a, `ws:${guarded}`)
  await expect.poll(() => (raw.doc.getMap('fuseSignoffs').get(K1) as AnyState | undefined)?.sig ?? null).toBe(hex('1'))
  expect((raw.doc.getMap('fuseSignoffs').get(K1) as AnyState).updatedBy).toBe(uid)
  raw.destroy()

  // a server that does not announce 'signoffs': the upload leaves them out
  await expect.poll(() => cloudEval(a, (c) => (c.supports ?? []).includes('signoffs'))).toBe(true)
  await a.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: (c.getState().supports as string[]).filter((x) => x !== 'signoffs') })
  })
  await upload(older)
  const raw2 = await rawClient(a, `ws:${older}`)
  // (the upload's pages arrived — the meta document is written in one go)
  await expect.poll(() => raw2.doc.getMap('pages').size).toBeGreaterThan(0)
  expect(raw2.doc.getMap('fuseSignoffs').size).toBe(0)
  raw2.destroy()
})

/* ------------------------------------------------------------------ the device copy */

/** Write records into IndexedDB `one-patchbay` / `kv` as the Patchbay keeps them (features/patchbay/cache.ts). */
const putRecords = (p: Page, keys: string[]) =>
  p.evaluate(
    (keys) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('one-patchbay')
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('kv', 'readwrite')
          for (const k of keys) tx.objectStore('kv').put({ ids: ['agent:nl-1'] }, k)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    keys,
  )
const records = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open('one-patchbay')
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const all = db.transaction('kv').objectStore('kv').getAllKeys()
          all.onsuccess = () => {
            db.close()
            resolve((all.result as IDBValidKey[]).map(String).sort())
          }
          all.onerror = () => reject(all.error)
        }
      }),
  )

test('removing a team workspace’s copy takes its Patchbay stores along; the local, another workspace’s and the device’s own stay', async ({ page: a }) => {
  await signIn(a, email('mara'))
  await openApp(a)
  const keep = await createWorkspace(a, 'Tessera Bleibt')
  const gone = await createWorkspace(a, 'Tessera Geht')
  await openApp(a, keep)
  await waitOnline(a)
  const uid = await cloudEval(a, (c) => c.user.id as string)
  const scope = (ws: string, who = uid) => `cloud:${ws}:u:${who}`
  // records of the local workspace, of both team workspaces (this member's and another member's of `gone`), and of a
  // workspace whose id starts the same — the device's own switches and this tab's return chip
  const all = [
    'local:local|lazy',
    `${scope(keep)}|lazy`,
    `${scope(keep)}|runs|2026-10-14`,
    `${scope(gone)}|lazy`,
    `${scope(gone)}|setup`,
    `${scope(gone, 'acct-tessera')}|runs|2026-10-14`,
    `${scope(`${gone}x`)}|lazy`,
  ].sort()
  await putRecords(a, all)
  await a.evaluate(
    ({ keep, gone, uid }) => {
      localStorage.setItem('one.patchbay.seen', '1')
      localStorage.setItem('one.patchbay.patch', '1')
      localStorage.setItem('one.patchbay.order:local:local', '[]')
      localStorage.setItem(`one.patchbay.order:cloud:${keep}:u:${uid}`, '[]')
      localStorage.setItem(`one.patchbay.order:cloud:${gone}:u:${uid}`, '[]')
      sessionStorage.setItem('one.patchbay.return', '{"profileId":"IN-01","next":"04"}')
    },
    { keep, gone, uid },
  )
  expect(await records(a)).toEqual(all)

  // open the one that goes, then Settings → Data → Remove copy: back to the local workspace, the copy removed at that boot
  await openApp(a, gone)
  await waitOnline(a)
  await a.keyboard.press('Control+,')
  const settings = a.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('tab', { name: /Data/ }).click()
  await settings.getByTestId('remove-copy').getByRole('button', { name: 'Remove copy' }).click()
  const confirm = a.getByRole('dialog').filter({ hasText: 'Remove the copy of' })
  await Promise.all([a.waitForEvent('load'), confirm.getByRole('button', { name: 'Remove copy' }).click()])
  await waitForApp(a)
  expect(await cloudStatus(a)).toBe('local')

  await expect.poll(() => records(a)).toEqual(all.filter((k) => !k.startsWith(`cloud:${gone}:`)))
  const ls = await a.evaluate(() => ({
    keys: Object.keys(localStorage)
      .filter((k) => k.startsWith('one.patchbay.'))
      .sort(),
    chip: sessionStorage.getItem('one.patchbay.return'),
  }))
  expect(ls).toEqual({ keys: ['one.patchbay.order:cloud:' + keep + ':u:' + uid, 'one.patchbay.order:local:local', 'one.patchbay.patch', 'one.patchbay.seen'].sort(), chip: null })
})

/* ------------------------------------------------------------------ B10: the fuse keys in a team */

/**
 * Mock 1's core in a team workspace, written by its owner: the Mails database (system 'mails', „Weiterleiten“), the
 * automation „An Team-Chat“ (webhook chat.example — never fired here) and the owner's browser agent Inbox-Helfer
 * (apply, everything, new Mails rows) → fuse F1 for every member (a browser agent without MCP servers is no device's own).
 * `createdBy` is the owner's account, as the agent editor writes it for a new agent (upsertAgent keeps what it is given).
 */
async function seedTeamF1(owner: Page, ownerId: string): Promise<void> {
  await wsEval(owner, (s, ownerId) => {
    const db = s.createDatabase({ title: 'Mails', properties: [{ id: 'pName', name: 'Name', type: 'title' }, { id: 'pMailFwd', name: 'Weiterleiten', type: 'checkbox' }] }) as string
    s.updateDatabase(db, {
      system: 'mails',
      automations: [{ id: 'autToChat', name: 'An Team-Chat', enabled: true, trigger: { type: 'property_changed', propertyId: 'pMailFwd' }, actions: [{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST' }], lastRunAt: null, lastStatus: null, lastMessage: null }],
    })
    const now = Date.now()
    s.upsertAgent({ id: 'agInbox', name: 'Inbox-Helfer', instructions: 'Lies jede neue Mail. Soll das Team sie sehen, setze „Weiterleiten“.', trigger: { type: 'row_created', databaseId: db }, scope: { everything: true, pages: [], databases: [] }, write: 'apply', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.2, enabled: true, createdAt: now, updatedAt: now, createdBy: ownerId })
  }, ownerId)
}

const pbPanel = (p: Page) => p.getByTestId('pb-fpanel')
const pbKey = (p: Page, n: number) => p.locator(`#pb-fuse-panel [data-pb-key="${n}"]`)
const pbKeyRow = (p: Page, n: number) => p.locator(`#pb-fuse-panel .pb-fkey[data-n="${n}"]`)
const openPatchbayIn = async (p: Page) => {
  await p.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(p.getByTestId('patchbay-page')).toBeVisible()
}

test('team keys: a member’s key 1 on the owner’s agent names the confirm before and leaves it waiting after; key 3 is the owners’ (named); the owner sees the waiting agent’s fuse and confirms in the editor first', async ({ page, context }) => {
  await signIn(page, email('mara'))
  expect((await api(page, 'PATCH', '/api/me', { name: 'Mara Lind' })).status).toBe(200)
  const maraId = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id
  const wsId = await createWorkspace(page, 'Nordlicht Schaltplan')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  expect((await api(member, 'PATCH', '/api/me', { name: 'Tessera Nord' })).status).toBe(200)
  const tesseraId = (await api<{ user: { id: string } }>(member, 'GET', '/api/me')).json.user.id
  await join(page, member, wsId, 'member')
  await openApp(page, wsId)
  await waitOnline(page)
  await seedTeamF1(page, maraId)
  await openApp(member, wsId)
  await waitOnline(member)
  await expect.poll(() => wsEval(member, (s) => s.agents?.agInbox?.write ?? null)).toBe('apply')

  // the member: F1 with the confirm note before the press; key 3 inert, the owners and admins named, "Copy link" to hand it over
  await openPatchbayIn(member)
  await expect(pbPanel(member).getByRole('heading', { level: 2 })).toHaveText('Fuse F1 · open path')
  await expect(pbKeyRow(member, 1).getByTestId('pb-fkey-team')).toHaveText('The agent then waits for Mara Lind to confirm it.')
  await expect(pbKey(member, 3)).toHaveAttribute('aria-disabled', 'true')
  await expect(pbKeyRow(member, 3).getByTestId('pb-fkey-why')).toHaveText('Only owners and admins: Mara Lind')
  await expect(pbPanel(member).getByTestId('pb-fkey-copy')).toBeVisible()
  await pbKey(member, 3).focus()
  await member.keyboard.press('Enter')
  await expect(member.getByTestId('pb-live')).toContainText('Allow this path — not possible here: Only owners and admins: Mara Lind')
  expect(await wsEval(member, (s) => s.fuseSignoffs ?? null)).toBeNull()

  // key 1: the agent writes proposals now — and waits for its creator (the member saved it)
  await pbKey(member, 1).click()
  await expect(pbPanel(member).getByTestId('pb-closed-head')).toHaveText('Fuse F1 · closed — Inbox-Helfer: Apply directly → Proposals for review')
  await expect(member.locator('.toast').filter({ hasText: 'Fuse F1 closed' }).last()).toContainText('The agent then waits for Mara Lind to confirm it.')
  await expect.poll(() => wsEval(page, (s) => [s.agents.agInbox.write, s.agents.agInbox.updatedBy])).toEqual(['stage', tesseraId])

  // the member's Undo puts "apply" back — the agent still waits for Mara (the member saved it last); the toast says so
  await pbPanel(member).getByTestId('pb-closed-head').focus()
  await member.keyboard.press('Control+z')
  await expect(member.locator('.toast').filter({ hasText: 'Taken back — fuse F1 is open again' }).last()).toContainText('The agent still waits for Mara Lind to confirm it.')
  // fix (safety-data): the member who changed it reads whose confirm the agent waits for — never "your confirm"
  await expect(pbPanel(member).locator('.pb-fact[data-fact="awaitsConfirm"]')).toContainText('waits for Mara Lind to confirm it')
  await expect.poll(() => wsEval(page, (s) => [s.agents.agInbox.write, s.agents.agInbox.updatedBy, s.agents.agInbox.createdBy])).toEqual(['apply', tesseraId, maraId])

  // the owner (the creator) sees the fuse of the agent a member changed, before confirming (§6 A8) — and is sent to the
  // editor first: a key saved as Mara would run Tessera's version unseen
  await openPatchbayIn(page)
  await expect(pbPanel(page).getByRole('heading', { level: 2 })).toHaveText('Fuse F1 · open path')
  await expect(pbPanel(page).locator('.pb-fact[data-fact="awaitsConfirm"]')).toContainText('waits for your confirm — changed by Tessera Nord')
  await expect(pbKey(page, 1)).toHaveAttribute('aria-disabled', 'true')
  await expect(pbKeyRow(page, 1).getByTestId('pb-fkey-why')).toHaveText('Inbox-Helfer waits for your confirm — changed by Tessera Nord. Confirm it in its editor first.')
  await expect(pbKey(page, 3)).not.toHaveAttribute('aria-disabled', 'true')
  await member.context().close()
})

test('team keys: an admin sees the grey row of a path only another member’s browser can see; a viewer gets a neutral LED and no Preflight lamp', async ({ page, context }) => {
  await signIn(page, email('mara'))
  expect((await api(page, 'PATCH', '/api/me', { name: 'Mara Lind' })).status).toBe(200)
  const maraId = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id
  const wsId = await createWorkspace(page, 'Nordlicht Schaltplan Gast')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  expect((await api(member, 'PATCH', '/api/me', { name: 'Tessera Nord' })).status).toBe(200)
  const tesseraId = (await api<{ user: { id: string } }>(member, 'GET', '/api/me')).json.user.id
  await join(page, member, wsId, 'member')
  const viewer = await newPerson(context)
  await signIn(viewer, email('gast'))
  await join(page, viewer, wsId, 'viewer')
  await openApp(page, wsId)
  await waitOnline(page)
  await seedTeamF1(page, maraId)

  // the member's own browser agent with a server of the member's browser: only that browser knows its tools
  await openApp(member, wsId)
  await waitOnline(member)
  await expect.poll(() => wsEval(member, (s) => !!s.agents?.agInbox)).toBe(true)
  await wsEval(member, (s, tesseraId) => {
    const now = Date.now()
    s.upsertAgent({ id: 'agTessera', name: 'Tessera-Spiegel', instructions: 'Spiegle die offenen Einträge von tracker.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: ['tracker'], runner: 'browser', model: null, effort: null, maxRunUsd: 0.4, enabled: true, createdAt: now, updatedAt: now, createdBy: tesseraId })
  }, tesseraId)
  await expect.poll(() => wsEval(page, (s) => !!s.agents?.agTessera)).toBe(true)

  // the owner: the grey row names the member whose browser alone sees that path
  await openPatchbayIn(page)
  const grey = page.locator('.pb-ftab[data-kind="unknown"]').filter({ hasText: 'Tessera Nord' })
  await expect(grey).toContainText('Fuse visible only in Tessera Nord’s browser — Tessera Nord can close it with key 1 or 2')
  await grey.click()
  await expect(pbPanel(page).getByTestId('pb-only-visible')).toHaveText('Fuse visible only in Tessera Nord’s browser — Tessera Nord can close it with key 1 or 2')

  // the viewer: the fuse is there, nothing to press — the LED in neutral ink, no Preflight lamp
  await openApp(viewer, wsId)
  await waitOnline(viewer)
  await expect(viewer.getByTestId('patchbay-nav-led')).toHaveAttribute('data-viewer', 'true')
  await expect(viewer.getByTestId('patchbay-nav-led').locator('.led')).not.toHaveClass(/led--on/)
  await expect
    .poll(() =>
      viewer.evaluate(async () => {
        const pf = (window as unknown as { __onePreflight?: { flush: (id?: string) => Promise<void>; state: () => { views: Array<{ id: string }> } } }).__onePreflight
        if (!pf) return 'no preflight'
        await pf.flush('fuses')
        return pf.state().views.some((v) => v.id === 'fuses') ? 'lamp' : 'none'
      }),
    )
    .toBe('none')
  await openPatchbayIn(viewer)
  await expect(pbKey(viewer, 1)).toHaveAttribute('aria-disabled', 'true')
  await expect(pbKeyRow(viewer, 1).getByTestId('pb-fkey-why')).toHaveText('You can only read this workspace.')
  await member.context().close()
  await viewer.context().close()
})

/* ------------------------------------------------------------------ B16: patching in a team */

/** This device's tracker server (tested: seven tools), its Patching switch on, the Patchbay open, its idle fold open. */
async function patchingOn(p: Page): Promise<void> {
  await wsEval(p, (s) =>
    s.updateSettings({
      mcpServers: [{ id: 'srvTracker', name: 'tracker', url: 'https://tracker.example/mcp', token: '', enabled: true, prompt: '', tools: ['query_issues', 'get_issue', 'whoami', 'create_issue', 'update_issue', 'add_comment', 'post_status'], checkedAt: 1 }],
    }),
  )
  await p.evaluate(() => localStorage.setItem('one.patchbay.patch', '1'))
  await openPatchbayIn(p)
  const fold = p.getByTestId('pb-fold').filter({ hasText: 'tracker' })
  if (await fold.count()) await fold.click()
  await expect(p.locator('.pb-jk[data-jack="server:srvTracker.write"]')).toBeVisible()
}

test('patching in a team: a member cannot lock a tool (OUT) — the owners and admins named; an admin can; a viewer gets no switch and no drop targets', async ({ page, context }) => {
  await signIn(page, email('mara'))
  expect((await api(page, 'PATCH', '/api/me', { name: 'Mara Lind' })).status).toBe(200)
  const maraId = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id
  const wsId = await createWorkspace(page, 'Nordlicht Patchen')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  expect((await api(member, 'PATCH', '/api/me', { name: 'Tessera Nord' })).status).toBe(200)
  await join(page, member, wsId, 'member')
  const admin = await newPerson(context)
  await signIn(admin, email('nordlicht'))
  expect((await api(admin, 'PATCH', '/api/me', { name: 'Nordlicht Ops' })).status).toBe(200)
  await join(page, admin, wsId, 'admin')
  const viewer = await newPerson(context)
  await signIn(viewer, email('gast'))
  await join(page, viewer, wsId, 'viewer')
  await openApp(page, wsId)
  await waitOnline(page)
  await seedTeamF1(page, maraId)
  // the profile IN-01 matches the tracker server by name (an owner writes it)
  expect(await wsEval(page, (s) => s.upsertIntegration({ schema: 'one.integration/1', id: 'in-01', name: 'IN-01', match: { name: 'tracker' }, unlocks: [], reads: ['query_issues', 'get_issue', 'whoami'] }))).toBe(true)

  // the member: the OUT lock is listed, refused with the owners and admins named — nothing written
  await openApp(member, wsId)
  await waitOnline(member)
  await expect.poll(() => wsEval(member, (s) => (s.integrations ?? []).length)).toBe(1)
  await patchingOn(member)
  await member.locator('.pb-jk[data-jack="server:srvTracker.write"]').click()
  const lockRow = (p: Page) => p.getByTestId('pb-connect').locator('[data-choice="lock:in-01:create_issue"]')
  await expect(lockRow(member)).toHaveAttribute('data-state', 'refused')
  await expect(lockRow(member)).toHaveAttribute('aria-disabled', 'true')
  await expect(lockRow(member).getByTestId('pb-connect-why')).toContainText('Only owners and admins lock a tool:')
  await expect(lockRow(member).getByTestId('pb-connect-why')).toContainText('Mara Lind')
  await expect(lockRow(member).getByTestId('pb-connect-why')).toContainText('Nordlicht Ops')
  await member.keyboard.press('Escape')

  // an admin: locked — the profile's OUT tools hold it for every member
  await openApp(admin, wsId)
  await waitOnline(admin)
  await expect.poll(() => wsEval(admin, (s) => (s.integrations ?? []).length)).toBe(1)
  await patchingOn(admin)
  await admin.locator('.pb-jk[data-jack="server:srvTracker.write"]').click()
  await expect(lockRow(admin)).toHaveAttribute('data-state', 'ok')
  await expect(lockRow(admin)).toContainText('create_issue → Outbox · IN-01')
  await lockRow(admin).click()
  await expect(admin.locator('.toast').filter({ hasText: 'Locked: create_issue (OUT) · Outbox · IN-01' }).last()).toBeVisible()
  await expect.poll(() => wsEval(page, (s) => (s.integrations as AnyState[])[0]?.outTools ?? null)).toEqual(['create_issue'])
  await expect.poll(() => wsEval(member, (s) => (s.integrations as AnyState[])[0]?.outTools ?? null)).toEqual(['create_issue'])

  // the viewer: no switch, the jacks no drop targets, a click opens nothing
  await openApp(viewer, wsId)
  await waitOnline(viewer)
  await viewer.evaluate(() => localStorage.setItem('one.patchbay.patch', '1'))
  await openPatchbayIn(viewer)
  await expect(viewer.getByTestId('pb-wires')).toBeVisible()
  await expect(viewer.getByTestId('pb-patching')).toHaveCount(0)
  await expect(viewer.getByTestId('pb-bench')).not.toHaveAttribute('data-patching', '')
  const j = viewer.locator('.pb-jk[data-jack="agent:agInbox.start"]')
  await j.click()
  await expect(viewer.getByTestId('pb-connect')).toHaveCount(0)
  const b = (await j.locator('.pb-jack').boundingBox())!
  await viewer.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await viewer.mouse.down()
  await viewer.mouse.move(b.x + 200, b.y + 40, { steps: 6 })
  await expect(viewer.getByTestId('pb-drag')).toHaveCount(0)
  await viewer.mouse.up()
  await member.context().close()
  await admin.context().close()
  await viewer.context().close()
})
