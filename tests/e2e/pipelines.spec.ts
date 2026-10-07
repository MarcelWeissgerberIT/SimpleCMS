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

/** The worker's repo "website" with extra fields (e.g. an analysis command). */
const website = (extra: Record<string, unknown> = {}) => ({ repos: [{ name: 'website', path: repo.path, baseBranch: 'main', testCommand: [process.execPath, 'check.mjs'], pr: 'none', maxUsdPerTask: 5, ...extra }] })
/** A linter that finds something (exit 1). */
const LINT = [process.execPath, '-e', "console.log('src/app.js:3:1 warning Unexpected var'); process.exit(1)"]

test('Explain the code: overview, static analysis, a One page per component, documentation check — the task links the pages', async ({ page }) => {
  await openApp(page)
  await connect(page, website({ analyzeCommand: LINT }))
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup-explain').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Explain the website')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('How does the website work? FAKE:PAGES')
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await expect(stageOf(page)).toContainText(/· Approve documentation$/i, { timeout: 90_000 })
  const headings = await h2s(page, id)
  for (const h of ['Overview', 'Static analysis', 'Components', 'Documentation check']) expect(headings).toContain(h)
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  // the analysis section: the program by name, its findings; the stage after it read them
  expect(plain).toContain('findings (exit code 1)')
  expect(plain).toContain('src/app.js:3:1 warning Unexpected var')
  expect(plain).toContain('Static analysis: exit code 1.')
  expect(plain).toContain('2 pages in')
  type P = { id: string; title: string; parentId: string | null; trashed?: boolean; content?: { content?: Array<{ type: string; attrs?: { level?: number }; content?: Array<{ text?: string }> }> } }
  const tree = await wsEval(page, (s, id) => {
    const pages = Object.values(s.pages as Record<string, P>)
    const root = pages.find((p) => p.title === 'Explain the website · Components' && !p.trashed)
    const kids = pages.filter((p) => root && p.parentId === root.id && !p.trashed)
    const task = JSON.stringify(s.pages[id].content)
    return {
      top: root ? root.parentId === null : false,
      links: (root?.content?.content ?? []).filter((b) => b.type === 'pageLink').length,
      kids: kids.map((k) => ({
        title: k.title,
        h2: (k.content?.content ?? []).filter((b) => b.type === 'heading' && b.attrs?.level === 2).map((b) => (b.content ?? []).map((c) => c.text ?? '').join('')),
        fenced: JSON.stringify(k.content).includes('## not a heading'),
        mentioned: task.includes(k.id),
      })),
    }
  }, id)
  expect(tree.top).toBe(true)
  expect(tree.links).toBe(2)
  expect(tree.kids).toEqual([
    { title: 'Billing', h2: ['How it works'], fenced: true, mentioned: true },
    { title: 'Reports', h2: [], fenced: false, mentioned: true },
  ])
})

test('Projects: a second Coding project with its own tasks; delete puts it and its tasks in the trash — Undo brings it back', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  await expect(page.getByTestId('coding-projects')).toContainText('Coding')
  await expect(page.getByTestId('coding-project-select')).toHaveCount(0)
  await page.getByTestId('coding-project-new').click()
  await page.getByTestId('coding-project-name').fill('Checkout redesign')
  await page.getByTestId('coding-project-create').click()
  await expect(page.getByText('Project “Checkout redesign” created.')).toBeVisible()
  const select = page.getByTestId('coding-project-select')
  await expect(select.locator('option:checked')).toHaveText('Checkout redesign')
  await expect(page.getByTestId('coding-count')).toContainText('00 tasks')
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Pay by card')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  type Db = { id: string; system?: string; pipeline?: Array<{ kind: string }>; properties: Array<{ name: string; options?: Array<{ name: string }> }> }
  const where = await wsEval(page, (s, id) => {
    const dbs = Object.values(s.databases as Record<string, Db>).filter((d) => d.system === 'coding')
    const stages = (d: Db) => d.properties.find((p) => p.name === 'Stage')!.options!.map((o) => o.name)
    return { db: s.pages[s.pages[id].databaseId].title, same: dbs.length === 2 && JSON.stringify(stages(dbs[0]!)) === JSON.stringify(stages(dbs[1]!)) }
  }, id)
  expect(where).toEqual({ db: 'Checkout redesign', same: true })
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(select.locator('option:checked')).toHaveText('Checkout redesign')
  await expect(page.getByTestId('coding-count')).toContainText('01 task')
  // the first project is still there, with none of these tasks
  await select.selectOption({ label: 'Coding' })
  await expect(page.getByTestId('coding-count')).toContainText('00 tasks')
  await select.selectOption({ label: 'Checkout redesign' })
  await page.getByTestId('coding-project-delete').click()
  await page.getByTestId('coding-project-delete-confirm').click()
  await expect(page.getByText('“Checkout redesign” and its tasks are in the trash.')).toBeVisible()
  await expect(page.getByTestId('coding-project-select')).toHaveCount(0)
  await expect(page.getByTestId('coding-projects')).toContainText('Coding')
  const trashed = () => wsEval(page, (s, id) => !!s.pages[s.pages[id].databaseId]?.trashed, id)
  expect(await trashed()).toBe(true)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(trashed).toBe(false)
  await expect(select.locator('option:checked')).toHaveText('Checkout redesign')
})

