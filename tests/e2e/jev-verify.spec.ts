/**
 * "Belegt?" (slice SJ, J13): Jev checks an answer of the help's Ask against the articles it was built from. Off by
 * default — then nothing goes to the decisions surface (control: switched on → exactly one request, and the "goes to"
 * line names Jev before the first send). The line under the answer: NOT SUPPORTED (amber) · "the answer says: not in the
 * sources" · a dim line without a number — never a stamp. "Ask more thoroughly (R)" asks once more on the deep role, only
 * on the person's press. Mocked hosts only.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, mockClaude } from './fixtures'
import { mockOpenRouter, seedEndpoints, type DecideStep } from './helpers/providers'
import { JEV, OR_KEY } from './helpers/jev'

const panel = (page: Page) => page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
const choice = (c: string): DecideStep => ({ answers: { support: { type: 'choice', choice: c, confidence: 0.91, probabilities: { [c]: 0.91 } } } })

async function setup(page: Page, o: { verify: boolean; support?: string }) {
  const or = await mockOpenRouter(page.context(), { decisionsFallback: choice(o.support ?? 'supported') })
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
