/**
 * The model Claude Code runs with — per pipeline stage and per task: the pipeline editor sets a stage's model (a chip
 * in its row, saved, kept after a reload; "Own…" checks the name as it is typed and blocks Save while it fails), the
 * task panel's setup strip overrides it for the task on this device, and the BUILT worker (public/mcp/one-worker.mjs)
 * with the fake Claude Code CLI (mcp/test/fixtures/fake-claude.mjs — no API call) gets it in the payload: `--model` in
 * Claude Code's argv, the log line naming it, the model Claude Code reports as a chip while it runs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'
import { makeCodingRepo, startCodingWorker, type CodingRepo, type RunningWorker } from './helpers/coding'

const PORT = 47385

test.describe.configure({ mode: 'serial' })

let repo: CodingRepo
let worker: RunningWorker | null = null

test.beforeAll(() => {
  repo = makeCodingRepo()
})
test.afterEach(async () => {
  await worker?.stop()
  worker = null
})
test.afterAll(() => repo?.cleanup())

/** The stored pipeline of the Coding database: [kind, model] per stage. */
const storedModels = (page: Page) =>
  wsEval(page, (s) => {
    const db = Object.values(s.databases).find((d: any) => d.system === 'coding') as any // eslint-disable-line @typescript-eslint/no-explicit-any
    return (db.pipeline as Array<{ kind: string; model?: string }>).map((p) => [p.kind, p.model ?? null])
  })

test('the pipeline editor: a stage\'s model shows as a chip, is saved and kept after a reload; "Own…" checks the name', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-pipeline-open').click()
  const rows = page.getByTestId('coding-pipeline').locator('> li')
  // Backlog · Ready · Plan · Approve plan · Implement · Test · Review · Ship · Done
  const plan = rows.nth(2)
  const implement = rows.nth(4)
  const test_ = rows.nth(5)
  await expect(plan.locator('.cpe-name')).toHaveValue('Plan')
  await expect(page.getByTestId('coding-pipeline-chip')).toHaveCount(0)

  // Plan: Fable from the list — a chip in the stage's row
  await plan.getByRole('button', { name: 'Stage details' }).click()
  const planModel = plan.getByTestId('coding-pipeline-model')
  await expect(planModel).toHaveValue('')
  expect(await planModel.locator('option').allTextContents()).toEqual(['Standard (worker default)', 'Opus', 'Sonnet', 'Haiku', 'Fable', 'Own…'])
  await expect(plan.locator('.cpe-model__hint')).toContainText('Standard: the repo’s model in worker.json')
  await planModel.selectOption('claude-fable-5-1')
  await expect(plan.getByTestId('coding-pipeline-chip')).toHaveText('Fable')
  await expect(plan.getByTestId('coding-pipeline-chip')).toHaveAttribute('title', 'Model: claude-fable-5-1')

  // Implement: an own name — checked as it is typed; Save waits until it passes
  await implement.getByRole('button', { name: 'Stage details' }).click()
  await implement.getByTestId('coding-pipeline-model').selectOption('__own')
  const own = implement.getByTestId('coding-pipeline-model-own')
  await expect(own).toBeFocused()
  const err = implement.getByTestId('coding-pipeline-model-err')
  await expect(err).toHaveText('Type the model name Claude Code should use.')
  const save = page.getByTestId('coding-pipeline-save')
  await expect(save).toBeDisabled()
  await own.fill('team model; rm -rf')
  await expect(err).toHaveText('Letters, digits and . _ : - [ ] only, starting with a letter or digit — no spaces, up to 100 characters.')
  await expect(own).toHaveAttribute('aria-invalid', 'true')
  await expect(implement.getByTestId('coding-pipeline-chip')).toHaveAttribute('data-bad', '')
  await expect(save).toBeDisabled()
  await own.fill('team-model.v2')
  await expect(err).toHaveCount(0)
  await expect(implement.getByTestId('coding-pipeline-chip')).toHaveText('team-model.v2')
  await expect(save).toBeEnabled()

  // a stage that does not run Claude Code has no model
  await test_.getByRole('button', { name: 'Stage details' }).click()
  await expect(test_.getByTestId('coding-pipeline-model')).toHaveCount(0)

  await save.click()
  await expect(page.locator('.toast').filter({ hasText: 'Pipeline saved.' })).toBeVisible()
  expect(await storedModels(page)).toEqual([['queue', null], ['queue', null], ['plan', 'claude-fable-5-1'], ['gate', null], ['implement', 'team-model.v2'], ['test', null], ['gate', null], ['git', null], ['done', null]])

  // kept after a reload; the editor shows them again
  await reloadApp(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-pipeline-open').click()
  await expect(page.getByTestId('coding-pipeline-chip')).toHaveText(['Fable', 'team-model.v2'])
  await rows.nth(4).getByRole('button', { name: 'Stage details' }).click()
  await expect(rows.nth(4).getByTestId('coding-pipeline-model')).toHaveValue('__own')
  await expect(rows.nth(4).getByTestId('coding-pipeline-model-own')).toHaveValue('team-model.v2')
  // back to Standard: the chip goes, the stage keeps no model
  await rows.nth(4).getByTestId('coding-pipeline-model').selectOption('')
  await expect(page.getByTestId('coding-pipeline-chip')).toHaveText(['Fable'])
  await page.getByTestId('coding-pipeline-save').click()
  await expect.poll(() => storedModels(page)).toEqual([['queue', null], ['queue', null], ['plan', 'claude-fable-5-1'], ['gate', null], ['implement', null], ['test', null], ['gate', null], ['git', null], ['done', null]])
})

