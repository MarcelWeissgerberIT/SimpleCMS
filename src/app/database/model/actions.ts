/**
 * Database write helpers on top of the workspace store actions
 * (two-way relation sync, type conversion, bulk ops, CSV export, row opening).
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { newId } from '../../lib/ids'
import { openPage } from '../../lib/router'
import { t } from '../../i18n'
import type { ColorName, Database, ID, Page, PropertyDef, PropertyType, PropertyValue, SelectOption, View } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import { isComputed } from './schema'
import type { Resolver } from './resolve'
import { isDateValue } from './format'

const ws = () => useWorkspace.getState()

/** The relation property on the other side of a two-way relation (implicit pairing). */
export function pairedRelation(dbId: ID, prop: PropertyDef): { db: Database; prop: PropertyDef } | null {
  if (prop.type !== 'relation' || !prop.relationDatabaseId) return null
  const target = ws().databases[prop.relationDatabaseId]
  if (!target) return null
  const back = target.properties.find((p) => p.type === 'relation' && p.relationDatabaseId === dbId && p.id !== prop.id)
  return back ? { db: target, prop: back } : null
}

/** Write a property value; keeps two-way relations in sync. */
export function writeValue(dbId: ID, prop: PropertyDef, rowId: ID, value: PropertyValue): void {
  const s = ws()
  if (prop.type === 'title') {
    s.updatePage(rowId, { title: String(value ?? '') })
    return
  }
  if (prop.type === 'relation') {
    const before = new Set((s.pages[rowId]?.properties[prop.id] as string[] | undefined) ?? [])
    const after = new Set((value as string[] | null) ?? [])
    s.setRowProperty(rowId, prop.id, [...after])
    const pair = pairedRelation(dbId, prop)
    if (pair) {
      for (const id of after) {
        if (before.has(id)) continue
        const cur = (ws().pages[id]?.properties[pair.prop.id] as string[] | undefined) ?? []
        if (!cur.includes(rowId)) s.setRowProperty(id, pair.prop.id, [...cur, rowId])
      }
      for (const id of before) {
        if (after.has(id)) continue
        const cur = (ws().pages[id]?.properties[pair.prop.id] as string[] | undefined) ?? []
        if (cur.includes(rowId)) s.setRowProperty(id, pair.prop.id, cur.filter((x) => x !== rowId))
      }
    }
    return
  }
  s.setRowProperty(rowId, prop.id, value)
}

