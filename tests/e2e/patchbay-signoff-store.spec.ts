/**
 * The Patchbay's allowed paths in the store (B9 — Workspace.fuseSignoffs, store/fuseSignoffs.ts, plan §1.10 / §2.8):
 *  - the reader (Node): path keys and signatures 64 hex, part digests ≤ 24 × `[a-z]\d{0,2}` → 16 hex, `at` finite,
 *    `updatedBy` ≤ 200 or null; a broken entry is left out (its fuse stays open); ≤ 500 entries, the newest kept;
 *    unknown fields of an entry kept while ≤ 1 KB; a clean map reads as itself and any other input's answer is the same
 *    object every time (B2's memo keeps its reference); nothing pollutes a prototype; sameSignoffs by value; the
 *    writers' helpers and the guard's refusals in order (readOnly → rights → server);
 *  - the writers in the app (signOffFuse / withdrawSignoff, under the test hook's writer): an allowance written and read
 *    back, the same signature again is no change, junk is refused; the local persistence round trip (the meta record
 *    holds it, a reload reads it, another tab gets it and its withdrawal without a reload); a re-hydrate (a workspace
 *    switch) never keeps the previous workspace's;
 *  - backups: a full backup carries them, a page backup never; a restore (replace or merge) keeps THIS workspace's — a
 *    file holding allowances for its own wiring brings none (§6 A14);
 *  - the local reset wipes every Patchbay store: IndexedDB `one-patchbay`, localStorage `one.patchbay.*`, this tab's
 *    sessionStorage return chip (the device copy's wipe of a team workspace: tests/e2e-cloud/patchbay.spec.ts).
 * Path keys and signatures are made-up hex; every name is fictional.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect, openApp, reloadApp, flush, wsEval, gotoPage, pageIdByTitle, MOD } from './fixtures'
import { exportBackup, importBackup } from './helpers/backup'
import {
  SIGNOFF_LIMITS,
  sameSignoffs,
  sanitizeFuseSignoffs,
  setSignoffGuard,
  signoffAdmins,
  signoffEntry,
  signoffRefusal,
  signoffRefused,
  signoffsAllowed,
  withoutSignoff,
  withSignoff,
} from '../../src/app/store/fuseSignoffs'
import type { FuseSignoff } from '../../src/app/store/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Hook = { __one: { workspace: { getState: () => AnyState; setState: (x: object) => void } }; __pbRef?: unknown }

/** 64 hex from one character (a made-up path key / signature); 16 hex likewise (a part digest). */
const hex = (c: string) => c.repeat(64)
const h16 = (c: string) => c.repeat(16)
const K1 = hex('a')
const K2 = hex('b')
const K3 = hex('c')
const PARTS = { d: h16('d'), a1: h16('e'), x: h16('f') }
const entry = (sig: string, at = 1000, extra: Record<string, unknown> = {}): FuseSignoff => ({ sig: hex(sig), parts: { ...PARTS }, at, updatedBy: null, ...extra }) as FuseSignoff
/** a path key from a number (for the cap): 64 hex */
const keyOf = (n: number) => n.toString(16).padStart(64, '0')

/* ------------------------------------------------------------------ the reader (Node) */