test('Spec → stories: the approved specification\'s stories become tasks of a new coding project (in its backlog)', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await page.getByTestId('coding-setup-stories').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Checkout epic')
  await page.getByTestId('coding-new-goal').fill('Buyers pay and see their orders. FAKE:STORIES')
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await expect(stageOf(page)).toContainText(/· Approve spec$/i, { timeout: 60_000 })
  await page.getByTestId('coding-approve').click()
  await expect(stageOf(page)).toContainText(/· Done$/i, { timeout: 60_000 })
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('3 of 3 stories are tasks in')
  expect(plain).not.toContain('"stories"')
  type Row = { id: string; databaseId?: string; title: string; trashed?: boolean; content?: unknown; properties: Record<string, unknown> }
  const made = await wsEval(page, (s, id) => {
    const db = Object.values(s.databases as Record<string, { id: string; system?: string; properties: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }> }>).find((d) => d.system === 'coding')!
    const stage = db.properties.find((p) => p.name === 'Stage')!
    const prio = db.properties.find((p) => p.name === 'Priority')!
    const rows = Object.values(s.pages as Record<string, Row>).filter((p) => p.databaseId === db.id && !p.trashed)
    return {
      title: s.pages[db.id].title,
      rows: rows
        .map((r) => ({ title: r.title, stage: stage.options!.find((o) => o.id === r.properties[stage.id])?.name, priority: prio.options!.find((o) => o.id === r.properties[prio.id])?.name, source: JSON.stringify(r.content).includes(id) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    }
  }, id)
  expect(made.title).toBe('Checkout — Stories')
  expect(made.rows).toEqual([
    { title: 'Order history', stage: 'Backlog', priority: 'Low', source: true },
    { title: 'Pay by card', stage: 'Backlog', priority: 'High', source: true },
    { title: 'Save the address', stage: 'Backlog', priority: 'Medium', source: true },
  ])
})

test('Review & merge: Claude reviews the branch\'s diff, the review waits at the gate; Post review and Merge go to the worker', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup-reviewmerge').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Add the feature file')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('A feature file.')
  await page.getByTestId('coding-create').click()
  const id = await taskId(page)
  await expect(stageOf(page)).toContainText(/· Approve plan$/i, { timeout: 60_000 })
  await page.getByTestId('coding-approve').click()
  await expect(stageOf(page)).toContainText(/· Approve review & merge$/i, { timeout: 90_000 })
  expect(await h2s(page, id)).toContain('AI review')
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('Branch diff: feature.txt')
  // nothing was posted or merged before the gate
  expect(worker!.log()).not.toMatch(/glab|gh pr/)
  await page.getByTestId('coding-tab-git').click()
  await expect(page.getByTestId('coding-post-review')).toBeEnabled()
  await page.getByTestId('coding-post-review').click()
  await expect(page.getByRole('dialog')).toContainText('Post the review to the merge request of')
  await page.getByRole('dialog').getByRole('button', { name: 'Post review' }).click()
  // this repo has merge requests switched off ("pr": "none"): the worker says so
  await expect(page.getByText(/requests are off for this repo/).first()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('coding-merge-pr').click()
  await expect(page.getByRole('dialog')).toContainText('Merge the merge request of')
  await page.getByRole('dialog').getByRole('button', { name: 'Merge' }).click()
  await expect(page.getByText(/requests are off for this repo/).nth(1)).toBeVisible({ timeout: 20_000 })
})
