/**
 * An older coding worker — downloaded before document stages existed — asks for work without `can` and without
 * `docs`: One never hands it a document stage. The Business analysis task fails with "needs a newer coding worker"
 * (instead of waiting in the queue forever while the worker drops it as unreadable) and the #/coding plate offers
 * "Download again". A 1.3.x worker (it names `can`, so it knows document stages) gets the same stage after Retry; so
 * does the worker the Business analysis / QA pipelines came with (`docs: true`, no `can` yet) — from the start. The
 * worker is played by the test: a WebSocket server on 127.0.0.1 speaking the protocol of features/coding/protocol.ts —
 * nothing else runs. A worker with the ZIP-import gap (1.3.1 up to 1.8.0 — `workerUnsafe`, read from the version its
 * welcome names) is named with its version and the download, wherever the connected worker shows; that notice wins
 * over the capability text. A worker older than 1.9.0 reached over Local from a browser on Windows (winWorker.ts — it
 * runs on this computer and can start a git.exe a repository brought along) gets a security notice of its own; the
 * browser's platform decides it, so these tests run as a browser on Linux unless they say Windows.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { WORKER_CAN, WORKER_SAFE, WORKER_SUBPROTOCOL, workerUnsafe, type WorkerInfo } from '../../src/app/features/coding/protocol'

const PORT = 47391
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

// the device profile says Windows; the Windows notice has its own test below
test.use({ userAgent: LINUX_UA })

// one fake worker on a fixed port
test.describe.configure({ mode: 'serial' })

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Asked {
  /** what the worker said it runs (undefined: it sent no `can`) */
  can: string[] | undefined
  /** the tab's answer (undefined while it is open) */
  answer?: Json
}

interface FakeWorker {
  /** null: an older worker (no `can`); a list: what a newer one names (with `docs: true`) */
  can: string[] | null
  /** `docs: true` without a `can`: the worker the Business analysis / QA pipelines came with */
  docs: boolean
  hellos: Json[]
  asked: Asked[]
  /** `next` requests the tab has not answered yet */
  open: () => number
  /** the tasks the tab handed out */
  handed: () => Json[]
  close: () => Promise<void>
}

/** Like an older one-worker: the welcome of its time (no setup page, no pairing, no branches), `next` on welcome, nudge and every 2 s. */
async function startFakeWorker(port: number, info: WorkerInfo): Promise<FakeWorker> {
  const { WebSocketServer } = (await import('../../mcp/node_modules/ws/wrapper.mjs')) as typeof import('../../mcp/node_modules/@types/ws/index.d.ts')
  const wss = new WebSocketServer({ host: '127.0.0.1', port, handleProtocols: (p: Set<string>) => (p.has(WORKER_SUBPROTOCOL) ? WORKER_SUBPROTOCOL : false) })
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve())
    wss.once('error', reject)
  })
  let tab: { send: (data: string) => void; readyState: number } | null = null
  let seq = 0
  let again = false
  const pending = new Map<string, Asked>()
  const fake: FakeWorker = {
    can: null,
    docs: false,
    hellos: [],
    asked: [],
    open: () => pending.size,
    handed: () => fake.asked.flatMap((a) => (a.answer?.result?.task ? [a.answer.result.task as Json] : [])),
    close: () => {
      clearInterval(poll)
      for (const c of wss.clients) c.terminate()
      return new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
  // one `next` at a time (again right after, when asked meanwhile) — like the real worker
  const ask = () => {
    // parallel 1: busy with a handed-out task, it asks for nothing more
    if (!tab || tab.readyState !== 1 || fake.handed().length >= info.parallel) return
    if (pending.size) {
      again = true
      return
    }
    again = false
    const id = `n${++seq}`
    const can = fake.can ? [...fake.can] : undefined
    const entry: Asked = { can }
    pending.set(id, entry)
    fake.asked.push(entry)
    tab.send(JSON.stringify({ type: 'req', id, op: 'next', repos: info.repos.map((r) => r.name), worker: info.name, ...(can || fake.docs ? { docs: true } : {}), ...(can ? { can } : {}) }))
  }
  const poll = setInterval(ask, 2000)
  wss.on('connection', (ws) => {
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as Json
      if (m.type === 'hello') {
        fake.hellos.push(m)
        tab = ws
        ws.send(JSON.stringify({ type: 'welcome', ...info }))
        return ask()
      }
      if (m.type === 'nudge') return ask()
      if (m.type === 'res') {
        const entry = pending.get(String(m.id))
        if (!entry) return
        pending.delete(String(m.id))
        entry.answer = m
        // a task: it runs here now (what One shows as "Running")
        const task = m.result?.task as Json | null | undefined
        if (task) ws.send(JSON.stringify({ type: 'status', busy: [{ taskId: task.id, repo: task.repo, stageId: task.stage.id, since: Date.now() }], spentToday: 0 }))
        if (again) ask()
      }
    })
  })
  return fake
}

