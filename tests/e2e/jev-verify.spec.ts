/**
 * "Belegt?" (slice SJ, J13): Jev checks an answer of the help's Ask against the articles it was built from. Off by
 * default — then nothing goes to the decisions surface (control: switched on → exactly one request, and the "goes to"
 * line names Jev before the first send). The line under the answer: NOT SUPPORTED (amber) · "the answer says: not in the
 * sources" · a dim line without a number — never a stamp. "Ask more thoroughly (R)" asks once more on the deep role, only
 * on the person's press. Mocked hosts only.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, mockClaude, createPage, gotoPage, editorOf, doc, para } from './fixtures'
import { mockOpenRouter, seedEndpoints, type DecideStep, type DecideStepFn } from './helpers/providers'
import { aiPanel } from './helpers/aiFlows'
import { JEV, OR_KEY } from './helpers/jev'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'

const panel = (page: Page) => page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
const choice = (c: string): DecideStep => ({ answers: { support: { type: 'choice', choice: c, confidence: 0.91, probabilities: { [c]: 0.91 } } } })

async function setup(page: Page, o: { verify: boolean; support?: string; decisions?: DecideStepFn[] }) {
  const or = await mockOpenRouter(page.context(), { decisionsFallback: choice(o.support ?? 'supported'), ...(o.decisions ? { decisions: o.decisions } : {}) })
  const bodies = await mockClaude(page.context(), () => 'Open **Share**, switch on **Protect with password** — see [Share links](help:share-links).')
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { routes: { gate: [{ p: 'openrouter', m: a.jev }] }, ...(a.verify ? { jev: { verify: true } } : {}) } }), { key: OR_KEY, jev: JEV, verify: o.verify })
  await wsEval(page, (s) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript'] } }, restricted: [] } }))
  await seedEndpoints(page, { [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }] })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('?')
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('tab', { name: /Ask/ }).click()
  return { or, bodies }
}

const askIt = async (page: Page) => {
  const field = panel(page).getByRole('textbox', { name: 'Your question' })
  await field.fill('How do I protect a share link with a password?')
  await field.press('Enter')
  await expect(panel(page).locator('.help-ask__out')).toContainText('Protect with password')
}

test.describe('"Belegt?" under the help’s answers (J13)', () => {
  test('off by default: no line, zero decision requests (control: on → the goes-to line names Jev before the first send, then exactly one request with the question, the articles and the answer)', async ({ page }) => {
    const off = await setup(page, { verify: false })
    await expect(panel(page).getByTestId('help-jev-goes')).toHaveCount(0)
    await askIt(page)
    await page.waitForTimeout(600)
    expect(off.or.decisions()).toHaveLength(0)
    await expect(panel(page).getByTestId('jev-sup')).toHaveCount(0)
    // control: switched on
    await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, jev: { verify: true } } }))
    await expect(panel(page).getByTestId('help-jev-goes')).toHaveText('+ Jev checks sources (TypeSafe via OpenRouter)')
    await askIt(page)
    await expect.poll(() => off.or.decisions().length).toBe(1)
    const body = off.or.decisions()[0]!.body!
    expect(body.model).toBe(JEV)
    expect(Object.keys(body.state)).toEqual(['question', 'sources', 'answer'])
    expect(body.state.question).toBe('How do I protect a share link with a password?')
    expect(JSON.stringify(body.state.sources)).toContain('Share links')
    expect(body.state.answer).toContain('Protect with password')
    expect(body.questions.support.type).toBe('choice')
    expect(Object.keys(body.questions.support.criteria)).toEqual(['supported', 'unsupported', 'declined'])
    // supported: a dim line, no number, no stamp
    const line = panel(page).getByTestId('jev-sup')
    await expect(line).toHaveAttribute('data-state', 'supported')
    await expect(line).toHaveText('Jev: no statement without a source found')
    await expect(line).not.toContainText('0.91')
  })

  test('NOT SUPPORTED: the amber cap and what Jev found; R asks once more on the deep role — never by itself', async ({ page }) => {
    const w = await setup(page, { verify: true, support: 'unsupported' })
    // the answer on the standard model (the deep one has nothing deeper to offer)
    await wsEval(page, (s) => s.updateSettings({ aiModel: 'claude-sonnet-5-5' }))
    await askIt(page)
    const line = panel(page).getByTestId('jev-sup')
    await expect(line).toHaveAttribute('data-state', 'unsupported')
    await expect(line.locator('.jev-cap')).toHaveText('NOT SUPPORTED')
    await expect(line).toContainText('Jev finds statements that are not in the sources')
    // nothing happens by itself
    await page.waitForTimeout(800)
    expect(w.bodies).toHaveLength(1)
    expect(JSON.parse(w.bodies[0]!).model).toMatch(/sonnet/)
    await expect(line.getByTestId('jev-deeper')).toHaveText(/Ask more thoroughly/)
    // R (focus outside the field): exactly one more chat request, on the deep role
    await panel(page).locator('.help-ask__out').click()
    await page.keyboard.press('r')
    await expect.poll(() => w.bodies.length).toBe(2)
    const first = JSON.parse(w.bodies[0]!).model as string
    const second = JSON.parse(w.bodies[1]!).model as string
    expect(second).not.toBe(first)
    expect(second).toMatch(/opus/)
    await page.waitForTimeout(500)
    expect(w.bodies).toHaveLength(2)
  })

  test('declined: neutral "the answer says: not in the sources"; a refused check (no key) is a dim note, no line of findings', async ({ page }) => {
    const w = await setup(page, { verify: true, support: 'declined' })
    await askIt(page)
    await expect(panel(page).getByTestId('jev-sup')).toHaveAttribute('data-state', 'declined')
    await expect(panel(page).getByTestId('jev-sup')).toHaveText('The answer says: not in the sources')
    expect(w.or.decisions()).toHaveLength(1)
    // without an OpenRouter key: not checked, nothing sent
    await wsEval(page, (s) => s.updateSettings({ aiKeys: { openrouter: '' } }))
    await askIt(page)
    await expect(panel(page).getByTestId('jev-sup')).toHaveAttribute('data-state', 'skipped')
    await expect(panel(page).getByTestId('jev-sup')).toContainText('Jev: not checked —')
    expect(w.or.decisions()).toHaveLength(1)
  })
})

test.describe('"Belegt?" — the line’s keys, its live region, a Vorprüfer that went (review)', () => {
  test('R belongs to the help panel: with the focus on the page behind it, R asks nothing (control: inside the panel it asks once)', async ({ page }) => {
    const w = await setup(page, { verify: true, support: 'unsupported' })
    await wsEval(page, (s) => s.updateSettings({ aiModel: 'claude-sonnet-5-5' }))
    await askIt(page)
    await expect(panel(page).getByTestId('jev-sup')).toHaveAttribute('data-state', 'unsupported')
    // the focus on the page's main region (outside the panel): R is the page's, not the line's
    await page.evaluate(() => (document.querySelector('#main, main[tabindex], .stage-col[tabindex]') as HTMLElement | null)?.focus())
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(false)
    await page.keyboard.press('r')
    await page.waitForTimeout(600)
    expect(w.bodies).toHaveLength(1)
    // control: inside the panel
    await panel(page).locator('.help-ask__out').click()
    await page.keyboard.press('r')
    await expect.poll(() => w.bodies.length).toBe(2)
  })

  test('after "Ask more thoroughly" the head names the deep model, and no further R is offered (it asks once more, not again)', async ({ page }) => {
    const w = await setup(page, { verify: true, support: 'unsupported' })
    await wsEval(page, (s) => s.updateSettings({ aiModel: 'claude-sonnet-5-5' }))
    await askIt(page)
    const head = panel(page).locator('.help-ask__head')
    await expect(head).toContainText(/Sonnet/)
    await panel(page).getByTestId('jev-deeper').click()
    await expect.poll(() => w.bodies.length).toBe(2)
    expect(JSON.parse(w.bodies[1]!).model).toMatch(/opus/)
    await expect(panel(page).getByTestId('jev-sup')).toHaveAttribute('data-state', 'unsupported')
    await expect(head).toContainText(/Opus/)
    await expect(head).not.toContainText(/Sonnet/)
    await expect(panel(page).getByTestId('jev-deeper')).toHaveCount(0)
    await panel(page).locator('.help-ask__out').click()
    await page.keyboard.press('r')
    await page.waitForTimeout(600)
    expect(w.bodies).toHaveLength(2)
  })

  test('the live region stands while Jev checks — the same element then says what Jev found', async ({ page }) => {
    const w = await setup(page, { verify: true, decisions: [{ hang: true, then: choice('unsupported') }] })
    await askIt(page)
    const line = panel(page).getByTestId('jev-sup')
    await expect(line).toHaveAttribute('data-state', 'checking')
    const status = line.locator('[role="status"]')
    await expect(status).toHaveCount(1)
    await status.evaluate((el) => el.setAttribute('data-e2e-mark', '1'))
    await expect.poll(() => w.or.hanging()).toBe(1)
    w.or.releaseDecisions()
    await expect(line).toHaveAttribute('data-state', 'unsupported')
    await expect(line.locator('[role="status"][data-e2e-mark="1"]')).toHaveText('Jev finds statements without a source')
  })

  test('"Sourced?" left on after the Vorprüfer went: no "goes to Jev" line, zero decision requests (control: chosen again → one)', async ({ page }) => {
    const w = await setup(page, { verify: true })
    await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, routes: {} } }))
    await expect(panel(page).getByTestId('help-jev-goes')).toHaveCount(0)
    await askIt(page)
    await page.waitForTimeout(600)
    expect(w.or.decisions()).toHaveLength(0)
    await expect(panel(page).getByTestId('jev-sup')).toHaveCount(0)
    await expect(panel(page).locator('.help-ask__head')).not.toContainText('Jev')
    // control
    await wsEval(page, (s, jev) => s.updateSettings({ ai: { ...s.settings.ai, routes: { gate: [{ p: 'openrouter', m: jev }] } } }), JEV)
    await expect(panel(page).getByTestId('help-jev-goes')).toBeVisible()
    await askIt(page)
    await expect.poll(() => w.or.decisions().length).toBe(1)
  })
})

/* Ask the workspace: "Belegt?" reads the excerpts as the answering route got them */
const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: Array<{ id: string }> }
const LUNA = 'openai/gpt-6-luna'
const WORK = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace']

