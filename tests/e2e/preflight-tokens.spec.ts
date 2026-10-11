/**
 * Preflight costs no tokens (T-P2-14, G3 — the runtime half of T-P1-6's static guard): with a Claude key set and every
 * request to the Claude API counted, the P2 story (every lamp lit, read, acknowledged), its queue (cards prepared, one
 * applied, Undo), a minute's tick and an idle while make 0 requests. Every name is fictional; the API is never reached.
 */
import { test, expect, openApp, wsEval } from './fixtures'
import { flushLamps, seedMorning, waitPreflight } from './helpers/preflightStory.mjs'

test('the story, its queue, a minute on and idle: no request to Claude', async ({ page, context }) => {
  test.setTimeout(120_000)
  await page.clock.install()
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  // registered last: it answers first — every request to the Claude API counted (and refused)
  const asked: string[] = []
  await context.route(/^https:\/\/api\.anthropic\.com\//, (r) => {
    asked.push(r.request().url())
    return r.abort()
  })
  await openApp(page)
  await waitPreflight(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

  await seedMorning(page)
  await expect(page.locator('.pf-cap[data-lamp="proposals"]')).toHaveAttribute('data-lit', /amber|red/)
  // the queue: cards prepared one after another, one applied, its Undo
  await page.locator('.pf-cap[data-lamp="proposals"]').focus()
  await page.keyboard.press('Enter')
  const card = page.locator('.pf-q article.pf-card[data-current]')
  await expect(card).toBeFocused()
  for (let i = 0; i < 4; i++) {
    await expect(card).not.toHaveAttribute('aria-busy', 'true')
    await page.keyboard.press('j')
  }
  await page.keyboard.press('k')
  await expect(card).not.toHaveAttribute('aria-busy', 'true')
  await page.keyboard.press('a')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __onePreflight: { stores: { queue: { getState: () => { done: unknown[] } } } } }).__onePreflight.stores.queue.getState().done.length)).toBe(1)
  await page.keyboard.press('z')
  // the gate's cards (the terminal's planner reads the task, no request) and every lamp acknowledged
  await page.locator('.pf-cap[data-lamp="gate"]').focus()
  await page.keyboard.press('Enter')
  await expect(card).not.toHaveAttribute('aria-busy', 'true')
  await page.getByTestId('pf-mc').click()
  // a minute on (the minute tick reads the token lamp again), then idle
  await page.clock.fastForward('01:05')
  await flushLamps(page)
  await page.clock.fastForward('00:30')
  await page.waitForTimeout(2000)
  expect(asked, 'requests to the Claude API').toEqual([])
})