/** The connected worker as if its welcome had named another version (the coding store through the Preflight seam, ?e2e). */
async function nameVersion(page: Page, version: string) {
  await page.evaluate((version) => {
    type Store = { getState: () => { worker: Record<string, unknown> | null }; setState: (p: unknown) => void }
    const coding = (window as unknown as { __onePreflight: { stores: { coding: Store } } }).__onePreflight.stores.coding
    coding.setState({ worker: { ...coding.getState().worker, worker: version } })
  }, version)
}

/** Settings → Coding worker: the test port, switch on, connected. */
async function connect(page: Page, name = 'old-box') {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText(`Connected · ${name} · 1 repo`)
  await page.keyboard.press('Escape')
}

test('an older worker (no `can`) is never handed a document stage: the task fails with "needs a newer coding worker", #/coding offers Download again; a 1.3 worker gets it after Retry', async ({ page, errors }) => {
  // the link looks for the worker again once the fake is gone
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const fake = await startFakeWorker(PORT, { worker: '1.1.0', name: 'old-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' } })
  try {
    await openApp(page)
    await connect(page)
    expect(fake.hellos[0]?.workspace?.id).toMatch(/^local:/)

    // a Business analysis task on the worker's repo: Ready → Analysis (a document stage, auto)
    await page.evaluate(() => (window.location.hash = '#/coding/spec'))
    await page.getByTestId('coding-setup').click()
    const before = fake.asked.length
    await page.getByTestId('coding-new').click()
    await page.getByTestId('coding-new-title').fill('Invoice approval flow')
    await page.getByTestId('coding-new-repo').fill('website')
    await page.getByTestId('coding-new-goal').fill('Describe how invoices are approved, by whom and when.')
    await page.getByTestId('coding-create').click()
    await expect(page.getByTestId('coding-panel')).toBeVisible()
    await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
    const id = await page.evaluate(() => window.location.hash.replace('#/p/', ''))

    // the old worker asked — and got nothing; the task says why instead of "Queued"
    await expect(page.getByTestId('coding-state')).toContainText('Failed', { timeout: 15_000 })
    await expect(page.locator('.ctk-box--err')).toContainText('This stage needs a newer coding worker')
    await expect(page.locator('.ctk-box--err').getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.locator('.ctk-code')).toContainText(/BA — website · Analysis$/i)
    await expect.poll(() => fake.asked.slice(before).filter((a) => a.answer).length).toBeGreaterThan(0)
    expect(fake.asked.every((a) => a.can === undefined)).toBe(true)
    for (const a of fake.asked.filter((x) => x.answer)) expect(a.answer).toEqual({ type: 'res', id: expect.any(String), ok: true, result: { task: null } })
    expect(fake.handed()).toEqual([])
    // never claimed by it
    const claimedBy = () =>
      wsEval(page, (s, id) => {
        const db = s.databases[s.pages[id].databaseId]
        return (s.pages[id].properties[db.properties.find((p: { name: string }) => p.name === 'Worker').id] as string | undefined) ?? null
      }, id)
    expect(await claimedBy()).toBeNull()

    // #/coding: the plate names the outdated worker and offers the file again (still connected)
    await page.evaluate(() => (window.location.hash = '#/coding'))
    const plate = page.getByTestId('coding-worker')
    await expect(plate).toContainText('old-box')
    const outdated = plate.getByTestId('coding-worker-outdated')
    await expect(outdated).toContainText('A newer worker is on the site')
    await expect(outdated.getByTestId('coding-download-again')).toHaveText('Download again')
    // 1.1.0 came before the ZIP import: no security notice, only the capability text
    await expect(page.getByTestId('coding-worker-unsafe')).toHaveCount(0)
    await expect(page.getByTestId('coding-needs')).toContainText('Invoice approval flow')
    const [download] = await Promise.all([page.waitForEvent('download'), outdated.getByTestId('coding-download-again').click()])
    expect(download.suggestedFilename()).toBe('one-worker.mjs')
    await expect(page.locator('.toast').filter({ hasText: 'Saved one-worker.mjs — now start it.' })).toBeVisible()
    await expect(plate.getByTestId('coding-worker-outdated')).toBeVisible()
    // more rounds: the failed task stays failed (it is not handed out, not patched again)
    const rounds = fake.asked.length
    await expect.poll(() => fake.asked.filter((a) => a.answer).length, { timeout: 10_000 }).toBeGreaterThan(rounds)
    expect(fake.handed()).toEqual([])

    // the same worker, now a 1.3.x (it names `can` without 'doc' — it knows document stages); every open question answered first
    fake.can = ['analyze', 'git:comment', 'git:merge']
    await expect.poll(() => fake.open()).toBe(0)
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
    await page.locator('.ctk-box--err').getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => fake.handed().length, { timeout: 15_000 }).toBe(1)
    const task = fake.handed()[0]!
    expect(task).toMatchObject({ id, repo: 'website', title: 'Invoice approval flow', stage: { kind: 'doc', name: 'Analysis', permissionMode: 'default' }, trusted: true })
    expect(fake.asked.find((a) => a.answer?.result?.task)?.can).toEqual(['analyze', 'git:comment', 'git:merge'])
    await expect(page.getByTestId('coding-state')).toContainText('Running')
    await expect(page.locator('.ctk-box--err')).toHaveCount(0)
    expect(await claimedBy()).toBe('old-box')

    // #/coding: it still lacks what came later (a stage's model), so the plate keeps offering the newer file — but no
    // task waits for it any more
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await expect(plate).toContainText('old-box')
    await expect(page.getByTestId('coding-worker-outdated')).toContainText('A newer worker is on the site')
    await expect(page.getByTestId('coding-needs')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

/** A Business analysis task on the worker's repo (Ready → Analysis, a document stage, auto); its page id. */
async function newAnalysisTask(page: Page, title: string): Promise<string> {
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill(title)
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Describe how invoices are approved, by whom and when.')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}

test('the worker the Business analysis / QA pipelines came with (`docs: true`, no `can` yet) runs document stages: handed out at once, never failed; #/coding still offers the newer download', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const fake = await startFakeWorker(PORT, { worker: '1.3.1', name: 'ba-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' } })
  fake.docs = true
  try {
    await openApp(page)
    await connect(page, 'ba-box')
    const id = await newAnalysisTask(page, 'Invoice approval flow')

    // handed out on the next round — no "needs a newer coding worker"
    await expect.poll(() => fake.handed().length, { timeout: 15_000 }).toBe(1)
    expect(fake.handed()[0]).toMatchObject({ id, repo: 'website', title: 'Invoice approval flow', stage: { kind: 'doc', name: 'Analysis' }, trusted: true })
    expect(fake.asked.every((a) => a.can === undefined)).toBe(true)
    await expect(page.getByTestId('coding-state')).toContainText('Running')
    await expect(page.locator('.ctk-box--err')).toHaveCount(0)

    // it still lacks what came later (Static analysis, Post review, Merge) — and 1.3.1 has the ZIP import with its gap:
    // the security notice wins over the capability text, with the same key
    await page.evaluate(() => (window.location.hash = '#/coding'))
    const plate = page.getByTestId('coding-worker')
    await expect(plate).toContainText('ba-box')
    await expect(plate.getByTestId('coding-worker-unsafe')).toContainText('This worker (1.3.1) has a security gap in ZIP import')
    await expect(plate.getByTestId('coding-worker-unsafe').getByTestId('coding-download-again')).toHaveText('Download again')
    await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)
    await expect(page.getByTestId('coding-needs')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

/** Set or clear the model of the Business analysis pipeline's first document stage ("Analysis"). */
const setAnalysisModel = (page: Page, model: string | null) =>
  wsEval(page, (s, model) => {
    const db = Object.values(s.databases).find((d: any) => d.system === 'spec') as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const first = db.pipeline.find((p: { kind: string }) => p.kind === 'doc')
    s.updateDatabase(db.id, { pipeline: db.pipeline.map((p: { id: string }) => (p.id === first.id ? { ...p, model: model ?? undefined } : p)) })
  }, model)

/** A Business analysis task (its database exists already): Ready → Analysis; its page id. */
async function addAnalysisTask(page: Page, title: string): Promise<string> {
  await page.evaluate(() => (window.location.hash = '#/coding/spec'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill(title)
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Describe how invoices are approved, by whom and when.')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await expect(page.locator('#main .pv-title')).toContainText(title)
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}

test('a worker that does not pass a model on (`can` without "model") never gets a stage with one — the stage\'s or the task\'s own; without a model it still runs the stage; a newer worker gets the model in the payload', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const fake = await startFakeWorker(PORT, { worker: '1.4.0', name: 'mid-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 2, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' } })
  // what the worker before models named
  fake.can = ['analyze', 'git:comment', 'git:merge', 'doc']
  try {
    await openApp(page)
    await connect(page, 'mid-box')
    await page.evaluate(() => (window.location.hash = '#/coding/spec'))
    await page.getByTestId('coding-setup').click()
    await setAnalysisModel(page, 'opus')

    // the stage has a model: not for this worker — the task says why, nothing is handed out
    const id = await addAnalysisTask(page, 'Invoice approval flow')
    await expect(page.getByTestId('coding-state')).toContainText('Failed', { timeout: 15_000 })
    await expect(page.locator('.ctk-box--err')).toContainText('This stage needs a newer coding worker')
    expect(fake.handed()).toEqual([])

    // no model on the stage, but the task's own pick on this device: the same
    await setAnalysisModel(page, null)
    await page.getByTestId('coding-model-select').selectOption('haiku')
    const answered = fake.asked.filter((a) => a.answer).length
    await page.locator('.ctk-box--err').getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => fake.asked.filter((a) => a.answer).length, { timeout: 10_000 }).toBeGreaterThan(answered + 1)
    await expect(page.locator('.ctk-box--err')).toContainText('This stage needs a newer coding worker')
    expect(fake.handed()).toEqual([])

    // as the pipeline (no model anywhere): the same worker runs it — the payload names none
    await page.getByTestId('coding-model-select').selectOption('')
    await page.locator('.ctk-box--err').getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => fake.handed().length, { timeout: 15_000 }).toBe(1)
    expect(fake.handed()[0]).toMatchObject({ id, stage: { kind: 'doc', name: 'Analysis', model: null } })
    await expect(page.getByTestId('coding-state')).toContainText('Running')

    // #/coding: the plate offers the newer file — as the security notice (1.4.0 has the ZIP-import gap), which wins
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await expect(page.getByTestId('coding-worker').getByTestId('coding-worker-unsafe')).toContainText('This worker (1.4.0) has a security gap in ZIP import')
    await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)

    // the newer worker names "model": a stage with one is handed out, the model in the payload; nothing outdated
    fake.can = ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list']
    await setAnalysisModel(page, 'opus')
    const second = await addAnalysisTask(page, 'Supplier onboarding')
    await expect.poll(() => fake.handed().length, { timeout: 15_000 }).toBe(2)
    expect(fake.handed()[1]).toMatchObject({ id: second, stage: { kind: 'doc', name: 'Analysis', model: 'opus' } })
    expect(fake.asked.find((a) => a.answer?.result?.task?.id === second)?.can).toContain('model')
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await expect(page.getByTestId('coding-worker')).toContainText('mid-box')
    await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)
    // the gap is the version's, not the capabilities': the notice stays
    await expect(page.getByTestId('coding-worker-unsafe')).toContainText('This worker (1.4.0)')
  } finally {
    await fake.close()
  }
})

