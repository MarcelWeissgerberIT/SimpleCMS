/**
 * A free board in a team workspace: Ada builds one with two record types (lanes, typed cards with their own
 * fields); Bob sees the lanes, the cards and their fields, and moves a card — Ada sees it move.
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

test.describe('team cloud — free board', () => {
  test('Ada builds a free board with two record types; Bob sees lanes, cards and fields and moves a card', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Board')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    for (const p of [a, b]) {
      await openApp(p, wsId)
      await waitOnline(p)
      await fresh(p)
    }

    const ids = await wsEval(a, () => {
      const s = st()
      s.upsertRecordType({ id: 'lead', name: 'Lead', color: 'orange', properties: [{ id: 'mail', name: 'Email', type: 'email' }], createdAt: 0, updatedAt: 0 })
      s.upsertRecordType({ id: 'bug', name: 'Bug', color: 'red', properties: [{ id: 'area', name: 'Area', type: 'text' }], createdAt: 0, updatedAt: 0 })
      const lane = { id: 'fbl', name: 'Lane', type: 'select', options: [{ id: 'l1', name: 'Inbox', color: 'gray' }, { id: 'l2', name: 'Doing', color: 'orange' }] }
      const dbId = s.createDatabase({
        title: 'Team board',
        parentId: null,
        properties: [{ id: 'fbt', name: 'Name', type: 'title' }, lane],
        views: [{ id: 'fbv', name: 'Free board', type: 'board', free: true, groupBy: 'fbl', filter: null, sorts: [], visibleProperties: [], openIn: 'peek', hiddenGroups: [] }],
      })
      st().attachRecordType(dbId, 'lead')
      st().attachRecordType(dbId, 'bug')
      const prop = (name: string) => st().databases[dbId].properties.find((x: { name: string }) => x.name === name).id
      const acme = st().createRow(dbId, { title: 'ACME', properties: { fbl: 'l1' } })
      st().setRecordType(acme, 'lead')
      st().setRowProperty(acme, prop('Email'), 'buy@acme.test')
      const bug = st().createRow(dbId, { title: 'Login loops', properties: { fbl: 'l1' } })
      st().setRecordType(bug, 'bug')
      st().setRowProperty(bug, prop('Area'), 'Auth')
      return { dbId, acme, bug }
    })

    // Bob: the board with its lanes, the cards with their own fields
    await expect.poll(() => wsEval(b, (_s, r) => st().pages[r.bug]?.recordType ?? null, ids), { timeout: 20_000 }).toBe('bug')
    await b.evaluate((id) => (window.location.hash = `#/p/${id}`), ids.dbId)
    await expect(b.locator('.fb-lanehead')).toHaveCount(2, { timeout: 20_000 })
    const bobCard = (title: string) => b.locator('.dbc', { hasText: title })
    await expect(bobCard('ACME').locator('.fb-card__type')).toContainText('Lead', { timeout: 20_000 })
    await expect(bobCard('ACME').locator('.fb-card__fields')).toContainText('buy@acme.test')
    await expect(bobCard('Login loops').locator('.fb-card__fields')).toContainText('Auth')
    await expect(bobCard('Login loops').locator('.fb-card__fields')).not.toContainText('Email')

    // Bob moves the bug to Doing (the card's menu); Ada sees it there
    await bobCard('Login loops').click({ button: 'right' })
    await b.getByRole('menuitem', { name: 'Move to lane' }).click()
    await b.getByRole('menuitem', { name: 'Doing' }).click()
    await expect.poll(() => wsEval(a, (_s, r) => st().pages[r.bug]?.properties.fbl ?? null, ids), { timeout: 20_000 }).toBe('l2')
    await a.evaluate((id) => (window.location.hash = `#/p/${id}`), ids.dbId)
    await expect(a.locator('.dbb-col', { has: a.locator('.fb-lanehead', { hasText: 'Doing' }) }).locator('.dbc', { hasText: 'Login loops' })).toBeVisible({ timeout: 20_000 })
  })
})
