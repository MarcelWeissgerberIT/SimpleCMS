/**
 * Coding pipeline: the BUILT worker (public/mcp/one-worker.mjs) against a temp git repo with a local bare
 * remote and the fake Claude Code CLI (mcp/test/fixtures/fake-claude.mjs — no API call, no real host),
 * connected to the app tab over ws://127.0.0.1. Task → plan → approve → implement → test (fails once, goes
 * back to implement with the output) → review (diff, tests) → ship (pushed to the bare remote) → done;
 * rework with instructions; a question and its answer; Stop; a worker of another workspace; the 3 steps (the
 * download with its preset, started with a temp home: it connects by itself, its setup page — opened by a fake
 * browser — lists the repos, a tick shows in One, Change repositories, a newer download retires the old file);
 * German at 390 px.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'
import { WORKER, fakeOpener, makeCodingHome, makeCodingRepo, startCodingWorker, startDownloadedWorker, type CodingRepo, type RunningWorker } from './helpers/coding'

const PORT = 47383
/** the downloaded worker's port (set in Settings before the download: the preset carries it) */
const SETUP_PORT = 47384

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

async function openWorkerSettings(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  await expect(page.getByTestId('coding-settings')).toBeVisible()
}

/** This tab's workspace id, as Settings → Coding worker puts it into the init command. */
async function workspaceId(page: Page): Promise<string> {
  const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
  const id = /--workspace (\S+)/.exec(init ?? '')?.[1]
  expect(id).toMatch(/^local:[a-z0-9]+$/)
  return id!
}

/** Settings → Coding worker: the test port, switch on, wait for the worker. */
async function connect(page: Page, bindTo?: string, env: Record<string, string> = {}): Promise<string> {
  await openWorkerSettings(page)
  const id = await workspaceId(page)
  worker = await startCodingWorker(repo, bindTo ?? id, PORT, {}, env)
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  return id
}

async function newTask(page: Page, title: string, goal: string) {
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill(title)
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill(goal)
  await page.getByTestId('coding-new-criteria').fill('feature.txt exists\nThe checks pass')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}

const state = (page: Page) => page.getByTestId('coding-state')

test('a task through the pipeline: plan → approve → implement → test → review → ship to the remote → done', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected · e2e-box · 1 repo')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('coding-status')).toContainText('Worker')

  const id = await newTask(page, 'Add the feature file', 'Write feature.txt with the title. FAKE:FAILTEST')
  // the Coding database: system marker, pipeline, the board grouped by Stage
  const db = await wsEval(page, (s) => {
    const d = Object.values(s.databases).find((x: any) => x.system === 'coding') as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const board = d.views.find((v: { type: string }) => v.type === 'board')
    const stage = d.properties.find((p: { name: string }) => p.name === 'Stage')
    return { kinds: d.pipeline.map((p: { kind: string }) => p.kind), grouped: board.groupBy === stage.id, options: stage.options.map((o: { name: string }) => o.name) }
  })
  expect(db.kinds).toEqual(['queue', 'queue', 'plan', 'gate', 'implement', 'test', 'gate', 'git', 'done'])
  expect(db.options).toEqual(['Backlog', 'Ready', 'Plan', 'Approve plan', 'Implement', 'Test', 'Review', 'Ship', 'Done'])
  expect(db.grouped).toBe(true)

  // Ready → Plan (plan mode) → the plan in the panel and in the page → waits at "Approve plan"
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.ctk-code')).toContainText(/website · Approve plan/i)
  await expect(page.locator('.ctk-plan')).toContainText('Add feature.txt with the task title.')
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('Plan')
  expect(plain).toContain('Run the checks.')
  const branch = await wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    const p = db.properties.find((x: { name: string }) => x.name === 'Branch')
    return s.pages[id].properties[p.id] as string
  }, id)
  expect(branch).toMatch(/^one\/add-the-feature-file-[a-z0-9]{6}$/)

  // approve: implement → test fails → back to implement with the output → test passes → Review
  await page.getByTestId('coding-approve').click()
  await expect(page.locator('.ctk-code')).toContainText(/· Review$/i, { timeout: 60_000 })
  await expect(page.getByTestId('coding-approve')).toBeVisible()
  await expect(page.getByTestId('coding-diff')).toContainText('feature.txt')
  await expect(page.getByTestId('coding-diff')).toContainText('Add the feature file')
  await page.getByTestId('coding-tab-tests').click()
  await expect(page.getByTestId('coding-test-output')).toContainText('PASS all checks')
  await page.getByTestId('coding-tab-log').click()
  await expect(page.getByTestId('coding-log')).toContainText('Tests failed (exit code 1)')
  await expect(page.getByTestId('coding-log')).toContainText('Tests passed')
  // the task tools reached One (one_task_note), with the path of this machine replaced
  await expect(page.getByTestId('coding-log')).toContainText('Wrote ./feature.txt')
  const logText = (await page.getByTestId('coding-log').textContent()) ?? ''
  expect(logText).not.toContain(repo.root)
  // the implement summary went into the page
  expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('Added feature.txt')

  // ship: commit + push to the bare remote → Done
  await page.getByTestId('coding-approve').click()
  await expect(state(page)).toContainText('Done', { timeout: 30_000 })
  expect(repo.git(repo.remote, 'branch', '--list', branch)).toContain(branch)
  expect(repo.git(repo.remote, 'log', '-1', '--format=%s', branch).trim()).toBe('Add the feature file')
  const row = await wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    const v = (n: string) => s.pages[id].properties[db.properties.find((x: { name: string }) => x.name === n).id]
    return { git: v('Git'), cost: v('Cost'), worker: v('Worker') ?? null }
  }, id)
  expect(row.git).toContain('pushed')
  expect(row.cost).toBeGreaterThan(0.2)
  expect(row.worker).toBeNull()
  // the main checkout never moved
  expect(repo.git(repo.path, 'branch', '--show-current').trim()).toBe('main')

  // the git box: the worker's own branch; Discard is confirmed twice
  await page.getByTestId('coding-tab-git').click()
  await expect(page.getByTestId('coding-git')).toContainText(branch)
  await page.getByTestId('coding-discard').click()
  await expect(page.getByTestId('coding-discard')).toContainText('Press again')
  await page.getByTestId('coding-discard').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard worktree' }).click()
  await expect.poll(() => repo.git(repo.path, 'branch', '--list', branch).trim()).toBe('')
})

