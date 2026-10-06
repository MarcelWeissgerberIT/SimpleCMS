/**
 * The vault (lib/vault.ts, store/secrets.ts, features/sync/storage.ts): the Claude API key and the
 * GitHub token are stored encrypted with a non-extractable AES-GCM key of this browser profile.
 * The store and every stored record only ever hold a marker ("vault:<id>:<last 4>").
 *
 * "Nothing in storage" is checked by reading EVERY IndexedDB database of the origin (binary values
 * included) plus localStorage / sessionStorage and searching for the plaintext.
 * api.anthropic.com and api.github.com are mocked (never the real APIs).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, flush, wsEval, mockClaude, pageIdByTitle, MOD, openExportDialog } from './fixtures'

declare global {
  interface Window {
    // the sync service's test hook (features/sync/service.ts, dev or ?e2e)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __oneSync: any
  }
}

const KEY = 'sk-ant-api03-VAULT-E2E-PLAINTEXT-7Qz9'
const OLD_KEY = 'sk-ant-api03-OLD-PROFILE-PLAINTEXT-k4W2'
const TEAM_KEY = 'sk-ant-api03-TEAM-OVERLAY-PLAINTEXT-t3Am'
const TOKEN = 'github_pat_VAULT_E2E_PLAINTEXT_TOKEN_Gh77'
const OLD_TOKEN = 'github_pat_OLD_PROFILE_PLAINTEXT_TOKEN_x9Pq'

const last4 = (s: string) => s.slice(-4)
const markerOf = (secret: string) => new RegExp(`^vault:[0-9a-z]+:${last4(secret)}$`)

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Everything this origin stores: every IndexedDB database (binary values as latin1) + local/sessionStorage. */
function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const latin1 = (u8: Uint8Array) => {
      let s = ''
      for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode(...u8.subarray(i, i + 4096))
      return s
    }
    const walk = async (v: unknown, depth = 0): Promise<unknown> => {
      if (depth > 40) return null
      if (v instanceof ArrayBuffer) return latin1(new Uint8Array(v))
      if (ArrayBuffer.isView(v)) return latin1(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
      if (v instanceof Blob) return latin1(new Uint8Array(await v.arrayBuffer()))
      if (v instanceof CryptoKey) return `CryptoKey(${v.algorithm.name}, extractable=${v.extractable})`
      if (v instanceof Map) return walk([...v.entries()], depth + 1)
      if (v instanceof Set) return walk([...v], depth + 1)
      if (Array.isArray(v)) return Promise.all(v.map((x) => walk(x, depth + 1)))
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(v)) out[k] = await walk(x, depth + 1)
        return out
      }
      return v
    }
    const parts: string[] = []
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      for (const store of Array.from(db.objectStoreNames)) {
        const [keys, values] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          const k = tx.objectStore(store).getAllKeys()
          const v = tx.objectStore(store).getAll()
          tx.oncomplete = () => resolve([k.result, v.result])
          tx.onerror = () => reject(tx.error)
        })
        parts.push(`${name}/${store} ${JSON.stringify(await walk(keys))} ${JSON.stringify(await walk(values))}`)
      }
      db.close()
    }
    parts.push(`localStorage ${JSON.stringify({ ...localStorage })}`, `sessionStorage ${JSON.stringify({ ...sessionStorage })}`)
    return parts.join('\n')
  })
}

/** Every x-api-key sent to api.anthropic.com (preflights left out). */
function claudeKeysSent(page: Page): string[] {
  const keys: string[] = []
  page.on('request', (req) => {
    if (!req.url().startsWith('https://api.anthropic.com/') || req.method() === 'OPTIONS') return
    void req.allHeaders().then((h) => keys.push(h['x-api-key'] ?? '(none)'))
  })
  return keys
}

/** Every console message of the page (any level): secrets never end up in logs. */
function consoleText(page: Page): string[] {
  const out: string[] = []
  page.on('console', (m) => out.push(m.text()))
  return out
}

