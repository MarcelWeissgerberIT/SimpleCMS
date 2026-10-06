/**
 * Building blocks (Workspace.kit) — the store contract: shared lists keep bound properties in step, record
 * types bring their properties into the databases holding them (never into a locked one), removing a block
 * never drops values, everything is sanitized and survives a reload.
 */
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'

// inside wsEval: `s` is the state when the call started — read fresh state after actions with `st()`
declare const st: () => any // eslint-disable-line @typescript-eslint/no-explicit-any

async function open(page: import('@playwright/test').Page, reload = false): Promise<void> {
  if (reload) await reloadApp(page)
  else await openApp(page)
  await page.evaluate(() => {
    const w = window as unknown as { st: () => unknown; __one: { workspace: { getState: () => unknown } } }
    w.st = () => w.__one.workspace.getState()
  })
}

const ITEMS = [
  { id: 'by', name: 'Bayern', color: 'blue' },
  { id: 'be', name: 'Berlin', color: 'red' },
]

test.describe('building blocks — store', () => {
  test('lists: bound select options follow the list; deleting the list unbinds, values stay', async ({ page }) => {
    await open(page)
    const { dbId, propId, rowId } = await wsEval(
      page,
      (s, items) => {
        s.upsertList({ id: 'states', name: 'Federal states', items, createdAt: 0, updatedAt: 0 })
        const dbId = s.createDatabase({ title: 'Branches', parentId: null })
        const propId = s.addProperty(dbId, { type: 'select', name: 'State', listId: 'states', options: [] })
        s.upsertList({ ...st().kit.lists.states, items: [...items, { id: 'hh', name: 'Hamburg', color: 'green' }] })
        const rowId = s.createRow(dbId, { title: 'North', properties: { [propId]: 'hh' } })
        return { dbId, propId, rowId }
      },
      ITEMS,
    )
    const opts = await wsEval(page, (s, a) => st().databases[a.dbId].properties.find((p: { id: string }) => p.id === a.propId).options.map((o: { name: string }) => o.name), { dbId, propId })
    expect(opts).toEqual(['Bayern', 'Berlin', 'Hamburg'])
    // the saver is stamped, the times set; unknown fields and bad items are dropped
    const list = await wsEval(page, (s) => {
      s.upsertList({ id: 'states', name: '  Federal\nstates ', items: [...st().kit.lists.states.items, { id: 'x y', name: 'bad id' }, { id: 'nn', name: '' }], evil: 1, createdAt: 5, updatedAt: 0 })
      return JSON.parse(JSON.stringify(st().kit.lists.states))
    })
    expect(list.name).toBe('Federal states')
    expect(list.items.map((o: { id: string }) => o.id)).toEqual(['by', 'be', 'hh'])
    expect(list.evil).toBeUndefined()
    expect(list.updatedAt).toBeGreaterThan(0)
    // removing the list: the property keeps its options and the row its value
    const after = await wsEval(page, (s, a) => {
      s.deleteList('states')
      const def = st().databases[a.dbId].properties.find((p: { id: string }) => p.id === a.propId)
      return { listId: def.listId ?? null, n: def.options.length, value: st().pages[a.rowId].properties[a.propId], left: Object.keys(st().kit.lists).length }
    }, { dbId, propId, rowId })
    expect(after).toEqual({ listId: null, n: 3, value: 'hh', left: 0 })
  })

  test('record types: attach adds linked properties to every view; edits follow; locked databases stay; rows keep values', async ({ page }) => {
    await open(page)
    const r = await wsEval(page, (s) => {
      s.upsertList({ id: 'prio', name: 'Priority', items: [{ id: 'a', name: 'A', color: 'red' }, { id: 'b', name: 'B', color: 'gray' }], createdAt: 0, updatedAt: 0 })
      s.upsertRecordType({
        id: 'lead',
        name: 'Lead',
        color: 'orange',
        properties: [
          { id: 'mail', name: 'Mail', type: 'email' },
          { id: 'prio', name: 'Priority', type: 'select', listId: 'prio' },
          { id: 'bad', name: 'Total', type: 'formula' },
        ],
        createdAt: 0,
        updatedAt: 0,
      })
      const dbId = s.createDatabase({ title: 'Board', parentId: null })
      const locked = s.createDatabase({ title: 'Locked', parentId: null })
      s.updateDatabase(locked, { locked: true })
      const lockedBefore = st().databases[locked].properties.length
      const ok = s.attachRecordType(dbId, 'lead')
      const refused = s.attachRecordType(locked, 'lead')
      const row = s.createRow(dbId, { title: 'ACME' })
      const typed = s.setRecordType(row, 'lead')
      const lockedRow = s.createRow(locked, { title: 'Nope' })
      const typedLocked = s.setRecordType(lockedRow, 'lead')
      const db = st().databases[dbId]
      const linked = db.properties.filter((p: { fromType?: unknown }) => p.fromType)
      return {
        dbId,
        row,
        ok,
        refused,
        typed,
        typedLocked,
        names: linked.map((p: { name: string }) => p.name),
        prioOptions: linked.find((p: { name: string }) => p.name === 'Priority').options.map((o: { name: string }) => o.name),
        inViews: db.views.every((v: { visibleProperties: string[] }) => linked.every((p: { id: string }) => v.visibleProperties.includes(p.id))),
        holds: db.recordTypes,
        lockedProps: st().databases[locked].properties.length - lockedBefore,
        lockedLinked: st().databases[locked].properties.filter((p: { fromType?: unknown }) => p.fromType).length,
        rowType: st().pages[row].recordType,
      }
    })
    expect(r).toMatchObject({ ok: true, refused: false, typed: true, typedLocked: false, names: ['Mail', 'Priority'], prioOptions: ['A', 'B'], inViews: true, holds: ['lead'], lockedProps: 0, lockedLinked: 0, rowType: 'lead' })

    // a rename and a new property follow into the database; a removed one stays, unlinked, with its values
    const after = await wsEval(page, (s, a) => {
      const mailId = st().databases[a.dbId].properties.find((p: { name: string }) => p.name === 'Mail').id
      s.setRowProperty(a.row, mailId, 'x@acme.test')
      const rt = st().kit.recordTypes.lead
      s.upsertRecordType({ ...rt, properties: [{ ...rt.properties[0], name: 'E-mail' }, { id: 'size', name: 'Size', type: 'number', numberFormat: 'euro' }] })
      const props = st().databases[a.dbId].properties
      return {
        names: props.map((p: { name: string }) => p.name),
        linked: props.filter((p: { fromType?: unknown }) => p.fromType).map((p: { name: string }) => p.name),
        size: props.find((p: { name: string }) => p.name === 'Size')?.numberFormat,
        mail: st().pages[a.row].properties[mailId],
      }
    }, r)
    expect(after.names.slice(-3)).toEqual(['E-mail', 'Priority', 'Size'])
    expect(after.linked).toEqual(['E-mail', 'Size'])
    expect(after.size).toBe('euro')
    expect(after.mail).toBe('x@acme.test')

    // deleting the record type: rows lose the type, properties stay unlinked
    const gone = await wsEval(page, (s, a) => {
      s.deleteRecordType('lead')
      const db = st().databases[a.dbId]
      return { rowType: st().pages[a.row].recordType ?? null, holds: db.recordTypes, linked: db.properties.filter((p: { fromType?: unknown }) => p.fromType).length, n: db.properties.length }
    }, r)
    expect(gone).toMatchObject({ rowType: null, holds: [], linked: 0 })
    expect(gone.n).toBe(after.names.length)
  })

  test('own property types: base fixed once created, list binding reaches its properties; all of it survives a reload', async ({ page }) => {
    await open(page)
    const r = await wsEval(page, (s) => {
      s.upsertList({ id: 'cc', name: 'Cost centres', items: [{ id: 'k1', name: '4711', color: 'gray' }], createdAt: 0, updatedAt: 0 })
      s.upsertPropType({ id: 'costc', name: 'Cost centre', base: 'select', createdAt: 0, updatedAt: 0, scripts: { validate: 'value != null', nope: 'x' } })
      const dbId = s.createDatabase({ title: 'Invoices', parentId: null })
      const propId = s.addProperty(dbId, { type: 'select', name: 'Cost centre', custom: 'costc', options: [] })
      s.upsertPropType({ ...st().kit.propTypes.costc, base: 'number', listId: 'cc' })
      const t = st().kit.propTypes.costc
      const def = st().databases[dbId].properties.find((p: { id: string }) => p.id === propId)
      return { dbId, base: t.base, scripts: Object.keys(t.scripts), listId: def.listId, options: def.options.map((o: { name: string }) => o.name) }
    })
    expect(r).toMatchObject({ base: 'select', scripts: ['validate'], listId: 'cc', options: ['4711'] })
    await open(page, true)
    const kept = await wsEval(page, (s) => ({ lists: Object.keys(st().kit.lists), types: Object.keys(st().kit.propTypes), base: st().kit.propTypes.costc?.base }))
    expect(kept).toEqual({ lists: ['cc'], types: ['costc'], base: 'select' })
  })
})
