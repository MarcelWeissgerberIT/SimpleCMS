/**
 * Provider keys (multi-provider S2, A9): an OpenRouter key lives in the vault (a marker in settings, the secret sealed),
 * never in the clear anywhere this origin stores data; connecting OpenRouter with its OAuth PKCE flow (consent page,
 * exchange and key check mocked from the documented formats — helpers/providers.ts mockOpenRouter; nothing reaches
 * openrouter.ai); the free key check. The connect key itself comes with the setup (stage C): these specs press it
 * through the `?e2e` seam `window.__oneAI.connectOpenRouter()`. Test data is fictional.
 */
import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, flush, waitForApp } from './fixtures'
import { mockOpenRouter, orCallback, type ORMock, type ORMockOpts } from './helpers/providers'
import { storageDump } from './helpers/oauth'
import { exportBackup, importBackup } from './helpers/backup'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** a pasted key (fictional) and the one the mocked exchange hands out */
const PASTED = 'sk-or-v1-e2e-pasted-key-6f1d00000000000000000000000000000000000000000000000Q7Rz'
const MINTED = 'sk-or-v1-e2e-minted-key-0a9c00000000000000000000000000000000000000000000000M4Tx'
const PREFIX = 'one.oauth.openrouter:'

const keysOf = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.aiKeys ?? null)))
const orState = (page: Page) => page.evaluate(() => (window as unknown as { __oneAI: { orConnectState(): Promise<AnyState> } }).__oneAI.orConnectState())
const verify = (page: Page, key?: string) => page.evaluate((k) => (window as unknown as { __oneAI: { verifyProvider(p: string, k?: string): Promise<AnyState> } }).__oneAI.verifyProvider('openrouter', k), key)
/** "Connect account" (the seam; the setup's key in stage C) — not awaited: the tab may go to OpenRouter itself */
const connect = (page: Page, o: { sameTab?: boolean } = {}) =>
  page.evaluate((opts) => {
    void (window as unknown as { __oneAI: { connectOpenRouter(o: unknown): Promise<void> } }).__oneAI.connectOpenRouter(opts)
  }, o)
/** the store as JSON (functions left out) */
const storeJson = (page: Page) => page.evaluate(() => JSON.stringify((window as unknown as { __one: { workspace: { getState(): unknown } } }).__one.workspace.getState(), (_k, v) => (typeof v === 'function' ? undefined : v)))
/** every place this origin keeps data, plus the store */
const everywhere = async (page: Page) => `${await storageDump(page)}\nstore ${await storeJson(page)}`
const exchanges = (or: ORMock) => or.to('/api/v1/auth/keys', 'POST')
const consents = (or: ORMock) => or.to('/auth', 'GET')
const pending = (page: Page) => page.evaluate((prefix) => Object.keys(sessionStorage).filter((k) => k.startsWith(prefix)), PREFIX)
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function open(page: Page, opts: ORMockOpts = {}): Promise<ORMock> {
  const or = await mockOpenRouter(page.context(), { exchange: MINTED, ...opts })
  await openApp(page)
  return or
}

/** Connect in a window; resolves the window once it is there. */
async function connectInWindow(page: Page): Promise<Page> {
  const popupP = page.context().waitForEvent('page')
  await connect(page)
  return popupP
}

