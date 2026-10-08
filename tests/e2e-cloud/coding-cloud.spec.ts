/**
 * Cloud worker (docs/CODING.md § Cloud worker) against the real team server: Settings → Coding worker → Cloud,
 * "Download one-worker-cloud.mjs" (a pending token in the file, this browser's pairing key), the BUILT worker
 * started from that file on "another computer" (its own home folder, the fake Claude Code CLI) dials the server's
 * relay; a Business-analysis document stage runs through the relay — every frame sealed end to end; Revoke stops
 * the worker for good (exit 2). Another member sees none of it. No console errors; the card fits at 390 px.
 * Then the pairing keys: "Download again" while connected keeps the link (no second key exchange) and the running
 * worker's key (also after two downloads and a reload; they are non-extractable keys in IndexedDB, nothing secret in
 * localStorage); another device of the member that downloads waits for its own file instead of taking this one's
 * place, and takes over without a Retry; a viewer promoted back loses the refusal by itself; a page that is not
 * https offers no Cloud.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, createWorkspace, join as joinWorkspace, api, wsEval } from './fixtures'
import { makeCodingRepo, startCloudWorker, type CodingRepo, type RunningWorker } from '../e2e/helpers/coding'
import { cloudWorkerPort } from '../../src/app/features/coding/protocol'

/** the cloud workers' local task-tools ports (this suite's own) */
const WORKER_PORT = 47393
const PORT_B = 47394
const PORT_C = 47395
const PORT_D = 47396

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    // a refused relay upgrade is the browser's own network log line, not ours
    if (m.type() === 'error' && !/WebSocket connection to .*\/coding\/tab/.test(m.text())) errors.push(`${who} console.error: ${m.text()}`)
  })
}

let repo: CodingRepo
let worker: RunningWorker | null = null
const extra: RunningWorker[] = []
test.beforeAll(() => {
  repo = makeCodingRepo()
})
test.afterEach(async () => {
  for (const w of extra.splice(0)) await w.stop()
})
test.afterAll(async () => {
  await worker?.stop()
  repo?.cleanup()
})
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

async function codingSettings(p: Page) {
  await p.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await p.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  await expect(p.getByTestId('coding-settings')).toBeVisible()
}

const h2s = (p: Page, id: string) =>
  wsEval(p, (s, id) => ((s.pages[id].content?.content ?? []) as Array<{ type: string; attrs?: { level?: number }; content?: Array<{ text?: string }> }>).filter((b) => b.type === 'heading' && b.attrs?.level === 2).map((b) => (b.content ?? []).map((c) => c.text ?? '').join('')), id)

