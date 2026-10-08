/**
 * Cloud worker (docs/CODING.md § Cloud worker) against the real team server: Settings → Coding worker → Cloud,
 * "Download one-worker-cloud.mjs" (a pending token in the file, this browser's pairing key), the BUILT worker
 * started from that file on "another computer" (its own home folder, the fake Claude Code CLI) dials the server's
 * relay; a Business-analysis document stage runs through the relay — every frame sealed end to end; Revoke stops
 * the worker for good (exit 2). Another member sees none of it. No console errors; the card fits at 390 px.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, createWorkspace, join as joinWorkspace, api, wsEval } from './fixtures'
import { makeCodingRepo, startCloudWorker, type CodingRepo, type RunningWorker } from '../e2e/helpers/coding'

/** the cloud worker's local task-tools port (this suite's own) */
const WORKER_PORT = 47393

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
test.beforeAll(() => {
  repo = makeCodingRepo()
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
  expect(preset.port).toBe(47323)
  expect(preset.cloud.token).toMatch(/^onew_[A-Za-z0-9_-]{43}$/)
  expect(preset.pair).toMatch(/^[A-Za-z0-9_-]{43}$/)
  // the token lives in the file only — never in this browser's storage
  const stored = await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(window.localStorage))))
  expect(stored).not.toContain(preset.cloud.token)
  expect(stored).toContain(preset.pair)
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
