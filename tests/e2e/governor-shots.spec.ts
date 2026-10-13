/**
 * The Regler's plates as people see them (production build) — the brake note (the AI menu at the line) and the halt
 * card (the AI terminal between two rounds), #/regler, Workspace › AI § 06 and Settings › AI's own line for this browser,
 * Preflight's USAGE lamp at the line, the start dialog of a manual agent run,
 * 1440 × 900 and 390 × 844, Paper and Carbon, and the status bar's REGLER cell (amber, at the line) at 1440, into
 * .shots/regler-*.png.
 * Screenshots only on request (REGLER_SHOTS=1). Values are fictional (Nordlicht, Launch plan).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { improve } from './helpers/aiFlows'
import { mockClaudeScript, text } from './helpers/providers'
import { openTerminal, run as runTask } from './helpers/terminal'
import { budget, spend } from './helpers/governor'

test.skip(!process.env.REGLER_SHOTS, 'screenshots only on request (REGLER_SHOTS=1)')

type Seam = { __oneGovernor: Record<string, (...a: unknown[]) => unknown>; __oneAI: Record<string, (...a: unknown[]) => unknown> }

const KEY = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const theme = (page: Page, t: 'light' | 'dark') => page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), t)

/** The mock's day: 4,12 $ across six sources, yesterday 1 $, an agent the governor held (3 × not started). */
async function seedRegler(page: Page) {
  await page.evaluate(() => {
    const now = Date.now()
    const m = (min: number) => Math.max(new Date(new Date(now).setHours(0, 0, 30, 0)).getTime(), now - min * 60_000)
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    y.setHours(12, 0, 0, 0)
    const e = (id: string, at: number, source: string, purpose: string, cls: string, usd: number, model = 'claude-opus-5-5', input = 1000, output = 200) => ({ id, at, scope: 'local:local', purpose, cls, source, role: 'main', route: `anthropic:${model}`, served: { p: 'anthropic', model }, classes: ['page'], usage: { input, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output, reasoning: 0 }, usd, costSource: 'table', priceAt: '2026-10-12', mcpCalls: 0, outcome: 'ok' })
    return (window as unknown as { __oneLedger: { seed(l: unknown[]): Promise<void> } }).__oneLedger.seed([
      e('t1', m(130), 'terminal:c1:t1', 'terminal.task', 'terminal', 1.2, 'claude-opus-5-5', 96_400, 15_300),
      e('t2', m(128), 'terminal:c1:t1', 'terminal.task', 'terminal', 0.86),
      e('a1', m(90), 'ai:r1:improve', 'menu.action', 'write', 0.21),
      e('a2', m(8), 'ai:r2:transform', 'structure.transform', 'structure', 0.56),
      e('g1', m(60), 'agent:agentNordlicht:run1', 'agents.run', 'agents', 0.74, 'claude-sonnet-5-5', 1_390_000, 15_300),
      e('m1', m(50), 'mail:w1', 'bulk.mail', 'bulk', 0.31, 'claude-sonnet-5-5'),
      e('f1', m(40), 'autofill:dbTessera:propSummary:j1', 'bulk.autofill', 'bulk', 0.18, 'claude-haiku-4-5'),
      e('k1', m(20), 'palette:q1', 'palette.ask', 'ask', 0.06),
      e('y1', y.getTime(), 'ai:r0:improve', 'menu.action', 'write', 5.2),
    ])
  })
  await wsEval(page, (s) => {
    for (const [id, name, write] of [['agentNordlicht', 'Nordlicht mirror', 'stage'], ['agentSuedwind', 'Sort mails', 'apply']])
      s.upsertAgent({ id, name, instructions: 'Summarise the week.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write, output: null, mcpServers: [], runner: 'browser', maxRunUsd: 3, enabled: true, createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1 })
  })
  await page.evaluate(() => {
    const at = Date.now() - 60_000
    const d = new Date(at)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return (window as unknown as { __onePreflight: { seedRuns(r: unknown[]): Promise<void> } }).__onePreflight.seedRuns([
      { id: `held-${day}`, agentId: 'agentSuedwind', runner: 'browser', trigger: { type: 'schedule', detail: '07:30' }, startedAt: at, endedAt: at, status: 'held', summary: '', steps: [], held: { kind: 'notStarted', binding: 'day', spent: 6, limit: 6, count: 3, times: [at - 7_200_000, at - 3_600_000, at] } },
    ])
  })
}

const R1 = { blocks: [{ type: 'text' as const, text: 'Drafting the brief.' }, { type: 'tool_use' as const, id: 'toolu_s1', name: 'create_page', input: { title: 'Nordlicht brief', markdown: 'Launch plan for Nordlicht.' } }], usage: { input: 2000, output: 100 } }
const R2 = { blocks: [{ type: 'tool_use' as const, id: 'toolu_s2', name: 'search_pages', input: { query: 'Tessera' } }], usage: { input: 2000, output: 6000 } }

for (const size of [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
] as const) {
  for (const t of ['light', 'dark'] as const) {
    test.describe(`${size.w} ${t}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } })

      test('the brake note in the AI menu', async ({ page }) => {
        await mockClaudeScript(page.context(), [text('A tighter launch sentence.')])
        await openApp(page)
        await KEY(page)
        await budget(page, { v: 1, day: 0.1 })
        await page.evaluate(() => (window as unknown as Seam).__oneGovernor.reserve(0.095, 'shot:hold'))
        await theme(page, t)
        await improve(page, null)
        const note = page.getByTestId('gv-brake-note')
        await expect(note).toBeVisible()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `.shots/regler-note-${size.w}-${t}.png` })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })

      test('the status cell at amber and at the line', async ({ page }) => {
        test.skip(size.w < 768, 'the status bar is not on phones')
        await openApp(page)
        await KEY(page)
        await budget(page, { v: 1, day: 6 })
        await theme(page, t)
        await spend(page, 4.6)
        const cell = page.locator('.status .gv-cell')
        await expect(cell).toHaveAttribute('data-level', 'amber', { timeout: 15_000 })
        await cell.screenshot({ path: `.shots/regler-cell-amber-${t}.png` })
        await page.locator('.status').screenshot({ path: `.shots/regler-status-amber-${t}.png` })
        await spend(page, 1.5)
        await expect(cell).toHaveAttribute('data-level', 'red')
        await page.locator('.status').screenshot({ path: `.shots/regler-status-red-${t}.png` })
      })

      test('#/regler', async ({ page }) => {
        await openApp(page)
        await KEY(page)
        await seedRegler(page)
        await budget(page, { v: 1, day: 6, month: 120 })
        await theme(page, t)
        await page.evaluate(() => (location.hash = '#/regler'))
        await expect(page.getByTestId('regler-ro-today')).toContainText('4.12')
        await expect(page.getByTestId('regler-consumer')).toHaveCount(7)
        await page.waitForTimeout(500)
        await page.screenshot({ path: `.shots/regler-page-${size.w}-${t}.png` })
        if (size.w < 768) {
          // the main column scrolls (not the document); it holds its place until the reader touches it (a wheel)
          await page.mouse.move(200, 500)
          await page.mouse.wheel(0, 1)
          const scrollTo = (sel: string) => page.locator(sel).evaluate((el) => {
            const col = el.closest('.stage-col') as HTMLElement
            col.scrollTop += el.getBoundingClientRect().top - col.getBoundingClientRect().top - 8
          })
          await scrollTo('.gv-plate')
          await page.waitForTimeout(300)
          await page.screenshot({ path: `.shots/regler-page-${size.w}-${t}-plate.png` })
          await scrollTo('[data-testid="regler-consumers"]')
          await page.waitForTimeout(300)
          await page.screenshot({ path: `.shots/regler-page-${size.w}-${t}-consumers.png` })
        }
        await page.locator('[data-testid="regler-stub"][data-source="agent:agentNordlicht:run1"]').click()
        await page.getByTestId('regler-receipts').evaluate((el, block) => el.scrollIntoView({ block }), size.w < 768 ? ('start' as const) : ('end' as const))
        await page.waitForTimeout(300)
        await page.screenshot({ path: `.shots/regler-page-${size.w}-${t}-below.png` })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })

      test('Workspace › AI § 06 and Settings › AI — my limit in this browser', async ({ page }) => {
        await openApp(page)
        await KEY(page)
        await seedRegler(page)
        await budget(page, { v: 1, day: 6, month: 120 })
        await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, day: 8, at: Date.now() })))
        await wsEval(page, (s) => s.stampDeviceGen())
        await page.evaluate(() => (window as unknown as Seam).__oneGovernor.load())
        await theme(page, t)
        await page.evaluate(() => (location.hash = '#/workspace/ai'))
        const sec = page.getByTestId('gv-budget')
        await expect(sec.getByTestId('gv-budget-day')).toHaveValue('6')
        await page.waitForTimeout(400)
        await page.screenshot({ path: `.shots/regler-budget-${size.w}-${t}.png` })
        if (size.w < 768) {
          await page.mouse.move(200, 500)
          await page.mouse.wheel(0, 1)
          await sec.evaluate((el) => {
            const col = el.closest('.stage-col') as HTMLElement
            col.scrollTop += el.getBoundingClientRect().top - col.getBoundingClientRect().top - 8
          })
          await page.waitForTimeout(300)
          await page.screenshot({ path: `.shots/regler-budget-${size.w}-${t}-section.png` })
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        // Settings › AI: the person's own line for this browser
        await page.evaluate(() => (window as unknown as { __one: { ui: { getState(): { openModal(m: object): void } } } }).__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
        const dev = page.getByTestId('gv-device')
        await expect(dev.getByTestId('gv-device-day')).toHaveValue('8')
        await dev.scrollIntoViewIfNeeded()
        await page.waitForTimeout(400)
        await page.screenshot({ path: `.shots/regler-device-${size.w}-${t}.png` })
      })

      test('Preflight: the USAGE lamp at the red line on Start', async ({ page }) => {
        await openApp(page)
        await KEY(page)
        await budget(page, { v: 1, day: 6 })
        await theme(page, t)
        await spend(page, 6.1)
        await page.evaluate(() => (location.hash = '#/'))
        const plate = page.getByTestId('pf-plate')
        await expect(plate).toBeVisible({ timeout: 15_000 })
        await expect(plate).toContainText('Usage')
        await page.waitForTimeout(600)
        await page.screenshot({ path: `.shots/regler-lamp-${size.w}-${t}.png` })
        await plate.screenshot({ path: `.shots/regler-lamp-plate-${size.w}-${t}.png` })
      })

      test('the start dialog of a manual run at the line', async ({ page }) => {
        await openApp(page)
        await KEY(page)
        await wsEval(page, (s) => {
          const now = Date.now()
          s.upsertAgent({ id: 'ag-nordlicht', name: 'Nordlicht digest', instructions: 'Summarise the status of the Nordlicht projects.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
        })
        await budget(page, { v: 1, day: 1 })
        await spend(page, 0.95)
        await theme(page, t)
        await page.evaluate(() => (location.hash = '#/agents/ag-nordlicht'))
        await page.getByRole('button', { name: 'Run now' }).click()
        const dlg = page.getByRole('dialog')
        await expect(dlg).toContainText('Red line · Nordlicht digest')
        await page.waitForTimeout(500)
        await page.screenshot({ path: `.shots/regler-start-${size.w}-${t}.png` })
        await page.keyboard.press('Escape')
      })

      test('the halt card in the AI terminal', async ({ page }) => {
        await mockClaudeScript(page.context(), [R1, R2, text('Staged the Nordlicht brief.')])
        await openApp(page)
        await KEY(page)
        await budget(page, { v: 1, day: 1 })
        await spend(page, 0.79)
        await theme(page, t)
        await openTerminal(page)
        await runTask(page, 'Draft the Nordlicht brief.')
        const card = page.getByTestId('gv-halt')
        await expect(card).toBeVisible()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `.shots/regler-halt-${size.w}-${t}.png` })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    })
  }
}