test('a cloud worker on another computer runs a document stage through the team server; Revoke stops it for good', async ({ page: a, context }) => {
  watch(a, 'ada')
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Cloud coding')
  await openApp(a, wsId)
  await waitOnline(a)

  // Settings → Coding worker: Local | Cloud, keyboard first
  await codingSettings(a)
  const via = a.getByTestId('coding-via')
  await expect(a.getByTestId('coding-via-local')).toHaveAttribute('aria-checked', 'true')
  await a.getByTestId('coding-via-local').focus()
  await a.keyboard.press('ArrowRight')
  await expect(a.getByTestId('coding-via-cloud')).toHaveAttribute('aria-checked', 'true')
  await expect(a.getByTestId('coding-via-cloud')).toBeFocused()
  await expect(via).toBeVisible()
  const card = a.getByTestId('coding-cloud-card')
  await expect(card).toBeVisible()
  await expect(a.getByTestId('coding-cloud-step1')).toContainText('only for you, only in this workspace')
  await expect(a.getByTestId('coding-step-1')).toHaveAttribute('data-state', 'current')

  // the download: the file carries the cloud preset — a worker token, this server, its own port
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByTestId('coding-cloud-download').click()])
  expect(download.suggestedFilename()).toBe('one-worker-cloud.mjs')
  const file = join(repo.root, 'one-worker-cloud.mjs')
  await download.saveAs(file)
  const preset = JSON.parse(readFileSync(file, 'utf8').split('\n')[1]!.replace(/^globalThis\.ONE_WORKER_PRESET = /, '')) as { workspace: string; origin: string; port: number; pair: string; cloud: { token: string } }
  expect(preset.workspace).toBe(`team:${wsId}`)
  // the workspace's own local port (cloud workers of several workspaces run side by side)
  expect(preset.port).toBe(cloudWorkerPort(`team:${wsId}`))
  expect(preset.port).toBeGreaterThanOrEqual(47323)
  expect(preset.cloud.token).toMatch(/^onew_[A-Za-z0-9_-]{43}$/)
  expect(preset.pair).toMatch(/^[A-Za-z0-9_-]{43}$/)
  // the token and the pairing secret live in the file only — this browser keeps the secret as a non-extractable key
  const stored = await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(window.localStorage))))
  expect(stored).not.toContain(preset.cloud.token)
  expect(stored).not.toContain(preset.pair)
  expect((await pairKeys(a)).map((k) => k.key)).toEqual([expect.stringMatching(new RegExp(`^cloud:${wsId}\\|cloudpair\\|[A-Za-z0-9_-]+$`))])
  for (const k of await pairKeys(a)) expect(k).toMatchObject({ extractable: false, algorithm: 'HKDF', type: 'secret', exportable: false })
  await expect(a.getByTestId('coding-step-1')).toHaveAttribute('data-state', 'done')

  // "another computer": the downloaded file, its own home, dialling the server
  worker = await startCloudWorker(file, repo, WORKER_PORT)
  await expect.poll(() => /connected to 127\.0\.0\.1:\d+ for "Cloud coding"/.test(worker!.log()), { timeout: 15_000 }).toBe(true)
  await expect(a.getByTestId('coding-conn')).toContainText('Connected · build-box · 1 repo · via cloud', { timeout: 20_000 })
  await expect(a.getByTestId('coding-cloud-live')).toContainText('via cloud')
  await a.keyboard.press('Escape')

  // a Business-analysis task without a repository: both document stages run on that computer, through the relay
  await a.evaluate(() => (window.location.hash = '#/coding/spec'))
  await a.getByTestId('coding-setup').click()
  await a.getByTestId('coding-new').click()
  await a.getByTestId('coding-new-title').fill('Invoice approval flow')
  await a.getByTestId('coding-new-goal').fill('Describe how invoices are approved, by whom and when.')
  await a.getByTestId('coding-create').click()
  await expect(a.getByTestId('coding-panel')).toBeVisible()
  await a.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  const id = await a.evaluate(() => window.location.hash.replace('#/p/', ''))
  await expect(a.locator('.ctk-code')).toContainText(/· Approve spec$/i, { timeout: 60_000 })
  const headings = await h2s(a, id)
  expect(headings).toContain('Analysis')
  expect(headings).toContain('Specification')
  // the worker kept its state in its own folder; the server never logged the task
  expect(worker.log()).toMatch(/task .* "Invoice approval flow"/)

  // another member: nothing of ada's worker — and no cloud worker of their own yet
  const b = await newPerson(context)
  watch(b, 'bob')
  await signIn(b, email('bob'))
  await joinWorkspace(a, b, wsId, 'member')
  const bobs = await api<unknown[]>(b, 'GET', `/api/workspaces/${wsId}/coding/workers`)
  expect(bobs.status).toBe(200)
  expect(bobs.json).toEqual([])
  await openApp(b, wsId)
  await waitOnline(b)
  await codingSettings(b)
  await b.getByTestId('coding-via-cloud').click()
  await expect(b.getByTestId('coding-cloud-card')).toBeVisible()
  await expect(b.getByTestId('coding-step-1')).toHaveAttribute('data-state', 'current')
  await b.close()

  // Revoke (confirmed): the worker stops for good — exit 2 — and the card says there is none
  await codingSettings(a)
  await a.getByTestId('coding-cloud-revoke').click()
  await a.getByTestId('coding-cloud-revoke-yes').click()
  await expect.poll(() => worker!.child.exitCode, { timeout: 15_000 }).toBe(2)
  expect(worker.log()).toMatch(/revoked/)
  await expect(a.getByTestId('coding-cloud-live')).toContainText('No cloud worker yet', { timeout: 15_000 })
  await expect(a.getByTestId('coding-step-1')).toHaveAttribute('data-state', 'current')

  // 390 px: the switch and the card fit without sideways scrolling
  await a.setViewportSize({ width: 390, height: 844 })
  await expect(card).toBeVisible()
  const overflow = await a.evaluate(() => {
    const el = document.querySelector('[data-testid="coding-settings"]') as HTMLElement
    return { page: document.documentElement.scrollWidth - window.innerWidth, panel: el.scrollWidth - el.clientWidth }
  })
  expect(overflow.page).toBeLessThanOrEqual(0)
  expect(overflow.panel).toBeLessThanOrEqual(1)
})

/** The pairing keys this browser keeps (IndexedDB "one-coding"): key, and what WebCrypto says about each. */
async function pairKeys(p: Page): Promise<Array<{ key: string; extractable: boolean; algorithm: string; type: string; exportable: boolean }>> {
  return p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('one-coding')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const out: Array<{ key: string; value: CryptoKey }> = []
          const cursor = db.transaction('kv').objectStore('kv').openCursor()
          cursor.onsuccess = () => {
            const c = cursor.result
            if (c) {
              if (String(c.key).includes('|cloudpair|')) out.push({ key: String(c.key), value: c.value as CryptoKey })
              return c.continue()
            }
            db.close()
            void Promise.all(
              out.map(async ({ key, value }) => ({
                key,
                extractable: value.extractable,
                algorithm: value.algorithm.name,
                type: value.type,
                exportable: await crypto.subtle.exportKey('raw', value).then(
                  () => true,
                  () => false,
                ),
              })),
            ).then((list) => resolve(list.sort((x, y) => x.key.localeCompare(y.key))))
          }
          cursor.onerror = () => reject(cursor.error)
        }
      }),
  )
}