interface GitHubMock {
  /** Authorization header of every request */
  auth: string[]
  /** request bodies */
  bodies: string[]
  /** a push moved the branch */
  pushed: boolean
}

/** api.github.com for me/notes: only `Bearer <token>` gets in; an empty repository that accepts a push. */
async function mockGitHub(page: Page, token: string): Promise<GitHubMock> {
  const m: GitHubMock = { auth: [], bodies: [], pushed: false }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE' }
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const auth = (await req.allHeaders())['authorization'] ?? ''
    m.auth.push(auth)
    m.bodies.push(req.postData() ?? '')
    if (auth !== `Bearer ${token}`) return json(401, { message: 'Bad credentials' })
    const method = req.method()
    const path = new URL(req.url()).pathname.replace(/^\/repos\/me\/notes/, '')
    if (method === 'GET' && path === '') return json(200, { full_name: 'me/notes', default_branch: 'main', private: true, permissions: { push: true } })
    if (method === 'GET' && path === '/git/ref/heads/main') return json(200, { object: { sha: 'c0' } })
    if (method === 'GET' && path.startsWith('/git/commits/')) return json(200, { sha: 'c0', tree: { sha: 't0' } })
    if (method === 'GET' && path.startsWith('/git/trees/')) return json(200, { sha: 't0', truncated: false, tree: [] })
    if (method === 'POST') return json(201, { sha: `s${m.bodies.length}` })
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      m.pushed = true
      return json(200, { object: { sha: 'c1' } })
    }
    return json(404, { message: 'Not Found' })
  })
  return m
}

