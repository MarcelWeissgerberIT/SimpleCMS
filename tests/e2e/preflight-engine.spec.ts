/**
 * Preflight (Vorflug-Check) — the pure parts, run in Node by the Playwright runner (no browser):
 *  - `classifyChange` (store/rowChange.ts, re-exported by store/rowIndex.ts): what one page change means for the shared
 *    row index — membership · values · content · nothing;
 *  - `gridNext` (ui/roving.ts): the plate's 2-D arrow keys at 4 and 2 columns;
 *  - `checkLamps` (store/integrations.ts, the read release of profile lamps): shapes, thresholds, the `read` rule (M3),
 *    a bad lamp left out and the profile kept, export / same.
 * Every page and value is fictional.
 */
import { test, expect } from '@playwright/test'
import { classifyChange } from '../../src/app/store/rowChange'
import { gridNext } from '../../src/app/ui/roving'
import { checkIntegration, checkProfileLamps, exportIntegration, sameIntegration, type IntegrationIssue } from '../../src/app/store/integrations'
import type { Page } from '../../src/app/store/types'

const page = (over: Partial<Page> = {}): Page => ({
  id: 'r1',
  kind: 'page',
  title: 'Exportfilter',
  icon: null,
  cover: null,
  parentId: 'db1',
  databaseId: 'db1',
  properties: { p1: 'Offen' },
  content: null,
  contentRev: 0,
  contentOrigin: null,
  favorite: false,
  trashed: false,
  trashedAt: null,
  createdAt: 1,
  updatedAt: 1,
  order: 0,
  settings: {} as Page['settings'],
  ...over,
})

test.describe('row index — classifyChange', () => {
  test('the same object, or nothing on either side, is no change', () => {
    const p = page()
    expect(classifyChange(p, p)).toBeNull()
    expect(classifyChange(undefined, undefined)).toBeNull()
  })

  test('added and removed pages are membership changes', () => {
    expect(classifyChange(page(), undefined)).toBe('membership')
    expect(classifyChange(undefined, page())).toBe('membership')
    // a plain page too (the tree changed: the inbox lamp reads `structure`)
    expect(classifyChange(page({ databaseId: null, parentId: null }), undefined)).toBe('membership')
  })

  test('database, trash and parent moves are membership changes', () => {
    const p = page()
    expect(classifyChange({ ...p, databaseId: 'db2', parentId: 'db2' }, p)).toBe('membership')
    expect(classifyChange({ ...p, databaseId: null, parentId: 'x', properties: {} }, p)).toBe('membership')
    expect(classifyChange({ ...p, trashed: true, trashedAt: 5 }, p)).toBe('membership')
    expect(classifyChange(p, { ...p, trashed: true, trashedAt: 5 })).toBe('membership')
    expect(classifyChange({ ...p, parentId: 'other' }, p)).toBe('membership')
    // membership wins over a value change in the same write
    expect(classifyChange({ ...p, trashed: true, title: 'Neu' }, p)).toBe('membership')
  })

  test('title and property values are value changes', () => {
    const p = page()
    expect(classifyChange({ ...p, title: 'Zertifikat-Warnung' }, p)).toBe('values')
    expect(classifyChange({ ...p, properties: { p1: 'Erledigt' } }, p)).toBe('values')
    // a new properties object counts even with the same values (compared by reference, like the store's writes)
    expect(classifyChange({ ...p, properties: { ...p.properties } }, p)).toBe('values')
  })

  test('anything else on another object is a content change', () => {
    const p = page()
    expect(classifyChange({ ...p, content: { type: 'doc', content: [] }, contentRev: 1 }, p)).toBe('content')
    expect(classifyChange({ ...p, comments: [] }, p)).toBe('content')
    expect(classifyChange({ ...p, updatedAt: 9 }, p)).toBe('content')
    expect(classifyChange({ ...p, icon: { type: 'emoji', value: 'x' } }, p)).toBe('content')
  })

  test('null and absent fields compare alike', () => {
    const p = page({ databaseId: null, parentId: null })
    const absent = { ...p } as Partial<Page>
    delete absent.databaseId
    delete absent.parentId
    expect(classifyChange(absent as Page, p)).toBe('content')
  })
})