test.describe('an OpenRouter key in the vault', () => {
  test('pasted: a marker in settings, sealed in the vault, the plaintext nowhere (scanner with a positive control); reload opens it; "" removes it', async ({ page }) => {
    const or = await open(page)
    // the scanner finds a planted string in localStorage, sessionStorage and IndexedDB (positive control)
    const PLANTED = 'e2e-planted-0b1c-needle'
    await page.evaluate(async (p) => {
      localStorage.setItem('e2e.planted', p)
      sessionStorage.setItem('e2e.planted', p)
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('e2e-control', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('kv')
        r.onsuccess = () => {
          const tx = r.result.transaction('kv', 'readwrite')
          tx.objectStore('kv').put({ deep: { value: p } }, 'k')
          tx.oncomplete = () => (r.result.close(), resolve())
          tx.onerror = () => reject(tx.error)
        }
        r.onerror = () => reject(r.error)
      })
    }, PLANTED)
    const control = await everywhere(page)
    expect(control.match(new RegExp(PLANTED, 'g'))?.length).toBe(3)
    await page.evaluate(async () => {
      localStorage.removeItem('e2e.planted')
      sessionStorage.removeItem('e2e.planted')
      await new Promise((r) => (indexedDB.deleteDatabase('e2e-control').onsuccess = r))
    })

    await wsEval(page, (s, k) => s.updateSettings({ aiKeys: { openrouter: k } }), PASTED)
    expect((await keysOf(page)).openrouter).toMatch(/^vault:[0-9a-z]{12}:Q7Rz$/)
    await flush(page)
    await expect.poll(() => storageDump(page)).toContain('ai-key:openrouter')
    // the check sends the key to openrouter.ai only (no text, no chat request)
    expect(await verify(page)).toMatchObject({ ok: true, credit: { limit: expect.any(Number) } })
    expect(or.to('/api/v1/key')).toHaveLength(1)
    expect(or.to('/api/v1/key')[0]!.bearer).toBe(PASTED)
    expect(or.posts()).toHaveLength(0)
    expect(await everywhere(page)).not.toContain(PASTED)

    // reload: the marker opens again (the key goes out as it was)
    await reloadApp(page)
    expect((await keysOf(page)).openrouter).toMatch(/:Q7Rz$/)
    expect(await verify(page)).toMatchObject({ ok: true })
    expect(or.to('/api/v1/key')[1]!.bearer).toBe(PASTED)
    expect(await everywhere(page)).not.toContain(PASTED)

    // '' removes the slot and the sealed secret
    await wsEval(page, (s) => s.updateSettings({ aiKeys: { openrouter: '' } }))
    expect(await keysOf(page)).toBeNull()
    await flush(page)
    await expect.poll(() => storageDump(page)).not.toContain('ai-key:openrouter')
    expect(await verify(page)).toEqual({ ok: false, code: 'no_key' })
  })

  test('a backup carries aiKeys {}; restoring it (merge and replace) keeps this device’s key', async ({ page }, testInfo) => {
    await open(page)
    await wsEval(page, (s, k) => s.updateSettings({ aiKeys: { openrouter: k } }), PASTED)
    const marker = (await keysOf(page)).openrouter as string
    await flush(page)
    const { file, json } = await exportBackup(page, testInfo, 'keys.json')
    expect(json.workspace.settings.aiKeys).toEqual({})
    expect(JSON.stringify(json)).not.toContain(PASTED)
    expect(JSON.stringify(json)).not.toContain(marker)
    for (const mode of ['merge', 'replace'] as const) {
      await importBackup(page, file, mode)
      expect((await keysOf(page)).openrouter).toBe(marker)
    }
    expect(await verify(page)).toMatchObject({ ok: true })
  })

  for (const [status, code] of [
    [401, 'invalid_key'],
    [402, 'no_credit'],
  ] as const)
    test(`the key check: ${status} → ${code}, no chat request`, async ({ page, errors }) => {
      errors.allow(/Failed to load resource|40[12]/)
      const or = await open(page, { key: status })
      expect(await verify(page, PASTED)).toEqual({ ok: false, code })
      expect(or.to('/api/v1/key')).toHaveLength(1)
      expect(or.posts()).toHaveLength(0)
    })
})

