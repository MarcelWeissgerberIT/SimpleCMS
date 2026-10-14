/**
 * The Patchbay in a team workspace — the store level of B9 (against the real server):
 *  - the allowed paths are the owners' and admins' (meta map `fuseSignoffs`): an owner's signOffFuse reaches a member's
 *    store at once, stamped by the server with the owner's account — the member reads the owner's name from it;
 *  - a member's writer is refused ('rights', naming the owners and admins); a member's store that holds other allowances
 *    anyway gets the team's back (the binding's put-back) and the document never sees them; the member's raw write into
 *    the document is put back by the server;
 *  - a server that does not announce 'signoffs' refuses the owner's writer ('server' — the Patchbay says
 *    `features.patchbay.key.serverOld`); positive control: announced again, it writes; a withdrawal reaches the member;
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

  // a server that does not guard the map (its /api/config without 'signoffs'): the owner's writer refuses — 'server'
  await page.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: (c.getState().supports as string[]).filter((x) => x !== 'signoffs') })
  })
  expect(await signOff(page, K2, hex('4'))).toEqual({ ok: false, why: 'server' })
  expect(await withdraw(page, K1)).toEqual({ ok: false, why: 'server' })
  expect(await sigsOf(page)).toEqual({ [K1]: hex('1') })
  // … and the owner's own store holding another value then is put back too (the binding writes nothing)
  await page.evaluate(({ k2, parts }) => (window as unknown as Hook).__one.workspace.setState({ fuseSignoffs: { [k2]: { sig: '5'.repeat(64), parts, at: Date.now(), updatedBy: null } } }), { k2: K2, parts: PARTS })
  await expect.poll(() => sigsOf(page)).toEqual({ [K1]: hex('1') })
  // positive control: announced again, the owner writes
  await page.evaluate(() => {
    const c = (window as unknown as Hook).__one.cloud.useCloud
    c.setState({ supports: [...(c.getState().supports as string[]), 'signoffs'] })
  })
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
