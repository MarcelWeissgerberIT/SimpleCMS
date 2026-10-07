/**
 * The pipelines next to Coding: Business analysis (documents, no repository needed) and QA (test cases → the Test
 * cases database), each on its own and chained ("Then"); the Import stage (a ZIP dropped in the task panel becomes
 * the task's repo); pages mentioned with @ going along to Claude Code. The BUILT worker with the fake Claude Code
 * CLI (mcp/test/fixtures/fake-claude.mjs — no API call), a temp repo with a local bare remote.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, doc, para } from './fixtures'
import { makeCodingRepo, startCodingWorker, type CodingRepo, type RunningWorker } from './helpers/coding'

const PORT = 47386

test.describe.configure({ mode: 'serial' })

let repo: CodingRepo
let worker: RunningWorker | null = null
let clones = ''

test.beforeAll(() => {
  repo = makeCodingRepo()
  clones = mkdtempSync(join(tmpdir(), 'one-clones-e2e-'))
})
test.afterEach(async () => {
  await worker?.stop()
  worker = null
})
test.afterAll(() => {
  repo?.cleanup()
  rmSync(clones, { recursive: true, force: true })
})

/** Settings → Coding worker: the test port, switch on, the worker bound to this tab's workspace. */
async function connect(page: Page, extra: Record<string, unknown> = {}) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
  const id = /--workspace (\S+)/.exec(init ?? '')![1]!
  worker = await startCodingWorker(repo, id, PORT, extra)
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('Connected')
  await page.keyboard.press('Escape')
}

const stageOf = (page: Page) => page.locator('.ctk-code')
/** The new task's id, once One opened its page (the dialog navigates after the task is written). */
async function taskId(page: Page): Promise<string> {
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}
const h2s = (page: Page, id: string) =>
  wsEval(page, (s, id) => ((s.pages[id].content?.content ?? []) as Array<{ type: string; attrs?: { level?: number }; content?: Array<{ text?: string }> }>).filter((b) => b.type === 'heading' && b.attrs?.level === 2).map((b) => (b.content ?? []).map((c) => c.text ?? '').join('')), id)

test('Business analysis on its own, without a repo: analysis + specification sections, approve, record, done — "Then: Coding" hands it on', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await expect(page.getByRole('heading', { name: 'Business analysis' })).toBeVisible()
  await expect(page.getByTestId('coding-kind-spec')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-new').click()
  await expect(page.getByRole('dialog')).toContainText('New analysis task')
  await page.getByTestId('coding-new-title').fill('Invoice approval flow')
  await page.getByTestId('coding-new-goal').fill('Describe how invoices are approved, by whom and when.')
  await page.getByTestId('coding-new-then-coding').click()
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  const id = await taskId(page)
  await expect(stageOf(page)).toContainText(/BA — documents only · /i)
  await expect(page.getByTestId('coding-then-coding')).toHaveAttribute('aria-pressed', 'true')
  // the worker runs both document stages in its scratch folder, then the gate waits
  await expect(stageOf(page)).toContainText(/· Approve spec$/i, { timeout: 60_000 })
  const headings = await h2s(page, id)
  expect(headings).toContain('Analysis')
  expect(headings).toContain('Specification')
  await expect(page.getByTestId('coding-tab-plan')).toHaveText('Document')
  await page.getByTestId('coding-approve').click()
  await expect(stageOf(page)).toContainText(/· Done$/i, { timeout: 60_000 })
  expect(await h2s(page, id)).toContain('Record')
  // handed on: a Coding task with the specification, linked both ways
  await expect(page.getByTestId('coding-then-open-coding')).toBeVisible({ timeout: 10_000 })
  const follow = await wsEval(page, (s, id) => {
    const db = Object.values(s.databases as Record<string, { id: string; system?: string }>).find((d) => d.system === 'coding')
    const row = Object.values(s.pages as Record<string, { id: string; databaseId?: string; title: string; plain?: string; content?: unknown }>).find((p) => p.databaseId === db?.id && p.title === 'Invoice approval flow')
    return row ? { id: row.id, mentions: JSON.stringify(row.content).includes(id) } : null
  }, id)
  expect(follow?.mentions).toBe(true)
  await page.getByTestId('coding-then-open-coding').click()
  await expect(stageOf(page)).toContainText(/TASK — no repo/i)
})

test('QA: the test cases of the document become rows of the Test cases database; the JSON leaves the page', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding/qa'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Login test cases')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Cover the login. FAKE:CASES')
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await expect(stageOf(page)).toContainText(/QA — website · Approve test cases$/i, { timeout: 60_000 })
  const rows = await wsEval(page, () => {
    const s = (window as unknown as { __one: { workspace: { getState: () => { pages: Record<string, { databaseId?: string; title: string; properties: Record<string, unknown> }>; databases: Record<string, { id: string; system?: string; properties: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }> }> } } } }).__one.workspace.getState()
    const db = Object.values(s.databases).find((d) => d.system === 'testcases')!
    const status = db.properties.find((p) => p.name === 'Status')!
    return Object.values(s.pages)
      .filter((p) => p.databaseId === db.id)
      .map((p) => ({ title: p.title, status: status.options!.find((o) => o.id === p.properties[status.id])?.name }))
      .sort((a, b) => a.title.localeCompare(b.title))
  })
  expect(rows).toEqual([
    { title: 'Sign in with a valid account', status: 'Not run' },
    { title: 'Wrong password', status: 'Not run' },
  ])
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('2 test cases are in')
  expect(plain).not.toContain('"steps"')
  await page.evaluate(() => (window.location.hash = '#/coding/qa'))
  await expect(page.getByTestId('coding-cases-open')).toBeVisible()
})