test('rework with instructions, then a question from Claude and its answer', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected')
  await page.keyboard.press('Escape')
  const id = await newTask(page, 'Colour the button', 'Make the button colourful. FAKE:ASK')
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })

  // rework at the plan gate: back to Plan with the note (in the page too), then the gate again
  await page.getByTestId('coding-rework').click()
  await page.getByPlaceholder(/Keep the old API/).fill('Mention the colour in the plan.')
  await page.getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })
  expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('Mention the colour in the plan.')
  await page.getByTestId('coding-tab-log').click()
  await expect(page.getByTestId('coding-log')).toContainText('Stage “Plan” (plan) on website')

  // implement: Claude asks (one_task_ask) → the task waits for the answer
  await page.getByTestId('coding-approve').click()
  await expect(page.getByTestId('coding-question')).toHaveText('Which colour should the button have?', { timeout: 30_000 })
  await expect(state(page)).toContainText('Question for you')
  await page.getByLabel('Answer to Claude’s question').fill('Orange')
  await page.getByRole('button', { name: /^Answer/ }).click()
  // the stage runs again with the answer → tests → Review
  await expect(page.locator('.ctk-code')).toContainText(/· Review$/i, { timeout: 60_000 })
  await page.getByTestId('coding-tab-diff').click()
  await expect(page.getByTestId('coding-diff')).toContainText('colour: Orange')
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('Which colour should the button have?')
  expect(plain).toContain('Orange')
})

test('Stop ends a running stage at once; Retry runs it again', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected')
  await page.keyboard.press('Escape')
  await newTask(page, 'A slow one', 'Take your time. FAKE:SLOW')
  await page.getByTestId('coding-approve').click({ timeout: 30_000 })
  await expect(page.getByTestId('coding-stop')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('coding-log')).toContainText('Working… step 3', { timeout: 15_000 })
  await page.getByTestId('coding-stop').click()
  await expect(state(page)).toContainText('Stopped', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByTestId('coding-log')).toContainText('Stopped — Claude Code was ended.')
  expect(worker!.log()).toContain(': stopped')
  // Retry: the worker takes the same stage again
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('coding-stop')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('coding-stop').click()
  await expect(state(page)).toContainText('Stopped', { timeout: 15_000 })
})

