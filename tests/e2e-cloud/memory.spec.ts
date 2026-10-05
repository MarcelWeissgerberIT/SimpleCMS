/**
 * The One memory in a TEAM workspace (features/ai/memory), against the real server: the memory database and
 * its log are created in the member's Private section and never reach a teammate. No Claude request is
 * made (/remember is the person's own words; api.anthropic.com is never called).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, waitOnline, createWorkspace, join } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

test('team workspace: the memory and its log are PRIVATE — a teammate never sees them', async ({ page: a, context }) => {
  watch(a, 'ada')
  await a.route('https://api.anthropic.com/**', (route) => route.abort())
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Memory team')
  const b = await newPerson(context)
  watch(b, 'bob')
  await signIn(b, email('bob'))
  await join(a, b, wsId, 'member')
  await openApp(a, wsId)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)

  // Ada: /remember in the AI terminal → y — the memory is created on this first confirmed memory
  await a.keyboard.press('Control+j')
  const input = a.locator('.term-prompt__input')
  await input.fill('/remember The Q4 budget is confidential until the board meeting')
  await input.press('Enter')
  const card = a.getByTestId('term-memory').last()
  await expect(card).toContainText('REMEMBER? · 1')
  await input.press('Tab')
  await a.keyboard.press('y')
  await expect(card.locator('.term-change')).toHaveAttribute('data-status', 'saved')

  const info = await wsEval(a, (s) => {
    const dbs = (Object.values(s.databases) as AnyState[]).filter((d) => d.system === 'memory' || d.system === 'memory-log')
    return dbs.map((d) => ({
      system: d.system,
      private: !!s.pages[d.id]?.private,
      parent: s.pages[d.id]?.parentId ?? null,
      rows: (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === d.id).map((p) => ({ title: p.title, private: !!p.private })),
    }))
  })
  expect(info).toEqual(
    expect.arrayContaining([
      { system: 'memory', private: true, parent: null, rows: [{ title: 'The Q4 budget is confidential until the board meeting', private: true }] },
      { system: 'memory-log', private: true, parent: null, rows: [] },
    ]),
  )
  await expect(a.getByTestId('private-section').locator('.sb-row__title', { hasText: 'One memory' })).toBeVisible()

  // Bob: a later shared page arrives (sync barrier) — the memory never does
  const barrier = await wsEval(a, (s) => s.createPage({ title: 'Barrier after memory' }))
  await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.title ?? null, barrier), { timeout: 15_000 }).toBe('Barrier after memory')
  expect(await wsEval(b, (s) => (Object.values(s.databases) as AnyState[]).some((d) => d.system === 'memory' || d.system === 'memory-log'))).toBe(false)
  expect(await wsEval(b, (s) => JSON.stringify((Object.values(s.pages) as AnyState[]).map((p) => p.title)).includes('Q4 budget'))).toBe(false)

  // the markers come back after a reload (read from the workspace's documents)
  await a.reload()
  await openApp(a, wsId)
  await waitOnline(a)
  await expect
    .poll(() => wsEval(a, (s) => (Object.values(s.databases) as AnyState[]).filter((d) => d.system).map((d) => `${d.system}:${s.pages[d.id]?.private ? 'private' : 'shared'}`).sort()), { timeout: 15_000 })
    .toEqual(['memory-log:private', 'memory:private'])
})