export function rowsOf(dbId: ID): Page[] {
  return Object.values(ws().pages)
    .filter((p) => p.databaseId === dbId && !p.trashed)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/** Create the reverse relation property on the target database and backfill it. */
export function enableTwoWay(dbId: ID, prop: PropertyDef): void {
  if (!prop.relationDatabaseId || pairedRelation(dbId, prop)) return
  const srcTitle = ws().pages[dbId]?.title || t('common.untitled')
  const backId = ws().addProperty(prop.relationDatabaseId, { type: 'relation', name: srcTitle, relationDatabaseId: dbId })
  const back = new Map<ID, ID[]>()
  for (const row of rowsOf(dbId)) {
    for (const id of (row.properties[prop.id] as string[] | undefined) ?? []) back.set(id, [...(back.get(id) ?? []), row.id])
  }
  for (const [id, ids] of back) ws().setRowProperty(id, backId, ids)
}

export function disableTwoWay(dbId: ID, prop: PropertyDef): void {
  const pair = pairedRelation(dbId, prop)
  if (pair) ws().deleteProperty(pair.db.id, pair.prop.id)
}

const nextColor = (opts: SelectOption[]): ColorName => COLOR_NAMES.filter((c) => c !== 'default')[opts.length % (COLOR_NAMES.length - 1)]

export function newOption(name: string, existing: SelectOption[], group?: SelectOption['group']): SelectOption {
  return { id: newId(), name, color: nextColor(existing), ...(group ? { group } : {}) }
}

/** Change a property's type, converting stored values where it makes sense. */
export function changePropertyType(r: Resolver, db: Database, prop: PropertyDef, type: PropertyType): void {
  if (prop.type === type || prop.type === 'title') return
  const s = ws()
  const rows = rowsOf(db.id)
  const texts = new Map<ID, string>()
  const lists = new Map<ID, string[]>()
  for (const row of rows) {
    const v = r.value(db, prop, row)
    texts.set(row.id, r.textOf(db, prop, v))
    if (prop.type === 'multi_select') lists.set(row.id, ((v as string[]) ?? []).map((id) => prop.options?.find((o) => o.id === id)?.name ?? '').filter(Boolean))
  }
  const patch: Partial<PropertyDef> = { type }
  let options: SelectOption[] = []
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    if (prop.options && (prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status')) {
      options = prop.options.map((o) => (type === 'status' ? { ...o, group: o.group ?? 'todo' } : { id: o.id, name: o.name, color: o.color }))
    } else {
      const names = new Set<string>()
      for (const row of rows) {
        const parts = type === 'multi_select' ? (texts.get(row.id) ?? '').split(',') : [texts.get(row.id) ?? '']
        parts.map((x) => x.trim()).filter(Boolean).forEach((x) => names.add(x))
      }
      for (const n of [...names].slice(0, 200)) options.push(newOption(n, options, type === 'status' ? 'todo' : undefined))
    }
    if (type === 'status' && options.length === 0) {
      options = [
        { id: newId(), name: t('database.status.notStarted'), color: 'gray', group: 'todo' },
        { id: newId(), name: t('database.status.inProgress'), color: 'orange', group: 'in_progress' },
        { id: newId(), name: t('database.status.done'), color: 'green', group: 'done' },
      ]
    }
    patch.options = options
  }
  if (type === 'formula' && !prop.formula) patch.formula = ''
  if (type === 'unique_id') patch.idPrefix = prop.idPrefix ?? ''
  s.updateProperty(db.id, prop.id, patch)
  if (isComputed({ ...prop, type })) {
    if (type === 'unique_id') {
      let n = 1
      for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt)) s.setRowProperty(row.id, prop.id, n++)
      s.updateDatabase(db.id, { nextUniqueId: Math.max(db.nextUniqueId, n) })
    }
    return
  }
  const byName = (name: string) => options.find((o) => o.name === name)?.id
  for (const row of rows) {
    const text = texts.get(row.id) ?? ''
    let v: PropertyValue = null
    switch (type) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        v = text
        break
      case 'number':
      case 'rating': {
        const n = parseFloat(text.replace(/[^\d.,-]/g, '').replace(',', '.'))
        v = Number.isFinite(n) ? (type === 'rating' ? Math.max(0, Math.min(prop.ratingMax ?? 5, Math.round(n))) : n) : null
        break
      }
      case 'select':
      case 'status':
        v = byName((lists.get(row.id)?.[0] ?? text).trim()) ?? null
        break
      case 'multi_select':
        v = (lists.get(row.id) ?? text.split(',').map((x) => x.trim()).filter(Boolean)).map(byName).filter((x): x is string => !!x)
        break
      case 'checkbox':
        v = prop.type === 'checkbox' ? row.properties[prop.id] === true : !!text && !['false', 'no', 'nein', '0'].includes(text.toLowerCase())
        break
      case 'date': {
        const old = row.properties[prop.id]
        if (isDateValue(old)) v = old
        else {
          const d = new Date(text)
          v = text && !Number.isNaN(d.getTime()) ? { start: d.toISOString().slice(0, 10) } : null
        }
        break
      }
      case 'person':
        v = prop.type === 'person' ? row.properties[prop.id] ?? [] : []
        break
      case 'files':
      case 'relation':
        v = []
        break
    }
    s.setRowProperty(row.id, prop.id, v)
  }
}