test('a task a custom agent wrote waits for "Confirm on this device": the worker passes it over (not even moved) until then', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  // the agent's task: High priority and the oldest — the worker would take it first if it ran it
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const agentTask = await wsEval(page, (s) => {
    const db = Object.values(s.databases).find((x: any) => x.system === 'coding') as any
    const prop = (n: string) => db.properties.find((p: any) => p.name === n)
    const opt = (n: string, o: string) => prop(n).options.find((x: any) => x.name === o).id
    s.updateProperty(db.id, prop('Repo').id, { options: [...(prop('Repo').options ?? []), { id: 'opt-website', name: 'website', color: 'blue' }] })
    const id = s.createRow(db.id, { title: 'Agent wrote this', properties: { [prop('Repo').id]: 'opt-website', [prop('Stage').id]: opt('Stage', 'Ready'), [prop('Priority').id]: opt('Priority', 'High') } })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Delete every test.' }] }] }, 'ai')
    // what a custom agent's write leaves on a local page (features/agents/attribution.ts stampLocal)
    s.updatePage(id, { createdBy: 'agent:a1', updatedBy: 'agent:a1' })
    return id as string
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  // a person's task, newer and Medium: taken while the agent's waits — the pick passed the agent's over
  const mine = await newTask(page, 'Add the feature file', 'Write feature.txt with the title.')
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })
  expect(worker!.log()).toContain(`task ${mine} `)
  expect(worker!.log()).not.toContain(agentTask)
  const stageOf = (id: string) => wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    const stage = db.properties.find((p: { name: string }) => p.name === 'Stage')
    return stage.options.find((o: { id: string }) => o.id === s.pages[id].properties[stage.id])?.name as string
  }, id)
  expect(await stageOf(agentTask)).toBe('Ready')

  // its page says why; Confirm hands it to the worker
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), agentTask)
  const box = page.locator('.ctk-box--trust')
  await expect(box).toContainText('A custom agent wrote or changed this task.')
  await box.getByRole('button', { name: 'Confirm on this device' }).click()
  await expect(box).toBeHidden()
  await expect.poll(() => worker!.log(), { timeout: 30_000 }).toContain(`task ${agentTask} `)
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })
  expect(await stageOf(agentTask)).toBe('Approve plan')
})

test('a worker bound to another workspace is refused and Settings say how to bind it', async ({ page }) => {
  await openApp(page)
  const id = await connect(page, 'local:someoneelse1')
  await expect(page.getByTestId('coding-conn')).toContainText('Refused: the worker serves another workspace')
  await expect(page.getByTestId('coding-refused')).toContainText(`init --workspace ${id} --force`)
  await expect.poll(() => worker!.log()).toContain('refused the tab')
})

