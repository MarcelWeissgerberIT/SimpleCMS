/**
 * #/regler v1 (Regler § 10.1, B10): the page reads this device's ledger when it opens — the readouts equal the ledger
 * (today, the month with yesterday, runs today), 01 consumers (rows by source, shares of the day budget, the model, an
 * agent the governor held today even without spend), 02 the roll by run (a stub opens to its receipt), "All" by day; the
 * hard-limit lines only for providers in use and OpenRouter's key limit read live once (no request without an OpenRouter
 * key); no ledger read before the page opens (without a budget); ⌘K and the status cell open it; 390 px.
 * Values are fictional (Nordlicht, Tessera, Launch plan); no AI host is reached (the aiNet guard, mocked OpenRouter).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, gotoPage, pageIdByTitle, MOD } from './fixtures'
import { budget } from './helpers/governor'
import { mockOpenRouter } from './helpers/providers'

type Seam = { __oneLedger: { seed(list: unknown[]): Promise<void>; opens(): number }; __onePreflight: { seedRuns(r: unknown[]): Promise<void> }; __oneGovernor: { opened(): { ledger: number; governor: number } } }

const OR_KEY = 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000'

const entry = (id: string, at: number, source: string, purpose: string, cls: string, usd: number, model = 'claude-opus-5-5', scope = 'local:local') => ({
  id,
  at,
  scope,
  purpose,
  cls,
  source,
  role: 'main',
  route: `anthropic:${model}`,
  served: { p: 'anthropic', model },
  classes: ['page'],
  usage: { input: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 200, reasoning: 0 },
  usd,
  costSource: 'table',
  priceAt: '2026-10-12',
  mcpCalls: 0,
  outcome: 'ok',
})

const AGENT = (id: string, name: string, write: 'none' | 'stage' | 'apply') => ({ id, name, instructions: 'Summarise the week.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write, output: null, mcpServers: [], runner: 'browser', maxRunUsd: 3, enabled: true, createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1 })

/** Today's spend as the mock shows it (4,12 $), yesterday 1 $, another workspace 0,50 $ (never counted here). */
async function seedDay(page: Page) {
  await page.evaluate(
    async ({ list }) => (window as unknown as Seam).__oneLedger.seed(list),
    {
      list: (() => {
        const now = Date.now()
        // a moment earlier today (never yesterday: the spec runs at any hour)
        const m = (min: number) => Math.max(new Date(new Date(now).setHours(0, 0, 30, 0)).getTime(), now - min * 60_000)
        const y = new Date(now)
        y.setDate(y.getDate() - 1)
        y.setHours(12, 0, 0, 0)
        return [
          entry('t1', m(50), 'terminal:c1:t1', 'terminal.task', 'terminal', 1.2),
          entry('t2', m(49), 'terminal:c1:t1', 'terminal.task', 'terminal', 0.86),
          entry('a1', m(40), 'ai:r1:improve', 'menu.action', 'write', 0.21),
          entry('a2', m(30), 'ai:r2:transform', 'structure.transform', 'structure', 0.56),
          entry('g1', m(25), 'agent:agentNordlicht:run1', 'agents.run', 'agents', 0.74, 'claude-sonnet-5-5'),
          entry('m1', m(20), 'mail:w1', 'bulk.mail', 'bulk', 0.31, 'claude-sonnet-5-5'),
          entry('f1', m(15), 'autofill:dbTessera:propSummary:j1', 'bulk.autofill', 'bulk', 0.18, 'claude-haiku-4-5'),
          entry('k1', m(10), 'palette:q1', 'palette.ask', 'ask', 0.06),
          entry('y1', y.getTime(), 'ai:r0:improve', 'menu.action', 'write', 1),
          entry('o1', m(5), 'ai:r9:improve', 'menu.action', 'write', 0.5, 'claude-opus-5-5', 'cloud:ws2:u:acc'),
        ]
      })(),
    },
  )
}

async function seedAgents(page: Page) {
  await wsEval(page, (s, a) => {
    for (const x of a) s.upsertAgent(x)
  }, [AGENT('agentNordlicht', 'Nordlicht digest', 'stage'), AGENT('agentSuedwind', 'Suedwind digest', 'apply')])
  await page.evaluate(() => {
    const at = Date.now() - 60_000
    const d = new Date(at)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return (window as unknown as Seam).__onePreflight.seedRuns([
      { id: `held-${day}`, agentId: 'agentSuedwind', runner: 'browser', trigger: { type: 'schedule', detail: '07:30' }, startedAt: at, endedAt: at, status: 'held', summary: '', steps: [], held: { kind: 'notStarted', binding: 'day', spent: 6, limit: 6, count: 3, times: [at - 7_200_000, at - 3_600_000, at] } },
    ])
  })
}

const open = (page: Page) => page.evaluate(() => (location.hash = '#/regler'))

