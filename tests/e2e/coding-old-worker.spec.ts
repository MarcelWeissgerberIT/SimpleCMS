/**
 * An older coding worker — downloaded before document stages existed — asks for work without `can` and without
 * `docs`: One never hands it a document stage. The Business analysis task fails with "needs a newer coding worker"
 * (instead of waiting in the queue forever while the worker drops it as unreadable) and the #/coding plate offers
 * "Download again". A 1.3.x worker (it names `can`, so it knows document stages) gets the same stage after Retry; so
 * does the worker the Business analysis / QA pipelines came with (`docs: true`, no `can` yet) — from the start. The
 * worker is played by the test: a WebSocket server on 127.0.0.1 speaking the protocol of features/coding/protocol.ts —
 * nothing else runs.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { WORKER_SUBPROTOCOL, type WorkerInfo } from '../../src/app/features/coding/protocol'

const PORT = 47391

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

    // #/coding: nothing outdated about it any more
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await expect(plate).toContainText('old-box')
    await expect(page.getByTestId('coding-worker-outdated')).toHaveCount(0)
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

    // it still lacks what came later (Static analysis, Post review, Merge): the plate offers the newer file
    await page.evaluate(() => (window.location.hash = '#/coding'))
    const plate = page.getByTestId('coding-worker')
    await expect(plate).toContainText('ba-box')
    await expect(plate.getByTestId('coding-worker-outdated')).toContainText('A newer worker is on the site')
    await expect(page.getByTestId('coding-needs')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