async function openSettings(page: Page, tab: RegExp) {
  await page.keyboard.press(`${MOD}+,`)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

/** A workspace snapshot of the store, with other settings / epoch (stands in for a team workspace being opened). */
async function hydrateAs(page: Page, epoch: string, aiApiKey: string) {
  await wsEval(
    page,
    (s, a) =>
      s.hydrate({
        version: s.version,
        epoch: a.epoch,
        pages: s.pages,
        databases: s.databases,
        people: s.people,
        functions: s.functions,
        recent: s.recent,
        settings: { ...s.settings, aiApiKey: a.aiApiKey },
      }),
    { epoch, aiApiKey },
  )
}

/* ------------------------------------------------------------------ */
/* Claude API key                                                      */
/* ------------------------------------------------------------------ */

test.describe('the Claude API key', () => {
  test('typed in Settings: sealed (no plaintext anywhere), requests carry it, a reload keeps it, Remove deletes it', async ({ page }) => {
    await mockClaude(page, () => 'OK')
    const sent = claudeKeysSent(page)
    const logs = consoleText(page)
    await openApp(page)
    let dialog = await openSettings(page, /Claude AI$/)
    const input = dialog.getByPlaceholder('sk-ant-')
    await input.fill(KEY)
    await input.press('Enter')
    const sealed = dialog.getByRole('group', { name: 'Anthropic API key' })
    await expect(sealed).toContainText(`•••• ${last4(KEY)}`)
    await expect(sealed).toContainText('Stored encrypted on this device')
    await expect(dialog.getByPlaceholder('sk-ant-')).toHaveCount(0)

    // the store keeps a marker ("a key is set", its last 4) — never the key
    expect(await wsEval(page, (s) => s.settings.aiApiKey)).toMatch(markerOf(KEY))
    await flush(page)
    await expect.poll(() => storageDump(page)).toContain('s:local:local|claude-api-key')
    const dump = await storageDump(page)
    expect(dump).not.toContain(KEY)
    expect(dump).not.toContain('VAULT-E2E-PLAINTEXT')
    // the profile key: AES-GCM, non-extractable — usable here, never readable
    expect(dump).toContain('CryptoKey(AES-GCM, extractable=false)')
    const exported = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('one-vault')
        r.onsuccess = () => resolve(r.result)
      })
      const key = await new Promise<CryptoKey>((resolve) => {
        const r = db.transaction('kv').objectStore('kv').get('key')
        r.onsuccess = () => resolve(r.result)
      })
      db.close()
      return crypto.subtle.exportKey('raw', key).then(
        () => 'exported',
        (e: Error) => e.name,
      )
    })
    expect(exported).toBe('InvalidAccessError')

    // a request carries the key itself
    await dialog.getByRole('button', { name: 'Test key' }).click()
    await expect(dialog.locator('.ai-status')).toContainText('Connected · key verified')
    expect([...new Set(sent)]).toEqual([KEY])

    // a new session: the key comes out of the vault
    await page.keyboard.press('Escape')
    await reloadApp(page)
    sent.length = 0
    dialog = await openSettings(page, /Claude AI$/)
    await expect(dialog.getByRole('group', { name: 'Anthropic API key' })).toContainText(`•••• ${last4(KEY)}`)
    await dialog.getByRole('button', { name: 'Test key' }).click()
    await expect(dialog.locator('.ai-status')).toContainText('Connected · key verified')
    expect([...new Set(sent)]).toEqual([KEY])

    // Replace keeps the readout until a new key is saved; Escape goes back
    await dialog.getByRole('button', { name: 'Replace' }).click()
    await expect(dialog.getByPlaceholder('sk-ant-')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('button', { name: 'Replace' })).toBeFocused()

    // Remove: marker and sealed record are gone, the field asks for a key again
    await dialog.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog.getByPlaceholder('sk-ant-')).toBeVisible()
    expect(await wsEval(page, (s) => s.settings.aiApiKey)).toBe('')
    await flush(page)
    await expect.poll(() => storageDump(page)).not.toContain('claude-api-key')
    expect(logs.join('\n')).not.toContain(KEY)
  })

  test('backups and share links never carry the key (nor its marker)', async ({ page }, testInfo) => {
    await openApp(page)
    await wsEval(page, (s, key) => s.updateSettings({ aiApiKey: key }), KEY)
    const marker = await wsEval(page, (s) => s.settings.aiApiKey)
    expect(marker).toMatch(markerOf(KEY))

    // full JSON backup (Workspace settings → Data → Export workspace)
    await openExportDialog(page)
    const exp = page.getByRole('dialog')
    await exp.getByRole('radio', { name: /Whole workspace/ }).click()
    await exp.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await exp.locator('[data-export-run]').click()
    const file = testInfo.outputPath('backup.json')
    await (await download).saveAs(file)
    const backup = readFileSync(file, 'utf8')
    expect(backup).toContain('Brand voice')
    expect(backup).not.toContain(KEY)
    expect(backup).not.toContain(marker)
    expect(backup).toContain('"aiApiKey":""')
    await page.keyboard.press('Escape')

    // share link of a page
    const id = await pageIdByTitle(page, 'Brand voice')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    expect(link).toContain('#/s/')
    expect(link).not.toContain(KEY)
    expect(link).not.toContain(marker)
  })

  test('team workspaces: an overlay key is sealed for that workspace, the local key is inherited, a copied record does not open', async ({ page }) => {
    await mockClaude(page, () => 'OK')
    const sent = claudeKeysSent(page)
    await openApp(page)
    await wsEval(page, (s, key) => s.updateSettings({ aiApiKey: key }), KEY)
    await expect.poll(() => storageDump(page)).toContain('s:local:local|claude-api-key')
    const testKey = async () => {
      sent.length = 0
      const dialog = await openSettings(page, /Claude AI$/)
      await dialog.getByRole('button', { name: 'Test key' }).click()
      await expect(dialog.locator('.ai-status')).toContainText('Connected · key verified')
      await page.keyboard.press('Escape')
      return [...new Set(sent)]
    }

    // a team workspace whose device overlay an older version wrote (plaintext key): sealed for cloud:<id>
    await hydrateAs(page, 'cloud:e2e-team', TEAM_KEY)
    expect(await wsEval(page, (s) => s.settings.aiApiKey)).toMatch(markerOf(TEAM_KEY))
    await expect.poll(() => storageDump(page)).toContain('s:cloud:e2e-team|claude-api-key')
    expect(await testKey()).toEqual([TEAM_KEY])
    expect(await storageDump(page)).not.toContain(TEAM_KEY)

    // a team workspace that started with the local workspace's settings: the local key opens, and is sealed for it too
    await hydrateAs(page, 'cloud:e2e-inherit', `vault:inheritedcopy:${last4(KEY)}`)
    expect(await testKey()).toEqual([KEY])
    await expect.poll(() => storageDump(page)).toContain('s:cloud:e2e-inherit|claude-api-key')

    // a sealed record copied to another workspace does not decrypt there (AAD = name + scope): the marker is
    // cleared, so Settings asks for the key again instead of failing on every request
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('one-vault')
        r.onsuccess = () => resolve(r.result)
      })
      await new Promise<void>((resolve) => {
        const tx = db.transaction('kv', 'readwrite')
        const os = tx.objectStore('kv')
        const r = os.get('s:local:local|claude-api-key')
        r.onsuccess = () => os.put(r.result, 's:cloud:e2e-copied|claude-api-key')
        tx.oncomplete = () => resolve()
      })
      db.close()
    })
    await hydrateAs(page, 'cloud:e2e-copied', 'vault:copiedrecord:0000')
    await expect.poll(() => wsEval(page, (s) => s.settings.aiApiKey)).toBe('')
    const dialog = await openSettings(page, /Claude AI$/)
    await expect(dialog.getByPlaceholder('sk-ant-')).toBeVisible()
  })
})

