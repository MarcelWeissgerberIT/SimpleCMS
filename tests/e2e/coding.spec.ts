/**
 * Coding pipeline: the BUILT worker (public/mcp/one-worker.mjs) against a temp git repo with a local bare
 * remote and the fake Claude Code CLI (mcp/test/fixtures/fake-claude.mjs — no API call, no real host),
 * connected to the app tab over ws://127.0.0.1. Task → plan → approve → implement → test (fails once, goes
 * back to implement with the output) → review (diff, tests) → ship (pushed to the bare remote) → done;
 * rework with instructions; a question and its answer; Stop; a worker of another workspace; German at 390 px.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { makeCodingRepo, startCodingWorker, type CodingRepo, type RunningWorker } from './helpers/coding'

const PORT = 47383

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

test('German at 390 px: #/coding, the new task dialog, the task panel and Settings fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { updateSettings: (p: unknown) => void } } } }).__one.workspace.getState().updateSettings({ language: 'de' }))
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(page.getByRole('heading', { name: 'Coding' })).toBeVisible()
  await expect(page.getByTestId('coding-worker')).toContainText('Die Verbindung zum Worker ist auf diesem Gerät aus.')
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
  expect(await overflow()).toBeLessThanOrEqual(0)
})