test.describe('#/regler (B10)', () => {
  test('the page reads today from the ledger: readouts, consumers with shares and a held agent, the roll by run', async ({ page }) => {
    const keyChecks: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('openrouter.ai')) keyChecks.push(r.url())
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    // the ledger first: a budget starts the totals, and a closed day once read is a record that never changes
    await seedDay(page)
    await budget(page, { v: 1, day: 6, month: 120 })
    await seedAgents(page)
    await open(page)
    const pg = page.getByTestId('regler-page')
    await expect(pg).toBeVisible()
    await expect(pg.locator('h1')).toHaveText('Governor')

    // the readouts equal the ledger: today 4,12 of 6; the month adds yesterday's 1 $; 7 runs; another workspace never
    await expect(page.getByTestId('regler-ro-today')).toHaveText('$4.12 / $6.00')
    // (on the 1st yesterday was last month)
    await expect(page.getByTestId('regler-ro-month')).toHaveText(new Date().getDate() === 1 ? '$4.12 / $120.00' : '$5.12 / $120.00')
    await expect(page.getByTestId('regler-ro-runs')).toHaveText('7')
    // the dial says the same; yesterday's total is the dashed peak
    await expect(pg.getByRole('img', { name: 'Usage today $4.12 of $6.00, rest $1.88' })).toBeVisible()
    await expect(pg.locator('.gv-legend')).toContainText('yesterday max $1.00')

    // 01: one row per source, most spent first, the held agent last — with its count and the lock
    const rows = page.getByTestId('regler-consumer')
    await expect(rows).toHaveCount(7)
    await expect(rows.nth(0)).toHaveAttribute('data-kind', 'terminal')
    await expect(rows.nth(0)).toContainText('AI terminal')
    await expect(rows.nth(0).getByTestId('regler-consumer-sub')).toHaveText('1 task')
    await expect(rows.nth(0).getByTestId('regler-consumer-usd')).toHaveText('$2.06')
    await expect(rows.nth(0)).toContainText('Opus 5.5')
    await expect(rows.nth(0)).toContainText('Checks always')
    // its share of the day budget: 2,06 / 6
    expect(await rows.nth(0).locator('.gv-con__bar i').evaluate((el) => parseFloat((el as HTMLElement).style.width))).toBeCloseTo(34.33, 1)
    await expect(rows.nth(1)).toContainText('AI menu & Transform')
    await expect(rows.nth(1).getByTestId('regler-consumer-sub')).toHaveText('2 runs')
    await expect(rows.nth(1).getByTestId('regler-consumer-usd')).toHaveText('$0.77')
    await expect(rows.nth(2)).toContainText('Nordlicht digest')
    await expect(rows.nth(2)).toContainText('Sonnet 5.5')
    await expect(rows.nth(2)).toContainText('Proposes')
    await expect(rows.nth(3)).toContainText('Mail organising')
    await expect(rows.nth(4)).toHaveAttribute('data-kind', 'autofill')
    await expect(rows.nth(5)).toContainText('questions')
    const held = rows.nth(6)
    await expect(held).toContainText('Suedwind digest')
    await expect(held.getByTestId('regler-consumer-sub')).toHaveText('Held · 3 × not started')
    await expect(held.getByTestId('regler-consumer-held')).toHaveText('Held')
    await expect(held.getByTestId('regler-consumer-usd')).toHaveText('$0.00')
    await expect(page.getByTestId('regler-consumers-sum')).toContainText('$4.12')
    await expect(page.getByTestId('regler-consumers-sum')).toContainText('7 runs · 7 sources')

    // 02: one stub per run, newest first; the terminal task's two responses are ONE receipt
    const stubs = page.getByTestId('regler-stub')
    await expect(stubs).toHaveCount(7)
    await expect(stubs.first()).toHaveAttribute('data-source', 'palette:q1')
    const term = page.locator('[data-testid="regler-stub"][data-source="terminal:c1:t1"]')
    await expect(term).toContainText('AI terminal')
    await expect(term).toContainText('$2.06')
    await term.press('Enter')
    await expect(term).toHaveAttribute('aria-expanded', 'true')
    const receipt = page.getByTestId('regler-stub-receipt')
    await expect(receipt.getByTestId('regler-receipt')).toContainText('2 requests')
    await expect(receipt.getByTestId('regler-receipt-usd')).toContainText('$2.06')
    await expect(page.locator('[data-testid="regler-stub"][data-source="ai:r2:transform"]')).toContainText('AI menu & Transform · Reshaping')

    // "All": the last 30 days by day — today and yesterday
    await page.getByTestId('regler-roll-all').click()
    const days = page.getByTestId('regler-day')
    await expect(days).toHaveCount(2)
    await expect(days.first()).toContainText('$4.12')
    await expect(days.nth(1)).toContainText('$1.00')
    await days.nth(1).click()
    await expect(page.getByTestId('regler-day-roll').getByTestId('regler-stub')).toHaveCount(1)

    // the hard limit: Claude only (no OpenRouter key here) — and not one request to openrouter.ai
    const hard = pg.locator('.gv-hard__line')
    await expect(hard).toHaveCount(1)
    await expect(hard.first()).toContainText('Spend limit in the Claude Console')
    await expect(hard.first().locator('a')).toHaveAttribute('href', 'https://console.anthropic.com/settings/limits')
    expect(keyChecks).toEqual([])
  })

  test('OpenRouter in use: its key limit is read live once per tab (no text sent) and named on the plate', async ({ page }) => {
    const or = await mockOpenRouter(page.context(), { key: () => ({ status: 200, json: { data: { label: 'One', limit: 10, usage: 3.58, limit_remaining: 6.42, is_free_tier: false } } }) })
    await openApp(page)
    await wsEval(page, (s, k) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: k } }), OR_KEY)
    expect(or.requests.filter((r) => r.path === '/api/v1/key')).toHaveLength(0)
    await open(page)
    const hard = page.getByTestId('regler-page').locator('.gv-hard__line')
    await expect(hard).toHaveCount(2)
    await expect(hard.nth(0)).toContainText('Claude Console')
    await expect(hard.nth(1)).toContainText('Key limit $10.00 · $6.42 left')
    expect(or.requests.filter((r) => r.path === '/api/v1/key')).toHaveLength(1)
    expect(or.requests.filter((r) => r.method === 'POST')).toHaveLength(0)
    // away and back: read once per tab
    await page.evaluate(() => (location.hash = '#/'))
    await open(page)
    await expect(hard.nth(1)).toContainText('$6.42 left')
    expect(or.requests.filter((r) => r.path === '/api/v1/key')).toHaveLength(1)
  })

  test('without a budget nothing reads the ledger until the page opens; the dial asks for a red line', async ({ page }) => {
    await openApp(page)
    await page.waitForTimeout(800)
    expect(await page.evaluate(() => (window as unknown as Seam).__oneGovernor.opened().ledger)).toBe(0)
    await seedDay(page)
    await open(page)
    await expect(page.getByTestId('regler-ro-today')).toHaveText('$4.12')
    await expect(page.getByTestId('regler-ro-month')).toHaveText(new Date().getDate() === 1 ? '$4.12' : '$5.12')
    expect(await page.evaluate(() => (window as unknown as Seam).__oneGovernor.opened().ledger)).toBeGreaterThan(0)
    const pg = page.getByTestId('regler-page')
    await expect(pg.locator('.gv-legend')).toContainText('No day budget — set a red line')
    await expect(page.getByTestId('regler-consumers')).toContainText('Share of today')
    await pg.getByRole('button', { name: 'Set a budget' }).click()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/workspace/ai')
  })

  test('⌘K "Governor" and the status cell open it', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('Governor')
    await expect(page.getByRole('option', { name: /Governor — usage and red line/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('regler-page')).toBeVisible()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/regler')
    // the status cell (shown while a budget exists)
    await page.evaluate(() => (location.hash = '#/'))
    await budget(page, { v: 1, day: 6 })
    await page.locator('.status .gv-cell').click()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/regler')
    expect(await page.title()).toMatch(/^Governor — /)
  })

  test('a person\'s autofill run shows its band against the rest before it starts — only while a line is set', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const db = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, db)
    await wsEval(page, (s, db) => s.addProperty(db, { type: 'text', name: 'Summary', autofill: { preset: 'summary' } }), db)
    const panel = async () => {
      await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
      await page.locator('#main section.db').first().locator('.dbt-hcell__btn', { hasText: 'Summary' }).click()
      await page.getByRole('menuitem', { name: /AI autofill/ }).click()
      const dlg = page.getByRole('dialog', { name: 'AI autofill · Summary' })
      await expect(dlg).toBeVisible()
      return dlg
    }
    // no line: the estimate as before, no band
    let dlg = await panel()
    await expect(dlg.getByRole('button', { name: /Fill all rows/ })).toBeVisible()
    await expect(dlg.getByTestId('af-regler')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    // a day budget that holds it: the band and the rest, not over
    await budget(page, { v: 1, day: 10 })
    dlg = await panel()
    const band = dlg.getByTestId('af-regler')
    await expect(band).toContainText(/Governor: this run ≈ \$[\d.]+–\u2060?[\d.]+ · rest \$10/)
    await expect(band).not.toHaveAttribute('data-over', 'true')
    await expect(band.locator('.gv-minibar')).toBeVisible()
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('one column, the readout in 2 × 2, the consumers as cards, nothing wider than the screen; the workspace menu opens it', async ({ page }) => {
      await openApp(page)
      await seedDay(page)
      await budget(page, { v: 1, day: 6, month: 120 })
      await seedAgents(page)
      // the phone's workspace menu (no status bar on a phone)
      await page.getByRole('button', { name: 'Open sidebar' }).click()
      await page.locator('aside.sb .sb-head__ws').click()
      await page.getByRole('menuitem', { name: 'Governor — usage and red line' }).click()
      await expect(page.getByTestId('regler-page')).toBeVisible()
      await expect(page.getByTestId('regler-ro-today')).toHaveText('$4.12 / $6.00')
      await expect(page.locator('.gv-cons__h')).toBeHidden()
      const cells = page.locator('.gv-ro__cell')
      const boxes = await cells.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
      expect(boxes[0]).toBe(boxes[1])
      expect(boxes[2]).toBeGreaterThan(boxes[0]!)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const main = page.locator('.app-main')
      expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    })
  })
})