test.describe('plate keys — gridNext', () => {
  test('4 columns, 10 caps (rows 0–3 · 4–7 · 8–9)', () => {
    expect(gridNext(0, 'ArrowRight', 4, 10)).toBe(1)
    expect(gridNext(3, 'ArrowRight', 4, 10)).toBe(4) // reading order: on to the next row
    expect(gridNext(9, 'ArrowRight', 4, 10)).toBe(9) // the last cap stays
    expect(gridNext(4, 'ArrowLeft', 4, 10)).toBe(3)
    expect(gridNext(0, 'ArrowLeft', 4, 10)).toBe(0)
    expect(gridNext(1, 'ArrowDown', 4, 10)).toBe(5)
    expect(gridNext(5, 'ArrowDown', 4, 10)).toBe(9)
    expect(gridNext(6, 'ArrowDown', 4, 10)).toBe(6) // no cap below → stays
    expect(gridNext(7, 'ArrowDown', 4, 10)).toBe(7)
    expect(gridNext(9, 'ArrowDown', 4, 10)).toBe(9) // last row
    expect(gridNext(9, 'ArrowUp', 4, 10)).toBe(5)
    expect(gridNext(2, 'ArrowUp', 4, 10)).toBe(2) // first row stays
    expect(gridNext(6, 'Home', 4, 10)).toBe(0)
    expect(gridNext(2, 'End', 4, 10)).toBe(9)
  })

  test('2 columns, 5 caps (rows 0–1 · 2–3 · 4)', () => {
    expect(gridNext(0, 'ArrowDown', 2, 5)).toBe(2)
    expect(gridNext(2, 'ArrowDown', 2, 5)).toBe(4)
    expect(gridNext(3, 'ArrowDown', 2, 5)).toBe(3) // no cap below → stays
    expect(gridNext(4, 'ArrowUp', 2, 5)).toBe(2)
    expect(gridNext(1, 'ArrowRight', 2, 5)).toBe(2)
    expect(gridNext(4, 'ArrowRight', 2, 5)).toBe(4)
    expect(gridNext(2, 'ArrowLeft', 2, 5)).toBe(1)
  })

  test('nothing focused, odd column counts, other keys', () => {
    expect(gridNext(-1, 'ArrowDown', 4, 10)).toBe(0)
    expect(gridNext(-1, 'End', 4, 10)).toBe(9)
    expect(gridNext(3, 'ArrowDown', 0, 5)).toBe(4) // a bad column count reads as one column
    expect(gridNext(0, 'ArrowDown', 1, 1)).toBe(0)
    expect(gridNext(0, 'Enter', 4, 10)).toBeNull()
    expect(gridNext(0, ' ', 4, 10)).toBeNull()
    expect(gridNext(0, 'ArrowDown', 4, 0)).toBeNull()
  })
})