test('workerUnsafe: 1.3.1 (the ZIP import) up to 1.8.0 has the gap — numeric part by part, a pre-release below its release, a version One cannot read never flagged', () => {
  expect(WORKER_SAFE).toBe('1.8.1')
  for (const v of ['1.8.0', '1.3.1', '1.4.0', '1.7.1', 'v1.8.0', ' 1.8.0 ', '1.8', '1.8.0-beta.2', '1.8.1-rc.1', '1.8.0+build.7', '1.8.0.9']) expect(workerUnsafe(v), v).toBe(true)
  for (const v of ['1.8.1', '1.8.2', '1.9.0', '1.10.0', '1.80.0', '2.0.0', '1.8.1+build.7', '1.3.0', '1.3.1-rc.1', '1.2.9', '1.1.0', '0.9.0']) expect(workerUnsafe(v), v).toBe(false)
  for (const v of [null, undefined, '', ' ', 'dev', 'garbage', '1.x.0', '1..8', '.1.8', '1.8.0-', 'x1.8.0', '1.8.0.0.0', '99999999999999999999.0.0', '1'.repeat(65), 180 as unknown as string]) expect(workerUnsafe(v), String(v)).toBe(false)
})

test('a worker with the ZIP-import gap (1.8.0, every capability) is named with its version and the download — the #/coding plate and Settings → Coding worker; German too', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const fake = await startFakeWorker(PORT, { worker: '1.8.0', name: 'zip-box', repos: [{ name: 'website', baseBranch: 'main', mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })
  fake.can = [...WORKER_CAN]
  try {
    await openApp(page)
    await connect(page, 'zip-box')
    await page.evaluate(() => (window.location.hash = '#/coding'))
    const plate = page.getByTestId('coding-worker')
    await expect(plate).toContainText('zip-box')
    // it named every capability (its first `next` arrived) — still the notice: the version decides
    await expect.poll(() => fake.asked.filter((a) => a.answer).length).toBeGreaterThan(0)
    const unsafe = plate.getByTestId('coding-worker-unsafe')
    await expect(unsafe).toHaveAttribute('role', 'status')
    await expect(unsafe.locator('.cv-plate__sec')).toHaveText('Security')
    await expect(unsafe).toContainText('This worker (1.8.0) has a security gap in ZIP import — download the new one, stop the old one (Ctrl+C) and start the new file.')
    await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)
    const [download] = await Promise.all([page.waitForEvent('download'), unsafe.getByTestId('coding-download-again').click()])
    expect(download.suggestedFilename()).toBe('one-worker.mjs')
    await expect(page.locator('.toast').filter({ hasText: 'Saved one-worker.mjs — now start it.' })).toBeVisible()
    // until the new file connects, the old one is still this one
    await expect(unsafe).toBeVisible()

    // Settings → Coding worker: the setup card names it too, with its key
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
    const card = page.getByTestId('coding-setup-card')
    await expect(card.getByTestId('coding-worker-unsafe')).toContainText('This worker (1.8.0) has a security gap in ZIP import')
    await expect(card.getByTestId('coding-worker-unsafe').getByTestId('coding-download-again')).toHaveText('Download again')
    await page.keyboard.press('Escape')

    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(unsafe.locator('.cv-plate__sec')).toHaveText('Sicherheit')
    await expect(unsafe).toContainText('Dieser Worker (1.8.0) hat eine Sicherheitslücke beim ZIP-Import – lade den neuen herunter, beende den alten (Ctrl+C) und starte die neue Datei.')
    await expect(unsafe.getByTestId('coding-download-again')).toHaveText('Erneut herunterladen')
  } finally {
    await fake.close()
  }
})

