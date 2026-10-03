/**
 * Sub-items in table and list views: the nested display order (filters + sorts apply within each
 * level; a matching sub-item brings its ancestors along, dimmed), expand / collapse state per view,
 * and the per-row colour rule lookup shared by all layouts.
 */
import { useCallback, useMemo } from 'react'
import type { ID, Page } from '../../store/types'
import { useLocalState, type DbModel } from '../hooks'
import { parentIdOf, subItemsOf, type SubItemsPair } from '../model/hierarchy'
import { sortRows } from '../model/query'
import { activeRules, ruleMatcher } from '../model/colors'
import '../structure.css'

export interface TreeNode {
  row: Page
  depth: number
  /** Sub-items shown under this row (after filters). */
  childCount: number
  expanded: boolean
  /** Shown only as context for a matching sub-item. */
  dimmed: boolean
  /** Last among its siblings (its connector line ends here). */
  last: boolean
  /** Per ancestor level 1…depth-1: does that ancestor's connector line run past this row? ("1"/"0") */
  rails: string
}

/** Indentation stops growing here (deeper levels still nest). */
export const MAX_INDENT = 4

/** `collapsed`: parents whose sub-items are hidden (everything else starts open). */
export function buildTree(m: DbModel, pair: SubItemsPair, collapsed: Set<ID>): TreeNode[] {
  const pages = m.resolver.ctx.pages
  const byId = new Map(m.allRows.map((r) => [r.id, r]))
  const parentOf = (r: Page) => {
    const p = parentIdOf(pages, pair, r)
    return p && byId.has(p) ? p : null
  }
  const matched = new Set(m.rows.map((r) => r.id))
  const visible = new Set(matched)
  for (const r of m.rows) {
    let p = parentOf(r)
    for (let guard = 0; p && !visible.has(p) && guard < 256; guard++) {
      visible.add(p)
      p = parentOf(byId.get(p)!)
    }
  }
  // display order of every visible row; siblings keep this order
  let ordered = m.rows
  if (visible.size !== matched.size) {
    const all = m.allRows.filter((r) => visible.has(r.id))
    ordered = m.view.sorts.length ? sortRows(m.resolver, m.db, all, m.view.sorts, m.propMap) : all
  }
  const children = new Map<ID | null, Page[]>()
  for (const r of ordered) {
    const p = parentOf(r)
    const key = p && visible.has(p) ? p : null
    const list = children.get(key)
    if (list) list.push(r)
    else children.set(key, [r])
  }
  // rows caught in a parent loop are reachable from no root: they become roots themselves
  const roots = [...(children.get(null) ?? [])]
  const reached = new Set<ID>()
  const mark = (start: Page) => {
    const stack = [start]
    while (stack.length) {
      const r = stack.pop()!
      if (reached.has(r.id)) continue
      reached.add(r.id)
      for (const k of children.get(r.id) ?? []) stack.push(k)
    }
  }
  roots.forEach(mark)
  for (const r of ordered)
    if (!reached.has(r.id)) {
      roots.push(r)
      mark(r)
    }

  const out: TreeNode[] = []
  const seen = new Set<ID>()
  type Entry = { row: Page; depth: number; last: boolean; rails: string }
  const stack: Entry[] = roots.map((row, i) => ({ row, depth: 0, last: i === roots.length - 1, rails: '' })).reverse()
  while (stack.length) {
    const { row, depth, last, rails } = stack.pop()!
    if (seen.has(row.id)) continue
    seen.add(row.id)
    const kids = (children.get(row.id) ?? []).filter((k) => !seen.has(k.id))
    const dimmed = !matched.has(row.id)
    // a dimmed parent is only there to show where a match lives: always open
    const open = kids.length > 0 && (dimmed || !collapsed.has(row.id))
    out.push({ row, depth, childCount: kids.length, expanded: open, dimmed, last, rails })
    // children see this row's line running on unless it was the last of its siblings (roots have none)
    const childRails = depth > 0 ? rails + (last ? '0' : '1') : ''
    if (open) for (let i = kids.length - 1; i >= 0; i--) stack.push({ row: kids[i], depth: depth + 1, last: i === kids.length - 1, rails: childRails })
  }
  return out
}

export interface Tree {
  pair: SubItemsPair | null
  /** Nested nodes in display order, or null when the view shows rows flat. */
  nodes: TreeNode[] | null
  toggle: (id: ID) => void
  expand: (id: ID) => void
}

/** Sub-items state of the current table / list view. */
export function useTree(m: DbModel): Tree {
  const pair = useMemo(() => subItemsOf(m.db), [m.db])
  // per viewer + view: the parents someone closed (sub-items start open, so nothing hides by surprise)
  const [list, setList] = useLocalState<ID[]>(`one.db.subclosed.${m.view.id}`, [])
  const nested = !!pair && (m.view.subItems ?? 'nested') === 'nested' && !m.groups && (m.view.type === 'table' || m.view.type === 'list')
  const key = list.join('|')
  const nodes = useMemo(
    () => (nested && pair ? buildTree(m, pair, new Set(key ? key.split('|') : [])) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nested, pair, m.rows, m.allRows, m.resolver, key, m.view.sorts],
  )
  const toggle = useCallback((id: ID) => setList((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])), [setList])
  const expand = useCallback((id: ID) => setList((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur)), [setList])
  return { pair, nodes, toggle, expand }
}

/** Row → first matching colour rule of the view (null when none). */
export function useRowColor(m: DbModel) {
  const rules = useMemo(() => activeRules(m.view, m.propMap), [m.view, m.propMap])
  return useMemo(() => ruleMatcher(m.resolver, m.db, rules, m.propMap), [m.resolver, m.db, rules, m.propMap])
}

/** Live sub-item count of a row (for card badges). */
export function subItemCount(m: DbModel, pair: SubItemsPair | null, row: Page): number {
  if (!pair) return 0
  const ids = row.properties[pair.children.id]
  if (!Array.isArray(ids)) return 0
  const pages = m.resolver.ctx.pages
  let n = 0
  for (const id of ids) {
    const p = pages[id]
    if (p && !p.trashed && p.databaseId === m.db.id && id !== row.id) n++
  }
  return n
}
