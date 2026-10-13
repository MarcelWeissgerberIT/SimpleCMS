/**
 * Case 11 (Regler B12) — an older tab, the budget generation raised (AI_POLICY_GEN = GEN.budget):
 *  - this build: a budget stamps `ai.gen` = 3 and its own requests go; a tab of the S2 generation (a build of policy
 *    generation 2 — simulated through the ?e2e seam `enforceGen(2)`) in the same browser refuses AI with 'reload' and
 *    sends nothing; the budget removed in the first tab → the older tab sends again (positive control);
 *  - for real (opt-in, `REGLER_S2_DIST=<a production build of the S2 release with base /SimpleCMS/>`): the second page is
 *    served that build on the same origin (same IndexedDB), the same three steps through its AI menu.
 * Every host is mocked (aiNet on); values are fictional (Launch notes).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, createPage, gotoPage, editorOf, doc, para, selectText } from './fixtures'
import { mockClaudeScript, text } from './helpers/providers'
import { aiPanel } from './helpers/aiFlows'
import { AI_POLICY_GEN } from '../../src/shared/ai/policy'
import { GEN } from '../../src/shared/ai/generations'

type Seam = { __oneAI: { enforceGen(g: number | null): number } }

const RELOAD = 'This workspace has AI rules this tab does not know yet'
const ANSWER = 'A tighter launch sentence.'
const KEY = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const genOf = (page: Page) => wsEval(page, (s) => (s.ai?.gen ?? null) as number | null)

/** Improve writing on "Launch notes" — refused with the reload note, or answered. */
async function improveOn(page: Page, id: string, refused: boolean) {
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: 'our launch sentence is kinda loose' }).click()
  await selectText(page, ed, 'our launch sentence is kinda loose')
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(aiPanel(page)).toBeVisible()
  await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
  if (refused) await expect(aiPanel(page).locator('.ai-error')).toContainText(RELOAD)
  else await expect(aiPanel(page)).toContainText(ANSWER)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

/** The second page of the same browser, served the files of another build (same origin, same IndexedDB). */
async function servedFrom(ctx: BrowserContext, dir: string): Promise<Page> {
  const page = await ctx.newPage()
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
  await page.route(/\/SimpleCMS\//, (route) => {
    const url = new URL(route.request().url())
    let rel = url.pathname.replace(/^\/SimpleCMS\//, '')
    if (!rel || rel.endsWith('/')) rel += 'index.html'
    const file = join(dir, rel)
    if (!existsSync(file) || !statSync(file).isFile()) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
  })
  return page
}

test.describe('case 11 — an older tab while a budget is stored (B12)', () => {
  test('this build enforces the budget generation', () => {
    expect(GEN.budget).toBe(3)
    expect(AI_POLICY_GEN).toBe(GEN.budget)
  })

  test('a tab of the S2 generation refuses AI with reload and sends nothing; the budget removed → it sends', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text(ANSWER), text(ANSWER), text(ANSWER)])
    await openApp(page)
    await KEY(page)
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('our launch sentence is kinda loose')) })
    expect(await wsEval(page, (s) => s.setGovernor({ v: 1, day: 1000, month: 1000 }) as { ok: boolean })).toEqual({ ok: true })
    expect(await genOf(page)).toBe(GEN.budget)
    await flush(page)
    // this build keeps the budget: its request goes (one)
    await improveOn(page, id, false)
    expect(requests).toHaveLength(1)

    // the older tab (a build of policy generation 2)
    const older = await page.context().newPage()
    await openApp(older)
    expect(await older.evaluate(() => (window as unknown as Seam).__oneAI.enforceGen(2))).toBe(2)
    expect(await genOf(older)).toBe(GEN.budget)
    await improveOn(older, id, true)
    await older.waitForTimeout(400)
    expect(requests).toHaveLength(1)
    expect(aiNet.count('anthropic')).toBe(1)

    // the budget removed in the first tab: the stamp follows, the older tab sends again
    expect(await wsEval(page, (s) => s.setGovernor(null) as { ok: boolean })).toEqual({ ok: true })
    expect(await genOf(page)).toBeNull()
    await flush(page)
    await expect.poll(() => genOf(older)).toBeNull()
    await improveOn(older, id, false)
    expect(requests).toHaveLength(2)
    await older.close()
  })

  test('for real: the S2 build served on the same origin refuses with reload and zero requests; the budget removed → it sends', async ({ page, aiNet }) => {
    const dir = process.env.REGLER_S2_DIST
    test.skip(!dir, 'opt-in: REGLER_S2_DIST=<a production build of the S2 release, base /SimpleCMS/>')
    const { requests } = await mockClaudeScript(page.context(), [text(ANSWER), text(ANSWER)])
    await openApp(page)
    await KEY(page)
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('our launch sentence is kinda loose')) })
    expect(await wsEval(page, (s) => s.setGovernor({ v: 1, day: 1000, month: 1000 }) as { ok: boolean })).toEqual({ ok: true })
    await flush(page)

    const older = await servedFrom(page.context(), dir!)
    await openApp(older)
    // it is the older build: it has no budget generation of its own and reads the stamp it cannot keep
    expect(await older.evaluate(() => typeof (window as unknown as { __oneAI: Record<string, unknown> }).__oneAI.enforceGen)).toBe('undefined')
    expect(await genOf(older)).toBe(GEN.budget)
    await improveOn(older, id, true)
    await older.waitForTimeout(400)
    expect(requests).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(0)

    expect(await wsEval(page, (s) => s.setGovernor(null) as { ok: boolean })).toEqual({ ok: true })
    await flush(page)
    await expect.poll(() => genOf(older)).toBeNull()
    await improveOn(older, id, false)
    expect(requests).toHaveLength(1)
    await older.close()
  })
})