/* ------------------------------------------------------------------ */
/* Migration from an older version                                      */
/* ------------------------------------------------------------------ */

test('a plaintext key and GitHub token of an older version are sealed on the next start and keep working', async ({ page }) => {
  await mockClaude(page, () => 'OK')
  const sent = claudeKeysSent(page)
  const gh = await mockGitHub(page, OLD_TOKEN)
  const logs = consoleText(page)
  await openApp(page)
  await flush(page)

  // leave the app and write what an older version stored: the key in the settings record (and in the
  // repair copy), the token in the sync config — then start again
  await page.goto('favicon.svg')
  await page.evaluate(
    async ({ key, token }) => {
      const open = (name: string, store: string) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open(name)
          r.onupgradeneeded = () => r.result.createObjectStore(store)
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
      const write = (db: IDBDatabase, store: string, fn: (os: IDBObjectStore) => void) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite')
          fn(tx.objectStore(store))
          tx.oncomplete = () => resolve()
          tx.onerror = tx.onabort = () => reject(tx.error)
        })
      const ws = await open('keyval-store', 'keyval')
      await write(ws, 'keyval', (os) => {
        const r = os.get('one.ws.v2')
        r.onsuccess = () => {
          const meta = r.result
          meta.settings.aiApiKey = key
          os.put(meta, 'one.ws.v2')
          os.put(meta, 'one.workspace.v1.bak')
        }
      })
      ws.close()
      const sync = await open('one-sync', 'kv')
      await write(sync, 'kv', (os) => os.put({ repo: 'me/notes', branch: 'main', prefix: 'one', token, auto: false, everyMin: 10, includePrivate: false }, 'github:local:local'))
      sync.close()
    },
    { key: OLD_KEY, token: OLD_TOKEN },
  )
  const before = await storageDump(page)
  expect(before).toContain(OLD_KEY)
  expect(before).toContain(OLD_TOKEN)

  await openApp(page)
  expect(await wsEval(page, (s) => s.settings.aiApiKey)).toMatch(markerOf(OLD_KEY))
  await expect
    .poll(async () => {
      const d = await storageDump(page)
      return { key: d.includes(OLD_KEY), token: d.includes(OLD_TOKEN), sealedKey: d.includes('s:local:local|claude-api-key'), sealedToken: d.includes('s:local:local|github-token') }
    })
    .toEqual({ key: false, token: false, sealedKey: true, sealedToken: true })

  // the key still works
  const dialog = await openSettings(page, /Claude AI$/)
  await expect(dialog.getByRole('group', { name: 'Anthropic API key' })).toContainText(`•••• ${last4(OLD_KEY)}`)
  await dialog.getByRole('button', { name: 'Test key' }).click()
  await expect(dialog.locator('.ai-status')).toContainText('Connected · key verified')
  expect([...new Set(sent)]).toEqual([OLD_KEY])

  // and the token: Settings shows it sealed, a push authenticates with it
  await dialog.getByRole('tab', { name: /Sync$/ }).click()
  await expect(dialog.locator('.sy-panel').nth(1).getByRole('group', { name: 'Access token' })).toContainText(`•••• ${last4(OLD_TOKEN)}`)
  await expect.poll(() => page.evaluate(() => window.__oneSync.state().github.state)).toBe('ready')
  await page.evaluate(() => window.__oneSync.push())
  expect(gh.pushed).toBe(true)
  expect([...new Set(gh.auth)]).toEqual([`Bearer ${OLD_TOKEN}`])
  // what went to GitHub carries neither the key nor the token
  for (const body of gh.bodies) {
    expect(body).not.toContain(OLD_TOKEN)
    expect(body).not.toContain(OLD_KEY)
  }
  expect(logs.join('\n')).not.toMatch(/OLD-PROFILE|OLD_PROFILE/)
})

