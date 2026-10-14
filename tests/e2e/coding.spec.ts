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
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, waitForApp, wsEval } from './fixtures'
import { WORKER, fakeOpener, makeCodingHome, makeCodingRepo, startCodingWorker, startDownloadedWorker, type CodingRepo, type RunningWorker } from './helpers/coding'

/** CODING_E2E_PORT: one port for both when suites run side by side (each test runs one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47383
/** the downloaded worker's port (set in Settings before the download: the preset carries it) */
const SETUP_PORT = Number(process.env.CODING_E2E_PORT) || 47384

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
  // a change to a file opens as its diff under the tool call
  const edit = page.getByTestId('coding-log').locator('details.clog-tool[data-edit]').last()
  await expect(edit.locator('summary')).toContainText('feature.txt +')
  await edit.locator('summary').click()
  await expect(edit.getByTestId('coding-log-edit')).toContainText('./feature.txt')
  await expect(edit.locator('.cd-row--add').first()).toContainText('Add the feature file')
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

test('two tabs confirm different tasks at once: both versions are kept; the other tab’s lamp follows without a reload (T-P2-11)', async ({ page }) => {
  type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const gateConfirms = (p: Page) =>
    p.evaluate(async () => {
      const pf = (window as unknown as { __onePreflight: AnyState }).__onePreflight
      await pf.flush()
      return ((pf.readings().gate?.ids ?? []) as string[]).filter((id) => id.includes(':confirm@')).sort()
    })
  const codingOn = (p: Page) => p.evaluate(() => (window as unknown as { __onePreflight: AnyState }).__onePreflight.stores.coding.setState({ enabled: true }))
  await openApp(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  // two tasks at the plan gate, both written by a custom agent: each waits for "Confirm on this device"
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [a, b] = await wsEval(page, (s) => {
    const db = Object.values(s.databases).find((x: any) => x.system === 'coding') as any
    const stage = db.properties.find((p: any) => p.name === 'Stage')
    const gate = db.pipeline.find((x: any) => x.kind === 'gate').id
    return ['Agent task one', 'Agent task two'].map((title) => {
      const id = s.createRow(db.id, { title, properties: { [stage.id]: gate } })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title}: the plan.` }] }] }, 'ai')
      s.updatePage(id, { createdBy: 'agent:a1', updatedBy: 'agent:a1' })
      return id as string
    })
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  await page.waitForFunction(() => !!(window as unknown as { __oneCoding?: unknown }).__oneCoding)
  await codingOn(page)
  await page.evaluate(() => (window as unknown as { __one: AnyState }).__one.flushSave())
  const second = await page.context().newPage()
  await second.goto('app/?e2e')
  await waitForApp(second)
  await second.waitForFunction(() => !!(window as unknown as { __oneCoding?: unknown; __onePreflight?: unknown }).__oneCoding && !!(window as unknown as { __onePreflight?: unknown }).__onePreflight)
  await expect.poll(() => wsEval(second, (s, id) => !!s.pages[id], b)).toBe(true)
  await codingOn(second)
  for (const p of [page, second]) await expect.poll(() => gateConfirms(p).then((ids) => ids.length)).toBe(2)

  // the versions as each card would show them, then Confirm in both tabs at the same moment (one task each)
  const view = (p: Page, id: string) => p.evaluate((id) => (window as unknown as { __oneCoding: AnyState }).__oneCoding.taskVersionView(id), id)
  const [va, vb] = [await view(page, a), await view(second, b)]
  const confirm = (p: Page, id: string, hash: string) => p.evaluate(({ id, hash }) => (window as unknown as { __oneCoding: AnyState }).__oneCoding.confirmTaskVersion(id, hash), { id, hash })
  expect(await Promise.all([confirm(page, a, va.hash), confirm(second, b, vb.hash)])).toEqual(['ok', 'ok'])

  // both versions are stored …
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-coding')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const v = await new Promise<string[]>((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get('local:local|trust')
      q.onsuccess = () => res(q.result ?? [])
      q.onerror = () => rej(q.error)
    })
    db.close()
    return v
  })
  expect(stored).toEqual(expect.arrayContaining([va.hash, vb.hash]))
  // … and each tab's lamp lost both confirm cards without a reload (the other tab's Confirm came over the channel)
  for (const p of [page, second]) await expect.poll(() => gateConfirms(p), { timeout: 10_000 }).toEqual([])
  for (const p of [page, second]) for (const id of [a, b]) expect(await p.evaluate((id) => (window as unknown as { __oneCoding: AnyState }).__oneCoding.taskNeedsConfirm(id), id)).toBe(false)
  await second.close()
})

test('Where the worker runs: a local workspace offers Local only — Cloud is off with its reason as text; the keys stay in the group', async ({ page }) => {
  await openApp(page)
  await openWorkerSettings(page)
  const group = page.getByTestId('coding-via')
  await expect(group).toHaveAttribute('role', 'radiogroup')
  const local = page.getByTestId('coding-via-local')
  const cloud = page.getByTestId('coding-via-cloud')
  await expect(local).toHaveAttribute('aria-checked', 'true')
  await expect(cloud).toHaveAttribute('aria-checked', 'false')
  await expect(cloud).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('coding-via-why')).toHaveText('Cloud needs a team workspace on a One server.')
  // the reason is the disabled option's description (not a tooltip)
  const why = await page.getByTestId('coding-via-why').getAttribute('id')
  await expect(cloud).toHaveAttribute('aria-describedby', why!)
  await expect(page.getByTestId('coding-via-hint')).toContainText('127.0.0.1')
  // roving focus: arrows move within the group, Cloud cannot be chosen here
  await local.focus()
  await page.keyboard.press('ArrowRight')
  await expect(cloud).toBeFocused()
  await expect(local).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Home')
  await expect(local).toBeFocused()
  await cloud.click({ force: true }) // aria-disabled: Playwright would wait for it to be enabled
  await expect(local).toHaveAttribute('aria-checked', 'true')
  // the local card and the manual setup stay
  await expect(page.getByTestId('coding-setup-card')).toBeVisible()
  await expect(page.getByTestId('coding-settings')).toHaveAttribute('data-via', 'local')
})

test('a worker bound to another workspace is refused and Settings say how to bind it', async ({ page }) => {
  await openApp(page)
  const id = await connect(page, 'local:someoneelse1')
  await expect(page.getByTestId('coding-conn')).toContainText('Refused: the worker serves another workspace')
  await expect(page.getByTestId('coding-refused')).toContainText(`init --workspace ${id} --force`)
  await expect.poll(() => worker!.log()).toContain('refused the tab')
})

/**
 * Chrome's Local Network Access as the person left it: `navigator.permissions.query` answers the test's state for its
 * names (the same status object each time, its `change` listeners called by `__lna.flip`); every other permission as the
 * browser has it. Counts this page's attempts to reach the worker's port (`__lna.tries`).
 */
async function stubLocalNetwork(page: Page, state: PermissionState, port: number) {
  await page.addInitScript(
    ({ state, port }) => {
      const listeners = new Set<() => void>()
      const lna = { state, tries: 0, flip: (s: PermissionState) => ((lna.state = s), listeners.forEach((fn) => fn())) }
      ;(window as unknown as { __lna: typeof lna }).__lna = lna
      const status = { name: 'local-network-access', onchange: null, get state() { return lna.state }, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn), dispatchEvent: () => true }
      const query = navigator.permissions.query.bind(navigator.permissions)
      navigator.permissions.query = ((d: PermissionDescriptor) =>
        ['loopback-network', 'local-network-access', 'local-network'].includes(String(d.name)) ? Promise.resolve(status as unknown as PermissionStatus) : query(d)) as typeof navigator.permissions.query
      const Native = window.WebSocket
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          if (String(url).startsWith(`ws://127.0.0.1:${port}`)) lna.tries += 1
        }
      }
    },
    { state, port },
  )
}

const lna = (page: Page) => page.evaluate(() => (window as unknown as { __lna: { state: string; tries: number } }).__lna)
const flipLna = (page: Page, state: PermissionState) => page.evaluate((s) => (window as unknown as { __lna: { flip: (s: PermissionState) => void } }).__lna.flip(s), state)

/** Start → the Worker offline lamp's queue: its current card (red at once for a refusal or a block). */
async function workerCard(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/'))
  const cap = page.locator('.pf-cap[data-lamp="worker"]')
  await expect(cap).toHaveAttribute('data-lit', 'red')
  await cap.focus()
  await page.keyboard.press('Enter')
  const card = page.locator('.pf-q article.pf-card[data-current]')
  await expect(card).toHaveAttribute('data-lamp', 'worker')
  return card
}

test('the browser blocks the local link (Local Network Access): the waiting text says to allow it; denied, Settings and the Preflight card say why — no retries; allowed, it connects by itself', async ({ page, errors }) => {
  // the link looks for the worker before it is started: Chrome logs those attempts
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  await stubLocalNetwork(page, 'prompt', PORT)
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await openWorkerSettings(page)
  const id = await workspaceId(page)
  const S = page.getByTestId('coding-settings')
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  // still to be asked: the link keeps trying and the waiting text says to choose Allow
  await expect(S.getByTestId('coding-waiting')).toContainText('No worker answers yet. Start it (step 2) — this tab keeps trying. If the browser asks whether One may reach apps on this device, choose Allow.')
  await expect(S.getByTestId('coding-conn')).toContainText('Waiting for the worker — if the browser asks whether One may reach apps on this device, choose Allow')

  // the person said no: blocked with the reason, the whole text and a Retry key — and no more attempts
  await flipLna(page, 'denied')
  const blocked = S.getByTestId('coding-blocked')
  await expect(blocked).toHaveAttribute('data-reason', 'permission')
  await expect(blocked).toContainText('The browser blocks this page from reaching the worker on this device. Allow it in the site settings (the icon left of the address: “Apps on device” / “Local network access”), then retry.')
  await expect(blocked.getByRole('button', { name: 'Retry now' })).toBeVisible()
  await expect(S.getByTestId('coding-card-live')).toContainText('Blocked by the browser: this page may not reach the worker on this device — allow it in the site settings')
  await expect(S.getByTestId('coding-waiting')).toHaveCount(0)
  const tries = (await lna(page)).tries
  expect(tries).toBeGreaterThan(0)
  // Retry while still denied: one attempt, blocked again
  await blocked.getByRole('button', { name: 'Retry now' }).click()
  await expect.poll(async () => (await lna(page)).tries).toBe(tries + 1)
  await expect(blocked).toHaveAttribute('data-reason', 'permission')
  await page.waitForTimeout(3000)
  expect((await lna(page)).tries).toBe(tries + 1)

  // Preflight: red at once, the card names the reason before "since"
  await page.keyboard.press('Escape')
  const card = await workerCard(page)
  await expect(card).toHaveAttribute('data-id', 'worker:blocked')
  await expect(card.locator('.pf-card__detail')).toHaveText(/^Blocked by the browser: this page may not reach the worker on this device — allow it in the site settings \(the icon left of the address: “Apps on device” \/ “Local network access”\), then retry · since \d\d:\d\d$/)

  // allowed in the site settings, the worker started: the link tries again by itself and connects
  worker = await startCodingWorker(repo, id, PORT)
  await flipLna(page, 'granted')
  await expect(page.getByTestId('coding-status')).toHaveAttribute('title', /^Connected · e2e-box · 1 repo/, { timeout: 15_000 })
  // the lamp goes dark (its card leaves the reading)
  await expect.poll(() => page.evaluate(async () => {
    const p = (window as unknown as { __onePreflight: { flush: (id: string) => Promise<void>; readings: () => Record<string, { count: number } | null> } }).__onePreflight
    await p.flush('worker')
    return p.readings().worker?.count ?? null
  })).toBe(0)
  await openWorkerSettings(page)
  await expect(S.getByTestId('coding-blocked')).toHaveCount(0)
  await expect(S.getByTestId('coding-card-live')).toContainText('Connected · e2e-box · 1 repo')
})

test('a browser that does not let this page open ws:// at all (Safari): blocked with what to use instead — Settings and the Preflight card', async ({ page }) => {
  await page.addInitScript((port) => {
    const Native = window.WebSocket
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (String(url).startsWith(`ws://127.0.0.1:${port}`)) throw new DOMException('An insecure WebSocket connection may not be initiated from a page loaded over HTTPS.', 'SecurityError')
        super(url, protocols)
      }
    }
  }, PORT)
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await openWorkerSettings(page)
  const S = page.getByTestId('coding-settings')
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  const blocked = S.getByTestId('coding-blocked')
  await expect(blocked).toHaveAttribute('data-reason', 'insecure')
  await expect(blocked).toContainText('This browser does not let a secure (https) page reach the worker on this computer. Use Chrome, Edge or Firefox.')
  await expect(blocked.getByRole('button', { name: 'Retry now' })).toBeVisible()
  await page.keyboard.press('Escape')
  const card = await workerCard(page)
  await expect(card.locator('.pf-card__detail')).toHaveText(/^Blocked by the browser: it does not let an https page reach the worker on this computer — use Chrome, Edge or Firefox · since \d\d:\d\d$/)
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
  // the start lines per computer: Windows — PowerShell and Command Prompt, the file quoted — or macOS · Linux
  const start = S.getByTestId('coding-start-command')
  await S.getByTestId('coding-os-windows').first().click()
  await expect(S.getByTestId('coding-os-windows').first()).toHaveAttribute('aria-checked', 'true')
  await expect(start.getByTestId('coding-start-command-powershell')).toHaveText('node "$env:USERPROFILE\\Downloads\\one-worker.mjs"')
  await expect(start.getByTestId('coding-start-command-cmd')).toHaveText('node "%USERPROFILE%\\Downloads\\one-worker.mjs"')
  await expect(start).toContainText('PowerShell')
  await expect(start).toContainText('Command Prompt (cmd)')
  await expect(S.getByTestId('coding-step-2')).toContainText('Git for Windows')
  // the browser may keep downloads elsewhere (Downloads moved, e.g. into OneDrive): start the file from there
  await expect(S.getByTestId('coding-start-folder')).toContainText('Copy as path')
  await expect(start.getByRole('button', { name: 'Copy Start command · PowerShell' })).toBeVisible()
  // arrow keys move the choice (one radiogroup per place, one choice for the tab)
  await S.getByTestId('coding-os-windows').first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(S.getByTestId('coding-os-posix').first()).toBeFocused()
  await expect(S.getByTestId('coding-os-posix').first()).toHaveAttribute('aria-checked', 'true')
  await expect(start.getByTestId('coding-start-command-sh')).toHaveText('node ~/Downloads/one-worker.mjs')
  await expect(start.getByTestId('coding-start-command-powershell')).toHaveCount(0)
  await expect(S.getByTestId('coding-step-2')).not.toContainText('Git for Windows')
  await expect(S.getByTestId('coding-start-folder')).toHaveCount(0)
  // ↑ / ↓ too, as in every radio group (wrapping at the ends)
  await page.keyboard.press('ArrowDown')
  await expect(S.getByTestId('coding-os-windows').first()).toBeFocused()
  await expect(S.getByTestId('coding-os-windows').first()).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(S.getByTestId('coding-os-posix').first()).toBeFocused()
  await expect(S.getByTestId('coding-os-posix').first()).toHaveAttribute('aria-checked', 'true')
  await expect(start.getByTestId('coding-start-command-sh')).toHaveText('node ~/Downloads/one-worker.mjs')
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(SETUP_PORT))
  await port.press('Enter')
  // the manual setup follows the same choice; its run lines set a port that is not the default
  await S.getByText('Manual setup (worker.json)').click()
  await expect(S.getByTestId('coding-manual-run-sh')).toHaveText(`node ~/one-worker.mjs check\nONE_WORKER_PORT=${SETUP_PORT} node ~/one-worker.mjs`)
  await expect(S.getByTestId('coding-manual-download-sh')).toContainText(/^curl -fsSL http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/mcp\/one-worker\.mjs -o ~\/one-worker\.mjs$/)
  await S.getByTestId('coding-os-windows').last().click()
  await expect(start.getByTestId('coding-start-command-powershell')).toBeVisible()
  await expect(S.getByTestId('coding-manual-init-powershell')).toHaveText(`node "$env:USERPROFILE\\one-worker.mjs" init --workspace ${id}`)
  await expect(S.getByTestId('coding-manual-init-cmd')).toHaveText(`node "%USERPROFILE%\\one-worker.mjs" init --workspace ${id}`)
  await expect(S.getByTestId('coding-manual-run-powershell')).toHaveText(`node "$env:USERPROFILE\\one-worker.mjs" check\n$env:ONE_WORKER_PORT = '${SETUP_PORT}'; node "$env:USERPROFILE\\one-worker.mjs"`)
  await expect(S.getByTestId('coding-manual-run-cmd')).toHaveText(`node "%USERPROFILE%\\one-worker.mjs" check\nset "ONE_WORKER_PORT=${SETUP_PORT}" && node "%USERPROFILE%\\one-worker.mjs"`)
  await expect(S.getByTestId('coding-manual-download-powershell')).toContainText(/^Invoke-WebRequest -UseBasicParsing "http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/mcp\/one-worker\.mjs" -OutFile "\$env:USERPROFILE\\one-worker\.mjs"$/)
  await expect(S.getByTestId('coding-manual-download-cmd')).toContainText(/^curl\.exe -fsSL "http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/mcp\/one-worker\.mjs" -o "%USERPROFILE%\\one-worker\.mjs"$/)
  await S.getByText('Manual setup (worker.json)').click()

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

  // 2 — start it: a temp home with two repos, no config file, no flag — "notes" as a clone the worker made
  const home = makeCodingHome(repo, ['shop', 'notes'])
  writeFileSync(join(home, 'code', 'notes', '.git', 'one-worker-source'), 'clone\n')
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
  // the repo's own Claude Code settings: a screen reader hears only the hints shown, as the switch moves
  const OWN = /^Use this repo’s own Claude Code settings/
  const MCP_HINT = /^Names as “claude mcp list” shows them/
  const USER_ONLY = /Its own settings are off: only servers added with/
  const WARN = /On: this repo’s hooks and helper commands/
  const shopRow = setup.locator('li.repo').filter({ hasText: '~/code/shop' })
  const shopOwn = shopRow.getByRole('switch', { name: OWN })
  const shopMcp = shopRow.getByRole('textbox', { name: 'Own MCP servers for Claude Code' })
  await expect(shopOwn).toBeChecked()
  await expect(shopOwn).toHaveAccessibleDescription(/^On for your own repositories\. Off: Claude Code starts with your own settings only/)
  await expect(shopMcp).toHaveAccessibleDescription(MCP_HINT)
  await expect(shopMcp).not.toHaveAccessibleDescription(USER_ONLY)
  await shopOwn.click()
  await expect(shopMcp).toHaveAccessibleDescription(USER_ONLY)
  await expect(shopOwn).not.toHaveAccessibleDescription(WARN)
  await shopOwn.click()
  await expect(shopMcp).not.toHaveAccessibleDescription(USER_ONLY)
  // a clone the worker made: off with the reason; the warning only while it is switched on against that
  await setup.getByRole('checkbox', { name: 'notes' }).check()
  const notesRow = setup.locator('li.repo').filter({ hasText: '~/code/notes' })
  const notesOwn = notesRow.getByRole('switch', { name: OWN })
  const notesMcp = notesRow.getByRole('textbox', { name: 'Own MCP servers for Claude Code' })
  await expect(notesOwn).not.toBeChecked()
  await expect(notesOwn).toHaveAccessibleDescription('Off by default: cloned by the worker. Switch it on only for code you trust.')
  await expect(notesMcp).toHaveAccessibleDescription(USER_ONLY)
  await notesOwn.click()
  await expect(notesOwn).toHaveAccessibleDescription(WARN)
  await expect(notesMcp).not.toHaveAccessibleDescription(USER_ONLY)
  await notesOwn.click()
  await expect(notesOwn).not.toHaveAccessibleDescription(WARN)
  await setup.getByRole('checkbox', { name: 'notes' }).uncheck()
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
  // Preflight's card names the older download, then since when
  await page.keyboard.press('Escape')
  const card = await workerCard(page)
  await expect(card).toHaveAttribute('data-id', 'worker:refused')
  await expect(card.locator('.pf-card__detail')).toHaveText(/^Refused: an older download is running — stop it \(Ctrl\+C\) and start the file you downloaded last · since \d\d:\d\d$/)
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

  // a tool call shows its name (a file change: the file and its counts); what it did opens on a click
  await page.getByTestId('coding-tab-log').click()
  const write = page.getByTestId('coding-log').locator('.clog-tool').filter({ hasText: 'Write' }).first()
  await expect(write.locator('summary')).toHaveText(/^Write\s*live\.txt \+1 −0$/)
  await expect(write.getByTestId('coding-log-edit')).toBeHidden()
  await write.locator('summary').click()
  await expect(write.getByTestId('coding-log-edit')).toContainText('./live.txt')
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
  // its cost in the UI's money (One formats the worker's number): "0,05 $", never "0.05 $"
  await expect(log).toContainText(/Claude Code fertig · \d+ Schritte · \d+,\d\d\s\$/)
  await expect(log).not.toContainText(/Schritte · \d+\.\d\d/)
  await expect(log).toContainText('Claude Code startet (acceptEdits-Modus) …')
  await expect(log).toContainText('Tests bestanden (')
  await expect(log).toContainText('Working… step 3')
})

