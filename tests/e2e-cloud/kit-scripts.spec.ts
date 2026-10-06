/**
 * Building blocks in a team workspace — the trust rule of own types' scripts: Ada's format script runs at
 * Ada (she saved it); at Bob it does not run (the cell shows the stored value and a REVIEW chip) until he
 * reads the code and confirms it; a changed version needs his confirmation again.
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

const fresh = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as { st: () => unknown; __one: { workspace: { getState: () => unknown } } }
    w.st = () => w.__one.workspace.getState()
  })
declare const st: () => any // eslint-disable-line @typescript-eslint/no-explicit-any

/** A database page (no editor to wait for: its table). */
async function gotoPage(p: Page, id: string): Promise<void> {
  await p.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  await expect(p.locator('#main section.db').first()).toBeVisible()
}

const firstCell = (p: Page) => p.locator('#main section.db [role="gridcell"][data-cell="0:1"]')

test.describe('team cloud — own types’ scripts', () => {
  test('Ada’s format script runs at Bob only after he confirms it; a changed version asks again', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Scripts')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    for (const p of [a, b]) {
      await openApp(p, wsId)
      await waitOnline(p)
      await fresh(p)
    }

    // Ada saves the type through the editor (this device: trusted), then a database uses it
    await a.evaluate(() => (window.location.hash = '#/kit/types'))
    await a.getByTestId('kt-new').click()
    await a.getByRole('menuitem', { name: 'Text', exact: true }).click()
    await a.getByTestId('kt-type-editor').waitFor()
    const name = a.getByTestId('kt-name')
    await name.fill('Code')
    await name.press('Enter')
    await a.getByTestId('kt-binding-format').click()
    await a.locator('.kt-code textarea').fill('upper(text(value))')
    await a.getByTestId('kt-save').click()
    const typeId = await wsEval(a, () => (Object.values(st().kit.propTypes) as Array<{ id: string; name: string }>).find((t) => t.name === 'Code')!.id)
    const dbId = await wsEval(a, (_s, typeId) => {
      const s = st()
      const dbId = s.createDatabase({ title: 'Codes', parentId: null })
      const propId = s.addProperty(dbId, { type: 'text', name: 'Code', custom: typeId })
      const d = st().databases[dbId]
      const title = d.properties.find((p: { type: string }) => p.type === 'title').id
      s.updateView(dbId, d.views[0].id, { visibleProperties: [title, propId] })
      s.createRow(dbId, { title: 'First', properties: { [propId]: 'abc-1' } })
      return dbId
    }, typeId)
    await gotoPage(a, dbId)
    await expect(firstCell(a)).toContainText('ABC-1')
    await expect(firstCell(a).getByTestId('kt-review-chip')).toHaveCount(0)

    // Bob: the stored value and a review chip — the script did not run
    await expect.poll(() => wsEval(b, (_s, id) => !!st().kit?.propTypes?.[id]?.scripts?.format, typeId), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => wsEval(b, (_s, id) => Object.values(st().pages).some((p: any) => p.databaseId === id), dbId), { timeout: 20_000 }).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
    await gotoPage(b, dbId)
    await expect(firstCell(b)).toContainText('abc-1')
    await expect(firstCell(b).getByTestId('kt-review-chip')).toBeVisible()
    // review → the exact code → Confirm
    await firstCell(b).getByTestId('kt-review-chip').click()
    await expect(b.getByRole('dialog')).toContainText('upper(text(value))')
    await b.getByTestId('kt-trust-confirm').click()
    await expect(firstCell(b)).toContainText('ABC-1')
    await expect(firstCell(b).getByTestId('kt-review-chip')).toHaveCount(0)

    // Ada changes the code in the editor: Bob is asked again, the new version does not run meanwhile
    await a.evaluate((id) => (window.location.hash = `#/kit/types/${id}`), typeId)
    await a.getByTestId('kt-binding-format').click()
    await a.locator('.kt-code textarea').fill('"#" + upper(text(value))')
    await a.getByTestId('kt-save').click()
    await gotoPage(a, dbId)
    await expect(firstCell(a)).toContainText('#ABC-1')
    await expect(firstCell(b).getByTestId('kt-review-chip')).toBeVisible({ timeout: 20_000 })
    await expect(firstCell(b)).toContainText('abc-1')
    await expect(firstCell(b)).not.toContainText('#ABC-1')
  })
})
