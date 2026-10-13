/**
 * Section 06 "Check" of the agent editor (slice SJ, J11): the Vorprüfung starts off (absent = off), switching it on
 * writes review v2 — never a top-level `route` — with `on` = the snapshot the catalogue names; the threshold stepper,
 * "On concerns", the Schreibschranke (disabled — and saying why — unless "Apply directly" and the pre-check), the picker's
 * Jev versions (other decision models dimmed), "new version" + Confirm, the calibration readout, server agents, a review
 * this build cannot read. Keyboard only, and touch at 390 px. Mocked hosts only; the agent and rows are fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, wsEval } from './fixtures'
import { AGENT, JEV, ON, SNAP, jevAgent, jevSetup, type AnyState } from './helpers/jev'
import { mockClaudeScript, mockOpenRouter } from './helpers/providers'
import { openApp } from './fixtures'

const stored = (page: Page) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.agents[id])), AGENT)
const editor = (page: Page) => page.locator('.agx-editor')
const sec = (page: Page) => editor(page).getByTestId('jev-ed')

async function openEditor(page: Page) {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(editor(page).getByRole('heading', { name: /06 — Check/ })).toBeVisible()
}

test.describe('section 06: the Vorprüfung and the Schreibschranke (J11)', () => {
  test('keyboard only: off by default; on → review v2 with the catalogue’s snapshot; mark 0.65, "Mark only", the gate once "Apply directly" — saved without a top-level route', async ({ page }) => {
    const w = await jevSetup(page)
    await jevAgent(page, { review: null })
    await openEditor(page)
    const pre = sec(page).getByRole('switch', { name: 'Pre-check' })
    const gate = sec(page).getByRole('switch', { name: 'Write gate' })
    // nothing is on by default
    await expect(pre).toHaveAttribute('aria-checked', 'false')
    expect((await stored(page)).review).toBeUndefined()
    // the gate: disabled, and its reason read out
    await expect(gate).toBeDisabled()
    await expect(gate).toHaveAccessibleDescription('Only with "Apply directly" and the pre-check — otherwise everything waits for you anyway.')
    // on, by keyboard
    await pre.focus()
    await page.keyboard.press('Space')
    await expect(pre).toHaveAttribute('aria-checked', 'true')
    await expect(sec(page).getByTestId('jev-chip')).toContainText('Jev 1.13')
    await expect(sec(page).getByTestId('jev-start')).toHaveText('Start values')
    // the catalogue was read once (its snapshot is what the person confirms)
    expect(w.or.to('/api/v1/models', 'GET').filter((r) => r.url.includes('output_modalities=decisions')).length).toBe(1)
    // mark below: ↓ steps by 0.05
    const mark = sec(page).getByTestId('jev-mark').getByRole('spinbutton')
    await mark.focus()
    await page.keyboard.press('ArrowDown')
    await expect(mark).toHaveAttribute('aria-valuenow', '0.65')
    // On concerns: Hold back is the default; ← picks Mark only
    const hold = sec(page).getByTestId('jev-hold')
    await expect(hold.getByRole('radio', { name: 'Hold back' })).toHaveAttribute('aria-checked', 'true')
    await hold.getByRole('radio', { name: 'Hold back' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(hold.getByRole('radio', { name: 'Mark only' })).toHaveAttribute('aria-checked', 'true')
    // the data line: allowed
    await expect(sec(page).getByTestId('jev-facts')).toContainText('Jev reads: instructions, change, row ✓ allowed')
    // "Apply directly" → the gate is offered; on → 0.90
    const apply = editor(page).getByRole('radio', { name: 'Apply directly' })
    await apply.focus()
    await page.keyboard.press('Space')
    await expect(gate).toBeEnabled()
    await gate.focus()
    await page.keyboard.press('Space')
    await expect(gate).toHaveAttribute('aria-checked', 'true')
    await expect(sec(page).getByTestId('jev-allow').getByRole('spinbutton')).toHaveAttribute('aria-valuenow', '0.9')
    // Save
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor(page)).toHaveCount(0)
    const a = await stored(page)
    expect(a.review).toEqual({ v: 2, on: ON, pre: { markBelow: 0.65, hold: false }, gate: { allowAt: 0.9 } })
    expect(a.route).toBeUndefined()
    expect(a.write).toBe('apply')
    // control: off again → no review at all
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await sec(page).getByRole('switch', { name: 'Pre-check' }).click()
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor(page)).toHaveCount(0)
    expect((await stored(page)).review ?? null).toBeNull()
  })

  test('Alt+M: the Jev versions; other decision models dimmed "tuned for Jev only"; picking one names it as the agent’s own Vorprüfer', async ({ page }) => {
    await jevSetup(page)
    await jevAgent(page, { hold: true })
    await openEditor(page)
    await sec(page).getByTestId('jev-chip').focus()
    await page.keyboard.press('Alt+m')
    const menu = page.locator('.popover[role="menu"]')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Jev 1\.13/ })).toBeVisible()
    // the alias and other decision models: listed, never selectable
    for (const name of [/Clef/i, /Span/i]) {
      const row = menu.getByRole('menuitem', { name })
      await expect(row).toHaveAttribute('aria-disabled', 'true')
      await expect(row).toContainText('tuned for Jev only')
    }
    await menu.getByRole('menuitem', { name: /^Jev 1\.13/ }).click()
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor(page)).toHaveCount(0)
    expect((await stored(page)).review).toMatchObject({ v: 2, decider: { p: 'openrouter', m: JEV }, on: ON })
  })

  test('another Jev snapshot answered → NEW VERSION; Confirm writes `on` at once and the lamp goes out (control: the confirmed one → no line)', async ({ page }) => {
    await jevSetup(page)
    await jevAgent(page, { hold: true })
    const newer = `${JEV}-20261101`
    await page.evaluate(
      ([a, to]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.putRun({ id: 'r-new', agentId: a, runner: 'browser', trigger: { type: 'manual' }, startedAt: Date.now() - 60_000, endedAt: Date.now() - 50_000, status: 'staged', summary: '', steps: [], staged: [], jev: { n: 1, checked: 0, marked: 0, held: 1, usd: 0, failed: 'changed', changedTo: to } }),
      [AGENT, newer] as const,
    )
    await openEditor(page)
    const line = sec(page).getByTestId('jev-new')
    await expect(line).toContainText('Jev 1.13 has a new version (Nov 01, 2026)')
    await line.getByRole('button', { name: 'Confirm' }).click()
    await expect(sec(page).getByTestId('jev-confirmed')).toBeVisible()
    await expect.poll(async () => (await stored(page)).review.on).toBe(`openrouter:${newer}`)
    // the lamp: out
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const p = (window as unknown as { __onePreflight: AnyState }).__onePreflight
          await p.flush('missed')
          return ((p.readings().missed?.ids ?? []) as string[]).filter((x) => x.startsWith('jevnew:'))
        }),
      )
      .toEqual([])
  })

  test('the calibration readout counts this device’s checked proposals — and never suggests a threshold', async ({ page }) => {
    await jevSetup(page)
    await jevAgent(page, { hold: true })
    const ok = (p: number, mark: boolean) => ({ v: 1, at: Date.now(), model: SNAP, state: 'ok', checks: { asked: p, target: 0.95, consistent: 0.95, clean: 0.95 }, low: 'asked', p, mark })
    const ch = (id: string, status: string, jev: AnyState, reason?: string) => ({ id, n: 1, kind: 'update_row', pageId: id, status, ...(reason ? { reason } : {}), props: [], jev })
    await page.evaluate(
      ([a, staged]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.putRun({ id: 'r-cal', agentId: a, runner: 'browser', trigger: { type: 'manual' }, startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 3_500_000, status: 'staged', summary: '', steps: [], staged }),
      [AGENT, [ch('c1', 'applied', ok(0.41, true)), ch('c2', 'discarded', ok(0.5, true)), ch('c3', 'discarded', ok(0.92, false), 'wrong'), ch('c4', 'applied', ok(0.95, false))]] as const,
    )
    await openEditor(page)
    await expect(sec(page).getByTestId('jev-calib')).toHaveText('4 pre-checked · 2 with concerns (1 applied, 1 discarded) · 1 without concerns discarded as wrong')
    await expect(sec(page)).toContainText('It never suggests a threshold.')
  })

  test('a server agent: the rows are off, "only after the server update"; a review this build cannot read is kept byte for byte', async ({ page }) => {
    await jevSetup(page)
    const future = { v: 3, on: ON, pre: { markBelow: 0.7, hold: true }, check: { route: [{ p: 'anthropic', m: 'claude-sonnet-5-5' }] } }
    await jevAgent(page, { review: future })
    await openEditor(page)
    await expect(editor(page).getByTestId('jev-ed-unreadable')).toBeVisible()
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor(page)).toHaveCount(0)
    expect((await stored(page)).review).toEqual(future)
    // a server agent: the rows are off and say why
    await wsEval(page, (s, a) => s.upsertAgent({ ...s.agents[a.id], runner: 'server', review: a.review }), { id: AGENT, review: { v: 2, on: ON, pre: { markBelow: 0.7, hold: true } } })
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(sec(page).getByTestId('jev-ed-server')).toHaveText('Server agents: only after the server update')
    await expect(sec(page).getByRole('switch', { name: 'Pre-check' })).toBeDisabled()
    await expect(sec(page).getByRole('switch', { name: 'Write gate' })).toBeDisabled()
  })
})

test('a Claude-only person: opening the editor reads no decisions catalogue and sends nothing to OpenRouter', async ({ page }) => {
  const or = await mockOpenRouter(page.context(), {})
  await mockClaudeScript(page.context(), [])
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  await jevAgent(page, { review: null })
  await openEditor(page)
  await expect(sec(page).getByRole('switch', { name: 'Pre-check' })).toHaveAttribute('aria-checked', 'false')
  await expect(sec(page).getByTestId('jev-noroute')).toHaveText('Needs OpenRouter — set it up in AI setup.')
  await page.waitForTimeout(500)
  expect(or.requests.length).toBe(0)
})

test.describe('section 06 at 390 px, by touch (J11)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('the rows stack, nothing scrolls sideways; a tap switches the pre-check on and the threshold keys step', async ({ page }) => {
    await jevSetup(page)
    await jevAgent(page, { review: null, write: 'apply' })
    await openEditor(page)
    await sec(page).getByRole('switch', { name: 'Pre-check' }).tap()
    await expect(sec(page).getByRole('switch', { name: 'Pre-check' })).toHaveAttribute('aria-checked', 'true')
    await sec(page).getByTestId('jev-mark').getByRole('button', { name: /higher/ }).tap()
    await expect(sec(page).getByTestId('jev-mark').getByRole('spinbutton')).toHaveAttribute('aria-valuenow', '0.75')
    await sec(page).getByRole('switch', { name: 'Write gate' }).tap()
    await expect(sec(page).getByTestId('jev-allow')).toBeVisible()
    const wide = await page.evaluate(() => {
      const el = document.querySelector('.agx-editor .modal__body, .agx-editor') as HTMLElement
      return { sw: el.scrollWidth, cw: el.clientWidth, doc: document.documentElement.scrollWidth }
    })
    expect(wide.sw).toBeLessThanOrEqual(wide.cw + 1)
    expect(wide.doc).toBeLessThanOrEqual(390)
  })
})

test.describe('the changelog’s "Try it" (J15)', () => {
  const help = (page: Page) => page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
  async function tryIt(page: Page) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('?')
    await expect(help(page).locator('.help-scroll')).toBeVisible()
    // the help opens where it was left: back to its home first
    if (!(await help(page).getByTestId('help-news').count())) await help(page).getByRole('navigation', { name: /Breadcrumbs|Pfad/ }).getByRole('button').first().click()
    await help(page).getByTestId('help-news').getByRole('button', { name: /What’s new/ }).click()
    await help(page).locator('.cl-row[data-entry="2026-10-13-agent-precheck"]').click()
    await help(page).locator('article[data-entry="2026-10-13-agent-precheck"]').getByRole('button', { name: 'Open an agent’s Check section' }).click()
  }

  test('opens the first agent’s editor at section 06 with the focus on the pre-check (control: no agent → the gallery)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    await openApp(page)
    await tryIt(page)
    await expect(page).toHaveURL(/#\/agents$/)
    await expect(editor(page)).toHaveCount(0)
    await jevSetup(page)
    await jevAgent(page, { review: null })
    await page.evaluate(() => (window.location.hash = '#/'))
    await tryIt(page)
    await expect(page).toHaveURL(new RegExp(`#/agents/${AGENT}$`))
    await expect(sec(page).getByRole('switch', { name: 'Pre-check' })).toBeFocused()
    await expect(sec(page).getByRole('switch', { name: 'Pre-check' })).toBeInViewport()
  })
})