test.describe('the reader — store/fuseSignoffs.ts (Node)', () => {
  test('nothing reads as one frozen {}; a clean map reads as itself; a reader of its own answer changes nothing', () => {
    const none = sanitizeFuseSignoffs(undefined)
    expect(none).toEqual({})
    expect(Object.isFrozen(none)).toBe(true)
    for (const raw of [null, 7, 'text', [entry('1')], {}, true]) expect(sanitizeFuseSignoffs(raw)).toBe(none)
    const clean = { [K1]: entry('1'), [K2]: entry('2', 2000, { by: 'later build' }) }
    expect(sanitizeFuseSignoffs(clean)).toBe(clean)
    expect(sanitizeFuseSignoffs(sanitizeFuseSignoffs(clean))).toBe(clean)
  })

  test('bad keys and broken entries are left out (their fuses stay open); a missing updatedBy reads as null', () => {
    const bad: Record<string, unknown> = {
      [K1]: entry('1'),
      ['A'.repeat(64)]: entry('2'), // upper case
      ['a'.repeat(63)]: entry('3'), // too short
      ['g'.repeat(64)]: entry('4'), // not hex
      [K2]: { ...entry('5'), sig: 'B'.repeat(64) },
      [K3]: { ...entry('6'), sig: 7 },
      [keyOf(1)]: { ...entry('7'), parts: [h16('d')] },
      [keyOf(2)]: { ...entry('7'), parts: { A: h16('d') } },
      [keyOf(3)]: { ...entry('7'), parts: { ab: h16('d') } },
      [keyOf(4)]: { ...entry('7'), parts: { a123: h16('d') } },
      [keyOf(5)]: { ...entry('7'), parts: { d: 'd'.repeat(15) } },
      [keyOf(6)]: { ...entry('7'), parts: Object.fromEntries(Array.from({ length: SIGNOFF_LIMITS.parts + 1 }, (_, i) => [`p${i}`, h16('d')])) },
      [keyOf(7)]: { ...entry('7'), at: Number.NaN },
      [keyOf(8)]: { ...entry('7'), at: Number.POSITIVE_INFINITY },
      [keyOf(9)]: { ...entry('7'), at: '1000' },
      [keyOf(10)]: { ...entry('7'), updatedBy: '' },
      [keyOf(11)]: { ...entry('7'), updatedBy: 'x'.repeat(SIGNOFF_LIMITS.updatedBy + 1) },
      [keyOf(12)]: { ...entry('7'), updatedBy: 42 },
      [keyOf(13)]: 'not an entry',
      [keyOf(14)]: { sig: hex('8'), at: 1 },
      [keyOf(15)]: (() => {
        const { updatedBy: _u, ...rest } = entry('9', 3000)
        return rest
      })(),
      [keyOf(16)]: { ...entry('a'), parts: { d: h16('d'), a99: h16('e') }, updatedBy: 'u'.repeat(SIGNOFF_LIMITS.updatedBy) },
    }
    const got = sanitizeFuseSignoffs(bad)
    expect(Object.keys(got).sort()).toEqual([K1, keyOf(15), keyOf(16)].sort())
    expect(got[keyOf(15)]).toEqual({ sig: hex('9'), parts: PARTS, at: 3000, updatedBy: null })
    expect(got[keyOf(16)].updatedBy).toHaveLength(SIGNOFF_LIMITS.updatedBy)
    // an answer the reader made is frozen, and the same input gets the same object again
    expect(Object.isFrozen(got) && Object.isFrozen(got[K1]) && Object.isFrozen(got[K1].parts)).toBe(true)
    expect(sanitizeFuseSignoffs(bad)).toBe(got)
    // read again, the answer is clean: itself
    expect(sanitizeFuseSignoffs(got)).toBe(got)
  })

  test('no prototype is touched: a stored "__proto__" key or field is plain data', () => {
    const raw = JSON.parse(`{"__proto__": {"polluted": true}, "${K1}": {"sig": "${hex('1')}", "parts": {}, "at": 1, "updatedBy": null, "__proto__": {"polluted": true}, "constructor": 1}}`)
    const got = sanitizeFuseSignoffs(raw)
    expect(Object.keys(got)).toEqual([K1])
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(got[K1])).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(got[K1]).sort()).toEqual(['at', 'parts', 'sig', 'updatedBy'])
  })

  test('at most 500: the newest kept (at the same time, the lower key stays)', () => {
    const raw: Record<string, FuseSignoff> = {}
    for (let i = 0; i < SIGNOFF_LIMITS.entries + 3; i++) raw[keyOf(i)] = entry('1', 10_000 + i)
    // one shares its time with the fourth oldest: the key decides which of the two goes
    raw[keyOf(1000)] = entry('2', 10_003)
    const got = sanitizeFuseSignoffs(raw)
    expect(Object.keys(got)).toHaveLength(SIGNOFF_LIMITS.entries)
    for (const gone of [keyOf(0), keyOf(1), keyOf(2), keyOf(1000)]) expect(got[gone], gone).toBeUndefined()
    for (const kept of [keyOf(3), keyOf(4), keyOf(SIGNOFF_LIMITS.entries + 2)]) expect(got[kept], kept).toBeTruthy()
    // the answer is ordered by key and reads as itself
    expect(Object.keys(got)).toEqual([...Object.keys(got)].sort())
    expect(sanitizeFuseSignoffs(got)).toBe(got)
  })

  test('unknown fields of an entry (a later build’s) are kept while ≤ 1 KB, else dropped — the entry stays', () => {
    const small = { note: 'n'.repeat(900), nested: { b: 2, a: [1, 2] } }
    const big = { note: 'n'.repeat(SIGNOFF_LIMITS.extraBytes + 10) }
    const odd = { fn: () => 1, gone: undefined, ok: 'kept' }
    const got = sanitizeFuseSignoffs({ [K1]: entry('1', 1, small), [K2]: entry('2', 2, big), [K3]: entry('3', 3, odd) })
    expect(got[K1]).toEqual({ ...entry('1', 1), ...small })
    expect(got[K2]).toEqual(entry('2', 2))
    expect(got[K3]).toEqual({ ...entry('3', 3), ok: 'kept' })
    // multi-byte text counts in bytes: 400 × "ä" = 800 bytes kept, 600 × "ä" = 1200 bytes not
    const de = sanitizeFuseSignoffs({ [K1]: entry('1', 1, { t: 'ä'.repeat(400) }), [K2]: entry('2', 2, { t: 'ä'.repeat(600) }) })
    expect((de[K1] as unknown as Record<string, unknown>).t).toHaveLength(400)
    expect((de[K2] as unknown as Record<string, unknown>).t).toBeUndefined()
  })

  test('sameSignoffs: by value — key order of unknown fields aside; none = {}; any field differs → not the same', () => {
    const a = { [K1]: entry('1', 1, { x: { b: 1, a: 2 } }) }
    const b = { [K1]: entry('1', 1, { x: { a: 2, b: 1 } }) }
    expect(sameSignoffs(a, b)).toBe(true)
    expect(sameSignoffs(undefined, {})).toBe(true)
    expect(sameSignoffs(undefined, null)).toBe(true)
    expect(sameSignoffs(a, undefined)).toBe(false)
    for (const over of [{ sig: hex('2') }, { at: 2 }, { updatedBy: 'acct-1' }, { parts: { ...PARTS, x: h16('0') } }, { parts: { d: h16('d') } }, { x: { a: 3, b: 1 } }]) {
      expect(sameSignoffs(a, { [K1]: { ...a[K1], ...over } as FuseSignoff }), JSON.stringify(over)).toBe(false)
    }
    expect(sameSignoffs(a, { [K2]: a[K1] })).toBe(false)
    // what a store holds unread (a broken write) is never the same as an entry — and never throws
    const broken = { [K1]: { sig: hex('1'), at: 1, updatedBy: null } } as unknown as Record<string, FuseSignoff>
    expect(sameSignoffs(broken, a)).toBe(false)
    expect(sameSignoffs(a, { [K1]: 'junk' } as unknown as Record<string, FuseSignoff>)).toBe(false)
  })

  test('the writers’ helpers: an entry checked, one more (the newest 500 kept, never the new one dropped), one less', () => {
    expect(signoffEntry({ sig: hex('1'), parts: PARTS, at: 5, updatedBy: null })).toEqual(entry('1', 5))
    expect(signoffEntry({ sig: hex('1'), parts: { D: h16('d') }, at: 5, updatedBy: null })).toBeNull()
    expect(signoffEntry({ sig: 'nope', parts: PARTS, at: 5, updatedBy: null })).toBeNull()
    const full: Record<string, FuseSignoff> = {}
    for (let i = 0; i < SIGNOFF_LIMITS.entries; i++) full[keyOf(i)] = entry('1', 10_000 + i)
    // the new one is older than all of them (a clock behind): it stays anyway, the oldest kept one goes
    const next = withSignoff(full, K1, entry('2', 5))
    expect(Object.keys(next)).toHaveLength(SIGNOFF_LIMITS.entries)
    expect(next[K1]).toEqual(entry('2', 5))
    expect(next[keyOf(0)]).toBeUndefined()
    // replacing one keeps the count
    expect(Object.keys(withSignoff(full, keyOf(7), entry('3', 1)))).toHaveLength(SIGNOFF_LIMITS.entries)
    expect(withoutSignoff({ [K1]: entry('1') }, K1)).toBeUndefined()
    expect(withoutSignoff({ [K1]: entry('1'), [K2]: entry('2') }, K1)).toEqual({ [K2]: entry('2') })
  })

  test('the guard: locally allowed; a team says which refused, in order (read only → rights → server); names the admins', () => {
    expect([signoffRefusal(), signoffRefused(), signoffsAllowed(), signoffAdmins()]).toEqual([null, null, true, []])
    const team = { writable: true, rights: true, server: true }
    setSignoffGuard({ writable: () => team.writable, rights: () => team.rights, server: () => team.server, admins: () => ['Mara Lind'] })
    try {
      expect(signoffRefusal()).toBeNull()
      team.server = false
      expect(signoffRefusal()).toBe('server')
      expect(signoffRefused()).toEqual({ ok: false, why: 'server' })
      team.rights = false
      expect(signoffRefusal()).toBe('rights')
      // the refusal names the owners and admins
      expect(signoffRefused()).toEqual({ ok: false, why: 'rights', admins: ['Mara Lind'] })
      team.writable = false
      expect([signoffRefusal(), signoffsAllowed()]).toEqual(['readOnly', false])
      expect(signoffAdmins()).toEqual(['Mara Lind'])
    } finally {
      setSignoffGuard(null)
    }
    expect(signoffRefusal()).toBeNull()
  })
})

