/**
 * Database entries in the sidebar tree — the shell side: "+" on a database (a new entry), and the drops
 * that cross a database's edge: a page dropped on a database becomes one of its entries, an entry dropped
 * where pages live leaves its database (it loses its properties: asks first). Entries never reorder in
 * the tree — a database's order comes from its first view.
 */
import { createEntry } from '../../database'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID, Page, PropertyValue } from '../../store/types'
import { canNestUnder, goToPage, isWithin, requestTitleFocus } from '../lib/actions'
import { treeKey, useTreeState } from '../lib/tree'

const ws = () => useWorkspace.getState()
const titleOf = (p: Page | undefined) => p?.title.trim() || t('common.untitled')
const sectionOf = (p: Page | undefined) => (p?.private ? 'private' : 'pages')

export type NodeKind = 'page' | 'database' | 'entry'

/** A tree row is a normal page, a database, or an entry (a database row). */
export const nodeKind = (p: Pick<Page, 'kind' | 'databaseId'>): NodeKind => (p.databaseId ? 'entry' : p.kind === 'database' ? 'database' : 'page')

/** "+" on a database in the tree: a new entry (the first view's presets), opened with its title focused. */
export function createEntryAndOpen(dbId: ID): ID | null {
  const id = createEntry(dbId)
  if (!id) return null
  useTreeState.getState().expand([treeKey(sectionOf(ws().pages[dbId]), dbId)])
  requestTitleFocus(id)
  goToPage(id)
  return id
}

/** Can the page `id` become an entry of the database `dbId`? (a plain page of the same scope, not around the database) */
export function canBecomeEntry(pages: Record<ID, Page>, id: ID, dbId: ID): boolean {
  const p = pages[id]
  const db = pages[dbId]
  if (!p || !db || p.databaseId || p.kind !== 'page' || p.template || db.kind !== 'database' || db.databaseId || db.trashed) return false
  if (!!p.private !== !!db.private || !ws().databases[dbId]) return false
  return !isWithin(pages, dbId, id)
}

/**
 * Can the entry `id` leave its database for a place under `parentId` (null: the top level — of my Private
 * section when `priv`)? Only where normal pages live, in the same scope, never inside its own sub-pages.
 */
export function canLeaveFor(pages: Record<ID, Page>, id: ID, parentId: ID | null, priv: boolean): boolean {
  const p = pages[id]
  if (!p?.databaseId || !!p.private !== priv) return false
  if (parentId === null) return true
  const target = pages[parentId]
  if (!target || target.trashed || target.kind === 'database' || target.databaseId || !!target.private !== priv) return false
  return !isWithin(pages, parentId, id)
}

/**
 * What a drag may do on the tree row `overId`: `inside` (nest, become an entry, leave the database for
 * it) and `beside` (land before / after it, as its sibling). An entry row only takes drops inside.
 */
export function dropOptions(pages: Record<ID, Page>, dragId: ID, overId: ID): { inside: boolean; beside: boolean } {
  const drag = pages[dragId]
  const target = pages[overId]
  if (!drag || !target || dragId === overId) return { inside: false, beside: false }
  const kind = nodeKind(target)
  const parent = target.parentId ? pages[target.parentId] : undefined
  const besideOk = kind !== 'entry' && parent?.kind !== 'database'
  if (drag.databaseId)
    return {
      inside: kind === 'page' && canLeaveFor(pages, dragId, overId, !!target.private),
      beside: besideOk && canLeaveFor(pages, dragId, target.parentId, !!target.private),
    }
  return {
    inside: kind === 'database' ? canBecomeEntry(pages, dragId, overId) : canNestUnder(dragId, overId),
    beside: besideOk && canNestUnder(dragId, target.parentId),
  }
}

/** A page dropped on a database: it becomes an entry (asks first when sub-pages come along). */
export function requestMakeEntry(pageId: ID, dbId: ID) {
  const s = ws()
  if (!canBecomeEntry(s.pages, pageId, dbId)) return
  const subs = countSubPages(s.pages, pageId)
  if (!subs) return makeEntry(pageId, dbId)
  useUI.getState().openModal({
    type: 'confirm',
    title: t('shell.entry.makeTitle', { title: titleOf(s.pages[pageId]), db: titleOf(s.pages[dbId]) }),
    body: subs === 1 ? t('shell.entry.makeBodyOne') : t('shell.entry.makeBody', { n: subs }),
    confirmLabel: t('shell.entry.makeLabel'),
    onConfirm: () => makeEntry(pageId, dbId),
  })
}