/* ------------------------------------------------------------------ */
/* GitHub token                                                        */
/* ------------------------------------------------------------------ */

test('the GitHub token typed in Settings → Sync is sealed, opens again after a reload, Remove deletes it', async ({ page }) => {
  const gh = await mockGitHub(page, TOKEN)
  const logs = consoleText(page)
  await openApp(page)
  let dialog = await openSettings(page, /Sync$/)
  let panel = dialog.locator('.sy-panel').nth(1)
  await panel.getByLabel('Repository', { exact: true }).fill('me/notes')
  await panel.getByPlaceholder('github_pat_').fill(TOKEN)
  await panel.getByPlaceholder('github_pat_').press('Enter')
  await expect(panel.getByRole('group', { name: 'Access token' })).toContainText(`•••• ${last4(TOKEN)}`)
  await expect(panel.getByRole('group', { name: 'Access token' })).toContainText('Stored encrypted on this device')
  await panel.getByRole('button', { name: 'Test connection' }).click()
  await expect(panel.getByText(/Connected · me\/notes/)).toBeVisible()
  expect([...new Set(gh.auth)]).toEqual([`Bearer ${TOKEN}`])

  await expect.poll(() => storageDump(page)).toContain('s:local:local|github-token')
  const dump = await storageDump(page)
  expect(dump).not.toContain(TOKEN)
  expect(dump).toMatch(/one-sync\/kv .*"token":"vault:[0-9a-z]+:Gh77"/)

  // a new session: the token comes out of the vault
  await page.keyboard.press('Escape')
  await reloadApp(page)
  gh.auth.length = 0
  dialog = await openSettings(page, /Sync$/)
  panel = dialog.locator('.sy-panel').nth(1)
  await expect(panel.getByRole('group', { name: 'Access token' })).toContainText(`•••• ${last4(TOKEN)}`)
  await panel.getByRole('button', { name: 'Test connection' }).click()
  await expect(panel.getByText(/Connected · me\/notes/)).toBeVisible()
  expect([...new Set(gh.auth)]).toEqual([`Bearer ${TOKEN}`])

  // Remove
  await panel.getByRole('button', { name: 'Remove' }).click()
  await expect(panel.getByPlaceholder('github_pat_')).toBeVisible()
  await expect.poll(() => storageDump(page)).not.toContain('github-token')
  expect(await storageDump(page)).not.toMatch(/"token":"vault:/)
  expect(logs.join('\n')).not.toContain(TOKEN)
})
