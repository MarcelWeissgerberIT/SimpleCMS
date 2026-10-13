/**
 * The Regler in the e2e specs: a stored budget this tab enforces, spending today as a response would meter it, and
 * the autofill watch's paused rows (localStorage `one.governor.paused:<scope>`). Values are fictional.
 */
import { expect, type Page } from '@playwright/test'
import { wsEval } from '../fixtures'

type Seam = { __oneAI: Record<string, (...a: any[]) => any>; __oneLedger: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A stored budget (this build enforces GEN.budget since G1 B12 — no seam needed). */
export async function budget(page: Page, value: object | null): Promise<void> {
  expect(await wsEval(page, (s, g) => s.setGovernor(g) as { ok: boolean; why?: string }, value)).toEqual({ ok: true })
}

/** Spend today as a response would meter it (this scope): the line's rest goes down by `usd`. */
export async function spend(page: Page, usd: number): Promise<void> {
  await page.evaluate(
    ([u]) =>
      (window as unknown as Seam).__oneLedger.meter({
        id: `spent-${Math.random().toString(36).slice(2, 10)}`,
        at: Date.now(),
        scope: '',
        purpose: 'menu.action',
        cls: 'write',
        source: 'ai:spec-spent:improve',
        role: 'main',
        route: 'anthropic:claude-opus-5-5',
        served: { p: 'anthropic', model: 'claude-opus-5-5' },
        classes: ['page'],
        usage: { input: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 200, reasoning: 0 },
        usd: u,
        costSource: 'table',
        priceAt: '2026-10-12',
        mcpCalls: 0,
        outcome: 'ok',
      }),
    [usd] as const,
  )
}

/** The autofill watch's rows paused at the line in this browser's local workspace. */
export const pausedRowsOf = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('one.governor.paused:local:local')
    return (raw ? JSON.parse(raw) : { rows: [], dropped: 0 }) as { rows: Array<{ db: string; prop: string; row: string; cause: string | null; at: number }>; dropped: number }
  })
