/**
 * worker 1.11.0 against a worker played by the test (helpers/fakeWorker.ts — the protocol of
 * features/coding/protocol.ts, nothing else runs; Claude Code never starts):
 *  - a permission Claude Code needs: the task "Waiting for you · permission", the card says what it wants and what
 *    "Always" would store; a key sends ONLY the request's id and the verb; the Preflight lamp "Claude wants" lights and
 *    its card answers VON HAND (never in ⇧A); the JETZT line and the request go when the link drops
 *  - the step limit: "Step limit reached (n/n)" with Continue (+N steps) — the stage runs again with `resume` — and
 *    Start over; a worker that does not name 'continue' gets Start over only
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { startFakeWorker, type FakeWorker, type Json } from './helpers/fakeWorker'
import { flushLamps, waitPreflight } from './helpers/preflightStory.mjs'

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47380

test.describe.configure({ mode: 'serial' })

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const welcome = (): WorkerInfo => ({ worker: '1.11.0', name: 'perm-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })

const askOf = (over: Json = {}): Json => ({ id: 'a1b2c3d4e5f6a7b8c9d0e1f2', tool: 'Bash', kind: 'bash', what: 'npm run lint', rule: 'Bash(npm run lint:*)', repo: 'website', at: Date.now(), until: Date.now() + 15 * 60_000, ...over })

const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>).__onePreflight, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const reading = async (page: Page, id: string) => {
  await flushLamps(page)
  return pf(page, (p, id) => p.readings()[id] ?? null, id)
}

/** Settings → Coding worker: the test port, switch on, connected. */
async function connect(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: /Connect to a coding worker on this computer|Mit einem Coding-Worker auf diesem Rechner verbinden/ }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('perm-box')
  await page.keyboard.press('Escape')
}

async function newTask(page: Page, title: string): Promise<string> {
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill(title)
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Fix the login form: the button stays grey.')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}

async function begin(page: Page, can: readonly string[], lang: 'en' | 'de' = 'en'): Promise<{ id: string; task: Json }> {
  fake = await startFakeWorker(PORT, welcome())
  fake.can = [...can]
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  if (lang === 'de') await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await connect(page)
  const id = await newTask(page, lang === 'de' ? 'Login-Formular reparieren' : 'Fix the login form')
  await expect.poll(() => fake!.handed().length, { timeout: 15_000 }).toBe(1)
  return { id, task: fake.handed()[0]! }
}

let fake: FakeWorker | null = null
test.afterEach(async () => {
  await fake?.close()
  fake = null
})

test('a permission: the task waits for you, the card says what Claude Code wants; Always sends only the request and the verb; the lamp lights; the JETZT line and the request go with the link', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const { id, task } = await begin(page, WORKER_CAN)
  await expect(page.getByTestId('coding-state')).toContainText('Running')
  fake!.send({ type: 'event', taskId: id, kind: 'progress', progress: { turns: 3, maxTurns: 40, cost: 0.12, model: null } })
  await expect(page.getByTestId('coding-steps')).toBeVisible()

  fake!.askPermission(task, askOf())
  await expect(page.getByTestId('coding-state')).toContainText('Waiting for you · permission')
  const card = page.getByTestId('coding-permission')
  await expect(card).toContainText('Claude wants')
  await expect(page.getByTestId('coding-permission-what')).toHaveText('npm run lint')
  await expect(page.getByTestId('coding-permission-rule')).toContainText('Bash(npm run lint:*)')
  await expect(card.getByTestId('coding-permission-always')).toBeVisible()
  // the lamp: one request, on the worker's own tab
  expect(await reading(page, 'permission')).toMatchObject({ count: 1, ids: [`perm:${id}:${askOf().id}`] })

  await card.getByTestId('coding-permission-always').click()
  await expect.poll(() => fake!.permAsked.length).toBe(1)
  // only the request's id and a fixed verb — never a path, a command or a rule
  const sent = fake!.permAsked[0]!
  expect(Object.keys(sent).sort()).toEqual(['ask', 'id', 'op', 'taskId', 'type', 'verb'])
  expect(sent).toMatchObject({ type: 'req', op: 'permission', taskId: id, ask: askOf().id, verb: 'always' })
  await expect(card).toHaveCount(0)
  await expect(page.getByTestId('coding-state')).toContainText('Running')
  expect(await reading(page, 'permission')).toMatchObject({ count: 0 })

  // a read outside the project: only once — no Always key, the card says why
  fake!.askPermission(task, askOf({ id: 'b1b2c3d4e5f6a7b8c9d0e1f2', tool: 'Read', kind: 'read', what: '/etc/hosts', outside: true, rule: null }))
  await expect(page.getByTestId('coding-permission-what')).toHaveText('/etc/hosts')
  await expect(page.getByTestId('coding-permission')).toContainText('a file outside the project')
  await expect(page.getByTestId('coding-permission-always')).toHaveCount(0)
  await expect(page.getByTestId('coding-permission-rule')).toContainText('Only once')

  // the link drops: the JETZT line and the request go (a worker that comes back names them again)
  await fake!.close()
  fake = null
  await expect(page.getByTestId('coding-permission')).toHaveCount(0)
  await expect(page.getByTestId('coding-steps')).toHaveCount(0)
  expect(await pf(page, (p) => {
    const s = p.stores.coding.getState()
    return { asks: Object.keys(s.asks).length, progress: Object.keys(s.progress).length }
  })).toEqual({ asks: 0, progress: 0 })
})