async function askWorkspace(page: Page, o: { openrouter: boolean }) {
  const or = await mockOpenRouter(page.context(), { chat: [{ text: 'We launch in two weeks [[Launch plan]].' }], decisionsFallback: choice('supported') })
  const bodies = await mockClaude(page.context(), () => 'We launch in two weeks [[Launch plan]].')
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  const luna = readCatalogRow(CATALOGUE.data.find((x) => x.id === LUNA), '2026-10-12')!
  const shortlist = { m: luna.id, label: luna.label, price: luna.price, caps: capsOfRow(luna), at: '2026-10-12' }
  // the workspace's "Work data" preset: no names, no transcripts for OpenRouter
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { models: [a.row], routes: { gate: [{ p: 'openrouter', m: a.jev }], ...(a.openrouter ? { workspace: [{ p: 'openrouter', m: a.luna }] } : {}) }, jev: { verify: true } } }), { key: OR_KEY, jev: JEV, row: shortlist, luna: LUNA, openrouter: o.openrouter })
  await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow } }, restricted: [] } }), WORK)
  await seedEndpoints(page, { [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }], [LUNA]: [{ tag: 'nordwind', name: 'Nordwind' }] })
  const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.'), para('')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  const ask = page.getByPlaceholder('Ask AI to write anything…')
  await expect(async () => {
    await ed.locator('p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Space')
    try {
      await expect(ask).toBeFocused({ timeout: 2000 })
    } catch (e) {
      if (!(await ask.count())) await page.keyboard.press('Backspace')
      throw e
    }
  }).toPass({ timeout: 15_000 })
  await aiPanel(page).getByRole('option', { name: /Ask your workspace/ }).click()
  await page.keyboard.type('When do we launch?')
  await page.keyboard.press('Enter')
  await expect(aiPanel(page)).toContainText('We launch in two weeks')
  return { or, bodies }
}

test.describe('"Belegt?" under Ask the workspace (review)', () => {
  test('answered on OpenRouter under "Work data": the excerpts went through OpenRouter’s rule — exactly one decision request', async ({ page }) => {
    const { or, bodies } = await askWorkspace(page, { openrouter: true })
    await expect.poll(() => or.posts().length).toBe(1)
    expect(bodies).toHaveLength(0)
    await expect.poll(() => or.decisions().length).toBe(1)
    await expect(aiPanel(page).getByTestId('jev-sup')).toHaveAttribute('data-state', 'supported')
  })

  test('control: answered by Claude (nothing redacted for OpenRouter) → refused, nothing sent to Jev', async ({ page }) => {
    const { or, bodies } = await askWorkspace(page, { openrouter: false })
    expect(bodies.length).toBeGreaterThan(0)
    await expect(aiPanel(page).getByTestId('jev-sup')).toHaveAttribute('data-state', 'skipped')
    expect(or.decisions()).toHaveLength(0)
  })
})