test('the worker runs Claude Code with the stage\'s model, the task\'s own pick wins on this device; the log and the running chip name it', async ({ page }) => {
  const argvLog = join(repo.root, `claude-args-${Date.now()}.jsonl`)
  await openApp(page)
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
  worker = await startCodingWorker(repo, /--workspace (\S+)/.exec(init ?? '')![1]!, PORT, {}, { FAKE_CLAUDE_LOG: argvLog })
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('Connected · e2e-box · 1 repo')
  await page.keyboard.press('Escape')

  // the pipeline: Plan runs with Fable, Implement with Sonnet
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  await wsEval(page, (s) => {
    const db = Object.values(s.databases).find((d: any) => d.system === 'coding') as any // eslint-disable-line @typescript-eslint/no-explicit-any
    s.updateDatabase(db.id, { pipeline: db.pipeline.map((p: { kind: string }) => (p.kind === 'plan' ? { ...p, model: 'claude-fable-5-1' } : p.kind === 'implement' ? { ...p, model: 'sonnet' } : p)) })
  })
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Keep the session alive')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Refresh the session before it expires. FAKE:SLOW')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()

  const runs = () => (existsSync(argvLog) ? readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { args: string[] }).args) : [])
  const modelOf = (args: string[]) => (args.includes('--model') ? args[args.indexOf('--model') + 1] : null)
  const log = page.getByTestId('coding-log')

  // Plan: the stage's model
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })
  expect(runs().map(modelOf)).toEqual(['claude-fable-5-1'])
  await page.getByTestId('coding-tab-log').click()
  await expect(log).toContainText('Model: claude-fable-5-1 (chosen in One)')

  // the task's own model on this device: every Claude Code stage of it — kept after a reload
  const pick = page.getByTestId('coding-model-select')
  await expect(pick).toHaveValue('')
  await expect(page.getByTestId('coding-model')).toContainText('Each Claude Code stage runs with the model the pipeline gives it.')
  expect(await pick.locator('option').allTextContents()).toEqual(['As the pipeline', 'Opus', 'Sonnet', 'Haiku', 'Fable'])
  await pick.selectOption('claude-fable-5-1')
  await expect(page.getByTestId('coding-model')).toContainText('Every Claude Code stage of this task runs with Fable — on this device.')
  await reloadApp(page)
  await expect(page.getByTestId('coding-model-select')).toHaveValue('claude-fable-5-1')
  // a device-only choice: nothing to confirm, the task stays trusted
  await expect(page.getByTestId('coding-panel')).toHaveAttribute('data-trust', 'yes')

  // Implement runs with the task's pick (not the stage's Sonnet): the chip shows what Claude Code reports
  await page.getByTestId('coding-approve').click()
  await expect(page.getByTestId('coding-run-model')).toHaveText('claude-fable-5-1', { timeout: 30_000 })
  expect(runs().map(modelOf)).toEqual(['claude-fable-5-1', 'claude-fable-5-1'])
  await page.getByTestId('coding-stop').click()
  await expect(page.getByTestId('coding-state')).toContainText('Stopped', { timeout: 15_000 })
  await expect(page.getByTestId('coding-run-model')).toHaveCount(0)

  // As the pipeline again: Retry runs Implement with Sonnet (an alias — Claude Code reports the model behind it)
  await page.getByTestId('coding-model-select').selectOption('')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('coding-run-model')).toHaveText('claude-opus-5-5', { timeout: 30_000 })
  expect(runs().map(modelOf)).toEqual(['claude-fable-5-1', 'claude-fable-5-1', 'sonnet'])
  await page.getByTestId('coding-tab-log').click()
  await expect(log).toContainText('Model: sonnet (chosen in One)')
  await page.getByTestId('coding-stop').click()
  await expect(page.getByTestId('coding-state')).toContainText('Stopped', { timeout: 15_000 })
  // the worker's own log names the task it ran; the argv never carried more than one model
  expect(runs().every((a) => a.filter((x) => x === '--model').length === 1)).toBe(true)
})