test('Preflight in German: the "Claude möchte" card shows the request in full; D refuses VON HAND through the confirm row; it is never in a bulk apply', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const { id, task } = await begin(page, WORKER_CAN, 'de')
  fake!.askPermission(task, askOf())
  await expect(page.getByTestId('coding-state')).toContainText('Wartet auf dich · Erlaubnis')
  await page.evaluate(() => (window.location.hash = '#/'))
  await waitPreflight(page)
  await expect.poll(async () => (await reading(page, 'permission'))?.count).toBe(1)
  const cap = page.locator('.pf-cap[data-lamp="permission"]')
  await expect(cap).toHaveAttribute('data-lit', 'amber')
  await cap.focus()
  await page.keyboard.press('Enter')
  const current = page.locator('.pf-q article.pf-card[data-current]')
  await expect(current).toBeFocused()
  await expect(current).toHaveAttribute('data-id', `perm:${id}:${askOf().id}`)
  await expect(current).not.toHaveAttribute('aria-busy', 'true')
  await expect(current.getByTestId('pf-permission')).toContainText('npm run lint')
  await expect(current.getByTestId('pf-permission')).toContainText('Bash(npm run lint:*)')
  // the card is never taken by ⇧A
  expect(await pf(page, (p) => p.stores.queue.getState().items.permission?.map((i: AnyState) => i.bulk))).toEqual([false])
  await page.keyboard.press('Shift+A')
  await page.waitForTimeout(300)
  expect(fake!.permAsked).toHaveLength(0)
  // D: VON HAND — the confirm row first, ↵ on its key answers
  await page.keyboard.press('d')
  await expect(page.getByTestId('pf-confirm')).toContainText('geht an Claude Code')
  await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
  expect(fake!.permAsked).toHaveLength(0)
  await page.keyboard.press('Enter')
  await expect.poll(() => fake!.permAsked.length).toBe(1)
  expect(fake!.permAsked[0]).toMatchObject({ op: 'permission', taskId: id, ask: askOf().id, verb: 'deny' })
  await expect.poll(async () => (await reading(page, 'permission'))?.count).toBe(0)
})

test('the step limit: the card names it; Continue (+N steps) runs the stage again with resume; Start over without', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const { task } = await begin(page, WORKER_CAN)
  expect(task.resume ?? null).toBeNull()
  await fake!.finish(task, { status: 'failed', error: 'Claude Code stopped at its step limit.', stepLimit: { turns: 20, max: 20 }, permissions: { asked: 2, allowed: 1, refused: 1 } })
  const box = page.getByTestId('coding-steplimit')
  await expect(box).toContainText('Step limit reached (20/20)')
  await expect(page.getByTestId('coding-permission-summary')).toHaveText('Permissions in the last run: 2 asked · 1 allowed · 1 refused')
  await expect(page.getByTestId('coding-continue')).toHaveText('Continue (+20 steps)')
  await page.getByTestId('coding-continue').click()
  await expect.poll(() => fake!.handed().length, { timeout: 15_000 }).toBe(2)
  const again = fake!.handed()[1]!
  expect(again.stage.id).toBe(task.stage.id)
  expect(again.resume).toEqual({ turns: 20, max: 20 })
  // stopped at the limit again: Start over runs it from the beginning (no resume)
  await fake!.finish(again, { status: 'failed', error: 'Claude Code stopped at its step limit.', stepLimit: { turns: 20, max: 20 } })
  await expect(box).toBeVisible()
  await page.getByTestId('coding-restart').click()
  await expect.poll(() => fake!.handed().length, { timeout: 15_000 }).toBe(3)
  expect(fake!.handed()[2]!.resume ?? null).toBeNull()
})

test('a worker that does not name "continue": the step-limit card offers Start over only, and says why', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const { task } = await begin(page, WORKER_CAN.filter((c) => c !== 'continue'))
  await fake!.finish(task, { status: 'failed', error: 'Claude Code stopped at its step limit.', stepLimit: { turns: 40, max: 40 } })
  await expect(page.getByTestId('coding-steplimit')).toContainText('Step limit reached (40/40)')
  await expect(page.getByTestId('coding-continue')).toHaveCount(0)
  await expect(page.getByTestId('coding-steplimit')).toContainText('Continue needs coding worker 1.11.0')
  await page.getByTestId('coding-restart').click()
  await expect.poll(() => fake!.handed().length, { timeout: 15_000 }).toBe(2)
  expect(fake!.handed()[1]!.resume ?? null).toBeNull()
})