test.describe('connecting OpenRouter (PKCE, mocked consent)', () => {
  test('in a window: consent → the opener exchanges (never the window) → sealed → checked; the window closes; S256 + state + key_label', async ({ page, errors }) => {
    const or = await open(page)
    const popup = await connectInWindow(page)
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect.poll(() => orState(page)).toMatchObject({ phase: 'done', check: { ok: true } })
    // the consent address
    expect(consents(or)).toHaveLength(1)
    const q = new URL(consents(or)[0]!.url).searchParams
    expect(q.get('callback_url')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/app\/\?oauth=openrouter$/)
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('key_label')).toBe('One')
    expect(q.get('state')!.length).toBeGreaterThanOrEqual(16)
    // one exchange, from the tab that started it (the window holds no verifier), PKCE checked
    expect(exchanges(or)).toHaveLength(1)
    const ex = exchanges(or)[0]!
    expect(ex.page).toBe(page)
    expect(ex.body).toMatchObject({ code: 'code-e2e-0001', code_challenge_method: 'S256' })
    expect(b64url(createHash('sha256').update(String(ex.body!.code_verifier)).digest())).toBe(q.get('code_challenge'))
    // sealed, then checked with the key (no text sent)
    expect((await keysOf(page)).openrouter).toMatch(/^vault:[0-9a-z]{12}:M4Tx$/)
    expect(or.to('/api/v1/key')).toHaveLength(1)
    expect(or.to('/api/v1/key')[0]!.bearer).toBe(MINTED)
    expect(or.posts()).toHaveLength(0)
    expect(await pending(page)).toEqual([])
    await flush(page)
    const dump = await everywhere(page)
    expect(dump).not.toContain(MINTED)
    expect(dump).not.toContain('code-e2e-0001')
    expect(dump).not.toContain('user_e2e_fixture')
    expect(dump).not.toContain(String(ex.body!.code_verifier))
  })

  test('in this tab (the window was blocked): the tab goes to OpenRouter and back to #/oauth/openrouter, which finishes it; "Continue the setup" resumes at step 02', async ({ page }) => {
    const or = await open(page)
    await page.evaluate(() => (window.open = () => null))
    await connect(page)
    await page.waitForURL(/#\/oauth\/openrouter$/, { timeout: 20_000 })
    const screen = page.getByTestId('or-oauth-screen')
    await expect(screen).toHaveAttribute('data-phase', 'done', { timeout: 15_000 })
    await expect(screen.getByRole('heading')).toHaveText('OpenRouter connected')
    expect(new URL(page.url()).search).toBe('')
    expect(exchanges(or)).toHaveLength(1)
    expect(exchanges(or)[0]!.page).toBe(page)
    await screen.getByRole('button', { name: 'Continue the setup' }).click()
    expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('one.aiSetup.resume'))) ?? 'null')).toMatchObject({ step: '02', provider: 'openrouter' })
    await openApp(page)
    expect((await keysOf(page)).openrouter).toMatch(/:M4Tx$/)
  })

  const refused: Array<{ name: string; opts: ORMockOpts; issue: string; exchanges: number }> = [
    { name: 'denied (state echoed)', opts: { consent: 'deny-state' }, issue: 'oauth_denied', exchanges: 0 },
    { name: 'denied without state (one attempt open)', opts: { consent: 'deny' }, issue: 'oauth_denied', exchanges: 0 },
    { name: 'a code without state', opts: { consent: 'code-no-state' }, issue: 'oauth_state', exchanges: 0 },
    { name: 'a code with another state', opts: { consent: (u) => orCallback(u.href.replace(/state=[^&]+/, `state=${'Z'.repeat(32)}`), 'approve') }, issue: 'oauth_state', exchanges: 0 },
    { name: 'the exchange refused (400)', opts: { exchange: 400 }, issue: 'oauth_exchange', exchanges: 1 },
    { name: 'the exchange refused (403)', opts: { exchange: 403 }, issue: 'oauth_exchange', exchanges: 1 },
    { name: 'the exchange unreadable (CORS)', opts: { exchange: 'cors' }, issue: 'offline', exchanges: 1 },
  ]
  for (const r of refused)
    test(`${r.name} → ${r.issue}; ${r.exchanges} exchange(s); nothing sealed`, async ({ page, errors }) => {
      errors.allow(/Failed to load resource|CORS|40[03]|auth\/keys/)
      const or = await open(page, r.opts)
      const popup = await connectInWindow(page)
      await popup.waitForEvent('close', { timeout: 20_000 })
      await expect.poll(() => orState(page)).toMatchObject({ phase: 'error', issue: r.issue })
      expect(exchanges(or)).toHaveLength(r.exchanges)
      for (const x of exchanges(or)) expect(x.page).toBe(page)
      expect(await keysOf(page)).toBeNull()
      expect(or.to('/api/v1/key')).toHaveLength(0)
    })

  test('expired (> 10 minutes): oauth_expired, nothing exchanged', async ({ page }) => {
    const or = await open(page, { consent: 'page' })
    const popup = await connectInWindow(page)
    await expect(popup.locator('#approve')).toBeVisible()
    await page.evaluate((prefix) => {
      for (const k of Object.keys(sessionStorage).filter((x) => x.startsWith(prefix))) {
        const a = JSON.parse(sessionStorage.getItem(k)!)
        sessionStorage.setItem(k, JSON.stringify({ ...a, at: Date.now() - 11 * 60_000 }))
      }
    }, PREFIX)
    await popup.locator('#approve').click()
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect.poll(() => orState(page)).toMatchObject({ phase: 'error', issue: 'oauth_expired' })
    expect(exchanges(or)).toHaveLength(0)
    expect(await keysOf(page)).toBeNull()
  })

  test('another workspace open now: oauth_scope names the workspace it was started in; nothing exchanged', async ({ page }) => {
    const or = await open(page, { consent: 'page' })
    const popup = await connectInWindow(page)
    await expect(popup.locator('#approve')).toBeVisible()
    // the attempt was started in a team workspace this tab no longer shows
    await page.evaluate((prefix) => {
      for (const k of Object.keys(sessionStorage).filter((x) => x.startsWith(prefix))) {
        const a = JSON.parse(sessionStorage.getItem(k)!)
        sessionStorage.setItem(k, JSON.stringify({ ...a, scope: 'cloud:ws-studio-nord', name: 'Studio Nord' }))
      }
    }, PREFIX)
    await popup.locator('#approve').click()
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect.poll(() => orState(page)).toMatchObject({ phase: 'error', issue: 'oauth_scope', workspace: 'Studio Nord' })
    expect(exchanges(or)).toHaveLength(0)
    expect(await keysOf(page)).toBeNull()
  })

  test('a second press supersedes the first: its late code → oauth_state, nothing exchanged', async ({ page }) => {
    const or = await open(page, { consent: 'page' })
    const popup = await connectInWindow(page)
    await expect(popup.locator('#approve')).toBeVisible()
    await connect(page)
    await expect.poll(() => consents(or).length).toBe(2)
    const [first, second] = consents(or)
    expect(new URL(first!.url).searchParams.get('state')).not.toBe(new URL(second!.url).searchParams.get('state'))
    expect(await pending(page)).toHaveLength(1)
    // the first attempt's code comes back late
    await popup.goto(orCallback(first!.url, 'approve'))
    await expect.poll(() => orState(page)).toMatchObject({ phase: 'error', issue: 'oauth_state' })
    expect(exchanges(or)).toHaveLength(0)
    expect(await keysOf(page)).toBeNull()
  })

  test('sessionStorage refused: vault, no consent page, nothing kept', async ({ page }) => {
    const or = await open(page)
    await page.evaluate((prefix) => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (k: string, v: string) {
        if (this === window.sessionStorage && k.startsWith(prefix)) throw new DOMException('refused', 'SecurityError')
        return set.call(this, k, v)
      }
    }, PREFIX)
    await connect(page)
    await expect.poll(() => orState(page)).toMatchObject({ phase: 'error', issue: 'vault' })
    expect(consents(or)).toHaveLength(0)
    expect(exchanges(or)).toHaveLength(0)
  })

  test('the opener reloaded during consent: the return is still taken there (one exchange, from the opener)', async ({ page }) => {
    const or = await open(page, { consent: 'page' })
    const popup = await connectInWindow(page)
    await expect(popup.locator('#approve')).toBeVisible()
    await page.reload()
    await waitForApp(page)
    await popup.locator('#approve').click()
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect.poll(() => orState(page)).toMatchObject({ phase: 'done', check: { ok: true } })
    expect(exchanges(or)).toHaveLength(1)
    expect(exchanges(or)[0]!.page).toBe(page)
    expect((await keysOf(page)).openrouter).toMatch(/:M4Tx$/)
  })

  test('a return no tab takes: the window says where to go, boots no workspace and exchanges nothing', async ({ page, context }) => {
    const or = await mockOpenRouter(context)
    const stray = await context.newPage()
    await stray.goto(`app/?oauth=openrouter&code=code-e2e-0009&state=${'Q'.repeat(32)}`)
    await expect(stray.locator('#boot')).toContainText('can’t be finished in this window', { timeout: 10_000 })
    await expect(stray.locator('#boot a')).toHaveText('Open One')
    expect(new URL(stray.url()).search).toBe('')
    expect(await stray.locator('.app').count()).toBe(0)
    expect(exchanges(or)).toHaveLength(0)
    void page
  })

  for (const [status, discarded] of [
    [402, false],
    [401, true],
  ] as const)
    test(`the check after the exchange answers ${status}: ${discarded ? 'not kept (delete it at OpenRouter)' : 'kept — a valid key without credit'}`, async ({ page, errors }) => {
      errors.allow(/Failed to load resource|40[12]/)
      const or = await open(page, { key: status })
      const popup = await connectInWindow(page)
      await popup.waitForEvent('close', { timeout: 20_000 })
      await expect.poll(() => orState(page)).toMatchObject({ phase: 'done', check: { ok: false, code: status === 402 ? 'no_credit' : 'invalid_key' }, ...(discarded ? { discarded: true } : {}) })
      expect(exchanges(or)).toHaveLength(1)
      if (discarded) expect(await keysOf(page)).toBeNull()
      else expect((await keysOf(page)).openrouter).toMatch(/:M4Tx$/)
      expect(or.posts()).toHaveLength(0)
    })
})
