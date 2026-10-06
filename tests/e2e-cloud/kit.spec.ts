/**
 * Building blocks in a team workspace (meta maps `lists`, `propTypes`, `recordTypes`): a list Ada saves
 * reaches Bob together with the options of a bound property; a record type and a row's type travel too.
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

test.describe('team cloud — building blocks', () => {
  test('lists, record types and a row’s type reach the teammate; bound options follow', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Kit')
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
      s.upsertList({ id: 'states', name: 'Federal states', items: [{ id: 'by', name: 'Bayern', color: 'blue' }], createdAt: 0, updatedAt: 0 })
      s.upsertRecordType({ id: 'lead', name: 'Lead', properties: [{ id: 'st', name: 'State', type: 'select', listId: 'states' }], createdAt: 0, updatedAt: 0 })
      const dbId = s.createDatabase({ title: 'Leads', parentId: null })
      const row = s.createRow(dbId, { title: 'ACME' })
      st().setRecordType(row, 'lead')
      return { dbId, row }
    })
    await expect.poll(() => wsEval(b, () => Object.keys(st().kit?.lists ?? {}).join()), { timeout: 20_000 }).toBe('states')
    await expect.poll(() => wsEval(b, (_s, r) => st().pages[r.row]?.recordType ?? null, ids), { timeout: 20_000 }).toBe('lead')
    const stamp = await wsEval(b, () => ({ by: st().kit.recordTypes.lead?.createdBy ?? null, name: st().kit.recordTypes.lead?.name }))
    expect(stamp.name).toBe('Lead')
    expect(stamp.by).toBeTruthy()

    // Bob adds an item: Ada's bound property gets it as an option
    await wsEval(b, () => {
      const l = st().kit.lists.states
      st().upsertList({ ...l, items: [...l.items, { id: 'be', name: 'Berlin', color: 'red' }] })
    })
    const optionsAt = (p: Page) =>
      wsEval(p, (_s, r) => (st().databases[r.dbId]?.properties.find((d: { fromType?: { prop: string } }) => d.fromType?.prop === 'st')?.options ?? []).map((o: { name: string }) => o.name).join(), ids)
    await expect.poll(() => optionsAt(a), { timeout: 20_000 }).toBe('Bayern,Berlin')
    await expect.poll(() => optionsAt(b), { timeout: 20_000 }).toBe('Bayern,Berlin')
  })
})
