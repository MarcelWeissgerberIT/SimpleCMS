/**
 * Table layout: column widths, flattened render items (groups, rows, add rows, calc rows),
 * virtualization helpers.
 */
import type { Page, PropertyDef, PropertyType, View } from '../../../store/types'
import type { RowGroup } from '../../model/query'
import { NONE_KEY } from '../../model/query'

export const ROW_H = 36
export const GROUP_H = 46
export const ADD_H = 34
export const CALC_H = 34
export const ADD_COL = 44
export const FILL_MIN = 24

const DEFAULT_W: Partial<Record<PropertyType, number>> = {
  title: 300,
  text: 220,
  number: 130,
  select: 160,
  multi_select: 220,
  status: 160,
  date: 190,
  person: 180,
  checkbox: 100,
  url: 210,
  email: 210,
  phone: 160,
  files: 190,
  relation: 220,
  rollup: 160,
  formula: 180,
  created_time: 200,
  last_edited_time: 200,
  unique_id: 120,
  rating: 140,
}

export function colWidth(view: View, prop: PropertyDef, override?: Record<string, number>, narrow?: boolean): number {
  const w = override?.[prop.id] ?? view.propertyWidths?.[prop.id] ?? DEFAULT_W[prop.type] ?? 180
  if (narrow && prop.type === 'title') return Math.min(w, 176)
  return w
}

export const minWidth = (prop: PropertyDef) => (prop.type === 'title' ? 140 : 72)

export type Item =
  | { kind: 'group'; key: string; group: RowGroup; h: number }
  | { kind: 'row'; key: string; row: Page; index: number; groupKey: string | null; h: number }
  | { kind: 'add'; key: string; group: RowGroup | null; h: number }
  | { kind: 'calc'; key: string; group: RowGroup | null; rows: Page[]; h: number }
  | { kind: 'empty'; key: string; h: number }

export function buildItems(rows: Page[], groups: RowGroup[] | null, hidden: Set<string>, collapsed: Set<string>, rowH: number, groupCalcs = true): Item[] {
  const items: Item[] = []
  let index = 0
  if (!groups) {
    if (!rows.length) items.push({ kind: 'empty', key: 'empty', h: 120 })
    for (const row of rows) items.push({ kind: 'row', key: row.id, row, index: index++, groupKey: null, h: rowH })
    items.push({ kind: 'add', key: 'add', group: null, h: ADD_H })
    items.push({ kind: 'calc', key: 'calc', group: null, rows, h: CALC_H })
    return items
  }
  for (const g of groups) {
    if (hidden.has(g.key)) continue
    if (g.key === NONE_KEY && g.rows.length === 0) continue
    items.push({ kind: 'group', key: `g:${g.key}`, group: g, h: GROUP_H })
    if (collapsed.has(g.key)) continue
    for (const row of g.rows) items.push({ kind: 'row', key: `${g.key}:${row.id}`, row, index: index++, groupKey: g.key, h: rowH })
    items.push({ kind: 'add', key: `a:${g.key}`, group: g, h: ADD_H })
    if (groupCalcs) items.push({ kind: 'calc', key: `c:${g.key}`, group: g, rows: g.rows, h: CALC_H })
  }
  if (!items.length) items.push({ kind: 'empty', key: 'empty', h: 120 })
  else if (!groupCalcs) items.push({ kind: 'calc', key: 'calc', group: null, rows, h: CALC_H })
  return items
}

export function offsetsOf(items: Item[]): number[] {
  const out = new Array<number>(items.length + 1)
  out[0] = 0
  for (let i = 0; i < items.length; i++) out[i + 1] = out[i] + items[i].h
  return out
}

/** Nearest scrollable ancestor (vertical). */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null
  while (cur && cur !== document.body) {
    const s = getComputedStyle(cur)
    if (/(auto|scroll|overlay)/.test(s.overflowY) && cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return null
}