test('Import stage: a ZIP dropped in the task panel becomes the task\'s repo, then the task moves on', async ({ page }) => {
  await openApp(page)
  await connect(page, { cloneDir: clones })
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup-modernise').click()
  await page.getByTestId('coding-new').click()
  await expect(page.getByTestId('coding-new-intake')).toBeVisible()
  await page.getByTestId('coding-new-title').fill('Rebuild the billing module')
  await page.getByTestId('coding-new-goal').fill('Understand the billing module and rebuild it.')
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await expect(stageOf(page)).toContainText(/· Import$/i)
  await expect(page.getByTestId('coding-state')).toContainText('Waiting for the code')
  await expect(page.getByTestId('coding-import')).toBeVisible()
  const zip = Buffer.from(zipSync({ 'billing/README.md': strToU8('# Billing\n'), 'billing/src/invoice.js': strToU8('export const total = (xs) => xs.reduce((a, b) => a + b, 0)\n') }))
  await page.getByTestId('coding-import-file').setInputFiles({ name: 'billing-legacy.zip', mimeType: 'application/zip', buffer: zip })
  await expect(stageOf(page)).toContainText(/billing-legacy · /i, { timeout: 30_000 })
  await expect(stageOf(page)).not.toContainText(/· Import$/i)
  const repoName = await wsEval(page, (s, id) => {
    const row = s.pages[id]
    const db = s.databases[row.databaseId]
    const prop = db.properties.find((p: { name: string }) => p.name === 'Repo')
    return prop.options.find((o: { id: string }) => o.id === row.properties[prop.id])?.name
  }, id)
  expect(repoName).toBe('billing-legacy')
  expect(worker!.log()).toMatch(/ready as repo "billing-legacy"/)
})

test('a page mentioned with @ goes along: the panel lists it, Claude Code gets its text', async ({ page }) => {
  await openApp(page)
  await connect(page)
  const review = await createPage(page, { title: 'Sample view review', content: doc(para('Finding 1: the list has no paging.'), para('Finding 2: dates are not localised.')) })
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Work on the review')
  await page.getByRole('checkbox').uncheck()
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await expect(page.getByTestId('coding-refs')).toContainText('Mention pages with @')
  await wsEval(page, (s, a) => s.setContent(a.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Analyse ' }, { type: 'mention', attrs: { id: a.review, label: 'Sample view review', kind: 'page' } }, { type: 'text', text: ' and take the first finding.' }] }] }, 'e2e'), { id, review })
  await expect(page.getByTestId('coding-refs')).toContainText('Sample view review')
  await page.getByTestId('coding-run').click()
  await expect(stageOf(page)).toContainText(/· Approve spec$/i, { timeout: 60_000 })
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('References: 1')
  expect(plain).toContain('First finding: the list has no paging.')
})

test('German at 390 px: the pipeline switch, the import box and the "Then" strip fit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { updateSettings: (p: unknown) => void } } } }).__one.workspace.getState().updateSettings({ language: 'de' }))
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await expect(page.getByRole('heading', { name: 'Business-Analyse' })).toBeVisible()
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(await overflow()).toBeLessThanOrEqual(0)
  await page.getByTestId('coding-new').click()
  await expect(page.getByRole('dialog')).toContainText('Neue Analyse-Aufgabe')
  await page.getByTestId('coding-new-title').fill('Rechnungsfreigabe')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-then')).toContainText('Danach')
  expect(await overflow()).toBeLessThanOrEqual(0)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup-modernise').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Altsystem neu bauen')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-state')).toContainText('Wartet auf den Code')
  await expect(page.getByTestId('coding-import')).toContainText('ZIP hier ablegen')
  expect(await overflow()).toBeLessThanOrEqual(0)
})

test('a One address pasted as plain text goes along too; "Copy for AI context" puts the page on the clipboard as Markdown', async ({ page }) => {
  await openApp(page)
  const review = await createPage(page, { title: 'Sample view review', content: doc(para('Finding 1: the list has no paging.')) })
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Work on the review')
  await page.getByRole('checkbox').uncheck()
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await wsEval(page, (s, a) => s.setContent(a.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Take the first finding of https://getonecms.com/app/#/p/${a.review} and fix it.` }] }] }, 'e2e'), { id, review })
  await expect(page.getByTestId('coding-refs')).toContainText('Sample view review')
  // Copy for AI context (⌘K on the review page)
  await page.evaluate(() => {
    ;(window as unknown as { __copied: string }).__copied = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => ((window as unknown as { __copied: string }).__copied = t, Promise.resolve()) }, configurable: true })
  })
  await page.evaluate((r) => (window.location.hash = `#/p/${r}`), review)
  await page.keyboard.press('Control+k')
  await page.locator('.pal-input input').fill('Copy for AI context')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toContain('# Sample view review')
  const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied)
  expect(copied).toContain(`- Page id: ${review}`)
  expect(copied).toContain(`#/p/${review}`)
  expect(copied).toContain('Finding 1: the list has no paging.')
  await expect(page.getByText(/Copied for AI — \d+ words/)).toBeVisible()
})