test.describe('profile lamps — checkLamps (read release)', () => {
  const waiting = { id: 'waiting', label: { en: 'Waiting on me', de: 'Wartet auf mich' }, where: [{ role: 'waiting', equals: true }], read: { role: 'waiting', value: false } }
  const comments = { id: 'comments', label: 'New comments', short: 'Comments', second: 'Tessera', view: { en: 'New comments', de: 'Neue Kommentare' }, amber: 3, red: 10, flash: false, master: false, after: 'gate' }
  const check = (lamps: unknown, recipeIds: string[] = ['mirror']) => {
    const issues: IntegrationIssue[] = []
    const out = checkProfileLamps(lamps, recipeIds, (i) => issues.push(i))
    return { out, codes: issues.map((i) => `${i.path.join('.')}:${i.code}`) }
  }

  test('valid lamps are kept as given', () => {
    const r = check([waiting, comments])
    expect(r.codes).toEqual([])
    expect(r.out).toEqual([waiting, comments])
    expect(check([{ id: 'mine', label: 'Mein Status', where: [{ role: 'myStatus', equals: 'Offen' }], read: { role: 'myStatus', value: 'In Arbeit' }, amber: null, red: 1 }]).out).toHaveLength(1)
  })

  test('exactly one of view / where', () => {
    expect(check([{ ...waiting, view: 'All' }])).toEqual({ out: [], codes: ['lamps.0:lampSource'] })
    const { where: _w, ...neither } = waiting
    expect(check([neither])).toEqual({ out: [], codes: ['lamps.0:lampSource'] })
  })

  test('read: only newComment / waiting → false or myStatus → an option name — never a source field (M3)', () => {
    for (const read of [{ role: 'comments', value: 0 }, { role: 'lastCommentAt', value: null }, { role: 'srcStatus', value: 'Done' }, { role: 'changedAt', value: null }, { role: 'waiting', value: true }, { role: 'newComment', value: null }, { role: 'myStatus', value: false }, { role: 'myStatus', value: '  ' }]) {
      const r = check([{ ...waiting, read }])
      expect(r.out, JSON.stringify(read)).toEqual([])
      expect(r.codes, JSON.stringify(read)).toEqual(['lamps.0.read:lampRead'])
    }
    expect(check([{ ...waiting, read: { role: 'newComment', value: false } }]).out).toHaveLength(1)
  })

  test('thresholds: whole numbers 1–9,999, red above amber, not both null', () => {
    expect(check([{ ...waiting, amber: null, red: null }])).toEqual({ out: [], codes: ['lamps.0:lampThresholds'] })
    expect(check([{ ...waiting, amber: 3, red: 3 }])).toEqual({ out: [], codes: ['lamps.0.red:lampOrder'] })
    expect(check([{ ...waiting, amber: 0 }]).codes).toEqual(['lamps.0.amber:range'])
    expect(check([{ ...waiting, amber: 1.5 }]).out).toEqual([])
    expect(check([{ ...waiting, red: 10_000 }]).out).toEqual([])
    expect(check([{ ...waiting, amber: '2' }]).out).toEqual([])
    // the defaults (amber 1, no red) need no keys; red alone with amber null is fine
    expect(check([{ ...waiting, amber: null, red: 1 }]).out[0]).toMatchObject({ amber: null, red: 1 })
  })

  test('ids, duplicates, texts, unknown keys, recipes, the list limit', () => {
    expect(check([{ ...waiting, id: 'Waiting' }]).out).toEqual([])
    expect(check([{ ...waiting, id: '1st' }]).out).toEqual([])
    expect(check([waiting, { ...comments, id: 'waiting' }])).toEqual({ out: [waiting], codes: ['lamps.1.id:duplicate'] })
    // a long label is clamped (≤ 16), as every text of a profile is
    const long = check([{ ...waiting, label: 'Neue Kommentare im Ticket' }])
    expect(long.codes).toEqual(['lamps.0.label:tooLong'])
    expect(long.out[0]?.label).toBe('Neue Kommentare ')
    // an unknown key is reported and left out of the copy
    const extra = check([{ ...waiting, colour: 'red' }])
    expect(extra.codes).toEqual(['lamps.0.colour:unknownKey'])
    expect(extra.out).toEqual([waiting])
    expect(check([{ ...waiting, recipe: 'other' }])).toEqual({ out: [], codes: ['lamps.0.recipe:lampRecipe'] })
    expect(check([{ ...waiting, recipe: 'tickets' }], ['tickets']).out).toHaveLength(1)
    // more than four: the first four are checked
    const five = check([1, 2, 3, 4, 5].map((n) => ({ ...waiting, id: `l${n}` })))
    expect(five.codes).toEqual(['lamps:tooMany'])
    expect(five.out.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4'])
    // more than four conditions: the lamp is left out (fewer ANDed conditions would count more rows)
    expect(check([{ ...waiting, where: [1, 2, 3, 4, 5].map(() => ({ role: 'waiting', equals: true })) }]).out).toEqual([])
    expect(check([{ ...waiting, where: [{ role: 'waiting' }] }]).out).toEqual([])
    expect(check([{ ...waiting, where: [{ role: 'not a role', equals: true }] }]).out).toEqual([])
    expect(check([{ ...waiting, where: [] }]).out).toEqual([])
    expect(check([{ ...waiting, after: 'Not An Id' }]).out).toEqual([])
  })

  test('the profile keeps its lamps (a bad one left out, the profile stays); export and same include them', () => {
    const raw = { schema: 'one.integration/1', id: 'tessera', name: 'Tessera', match: { name: 'relay' }, unlocks: ['keys'], lamps: [waiting, { ...comments, amber: null, red: null }] }
    const p = checkIntegration(raw)!
    expect(p).not.toBeNull()
    expect(p.lamps).toEqual([waiting])
    expect(exportIntegration(p).lamps).toEqual([waiting])
    expect(sameIntegration(p, { ...p, lamps: [{ ...waiting, amber: 2 }] })).toBe(false)
    expect(sameIntegration(p, checkIntegration(JSON.parse(JSON.stringify(raw))))).toBe(true)
    // "lamps" is a known key now: the editor does not call it unknown
    const issues: IntegrationIssue[] = []
    checkIntegration({ ...raw, lamps: [waiting] }, (i) => issues.push(i))
    expect(issues.filter((i) => i.code === 'unknownKey')).toEqual([])
    // no lamps: no key in the copy
    expect('lamps' in checkIntegration({ ...raw, lamps: [] })!).toBe(false)
  })
})
