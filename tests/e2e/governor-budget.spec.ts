/**
 * The budget settings (Regler § 10.6 / § 10.7, B11):
 *  - Workspace › AI § 06: the day / month budget round trip (save, the AI stamp, Undo as an Undo, reload, remove), the
 *    note "measured on each device", the hard limit per provider;
 *  - amounts in the UI's language: EN "1.5" (a German "1,5" refused in English), DE "1,5" and "1.5"; grouped thousands
 *    read as thousands ("1,000" · "1.000"), out of range refused — never saved as 1;
 *  - Settings › AI "My limit in this browser": written to localStorage one.governor.device (never the store) with this
 *    workspace's device stamp; the lower red line named when the workspace has a day budget too;
 *  - case 13: the device line counts a second scope's spend, the workspace budget does not (the brake, nothing sent).
 * Team: tests/e2e-cloud/governor-team.spec.ts (a member reads § 06 with the lock). Values are fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, uiEval, flush } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Seam = { __oneAI: { enforceGen(g: number): number; prepare(i: unknown): AnyState }; __oneGovernor: { load(): Promise<void>; totals(): AnyState }; __oneLedger: { seed(l: unknown[]): Promise<void> } }

const govOf = (page: Page) => wsEval(page, (s) => (s.governor ? { day: s.governor.day ?? null, month: s.governor.month ?? null } : null))
const genOf = (page: Page) => wsEval(page, (s) => (s.ai?.gen ?? null) as number | null)
const enforce = (page: Page) => page.evaluate(() => (window as unknown as Seam).__oneAI.enforceGen(3))

async function section(page: Page) {
  await page.evaluate(() => (location.hash = '#/workspace/ai'))
  const sec = page.getByTestId('gv-budget')
  await expect(sec).toBeVisible()
  return sec
}

test.describe('Workspace › AI § 06 (B11)', () => {
  test('the budget round trip: save stamps the AI generation, Undo puts it back, a reload reads it, remove takes it away', async ({ page }) => {
    await openApp(page)
    await enforce(page)
    const sec = await section(page)
    // the rail names the section; its head; the note; the hard limit
    await expect(page.locator('.wsp-tab[data-section="ai"]')).toContainText('07')
    await expect(page.locator('.wsp-tab[data-section="ai"]')).toContainText('AI')
    await expect(page.getByTestId('ws-section-ai').locator('#wsp-section-title')).toContainText('AI')
    await expect(sec).toContainText('Budget & governor')
    await expect(sec).toContainText('measured on each device separately')
    await expect(sec.locator('.gv-hard__line')).toContainText('Spend limit in the Claude Console')
    expect(await govOf(page)).toBeNull()

    await sec.getByTestId('gv-budget-day').fill('6')
    await sec.getByTestId('gv-budget-month').fill('120')
    await sec.getByTestId('gv-budget-save').click()
    await expect(sec.locator('.gv-budget__said')).toContainText('Saved')
    expect(await govOf(page)).toEqual({ day: 6, month: 120 })
    expect(await genOf(page)).toBe(3)
    // the status bar's cell appears with the budget
    await expect(page.locator('.status .gv-cell')).toBeVisible()

    // Undo: back as it was (no budget, no stamp)
    await sec.getByTestId('gv-budget-undo').click()
    await expect(sec.locator('.gv-budget__said')).toContainText('Back as it was')
    expect(await govOf(page)).toBeNull()
    expect(await genOf(page)).toBeNull()
    await expect(sec.getByTestId('gv-budget-day')).toHaveValue('')

    // again, then a reload reads it into the fields
    await sec.getByTestId('gv-budget-day').fill('6.5')
    await sec.getByTestId('gv-budget-save').click()
    expect(await govOf(page)).toEqual({ day: 6.5, month: null })
    await flush(page)
    await reloadApp(page)
    await enforce(page)
    const again = await section(page)
    await expect(again.getByTestId('gv-budget-day')).toHaveValue('6.5')
    await expect(again.getByTestId('gv-budget-month')).toHaveValue('')
    // remove
    await again.getByTestId('gv-budget-remove').click()
    await expect(again.locator('.gv-budget__said')).toContainText('No budget')
    expect(await govOf(page)).toBeNull()
  })

  test('amounts in the UI language: EN 1.5 and 1,000; DE 1,5 · 1.5 · 1.000; a German comma in English and out of range refused (never saved)', async ({ page }) => {
    await openApp(page)
    await enforce(page)
    let sec = await section(page)
    const day = () => sec.getByTestId('gv-budget-day')
    const month = () => sec.getByTestId('gv-budget-month')
    const save = () => sec.getByTestId('gv-budget-save').click()

    await day().fill('1.5')
    await month().fill('1,000')
    await save()
    expect(await govOf(page)).toEqual({ day: 1.5, month: 1000 })
    // English: "1,5" is no amount — refused, the stored value stays
    await day().fill('1,5')
    await save()
    await expect(sec.locator('.gv-budget__err')).toContainText('Not an amount')
    await expect(day()).toHaveAttribute('aria-invalid', 'true')
    expect(await govOf(page)).toEqual({ day: 1.5, month: 1000 })
    // out of range: refused, never clamped or cut
    await day().fill('20000')
    await save()
    await expect(sec.locator('.gv-budget__err')).toContainText('Between $0.10 and $10,000')
    await day().fill('0.05')
    await save()
    await expect(sec.locator('.gv-budget__err')).toContainText('Between')
    expect(await govOf(page)).toEqual({ day: 1.5, month: 1000 })

    // German (the section opened again: an unsaved entry is the person's and stays while it is open)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.evaluate(() => (location.hash = '#/workspace'))
    await expect(page.getByTestId('gv-budget')).toHaveCount(0)
    sec = await section(page)
    await expect(sec).toContainText('Budget & Regler')
    await expect(day()).toHaveValue('1,5')
    await expect(month()).toHaveValue('1000')
    await day().fill('2,5')
    await month().fill('1.000')
    await save()
    expect(await govOf(page)).toEqual({ day: 2.5, month: 1000 })
    await day().fill('3.5')
    await save()
    expect(await govOf(page)).toEqual({ day: 3.5, month: 1000 })
    await day().fill('1,5,0')
    await save()
    await expect(sec.locator('.gv-budget__err')).toContainText('Kein Betrag')
    expect(await govOf(page)).toEqual({ day: 3.5, month: 1000 })
  })
})

test.describe('Settings › AI — my limit in this browser (B11)', () => {
  test('written to this browser only (never the store) with the device stamp; the lower red line is named next to a workspace budget; removing it lowers the stamp', async ({ page }) => {
    await openApp(page)
    await enforce(page)
    await wsEval(page, (s) => s.setGovernor({ v: 1, day: 6 }))
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const dev = page.getByTestId('gv-device')
    await dev.scrollIntoViewIfNeeded()
    await expect(dev).toContainText('My limit in this browser')
    await expect(dev.getByTestId('gv-device-scope')).toContainText('every workspace')
    await dev.getByTestId('gv-device-day').fill('8')
    await dev.getByTestId('gv-device-save').click()
    await expect(dev.locator('.gv-budget__said')).toContainText('Saved')
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('one.governor.device'))) ?? 'null')
    expect(stored).toMatchObject({ v: 1, day: 8 })
    expect(await wsEval(page, (s) => s.settings.ai?.gen ?? null)).toBe(3)
    // never in the workspace's store
    expect(await govOf(page)).toEqual({ day: 6, month: null })
    await expect(dev.getByTestId('gv-device-lower')).toContainText('The workspace allows $6.00 a day — the lower red line applies')
    // the day read, it says what it counts
    await page.evaluate(() => (window as unknown as Seam).__oneGovernor.load())
    await expect(dev.getByTestId('gv-device-scope')).toContainText('today $0.00 (here $0.00)')
    // removed: the line and its stamp go
    await dev.getByTestId('gv-device-remove').click()
    expect(await page.evaluate(() => localStorage.getItem('one.governor.device'))).toBeNull()
    await expect.poll(() => wsEval(page, (s) => s.settings.ai?.gen ?? null)).toBeNull()
  })
})

test.describe('case 13 — the device line counts a second workspace (B11)', () => {
  const SIZE = { promptChars: 400, maxTokens: 400 }
  const prepare = (page: Page) => page.evaluate((size) => (window as unknown as Seam).__oneAI.prepare({ purpose: 'help.ask', sources: [], size }), SIZE)

  test('another scope of this browser spent the day: the device line refuses (nothing sent), the workspace budget does not', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await enforce(page)
    const other = 'cloud:ws-tessera-0001:u:acc-mara-lind'
    await page.evaluate((o) => {
      const now = Date.now()
      const d = new Date(now)
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      localStorage.setItem('one.governor.scopes', JSON.stringify([{ scope: o, last: day }]))
      return (window as unknown as Seam).__oneLedger.seed([
        { id: 'o1', at: now, scope: o, purpose: 'menu.action', cls: 'write', source: 'ai:run-o1:improve', role: 'main', route: 'anthropic:claude-sonnet-5-5', served: { p: 'anthropic', model: 'claude-sonnet-5-5' }, classes: ['page'], usage: { input: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 200, reasoning: 0 }, usd: 0.999, costSource: 'table', priceAt: '2026-10-12', mcpCalls: 0, outcome: 'ok' },
      ])
    }, other)
    // the workspace's budget of 1 $: this workspace spent nothing here — the request passes
    await wsEval(page, (s) => s.setGovernor({ v: 1, day: 1 }))
    await page.evaluate(() => (window as unknown as Seam).__oneGovernor.load())
    expect(await prepare(page)).toMatchObject({ ok: true })
    // the person's line of 1 $ for this browser: the other workspace's 0,999 $ counts — refused, nothing reserved
    await wsEval(page, (s) => s.setGovernor(null))
    await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, day: 1, at: Date.now() })))
    await page.evaluate(() => (window as unknown as Seam).__oneGovernor.load())
    const t = await page.evaluate(() => (window as unknown as Seam).__oneGovernor.totals())
    expect(t.device.spentToday).toBeCloseTo(0.999, 6)
    expect(t.scope.spentToday).toBe(0)
    expect(await prepare(page)).toMatchObject({ ok: false, code: 'budget', detail: 'device-day' })
  })
})