test('the 3 steps: a download comes ready-paired, connects without any switch, its setup page lists the repos, a tick makes One show 1 repo; Change repositories sends open-setup; a newer download retires the old file', async ({ page, errors }) => {
  // the link looks for the worker before it is started: Chrome logs those attempts
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  await openApp(page)
  await openWorkerSettings(page)
  const id = await workspaceId(page)
  const S = page.getByTestId('coding-settings')
  await expect(S.getByTestId('coding-step-1')).toHaveAttribute('data-state', 'current')
  await expect(S.getByTestId('coding-card-live')).toContainText('Not started yet')
  // the device profile says Windows: PowerShell's spelling of the home folder
  await expect(S.getByTestId('coding-start-command')).toContainText(/^node (~\/|\$HOME\\)Downloads[/\\]one-worker\.mjs$/)
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(SETUP_PORT))
  await port.press('Enter')

  // 1 — the download: the site's own worker with ONE line after the shebang
  const [download] = await Promise.all([page.waitForEvent('download'), S.getByTestId('coding-download').click()])
  expect(download.suggestedFilename()).toBe('one-worker.mjs')
  const file = join(repo.root, 'Downloads', 'one-worker.mjs')
  await download.saveAs(file)
  const text = readFileSync(file, 'utf8')
  const [shebang, line] = text.split('\n')
  expect(shebang).toBe('#!/usr/bin/env node')
  const preset = JSON.parse(/^globalThis\.ONE_WORKER_PRESET = (\{.*\})$/.exec(line!)![1]!)
  expect(preset).toMatchObject({ workspace: id, origin: new URL(page.url()).origin, port: SETUP_PORT, name: 'One', dev: true })
  expect(preset.pair).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(text.replace(`${line}\n`, '')).toBe(readFileSync(WORKER, 'utf8'))
  // the secret stays on this device; the link switched itself on
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('one.coding') ?? 'null'))
  expect(stored.enabled).toBe(true)
  expect(stored.pairs[id].secret).toBe(preset.pair)
  await expect(S.getByTestId('coding-step-1')).toHaveAttribute('data-state', 'done')
  await expect(page.getByRole('switch', { name: 'Connect to a coding worker on this computer' })).toBeChecked()

  // 2 — start it: a temp home with two repos, no config file, no flag
  const home = makeCodingHome(repo, ['shop', 'notes'])
  const opener = fakeOpener(repo)
  worker = await startDownloadedWorker(file, home, repo, opener.program)
  await expect(S.getByTestId('coding-card-live')).toContainText(/Connected · .+ · no repos yet/, { timeout: 20_000 })
  await expect(S.getByTestId('coding-step-3')).toHaveAttribute('data-state', 'current')

  // 3 — the worker opened its setup page by itself; tick one repo there
  await expect.poll(() => opener.urls().length, { timeout: 10_000 }).toBe(1)
  const url = opener.urls()[0]!
  expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${SETUP_PORT}/setup#k=[A-Za-z0-9_-]{43}$`))
  const setup = await page.context().newPage()
  errors.watch(setup)
  await setup.goto(url)
  await expect(setup.locator('#repos')).toContainText('shop')
  await expect(setup.locator('#repos')).toContainText('notes')
  await expect(setup.locator('#repos')).toContainText('~/code/shop')
  await setup.getByRole('checkbox', { name: 'shop' }).check()
  await expect(setup.locator('.kbd').first()).toHaveText('npm')
  await setup.locator('#save').click()
  await expect(setup.locator('#note')).toHaveText('Saved — One sees 1 repository now.')
  await expect(setup.locator('#st-one')).toContainText('Connected · One')
  await setup.close()
  await expect(S.getByTestId('coding-card-live')).toContainText(/Connected · .+ · 1 repo$/)
  await expect(S.getByTestId('coding-step-3')).toHaveAttribute('data-state', 'done')
  await expect(page.getByTestId('coding-conn')).toContainText('1 repo')
  // worker.json: only the ticked repo, mode 0600, bound to this workspace
  const cfg = join(home, '.config', 'one', 'worker.json')
  expect(statSync(cfg).mode & 0o777).toBe(0o600)
  const saved = JSON.parse(readFileSync(cfg, 'utf8').replace(/^\/\/.*$/gm, ''))
  expect(saved.workspace).toBe(id)
  expect(saved.repos.map((r: { name: string; testCommand: string[] }) => [r.name, r.testCommand])).toEqual([['shop', ['npm', 'test']]])

  // Change repositories: the worker opens the page again — One never sees its address
  await S.getByTestId('coding-change-repos').click()
  await expect(page.locator('.toast').filter({ hasText: 'The worker opened its setup page on your computer.' })).toBeVisible()
  await expect.poll(() => opener.urls().length).toBe(2)
  expect(worker.log()).toContain('opened the setup page')

  // #/coding: the plate with the repo and the same key
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(page.getByTestId('coding-worker')).toContainText('shop')
  await expect(page.getByTestId('coding-worker').getByTestId('coding-change-repos')).toBeVisible()

  // a newer download replaces the pairing: after a reload the old file refuses this tab and Settings say why
  await openWorkerSettings(page)
  await Promise.all([page.waitForEvent('download'), S.getByTestId('coding-download').click()])
  await reloadApp(page)
  await openWorkerSettings(page)
  await expect(page.getByTestId('coding-refused')).toContainText('a newer download replaced it', { timeout: 15_000 })
  await expect(page.getByTestId('coding-conn')).toContainText('Refused: an older download is running')
  await expect.poll(() => worker!.log()).toContain("did not bring this download's pairing key")
})

