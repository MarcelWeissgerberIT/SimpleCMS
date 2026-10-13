/**
 * The Regler's plates as people see them (production build) — the brake note (the AI menu at the line) and the halt
 * card (the AI terminal between two rounds), 1440 × 900 and 390 × 844, Paper and Carbon, into .shots/regler-*.png.
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
