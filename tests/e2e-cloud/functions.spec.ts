/**
 * Custom functions in a team workspace (meta document map `functions`): one Ada builds is usable
 * by Bob in his database formulas, an edit by Bob reaches Ada, and a viewer can only look (the
 * builder is read-only, a store write is put back).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, waitOnline, createWorkspace, join as joinWorkspace } from './fixtures'

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

const TRIPLE = {
  id: 'fn-triple',
  name: 'TRIPLE',
  description: 'x × 3',
  params: [{ name: 'x', type: 'number' }],
  body: {
    k: 'call',
    fn: '*',
    args: [
      { k: 'param', name: 'x' },
      { k: 'num', v: 3 },
    ],
  },
  createdAt: 1,
  updatedAt: 1,
}

const fx = (p: Page) => p.getByRole('dialog', { name: 'Functions' })
const openBuilder = (p: Page) => p.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'functions' })) // eslint-disable-line @typescript-eslint/no-explicit-any
const bodyOf = (p: Page) => wsEval(p, (s) => JSON.stringify(s.functions?.['fn-triple']?.body ?? null))

test.describe('team cloud — custom functions', () => {
  test('Ada’s function is usable by Bob, his edit reaches her, a viewer only looks', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Numbers')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    const c = await newPerson(context)
    watch(c, 'cleo')
    await signIn(c, email('cleo'))
    await joinWorkspace(a, c, wsId, 'viewer')
    for (const p of [a, b, c]) {
      await openApp(p, wsId)
      await waitOnline(p)
    }

    await wsEval(a, (s, fn) => s.upsertFunction(fn), TRIPLE)
    await expect.poll(() => wsEval(b, (s) => s.functions?.['fn-triple']?.name ?? null), { timeout: 20_000 }).toBe('TRIPLE')
    await expect.poll(() => wsEval(c, (s) => s.functions?.['fn-triple']?.name ?? null), { timeout: 20_000 }).toBe('TRIPLE')

    // Bob uses it in a database formula
    const db = await wsEval(b, (s) => {
      const db = s.createDatabase({
        title: 'Numbers',
        properties: [
          { id: 'nName', name: 'Name', type: 'title' },
          { id: 'nN', name: 'N', type: 'number' },
          { id: 'nOut', name: 'Out', type: 'formula', formula: 'TRIPLE(prop("N"))' },
        ],
      })
      s.createRow(db, { title: 'Seven', properties: { nN: 7 } })
      return db as string
    })
    await b.evaluate((id) => (window.location.hash = `#/p/${id}`), db)
    const cell = b.locator('#main section.db .dbt-body .dbt-row[role="row"]', { has: b.locator('.dbt-cell--title', { hasText: 'Seven' }) })
    await expect(cell).toContainText('21')

    // Bob edits the function in the builder (3 → 4): Ada gets it, his formula follows
    await openBuilder(b)
    await fx(b).locator('[data-path="1"]').click()
    await b.locator('.fx-menu').getByRole('textbox', { name: 'Value' }).fill('4')
    await b.keyboard.press('Enter')
    await fx(b).locator('[data-save]').click()
    await expect(fx(b).locator('[data-save]')).toBeDisabled()
    await b.keyboard.press('Escape')
    await expect(cell).toContainText('28')
    await expect.poll(() => bodyOf(a), { timeout: 20_000 }).toContain('"v":4')

    // the viewer: read-only builder, and a direct store write is put back
    await openBuilder(c)
    await expect(fx(c).getByText('View only — you can try functions')).toBeVisible()
    await expect(fx(c).getByRole('textbox', { name: 'Function name' })).toBeDisabled()
    await expect(fx(c).locator('[data-save]')).toHaveCount(0)
    await expect(fx(c).locator('[data-new-function]')).toHaveCount(0)
    await fx(c).locator('[data-sample="x"]').fill('5')
    await expect(fx(c).getByTestId('fx-result')).toHaveText('20')
    await c.keyboard.press('Escape')
    await wsEval(c, (s) => s.deleteFunction('fn-triple'))
    await expect.poll(() => wsEval(c, (s) => s.functions?.['fn-triple']?.name ?? null), { timeout: 10_000 }).toBe('TRIPLE')
    expect(await wsEval(a, (s) => s.functions?.['fn-triple']?.name ?? null)).toBe('TRIPLE')
  })
})