test('German at 390 px: the stage\'s model field and the task\'s Model pick fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-pipeline-open').click()
  const plan = page.getByTestId('coding-pipeline').locator('> li').nth(2)
  await plan.getByRole('button', { name: 'Details der Stufe' }).click()
  await plan.getByTestId('coding-pipeline-model').selectOption('__own')
  await plan.getByTestId('coding-pipeline-model-own').fill('kein gültiger Name')
  await expect(plan.getByTestId('coding-pipeline-model-err')).toHaveText('Nur Buchstaben, Ziffern und . _ : - [ ], vorn ein Buchstabe oder eine Ziffer – ohne Leerzeichen, bis 100 Zeichen.')
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(await overflow()).toBeLessThanOrEqual(0)
  const dialog = await page.getByRole('dialog').boundingBox()
  for (const el of [plan.getByTestId('coding-pipeline-model'), plan.getByTestId('coding-pipeline-model-own'), plan.getByTestId('coding-pipeline-model-err'), plan.getByTestId('coding-pipeline-chip')]) {
    const b = (await el.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(dialog!.x)
    expect(b.x + b.width).toBeLessThanOrEqual(dialog!.x + dialog!.width + 0.5)
  }
  await plan.getByTestId('coding-pipeline-model').selectOption('opus')
  await page.getByTestId('coding-pipeline-save').click()
  await expect(page.getByTestId('coding-pipeline')).toHaveCount(0)

  // a task: the Model pick next to Approvals
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Fehler anzeigen')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-model')).toContainText('Modell')
  await expect(page.getByTestId('coding-model-select').locator('option').first()).toHaveText('Wie die Pipeline')
  await page.getByTestId('coding-model-select').selectOption('haiku')
  await expect(page.getByTestId('coding-model')).toContainText('Jede Claude-Code-Stufe dieser Aufgabe läuft mit Haiku – auf diesem Gerät.')
  expect(await overflow()).toBeLessThanOrEqual(0)
  const sel = (await page.getByTestId('coding-model-select').boundingBox())!
  expect(sel.x + sel.width).toBeLessThanOrEqual(390)
})