/* ------------------------------------------------------------------ the app */

const signOff = (p: Page, key: string, sig: string, parts: Record<string, string> = PARTS) =>
  wsEval(p, (s, a) => s.signOffFuse(a.key, a.sig, a.parts) as { ok: boolean; why?: string }, { key, sig, parts })
const withdraw = (p: Page, key: string) => wsEval(p, (s, k) => s.withdrawSignoff(k) as { ok: boolean; why?: string }, key)
const signoffsOf = (p: Page) => wsEval(p, (s) => (s.fuseSignoffs ? JSON.parse(JSON.stringify(s.fuseSignoffs)) : null) as Record<string, AnyState> | null)
const sigsOf = async (p: Page) => {
  const m = await signoffsOf(p)
  return m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.sig as string])) : null
}
/** Remember the store's map (by reference) — and ask later whether it is still that very object. */
const keepRef = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as Hook
    w.__pbRef = w.__one.workspace.getState().fuseSignoffs
    return w.__pbRef !== undefined
  })
const sameRef = (p: Page) => p.evaluate(() => (window as unknown as Hook).__one.workspace.getState().fuseSignoffs === (window as unknown as Hook).__pbRef)
/** The local workspace's stored meta record (IndexedDB keyval-store / one.ws.v2). */
const storedMeta = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<AnyState | null>((resolve, reject) => {
        const req = indexedDB.open('keyval-store')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const get = db.transaction('keyval').objectStore('keyval').get('one.ws.v2')
          get.onsuccess = () => {
            db.close()
            resolve((get.result as AnyState | undefined) ?? null)
          }
          get.onerror = () => reject(get.error)
        }
      }),
  )