test('a worker without the gap (1.8.1) gets no notice on macOS / Linux; the same version naming older capabilities gets the capability text, never the security one', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const fake = await startFakeWorker(PORT, { worker: '1.8.1', name: 'safe-box', repos: [{ name: 'website', baseBranch: 'main', mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })
  fake.can = [...WORKER_CAN]
  try {
    await openApp(page)
    await connect(page, 'safe-box')
    await page.evaluate(() => (window.location.hash = '#/coding'))
    const plate = page.getByTestId('coding-worker')
    await expect(plate).toContainText('safe-box')
    await expect.poll(() => fake.asked.filter((a) => a.answer).length).toBeGreaterThan(0)
    await expect(page.getByTestId('coding-worker-unsafe')).toHaveCount(0)
    await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)

    // it names fewer capabilities on its next round: the capability text, the version stays safe
    const answered = fake.asked.filter((a) => a.answer).length
    fake.can = ['analyze', 'git:comment', 'git:merge']
    await expect.poll(() => fake.asked.filter((a) => a.answer).length, { timeout: 10_000 }).toBeGreaterThan(answered)
    await expect(plate.getByTestId('coding-worker-outdated')).toContainText('A newer worker is on the site')
    await expect(page.getByTestId('coding-worker-unsafe')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test.describe('a browser on Windows', () => {
  test.use({ userAgent: WINDOWS_UA })

  test('a worker older than 1.9.0 reached over Local gets a security notice of its own — the #/coding plate, the setup card, the download, German; the ZIP-import notice still wins', async ({ page, errors }) => {
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    const fake = await startFakeWorker(PORT, { worker: '1.8.1', name: 'win-box', repos: [{ name: 'website', baseBranch: 'main', mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })
    fake.can = [...WORKER_CAN]
    try {
      await openApp(page)
      await connect(page, 'win-box')
      await page.evaluate(() => (window.location.hash = '#/coding'))
      const plate = page.getByTestId('coding-worker')
      await expect(plate).toContainText('win-box')
      await expect.poll(() => fake.asked.filter((a) => a.answer).length).toBeGreaterThan(0)
      // every capability, no ZIP-import gap — yet on Windows it looks for git / Claude Code in the repository first
      const win = plate.getByTestId('coding-worker-windows')
      await expect(win).toHaveAttribute('role', 'status')
      await expect(win).toHaveAttribute('data-kind', 'security')
      await expect(win.locator('.cv-plate__sec')).toHaveText('Security')
      await expect(win).toContainText('On Windows, this worker (1.8.1) can start a program named git.exe or claude.exe that a cloned or imported repository brings along — download the new one, stop the old one (Ctrl+C) and start the new file. Running it in WSL? Then this does not apply.')
      await expect(page.getByTestId('coding-worker-unsafe')).toHaveCount(0)
      await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)
      const [download] = await Promise.all([page.waitForEvent('download'), win.getByTestId('coding-download-again').click()])
      expect(download.suggestedFilename()).toBe('one-worker.mjs')

      // Settings → Coding worker: the setup card shows the security notices alone — this one too
      await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
      const card = page.getByTestId('coding-setup-card')
      await expect(card.getByTestId('coding-worker-windows')).toContainText('On Windows, this worker (1.8.1)')
      await expect(card.getByTestId('coding-worker-windows').getByTestId('coding-download-again')).toHaveText('Download again')
      await page.keyboard.press('Escape')

      // German
      await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
      await expect(win.locator('.cv-plate__sec')).toHaveText('Sicherheit')
      await expect(win).toContainText('Unter Windows kann dieser Worker (1.8.1) ein Programm namens git.exe oder claude.exe starten, das ein geklontes oder importiertes Repository mitbringt')
      await expect(win).toContainText('Läuft er in WSL? Dann betrifft es ihn nicht.')
      await wsEval(page, (s) => s.updateSettings({ language: 'en' }))

      // older still, with the ZIP-import gap (1.8.0): that notice wins, as everywhere
      await nameVersion(page, '1.8.0')
      await expect(plate.getByTestId('coding-worker-unsafe')).toContainText('This worker (1.8.0) has a security gap in ZIP import')
      await expect(page.getByTestId('coding-worker-windows')).toHaveCount(0)
      // 1.9.0: nothing to say
      await nameVersion(page, '1.9.0')
      await expect(plate).toContainText('win-box')
      await expect(page.getByTestId('coding-worker-windows')).toHaveCount(0)
      await expect(page.getByTestId('coding-worker-unsafe')).toHaveCount(0)
      await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)
    } finally {
      await fake.close()
    }
  })
})

test('the task panel names Claude Code\'s own MCP servers for the task; a task that mentions one Claude Code may not use says so, with the setup page one click away', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  // a current worker: the repo has the person's own "kb" server; tasks without a repository have none
  const fake = await startFakeWorker(PORT, { worker: '1.7.0', name: 'mcp-box', repos: [{ name: 'website', baseBranch: 'main', mcp: ['kb'] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })
  fake.can = ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list']
  try {
    await openApp(page)
    // One's own MCP servers (for One's Claude): "tracker" (codeword "kb") and "wiki"
    await wsEval(page, (s) =>
      s.updateSettings({
        mcpServers: [
          { id: 'm1', name: 'tracker', codeword: 'kb', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '' },
          { id: 'm2', name: 'wiki', url: 'https://wiki.example.com/mcp', token: '', enabled: true, prompt: '' },
        ],
      }),
    )
    await connect(page, 'mcp-box')
    await page.evaluate(() => (window.location.hash = '#/coding/spec'))
    await page.getByTestId('coding-setup').click()
    // a task on the repo that names both: "kb" is allowed there, "Wiki" is not
    await page.getByTestId('coding-new').click()
    await page.getByTestId('coding-new-title').fill('Approval rules from the tracker')
    await page.getByTestId('coding-new-repo').fill('website')
    await page.getByTestId('coding-new-goal').fill('Read ticket 42 with kb and the approval page in the Wiki, then write the rules.')
    await page.getByTestId('coding-create').click()
    await expect(page.getByTestId('coding-panel')).toBeVisible()
    const line = page.getByTestId('coding-task-mcp')
    await expect(line).toContainText('Claude Code · MCP')
    await expect(line.locator('.ctk-mcp__name')).toHaveText(['kb'])
    const missing = line.getByTestId('coding-task-mcp-missing')
    await expect(missing).toContainText('The task mentions wiki — Claude Code may not use it here.')
    await expect(missing).toContainText('this repo’s “Own MCP servers for Claude Code”')
    await expect(missing.getByTestId('coding-task-mcp-fix')).toHaveText('Open the setup page')

    // a task without a repository: no own servers there — the text asks for MCP → the note names the right field
    await page.evaluate(() => (window.location.hash = '#/coding/spec'))
    await page.getByTestId('coding-new').click()
    await page.getByTestId('coding-new-title').fill('Summarise the open questions')
    await page.getByTestId('coding-new-goal').fill('Use the MCP tools to read the open questions.')
    await page.getByTestId('coding-create').click()
    await expect(page.getByTestId('coding-panel')).toBeVisible()
    await expect(line.locator('.ctk-mcp__none')).toHaveText('only One’s task tools')
    await expect(line.getByTestId('coding-task-mcp-missing')).toContainText('The task mentions MCP')
    await expect(line.getByTestId('coding-task-mcp-missing')).toContainText('“Tasks without a repository — own MCP servers”')
  } finally {
    await fake.close()
  }
})

test('an older worker names no MCP servers: the task panel shows no MCP line', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const fake = await startFakeWorker(PORT, { worker: '1.6.0', name: 'mid-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' } })
  fake.can = ['analyze', 'git:comment', 'git:merge', 'doc', 'model']
  try {
    await openApp(page)
    await connect(page, 'mid-box')
    await page.evaluate(() => (window.location.hash = '#/coding/spec'))
    await page.getByTestId('coding-setup').click()
    await page.getByTestId('coding-new').click()
    await page.getByTestId('coding-new-title').fill('Read the MCP notes')
    await page.getByTestId('coding-new-repo').fill('website')
    await page.getByTestId('coding-new-goal').fill('Use MCP.')
    await page.getByTestId('coding-create').click()
    await expect(page.getByTestId('coding-panel')).toBeVisible()
    await expect(page.getByTestId('coding-task-mcp')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Settings → MCP servers: the overview table — codeword, One’s Claude, agents, integrations and Claude Code per server; a name only Claude Code has gets its own row; German cards at 390 px', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  // Claude Code: the repo "website" has "KB" (the codeword of One's "tracker", any case), tasks without a repo have "notes"
  const fake = await startFakeWorker(PORT, { worker: '1.7.1', name: 'mcp-box', repos: [{ name: 'website', baseBranch: 'main', mcp: ['KB'] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: ['notes'] })
  fake.can = ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list']
  try {
    await openApp(page)
    await wsEval(page, (s) => {
      const now = Date.now()
      s.updateSettings({
        mcpServers: [
          { id: 'm1', name: 'tracker', codeword: 'kb', scope: 'all', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'add_comment'], checkedAt: 1 },
          { id: 'm2', name: 'wiki', url: 'https://wiki.example.com/mcp', token: '', enabled: false, prompt: '' },
        ],
      })
      const agent = { instructions: 'Sum up the tracker.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, createdAt: now, updatedAt: now }
      s.upsertAgent({ ...agent, id: 'ag-digest', name: 'Daily digest', mcpServers: ['tracker'], mcpTools: { tracker: ['list_items', 'get_item'] }, enabled: true })
      s.upsertAgent({ ...agent, id: 'ag-old', name: 'Old helper', mcpServers: ['tracker'], enabled: false })
      // a tool list of none leaves the server out
      s.upsertAgent({ ...agent, id: 'ag-none', name: 'Quiet one', mcpServers: ['tracker'], mcpTools: { tracker: [] }, enabled: true })
      s.upsertIntegration({ schema: 'one.integration/1', id: 'items', name: 'Item tracker', match: { tools: ['list_items', 'get_item'] }, unlocks: ['keys'] })
    })
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    const table = page.getByTestId('mcp-overview')
    await table.scrollIntoViewIfNeeded()
    // before the worker is connected: "Worker not connected"
    await expect(table.locator('tr[data-server="tracker"]').getByTestId('mcp-overview-code')).toHaveText('Worker not connected')
    await page.keyboard.press('Escape')
    await connect(page, 'mcp-box')
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    await table.scrollIntoViewIfNeeded()
    await expect(table.locator('thead th')).toHaveText(['Server', 'Codeword', 'One’s Claude', 'Custom agents', 'Integrations', 'Claude Code (worker)'])
    const tracker = table.locator('tr[data-server="tracker"]')
    await expect(tracker.locator('th')).toContainText('TRACKER')
    await expect(tracker.locator('th')).toContainText('tracker.example.com')
    await expect(tracker.locator('td').nth(0)).toHaveText('kb:')
    await expect(tracker.locator('td').nth(1)).toHaveText('Every AI call')
    await expect(tracker.locator('td').nth(2).locator('.mcpo__chip')).toHaveText(['Daily digest2 tools', 'Old helper'])
    await expect(tracker.locator('td').nth(2).locator('.mcpo__chip[data-off]')).toHaveText('Old helper')
    await expect(tracker.locator('td').nth(3)).toHaveText('Item tracker')
    await expect(tracker.getByTestId('mcp-overview-code').locator('.mcpo__chip')).toHaveText(['website'])
    const wiki = table.locator('tr[data-server="wiki"]')
    await expect(wiki.locator('td').nth(0)).toHaveText('—')
    await expect(wiki.locator('td').nth(1)).toHaveText('Off')
    await expect(wiki.locator('td').nth(1).locator('.mcpo__scope')).toHaveAttribute('title', 'Switched off: not used — not even through its codeword')
    await expect(wiki.locator('td').nth(2)).toHaveText('—')
    await expect(wiki.getByTestId('mcp-overview-code')).toHaveText('—')
    // a server only Claude Code has: its own row
    const notes = table.locator('tr[data-server="notes"]')
    await expect(notes).toHaveAttribute('data-only', 'code')
    await expect(notes.locator('th')).toContainText('only Claude Code')
    await expect(notes.getByTestId('mcp-overview-code')).toHaveText('tasks without a repo')
    await expect(table.locator('tbody tr')).toHaveCount(3)
    // the name opens that server's details below
    await tracker.getByRole('button', { name: 'TRACKER' }).click()
    await expect(page.locator('.mcps-card[data-server="tracker"]')).toHaveAttribute('data-open', 'true')

    // German at 390 px: each server a card with its labels, no sideways scroll
    await page.keyboard.press('Escape')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    await table.scrollIntoViewIfNeeded()
    await expect(table.locator('thead')).toHaveCSS('position', 'absolute')
    await expect(tracker.locator('td').nth(1)).toHaveText('Jede KI-Anfrage')
    await expect(wiki.locator('td').nth(1)).toHaveText('Aus')
    await expect(notes.getByTestId('mcp-overview-code')).toHaveText('Aufgaben ohne Repository')
    const wide = await table.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(wide).toBeLessThanOrEqual(1)
  } finally {
    await fake.close()
  }
})
