/**
 * Preflight (Vorflug-Check) — the pure parts, run in Node by the Playwright runner (no browser):
 *  - `classifyChange` (store/rowChange.ts, re-exported by store/rowIndex.ts): what one page change means for the shared
 *    row index — membership · values · content · nothing;
 *  - `gridNext` (ui/roving.ts): the plate's 2-D arrow keys at 4 and 2 columns.
 * Every page and value is fictional.
 */
import { test, expect } from '@playwright/test'
import { classifyChange } from '../../src/app/store/rowChange'
import { gridNext } from '../../src/app/ui/roving'
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