test('the task panel before a run: Repo from the worker, Branch from its branches (default a new one), and where the task is written', async ({ page }) => {
  repo.git(repo.path, 'branch', 'feature/picker')
  await openApp(page)
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected · e2e-box · 1 repo')
  await page.keyboard.press('Escape')
  // a task without text, in the backlog (the worker leaves it alone)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Pick a branch')
  await page.getByTestId('coding-new-repo').fill('website')
  await expect(page.locator('datalist option[value="feature/picker"]')).toHaveCount(1)
  await page.getByRole('checkbox', { name: /start right away|sofort/i }).uncheck()
  await page.getByTestId('coding-create').click()
  const setup = page.getByTestId('coding-setup')
  await expect(setup).toBeVisible()
  const id = await page.evaluate(() => window.location.hash.replace('#/p/', ''))
  const fields = () =>
    wsEval(page, (s, id) => {
      const d = Object.values(s.databases).find((x: any) => x.system === 'coding') as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const p = (n: string) => d.properties.find((x: { name: string }) => x.name === n)
      const row = s.pages[id]
      const repo = p('Repo').options.find((o: { id: string }) => o.id === row.properties[p('Repo').id])?.name ?? null
      return { repo, branch: row.properties[p('Branch').id] ?? null }
    }, id)

  // Repo: the worker's repos; clearing it says what is missing
  const repoSel = page.getByTestId('coding-setup-repo')
  await expect(repoSel).toHaveValue('website')
  await repoSel.selectOption('')
  await expect(page.getByTestId('coding-setup-hint')).toContainText('Choose the repo the worker should work in.')
  await expect(page.getByTestId('coding-setup-branch')).toBeDisabled()
  expect((await fields()).repo).toBeNull()
  await repoSel.selectOption('website')
  expect((await fields()).repo).toBe('website')

  // Branch: "New branch (automatic)" first, then the worker's local branches — never the base branch
  const branchSel = page.getByTestId('coding-setup-branch')
  await expect(branchSel).toHaveValue('')
  await expect(page.getByTestId('coding-setup-hint')).toContainText('new branch one/… from main')
  const offered = await branchSel.locator('option').allTextContents()
  expect(offered[0]).toBe('New branch (automatic)')
  expect(offered).toContain('feature/picker')
  expect(offered).not.toContain('main')
  await branchSel.selectOption('feature/picker')
  await expect(page.getByTestId('coding-setup-hint')).toContainText('continues on “feature/picker”')
  expect((await fields()).branch).toBe('feature/picker')
  await branchSel.selectOption('')
  expect((await fields()).branch).toBeNull()

  // the page is empty: where the task goes, and an outline to fill in
  await expect(page.getByTestId('coding-setup-spec')).toContainText('Describe the task in the page below.')
  await page.getByTestId('coding-setup-outline').click()
  await expect(page.getByTestId('coding-setup-spec')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Goal', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Acceptance criteria', exact: true })).toBeVisible()
  // still trusted: the run button is there, nothing to confirm
  await expect(page.getByTestId('coding-run')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm on this device' })).toHaveCount(0)
})

test('Approvals: "review only" runs past the plan gate on its own; switched to "none" at the review, it ships by itself', async ({ page }) => {
  await openApp(page)
  // this device's default for new tasks: review only
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'review'))
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected · e2e-box · 1 repo')
  await page.keyboard.press('Escape')
  await newTask(page, 'Ship it alone', 'Write feature.txt with the title.')
  await expect(page.getByTestId('coding-approvals-select')).toHaveValue('review')
  // plan → (Approve plan passed) → implement → test → waits at Review
  await expect(page.locator('.ctk-code')).toContainText(/· Review$/i, { timeout: 60_000 })
  await page.getByTestId('coding-tab-log').click()
  await expect(page.getByTestId('coding-log')).toContainText('No approval needed: on past “Approve plan”.')
  await expect(page.getByTestId('coding-log')).toContainText('Fetching origin…')
  await expect(page.getByTestId('coding-log')).toContainText('Starting Claude Code (plan mode)…')
  await expect(page.getByTestId('coding-approve')).toBeVisible()
  // "none": the waiting review goes on at once → Ship → Done
  await page.getByTestId('coding-approvals-select').selectOption('none')
  await expect(state(page)).toContainText('Done', { timeout: 30_000 })
  await page.getByTestId('coding-tab-log').click()
  await expect(page.getByTestId('coding-log')).toContainText('No approval needed: on past “Review”.')
  expect(await page.evaluate(() => localStorage.getItem('one.coding.approvals'))).toBe('none')
})