/** ⌘K → Export on a page: this page only, full backup → the parsed file. */
async function exportPageBackup(page: Page, testInfo: TestInfo, title: string) {
  await gotoPage(page, await pageIdByTitle(page, title))
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('>export')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Full backup/ }).click()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  const file = testInfo.outputPath('page.json')
  await (await download).saveAs(file)
  await page.keyboard.press('Escape')
  return JSON.parse(readFileSync(file, 'utf8'))
}

test.describe('Workspace.fuseSignoffs in the app', () => {
  test('signOffFuse / withdrawSignoff: written and read back; the same signature is no change; junk refused', async ({ page }) => {
    await openApp(page)
    expect(await signoffsOf(page)).toBeNull()
    const before = Date.now()
    expect(await signOff(page, K1, hex('1'))).toEqual({ ok: true })
    const m = await signoffsOf(page)
    expect(Object.keys(m ?? {})).toEqual([K1])
    expect(m![K1]).toMatchObject({ sig: hex('1'), parts: PARTS, updatedBy: null })
    expect(m![K1].at).toBeGreaterThanOrEqual(before)
    // the same path with the same signature: nothing changes (who allowed it and when stay — the same object)
    expect(await keepRef(page)).toBe(true)
    expect(await signOff(page, K1, hex('1'))).toEqual({ ok: true })
    expect(await sameRef(page)).toBe(true)
    // the path changed (a new signature): allowed again, a new entry
    expect(await signOff(page, K1, hex('2'))).toEqual({ ok: true })
    expect(await sigsOf(page)).toEqual({ [K1]: hex('2') })
    // junk: no path key, no signature, broken parts — refused, nothing written
    for (const [key, sig, parts] of [
      ['not-a-key', hex('3'), PARTS],
      [K2, 'short', PARTS],
      [K2, hex('3'), { D: h16('d') }],
      [K2, hex('3'), { d: 'x' }],
    ] as const) expect(await signOff(page, key, sig, parts as Record<string, string>), `${key} ${sig}`).toEqual({ ok: false, why: 'invalid' })
    expect(await withdraw(page, 'nope')).toEqual({ ok: false, why: 'invalid' })
    expect(await sigsOf(page)).toEqual({ [K1]: hex('2') })
    // withdraw: a path not allowed is no change; the last one gone = none (undefined, not {})
    expect(await withdraw(page, K3)).toEqual({ ok: true })
    expect(await withdraw(page, K1)).toEqual({ ok: true })
    expect(await wsEval(page, (s) => [s.fuseSignoffs === undefined, 'fuseSignoffs' in s])).toEqual([true, true])
  })

  test('local persistence: the meta record holds it, a reload reads it, another tab gets it and its withdrawal', async ({ page }) => {
    await openApp(page)
    expect(await signOff(page, K1, hex('1'))).toEqual({ ok: true })
    expect(await signOff(page, K2, hex('2'))).toEqual({ ok: true })
    await flush(page)
    const meta = await storedMeta(page)
    expect(Object.keys((meta?.fuseSignoffs as AnyState | null) ?? {}).sort()).toEqual([K1, K2])
    await reloadApp(page)
    expect(await sigsOf(page)).toEqual({ [K1]: hex('1'), [K2]: hex('2') })

    // another tab reads it at boot; its withdrawal reaches this tab without a reload (the meta record's change)
    const b = await page.context().newPage()
    await openApp(b)
    expect(await sigsOf(b)).toEqual({ [K1]: hex('1'), [K2]: hex('2') })
    expect(await keepRef(page)).toBe(true)
    expect(await withdraw(b, K1)).toEqual({ ok: true })
    await flush(b)
    await expect.poll(() => sigsOf(page)).toEqual({ [K2]: hex('2') })
    expect(await sameRef(page)).toBe(false)
    // and this tab's own allowance reaches the other one
    expect(await signOff(page, K3, hex('3'))).toEqual({ ok: true })
    await flush(page)
    await expect.poll(() => sigsOf(b)).toEqual({ [K2]: hex('2'), [K3]: hex('3') })
    await b.close()

    // a stored record with junk in it: the reader leaves the junk out at boot
    await page.evaluate(
      ({ bad }) =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('keyval-store')
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('keyval', 'readwrite')
            const os = tx.objectStore('keyval')
            const get = os.get('one.ws.v2')
            get.onsuccess = () => os.put({ ...get.result, fuseSignoffs: { ...get.result.fuseSignoffs, ...bad } }, 'one.ws.v2')
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
          req.onerror = () => reject(req.error)
        }),
      { bad: { ['Z'.repeat(64)]: { sig: hex('9'), parts: {}, at: 1 }, [hex('d')]: { sig: 'broken', parts: {}, at: 1 } } },
    )
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    expect(await sigsOf(page)).toEqual({ [K2]: hex('2'), [K3]: hex('3') })
  })

  test('a re-hydrate (a workspace switch) takes the new workspace’s — none stays none; the same value keeps its object', async ({ page }) => {
    await openApp(page)
    expect(await signOff(page, K1, hex('1'))).toEqual({ ok: true })
    expect(await keepRef(page)).toBe(true)
    const rehydrate = (p: Page, signoffs: unknown) =>
      p.evaluate((so) => {
        const s = (window as unknown as Hook).__one.workspace.getState() as AnyState & { hydrate: (ws: object) => void }
        const snap = JSON.parse(JSON.stringify({ version: s.version, epoch: s.epoch, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, integrations: s.integrations }))
        s.hydrate(so === undefined ? snap : { ...snap, fuseSignoffs: so })
      }, signoffs)
    // the same value, a new object: the reference stays
    await rehydrate(page, JSON.parse(JSON.stringify(await signoffsOf(page))))
    expect(await sameRef(page)).toBe(true)
    // a workspace without any: none (never the previous workspace's)
    await rehydrate(page, undefined)
    expect(await signoffsOf(page)).toBeNull()
    // one with junk: read through the reader
    await rehydrate(page, { [K2]: { sig: hex('2'), parts: PARTS, at: 1, updatedBy: null }, nope: { sig: hex('3') } })
    expect(await sigsOf(page)).toEqual({ [K2]: hex('2') })
  })

  test('backups: full ones carry them, page ones never; a restore (replace or merge) keeps this workspace’s — a file brings none', async ({ page }, testInfo) => {
    await openApp(page)
    expect(await signOff(page, K1, hex('1'))).toEqual({ ok: true })
    await flush(page)

    // a full backup carries them (positive control), a page backup never
    const { file: ownFile, json } = await exportBackup(page, testInfo, 'full.json')
    expect(Object.keys(json.workspace.fuseSignoffs ?? {})).toEqual([K1])
    expect((await exportPageBackup(page, testInfo, 'Welcome to One')).workspace.fuseSignoffs).toBeUndefined()

    // a file with other allowances, restored by replace: the workspace is the file's (a page proves it), the allowances ours
    expect(await keepRef(page)).toBe(true)
    const other = JSON.parse(JSON.stringify(json))
    other.workspace.fuseSignoffs = { [K2]: entry('2', Date.now()), [K3]: entry('3', Date.now()) }
    const proof = Object.values(other.workspace.pages as Record<string, { title: string }>)[0]
    proof.title = 'Restored from the file'
    const otherFile = testInfo.outputPath('other.json')
    writeFileSync(otherFile, JSON.stringify(other))
    await importBackup(page, otherFile, 'replace')
    await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((p) => p.title === 'Restored from the file'))).toBe(true)
    expect(await sigsOf(page)).toEqual({ [K1]: hex('1') })
    expect(await sameRef(page)).toBe(true)
    // merge: the file's are never taken either
    await importBackup(page, otherFile, 'merge')
    expect(await sigsOf(page)).toEqual({ [K1]: hex('1') })
    expect(await sameRef(page)).toBe(true)

    // the file of this very workspace — an allowance for its own wiring — into a workspace that has none now: none arrive
    expect(await withdraw(page, K1)).toEqual({ ok: true })
    await importBackup(page, ownFile, 'replace')
    expect(await signoffsOf(page)).toBeNull()
    await importBackup(page, ownFile, 'merge')
    expect(await signoffsOf(page)).toBeNull()
    await importBackup(page, otherFile, 'merge')
    expect(await signoffsOf(page)).toBeNull()
    await reloadApp(page)
    expect(await signoffsOf(page)).toBeNull()
  })

  test('the local reset wipes every Patchbay store: IndexedDB one-patchbay, localStorage one.patchbay.*, the return chip', async ({ page }) => {
    await openApp(page)
    // the stores as the Patchbay keeps them (features/patchbay/cache.ts): records of this and of a team scope, the
    // device's switches and row orders, this tab's return chip — and a key of someone else that stays
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('one-patchbay')
          req.onupgradeneeded = () => req.result.createObjectStore('kv')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('kv', 'readwrite')
            tx.objectStore('kv').put({ hosts: ['tracker.example'] }, 'local:local|lazy')
            tx.objectStore('kv').put({ n: { 'agent:nl-1': 2 } }, 'local:local|runs|2026-10-14')
            tx.objectStore('kv').put({ profileId: 'IN-01' }, 'cloud:Nordlicht1:u:acct-mara|setup')
            tx.oncomplete = () => {
              db.close()
              localStorage.setItem('one.patchbay.seen', '1')
              localStorage.setItem('one.patchbay.patch', '1')
              localStorage.setItem('one.patchbay.order:local:local', '["agent:nl-1"]')
              localStorage.setItem('one.patchbay.order:cloud:Nordlicht1:u:acct-mara', '["agent:nl-2"]')
              localStorage.setItem('one.textScale', '2')
              sessionStorage.setItem('one.patchbay.return', '{"profileId":"IN-01","next":"04"}')
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    await page.evaluate(() => localStorage.setItem('one.resetPending', '1'))
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const left = await page.evaluate(async () => {
      const dbs = (await indexedDB.databases()).map((d) => d.name)
      const ls = Object.keys(localStorage).filter((k) => k.startsWith('one.patchbay.'))
      return { db: dbs.includes('one-patchbay'), ls, chip: sessionStorage.getItem('one.patchbay.return'), scale: localStorage.getItem('one.textScale') }
    })
    expect(left).toEqual({ db: false, ls: [], chip: null, scale: '2' })
  })
})
