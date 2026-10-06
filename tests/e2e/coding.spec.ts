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
async function connect(page: Page, bindTo?: string): Promise<string> {
  await openWorkerSettings(page)
  const id = await workspaceId(page)
  worker = await startCodingWorker(repo, bindTo ?? id, PORT)
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
  await expect(page.getByTestId('coding-log')).toContainText('Stage "Plan" (plan)')

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
  await expect(page.getByTestId('coding-conn')).toContainText('Refused: this worker belongs to another download')
  await expect.poll(() => worker!.log()).toContain("did not bring this download's pairing key")
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