/** Add a property and place it in the given view at a position (relative to visible props). */
export function insertProperty(db: Database, view: View | null, def: Partial<PropertyDef> & Pick<PropertyDef, 'type'>, at?: { anchorId: ID; side: 'left' | 'right' }): ID {
  const s = ws()
  let dbIndex: number | undefined
  if (at) {
    const i = db.properties.findIndex((p) => p.id === at.anchorId)
    if (i >= 0) dbIndex = at.side === 'left' ? i : i + 1
    if (db.properties[0]?.type === 'title' && dbIndex === 0) dbIndex = 1
  }
  const id = s.addProperty(db.id, def, dbIndex)
  if (view && at) {
    const fresh = ws().databases[db.id]?.views.find((v) => v.id === view.id)
    if (fresh) {
      const list = fresh.visibleProperties.filter((x) => x !== id)
      const ai = list.indexOf(at.anchorId)
      const pos = ai < 0 ? (at.side === 'left' ? 0 : list.length) : at.side === 'left' ? ai : ai + 1
      list.splice(pos, 0, id)
      s.updateView(db.id, view.id, { visibleProperties: list })
    }
  }
  return id
}

export function duplicateProperty(db: Database, view: View | null, prop: PropertyDef): ID {
  const copy: Partial<PropertyDef> & Pick<PropertyDef, 'type'> = JSON.parse(JSON.stringify({ ...prop, id: undefined, name: `${prop.name} (${t('database.copySuffix')})` }))
  const id = insertProperty(db, view, copy, { anchorId: prop.id, side: 'right' })
  if (!isComputed(prop) && prop.type !== 'title') for (const row of rowsOf(db.id)) {
    const v = row.properties[prop.id]
    if (v !== undefined) ws().setRowProperty(row.id, id, JSON.parse(JSON.stringify(v)))
  }
  return id
}

/** Trash rows with an undo toast. */
export function deleteRows(ids: ID[]): void {
  if (!ids.length) return
  const s = ws()
  for (const id of ids) s.trashPage(id)
  useUI.getState().toast({
    message: t(`database.toast.deleted.${ids.length === 1 ? 'one' : 'other'}`, { count: ids.length }),
    action: { label: t('common.undo'), run: () => ids.forEach((id) => ws().restorePage(id)) },
  })
}

export function duplicateRows(dbId: ID, ids: ID[]): ID[] {
  const s = ws()
  const db = s.databases[dbId]
  const out: ID[] = []
  for (const id of ids) {
    const nid = s.duplicatePage(id)
    if (!nid) continue
    out.push(nid)
    const uid = db?.properties.find((p) => p.type === 'unique_id')
    if (uid) {
      const cur = ws().databases[dbId]
      s.setRowProperty(nid, uid.id, cur.nextUniqueId)
      s.updateDatabase(dbId, { nextUniqueId: cur.nextUniqueId + 1 })
    }
  }
  return out
}

/** Open a row according to the view's openIn preference. */
export function openRow(id: ID, view?: View | null): void {
  const mode = view?.openIn ?? 'peek'
  if (mode === 'full') openPage(id)
  else useUI.getState().openPeek(id, mode === 'center' ? 'center' : 'side')
}

/** Order value placing an item between two neighbours (by page.order). */
export function orderBetween(before: Page | undefined, after: Page | undefined): number {
  if (before && after) return (before.order + after.order) / 2
  if (before) return before.order + 1
  if (after) return after.order - 1
  return 1
}

/* ---------------- CSV ---------------- */

function csvCell(s: string): string {
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Machine-friendly CSV values: ISO dates, raw numbers; everything else as display text. */
function csvValue(r: Resolver, db: Database, p: PropertyDef, row: Page): string {
  const v = r.value(db, p, row)
  if (p.type === 'date' && isDateValue(v)) return v.end ? `${v.start} → ${v.end}` : v.start
  if ((p.type === 'created_time' || p.type === 'last_edited_time') && v instanceof Date) return v.toISOString()
  if ((p.type === 'number' || p.type === 'rating') && typeof v === 'number') return String(v)
  if (p.type === 'checkbox') return v === true ? 'true' : 'false'
  return r.text(db, p, row)
}

export function exportCsv(r: Resolver, db: Database, props: PropertyDef[], rows: Page[], filename: string): void {
  const header = props.map((p) => csvCell(p.name)).join(',')
  const lines = rows.map((row) => props.map((p) => csvCell(csvValue(r, db, p, row))).join(','))
  const blob = new Blob(['﻿' + [header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(filename || 'database').replace(/[\\/:*?"<>|]+/g, '-')}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