/** Settings → Coding worker → Cloud: download the cloud worker (confirming a replacement), saved under `name`. */
async function downloadCloud(p: Page, name: string): Promise<{ file: string; preset: { pair: string; port: number; cloud: { token: string } } }> {
  const waiting = p.waitForEvent('download')
  await p.getByTestId('coding-cloud-download').click()
  const replace = p.getByTestId('coding-cloud-replace-yes')
  if (await replace.isVisible({ timeout: 1500 }).catch(() => false)) await replace.click()
  const download = await waiting
  const file = join(repo.root, `${name}-${Date.now()}.mjs`)
  await download.saveAs(file)
  const preset = JSON.parse(readFileSync(file, 'utf8').split('\n')[1]!.replace(/^globalThis\.ONE_WORKER_PRESET = /, '')) as { pair: string; port: number; cloud: { token: string } }
  return { file, preset }
}

const connLine = (p: Page) => p.getByTestId('coding-conn')
const myWorkers = async (p: Page, wsId: string) => (await api<Array<{ id: string; state: string; online: boolean }>>(p, 'GET', `/api/workspaces/${wsId}/coding/workers`)).json

test('Download again while connected — twice, the new files not started: the link stays, the running worker keeps its key (also after a reload); the newest file then takes over', async ({ page: a }) => {
  watch(a, 'ada')
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Cloud keys')
  await openApp(a, wsId)
  await waitOnline(a)
  await codingSettings(a)
  await a.getByTestId('coding-via-cloud').click()
  const first = await downloadCloud(a, 'first')
  const w1 = await startCloudWorker(first.file, repo, PORT_B)
  extra.push(w1)
  await expect(connLine(a)).toContainText('Connected · build-box · 1 repo · via cloud', { timeout: 20_000 })
  const t1 = (await myWorkers(a, wsId)).find((w) => w.state === 'active')!.id

  // "Download again" while connected, twice (as if the first save was cancelled) — the working pairing is untouched
  const mark = w1.log().length
  const second = await downloadCloud(a, 'second')
  const third = await downloadCloud(a, 'third')
  await a.waitForTimeout(2500)
  await expect(connLine(a)).toContainText('Connected · build-box')
  expect(w1.log().slice(mark)).not.toMatch(/One disconnected|refused|bad key/)
  const list = await myWorkers(a, wsId)
  const t3 = list.find((w) => w.state === 'pending')!.id
  expect(list.map((w) => w.id).sort()).toEqual([t1, t3].sort())
  // this device keeps keys for the running worker and the newest download — not for the replaced one; nothing secret in localStorage
  expect((await pairKeys(a)).map((k) => k.key)).toEqual([`cloud:${wsId}|cloudpair|${t1}`, `cloud:${wsId}|cloudpair|${t3}`].sort())
  const stored = await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(window.localStorage))))
  for (const f of [first, second, third]) {
    expect(stored).not.toContain(f.preset.pair)
    expect(stored).not.toContain(f.preset.cloud.token)
  }

  // a reload: the running worker still pairs with this device (not "Paired with another device")
  await openApp(a, wsId)
  await waitOnline(a)
  await codingSettings(a)
  await expect(connLine(a)).toContainText('Connected · build-box · 1 repo · via cloud', { timeout: 20_000 })

  // the newest file starts (on its own port here; on the same computer the old one is stopped first): it takes over
  const w3 = await startCloudWorker(third.file, repo, PORT_C)
  extra.push(w3)
  await expect.poll(() => w1.child.exitCode, { timeout: 15_000 }).toBe(2)
  await expect(connLine(a)).toContainText('Connected · build-box', { timeout: 20_000 })
  await expect.poll(async () => (await pairKeys(a)).map((k) => k.key), { timeout: 10_000 }).toEqual([`cloud:${wsId}|cloudpair|${t3}`])
  // the replaced second download never gets in
  const w2 = await startCloudWorker(second.file, repo, PORT_D).catch(() => null)
  if (w2) {
    extra.push(w2)
    await expect.poll(() => w2.child.exitCode, { timeout: 15_000 }).toBe(2)
  }
})