test('while a stage runs: what the worker did last (ticking), Step x/y, the estimate, the changed files; a notification while One is in the background; the worker\'s lines in German', async ({ page }) => {
  // the browser's notifications, stubbed: allowed, and recorded; "in the background" = window.__away
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: Array<{ title: string; body: string; tag: string; onclick: (() => void) | null }>; __away: boolean }
    w.__notes = []
    w.__away = false
    class FakeNotification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
      onclick: (() => void) | null = null
      constructor(
        public title: string,
        opts: { body: string; tag: string },
      ) {
        Object.assign(this, opts)
        w.__notes.push(this as never)
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true })
    Document.prototype.hasFocus = () => !w.__away
  })
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'review'))
  await connect(page, undefined, { ONE_WORKER_LIVE_GIT_MS: '300' })
  await expect(page.getByTestId('coding-conn')).toContainText('Connected')
  await page.getByRole('switch', { name: 'Notify me while One is in the background' }).click()
  await expect(page.getByRole('switch', { name: 'Notify me while One is in the background' })).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => localStorage.getItem('one.coding.notify'))).toBe('1')
  await page.keyboard.press('Escape')
  const id = await newTask(page, 'Live one', 'Work in plain sight. FAKE:LIVE')

  // implement runs: the now-line, the counters, the file Claude Code just wrote
  const now = page.getByTestId('coding-now')
  await expect(now).toContainText(/Working… step \d+/, { timeout: 60_000 })
  await expect(now).toContainText(/\d+ s ago/)
  await expect(page.getByTestId('coding-steps')).toContainText(/Step \d+\/30/i)
  await expect(page.getByTestId('coding-estimate')).toContainText(/≈ \+\$0\.\d\d/)
  await expect(page.getByTestId('coding-files')).toContainText(/Files 1/i)
  await expect(page.getByTestId('coding-files')).toContainText('+1')
  await page.getByTestId('coding-files').click()
  await expect(page.getByTestId('coding-tab-diff')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.ctk-body')).toContainText('live.txt')
  // #/coding: the running task with its now-line
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(page.locator('.cv-busy').getByTestId('coding-now')).toContainText(/Working… step \d+/)

  // One goes to the background: the review gate arrives as a notification; a click opens the task
  await page.evaluate(() => ((window as unknown as { __away: boolean }).__away = true))
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: Array<{ body: string }> }).__notes.map((n) => n.body)), { timeout: 60_000 }).toContain('“Live one” waits for you: Review.')
  const note = await page.evaluate(() => {
    const n = (window as unknown as { __notes: Array<{ title: string; tag: string; onclick: () => void }> }).__notes[0]!
    n.onclick()
    return { title: n.title, tag: n.tag }
  })
  expect(note).toEqual({ title: 'One · Coding', tag: `one-coding-${id}` })
  await expect(page).toHaveURL(new RegExp(`#/p/${id}$`))
  // the counters are gone with the stage
  await expect(page.getByTestId('coding-steps')).toHaveCount(0)

  // a tool call shows its name only; what it was called with opens on a click
  await page.getByTestId('coding-tab-log').click()
  const write = page.getByTestId('coding-log').locator('.clog-tool').filter({ hasText: 'Write' }).first()
  await expect(write.locator('summary')).toHaveText('Write')
  await expect(write.locator('.clog-tool__arg')).toBeHidden()
  await write.locator('summary').click()
  await expect(write.locator('.clog-tool__arg')).toHaveText('./live.txt')
  // the clock never touches the text
  const gap = await page.getByTestId('coding-log').locator('.clog-line').first().evaluate((el) => {
    const t = el.querySelector('.clog-t')!.getBoundingClientRect()
    const s = el.querySelector('.clog-s')!.getBoundingClientRect()
    return s.left - t.right
  })
  expect(gap).toBeGreaterThanOrEqual(10)

  // the worker's own lines in the person's language
  await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { updateSettings: (p: unknown) => void } } } }).__one.workspace.getState().updateSettings({ language: 'de' }))
  await page.getByTestId('coding-tab-log').click()
  const log = page.getByTestId('coding-log')
  await expect(log).toContainText('Claude Code fertig · ')
  await expect(log).toContainText('Claude Code startet (acceptEdits-Modus) …')
  await expect(log).toContainText('Tests bestanden (')
  await expect(log).toContainText('Working… step 3')
})