/** Live pages below a page (its sub-pages and everything in them). */
function countSubPages(pages: Record<ID, Page>, id: ID): number {
  const byParent = new Map<ID, ID[]>()
  for (const p of Object.values(pages)) {
    if (!p.parentId || p.trashed) continue
    const list = byParent.get(p.parentId)
    if (list) list.push(p.id)
    else byParent.set(p.parentId, [p.id])
  }
  let n = 0
  const seen = new Set<ID>([id])
  const stack = [...(byParent.get(id) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    n++
    stack.push(...(byParent.get(cur) ?? []))
  }
  return n
}

function makeEntry(pageId: ID, dbId: ID) {
  const s = ws()
  const page = s.pages[pageId]
  const db = s.databases[dbId]
  if (!page || !db || !canBecomeEntry(s.pages, pageId, dbId)) return
  const before: Partial<Page> = { parentId: page.parentId, databaseId: page.databaseId, properties: page.properties, order: page.order }
  // a fresh entry: no properties but its number (unique ids are handed out once, like for a new row)
  const properties: Record<ID, PropertyValue> = {}
  const numbered = db.properties.filter((p) => p.type === 'unique_id')
  for (const p of numbered) properties[p.id] = db.nextUniqueId
  s.updatePage(pageId, { parentId: dbId, databaseId: dbId, properties, order: orderAt(s.pages, dbId, undefined, pageId, !!page.private) })
  if (numbered.length) s.updateDatabase(dbId, { nextUniqueId: db.nextUniqueId + 1 })
  useTreeState.getState().expand([treeKey(sectionOf(page), dbId)])
  useUI.getState().toast({
    message: t('shell.entry.made', { title: titleOf(page), db: titleOf(s.pages[dbId]) }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        if (ws().pages[pageId]?.databaseId === dbId) ws().updatePage(pageId, before)
      },
    },
  })
}

/**
 * An entry dropped where pages live: asks, then it leaves its database for `parentId` (at `index` among
 * the pages there; undefined: at the end). Its properties go, and so do links to it from other entries.
 */
export function requestLeaveDatabase(rowId: ID, parentId: ID | null, index?: number) {
  const s = ws()
  const row = s.pages[rowId]
  if (!row?.databaseId || !canLeaveFor(s.pages, rowId, parentId, !!row.private)) return
  useUI.getState().openModal({
    type: 'confirm',
    title: t('shell.entry.leaveTitle'),
    body: t('shell.entry.leaveBody', { title: titleOf(row), db: titleOf(s.pages[row.databaseId]) }),
    confirmLabel: t('shell.entry.leaveLabel'),
    danger: true,
    onConfirm: () => leaveDatabase(rowId, parentId, index),
  })
}

function leaveDatabase(rowId: ID, parentId: ID | null, index?: number) {
  const s = ws()
  const row = s.pages[rowId]
  const dbId = row?.databaseId
  if (!row || !dbId || !canLeaveFor(s.pages, rowId, parentId, !!row.private)) return
  const before: Partial<Page> = { parentId: row.parentId, databaseId: dbId, properties: row.properties, order: row.order }
  const links = linksTo(s.pages, rowId, dbId)
  s.updatePage(rowId, { parentId, databaseId: null, properties: {}, order: orderAt(s.pages, parentId, index, rowId, !!row.private) })
  for (const l of links) s.setRowProperty(l.rowId, l.propId, l.value.filter((x) => x !== rowId))
  if (parentId) useTreeState.getState().expand([treeKey(sectionOf(row), parentId)])
  useUI.getState().toast({
    message: t('shell.entry.left', { title: titleOf(row), db: titleOf(s.pages[dbId]) }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        const cur = ws()
        if (!cur.pages[rowId] || cur.pages[rowId].databaseId || !cur.pages[dbId] || !cur.databases[dbId]) return
        cur.updatePage(rowId, before)
        for (const l of links) {
          const now = ws().pages[l.rowId]?.properties[l.propId]
          const list = Array.isArray(now) ? (now as ID[]) : []
          if (ws().pages[l.rowId] && !list.includes(rowId)) ws().setRowProperty(l.rowId, l.propId, [...list, rowId])
        }
      },
    },
  })
}

/** Relation values (of any database) that link to the row `rowId` of database `dbId`. */
function linksTo(pages: Record<ID, Page>, rowId: ID, dbId: ID): Array<{ rowId: ID; propId: ID; value: ID[] }> {
  const props = new Map<ID, ID[]>()
  for (const db of Object.values(ws().databases)) {
    const ids = db.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId === dbId).map((p) => p.id)
    if (ids.length) props.set(db.id, ids)
  }
  const out: Array<{ rowId: ID; propId: ID; value: ID[] }> = []
  if (!props.size) return out
  for (const p of Object.values(pages)) {
    if (!p.databaseId || p.id === rowId) continue
    for (const propId of props.get(p.databaseId) ?? []) {
      const v = p.properties[propId]
      if (Array.isArray(v) && (v as ID[]).includes(rowId)) out.push({ rowId: p.id, propId, value: v as ID[] })
    }
  }
  return out
}

/** The order value for position `index` among the live pages under `parentId` (the store's rule; top level: same scope). */
function orderAt(pages: Record<ID, Page>, parentId: ID | null, index: number | undefined, excludeId: ID, priv: boolean): number {
  const sibs = Object.values(pages)
    .filter((p) => p.parentId === parentId && !p.trashed && p.id !== excludeId && (parentId !== null || !!p.private === priv))
    .sort((a, b) => a.order - b.order)
  if (!sibs.length) return 1
  if (index === undefined || index >= sibs.length) return sibs[sibs.length - 1].order + 1
  if (index <= 0) return sibs[0].order - 1
  return (sibs[index - 1].order + sibs[index].order) / 2
}