test('another device of the member downloads while this one works: this one keeps working; the other waits for its own file and takes over without a Retry', async ({ page: a, context }) => {
  watch(a, 'ada')
  const who = email('ada')
  await signIn(a, who)
  const wsId = await createWorkspace(a, 'Cloud devices')
  await openApp(a, wsId)
  await waitOnline(a)
  await codingSettings(a)
  await a.getByTestId('coding-via-cloud').click()
  const mine = await downloadCloud(a, 'device-a')
  const w1 = await startCloudWorker(mine.file, repo, PORT_B)
  extra.push(w1)
  await expect(connLine(a)).toContainText('Connected · build-box · 1 repo · via cloud', { timeout: 20_000 })

  // the same member on another device (its own browser storage)
  const b = await newPerson(context)
  watch(b, 'ada-2')
  await signIn(b, who)
  await openApp(b, wsId)
  await waitOnline(b)
  await codingSettings(b)
  await b.getByTestId('coding-via-cloud').click()
  await expect(b.getByTestId('coding-cloud-step1')).toContainText('downloaded on another device')
  await expect(b.getByTestId('coding-cloud-download')).toContainText('Download for this device')
  const mark = w1.log().length
  const theirs = await downloadCloud(b, 'device-b')
  // B waits for its own file — it does not take A's place
  await expect(connLine(b)).toContainText('Waiting for your new download to start', { timeout: 15_000 })
  await expect(b.getByTestId('coding-waiting')).toContainText('Start the file you downloaded here')
  await a.waitForTimeout(2000)
  await expect(connLine(a)).toContainText('Connected · build-box')
  expect(w1.log().slice(mark)).not.toMatch(/One disconnected|refused/)

  // B's file starts on its computer: it replaces A's worker, B connects by itself, A says so
  const w2 = await startCloudWorker(theirs.file, repo, PORT_C)
  extra.push(w2)
  await expect.poll(() => w1.child.exitCode, { timeout: 15_000 }).toBe(2)
  await expect(connLine(b)).toContainText('Connected · build-box · 1 repo · via cloud', { timeout: 30_000 })
  await expect(connLine(a)).toContainText('Paired with another device', { timeout: 30_000 })
  await b.close()
})

test('a member demoted to viewer and promoted back: the cloud refusal clears by itself', async ({ page: a, context }) => {
  watch(a, 'ada')
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Cloud roles')
  const b = await newPerson(context)
  watch(b, 'bob')
  await signIn(b, email('bob'))
  await joinWorkspace(a, b, wsId, 'member')
  const bobId = (await api<{ user: { id: string } }>(b, 'GET', '/api/me')).json.user.id
  await openApp(b, wsId)
  await waitOnline(b)
  await codingSettings(b)
  await b.getByTestId('coding-via-cloud').click()
  await b.getByRole('switch', { name: 'Connect to my cloud worker through the team server' }).click()
  await expect(connLine(b)).toContainText('No cloud worker yet', { timeout: 15_000 })

  expect((await api(a, 'PATCH', `/api/workspaces/${wsId}/members/${bobId}`, { role: 'viewer' })).status).toBe(200)
  await openApp(b, wsId)
  await waitOnline(b)
  await codingSettings(b)
  await expect(connLine(b)).toContainText('Refused: viewers cannot run tasks', { timeout: 15_000 })

  // promoted back: no Retry, no reload
  expect((await api(a, 'PATCH', `/api/workspaces/${wsId}/members/${bobId}`, { role: 'member' })).status).toBe(200)
  await expect(connLine(b)).toContainText('No cloud worker yet', { timeout: 20_000 })
  await expect(b.getByTestId('coding-refused')).toHaveCount(0)
  await b.close()
})

test('a page that is not https offers no Cloud — the reason is the option\'s description', async ({ page: a, context }) => {
  watch(a, 'ada')
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Cloud http')
  const b = await newPerson(context)
  watch(b, 'ada-http')
  // what a plain-http server on the LAN looks like to the page (this suite runs on 127.0.0.1, which is allowed)
  await b.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true }))
  await signIn(b, email('carla'))
  await joinWorkspace(a, b, wsId, 'member')
  await openApp(b, wsId)
  await waitOnline(b)
  await codingSettings(b)
  const cloud = b.getByTestId('coding-via-cloud')
  await expect(cloud).toHaveAttribute('aria-disabled', 'true')
  await expect(b.getByTestId('coding-via-why')).toHaveText('Cloud needs this One server on https:// — its admin sets PUBLIC_URL to an https address.')
  await expect(cloud).toHaveAttribute('aria-describedby', (await b.getByTestId('coding-via-why').getAttribute('id'))!)
  await cloud.click({ force: true })
  await expect(b.getByTestId('coding-via-local')).toHaveAttribute('aria-checked', 'true')
  await expect(b.getByTestId('coding-cloud-card')).toHaveCount(0)
  await b.close()
})