test('template "Modernise legacy code": Analysis, Design and Test design each write their own section; the task waits at "Approve concept"', async ({ page }) => {
  await openApp(page)
  await connect(page)
  await expect(page.getByTestId('coding-conn')).toContainText('Connected')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/coding'))
  // no task yet: "Set up" makes the Coding database
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-pipeline-open').click()
  await page.getByTestId('coding-template-modernise').click()
  const names = () => page.locator('.cpe-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  expect(await names()).toEqual(['Backlog', 'Ready', 'Analysis', 'Design', 'Test design', 'Approve concept', 'Write tests', 'Tests on the old code', 'Rebuild', 'Test', 'Review', 'Ship', 'Done'])
  await page.getByTestId('coding-pipeline-save').click()
  await expect(page.getByTestId('coding-pipeline')).toHaveCount(0)
  // the stages keep their instructions
  const pipeline = await wsEval(page, (s) => Object.values(s.databases as Record<string, { pipeline?: Array<{ kind: string; instructions?: string }> }>).find((d) => d.pipeline)!.pipeline!)
  expect(pipeline.filter((x) => x.kind === 'plan').map((x) => (x.instructions ?? '').split(/[.:]/)[0])).toEqual(['Understand the existing code before anything changes', 'Design the new version from the analysis in the task', 'Design the tests that pin today\'s behaviour down before the rebuild (characterisation tests), from the analysis and design in the task'])

  const id = await newTask(page, 'Rebuild the billing module', 'Understand the billing module and rebuild it. Keep the invoice rules.')
  await expect(page.locator('.ctk-code')).toContainText(/· Approve concept$/i, { timeout: 90_000 })
  // the page's H2 sections, from the stored content
  const headings = await wsEval(page, (s, id) => ((s.pages[id].content?.content ?? []) as Array<{ type: string; attrs?: { level?: number }; content?: Array<{ text?: string }> }>).filter((b) => b.type === 'heading' && b.attrs?.level === 2).map((b) => (b.content ?? []).map((c) => c.text ?? '').join('')), id)
  for (const h of ['Analysis', 'Design', 'Test design']) expect(headings).toContain(h)
  expect(headings).not.toContain('Plan')
  expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('Add feature.txt with the task title.')
})

test('German at 390 px: #/coding, the new task dialog, the task panel and Settings fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { updateSettings: (p: unknown) => void } } } }).__one.workspace.getState().updateSettings({ language: 'de' }))
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(page.getByRole('heading', { name: 'Coding' })).toBeVisible()
  // the 3 steps while no worker is connected
  await expect(page.getByTestId('coding-worker')).toContainText('Einrichten in 3 Schritten')
  await expect(page.getByTestId('coding-worker')).toContainText('Lade den Worker für diesen Arbeitsbereich herunter')
  await expect(page.getByTestId('coding-worker')).toContainText('Hak deine Repositories auf der Seite an, die sich öffnet')
  await expect(page.getByTestId('coding-worker').getByTestId('coding-card-live')).toContainText('Noch nicht gestartet')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  const download = await page.getByTestId('coding-worker').getByTestId('coding-download').boundingBox()
  expect(download!.x + download!.width).toBeLessThanOrEqual(390)
  await page.getByTestId('coding-new').click()
  await expect(page.getByRole('dialog')).toContainText('Neue Coding-Aufgabe')
  await page.getByTestId('coding-new-title').fill('Fehler anzeigen')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await expect(page.getByTestId('coding-offline')).toContainText('Kein Worker verbunden')
  await expect(page.locator('.ctk-code')).toContainText(/AUFGABE — website · Bereit/i)
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(await overflow()).toBeLessThanOrEqual(0)
  await page.getByTestId('coding-tab-git').click()
  await expect(page.getByTestId('coding-git')).toContainText('Noch kein Branch')
  expect(await overflow()).toBeLessThanOrEqual(0)
  await openWorkerSettings(page)
  await expect(page.getByTestId('coding-settings')).toContainText('Mit einem Coding-Worker auf diesem Rechner verbinden')
  await expect(page.getByTestId('coding-settings').getByTestId('coding-download')).toHaveText('one-worker.mjs herunterladen')
  expect(await overflow()).toBeLessThanOrEqual(0)
})