test('the worker\'s 1.9.0 hint lines as the panel writes them: where the worktrees are (home · own · synced, none), git without a name, a planted program (EN, DE)', async ({ page }) => {
  await openApp(page)
  await page.waitForFunction(() => !!(window as unknown as { __oneCoding?: unknown }).__oneCoding)
  const line = (c: string, v: Record<string, string>) =>
    page.evaluate(({ c, v }) => (window as unknown as { __oneCoding: { lineText: (l: unknown) => string } }).__oneCoding.lineText({ t: Date.now(), k: 'warn', s: 'as the worker wrote it', c, v }), { c, v })
  const one = (worktrees?: string) => line('onedrive', { repo: 'shop', ...(worktrees ? { worktrees } : {}) })
  expect(await one('home')).toBe('shop lies in OneDrive: OneDrive downloads online-only files first and locks files while it syncs, so git steps can stall or fail. The task worktrees stay out of it, in .one-worktrees in your user folder. Faster: move the repo out of OneDrive (e.g. to C:\\code) and tick that folder.')
  expect(await line('cloudStorage', { repo: 'shop', worktrees: 'home' })).toContain('The task worktrees stay out of it, in ~/.one-worktrees.')
  expect(await one('own')).toContain('The task worktrees stay out of it, where worktreeDir in worker.json puts them')
  expect(await one('synced')).toContain('The task worktrees lie in a synced folder too (worktreeDir in worker.json) — set one outside it.')
  expect(await one()).toContain('Unless worktreeDir in worker.json says otherwise, the task worktrees stay out of it.')
  for (const w of [undefined, 'home', 'own', 'synced']) expect(await one(w)).not.toMatch(/\{\w+\}/)
  expect(await line('gitIdentity', { repo: 'shop' })).toMatch(/^git in shop does not know who commits/)
  expect(await line('plantedProgram', { file: 'uvx.cmd' })).toContain('Remove or rename uvx.cmd where it lies — in the repository and on the task’s branch')
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  expect(await one('synced')).toContain('Auch die Worktrees der Aufgaben liegen in einem synchronisierten Ordner (worktreeDir in worker.json) – lege sie außerhalb an.')
  expect(await one('home')).toContain('in .one-worktrees in deinem Benutzerordner.')
  expect(await line('gitIdentity', { repo: 'shop' })).toMatch(/^git in shop weiß nicht, wer committet/)
  expect(await line('plantedProgram', { file: 'uvx.cmd' })).toContain('uvx.cmd dort entfernen oder umbenennen, wo sie liegt – im Repository und im Branch der Aufgabe')
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
  expect(await names()).toEqual(['Backlog', 'Import', 'Ready', 'Static analysis', 'Analysis', 'Design', 'Test design', 'Approve concept', 'Write tests', 'Tests on the old code', 'Rebuild', 'Test', 'Review', 'Ship', 'Done'])
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
  // Wo der Worker läuft: Lokal | Cloud fits, with its reason
  await expect(page.getByTestId('coding-via-local')).toHaveText('Lokal')
  await expect(page.getByTestId('coding-via-cloud')).toHaveText('Cloud')
  await expect(page.getByTestId('coding-via-why')).toHaveText('Cloud braucht einen Team-Arbeitsbereich auf einem One-Server.')
  const seg = await page.getByTestId('coding-via').boundingBox()
  expect(seg!.x + seg!.width).toBeLessThanOrEqual(390)
  expect(await overflow()).toBeLessThanOrEqual(0)
})
