/**
 * Database write helpers on top of the workspace store actions
 * (two-way relation sync, type conversion, bulk ops, CSV export, row opening).
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { newId } from '../../lib/ids'
import { openPage } from '../../lib/router'
import { t } from '../../i18n'
import type { ColorName, Database, FilterGroup, ID, Page, PropertyDef, PropertyType, PropertyValue, SelectOption, View } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import { isComputed } from './schema'
import type { Resolver } from './resolve'
import { constrainRelationWrite, dependenciesOf, subItemsOf } from './hierarchy'
import { dateValueText, isDateValue, isoWithTime, parseDateText, parseNumberText } from './format'
import { isDbReadOnly } from '../readonly'
import { isDbLocked } from './lock'

/** Properties of this database may change (not view only, not locked). */
const schemaEditable = (dbId: ID | undefined) => !isDbReadOnly() && !isDbLocked(dbId)

const ws = () => useWorkspace.getState()

/**
 * Two-way relations are paired explicitly: turning two-way on creates the reverse property on the
 * target database with the id `<forward id>.2way`. Only such a pair syncs — two relations that
 * merely point at each other (created separately) stay independent, and switching two-way off can
 * only ever remove the property that two-way created or its explicit partner.
 */
export const TWO_WAY_SUFFIX = '.2way'

export function pairedRelation(dbId: ID, prop: PropertyDef): { db: Database; prop: PropertyDef } | null {
  if (prop.type !== 'relation' || !prop.relationDatabaseId) return null
  const target = ws().databases[prop.relationDatabaseId]
  if (!target) return null
  const partner = (p: PropertyDef | undefined): p is PropertyDef => !!p && p.id !== prop.id && p.type === 'relation' && p.relationDatabaseId === dbId
  const back = target.properties.find((p) => p.id === prop.id + TWO_WAY_SUFFIX)
  if (partner(back)) return { db: target, prop: back }
  if (prop.id.endsWith(TWO_WAY_SUFFIX)) {
    const fwd = target.properties.find((p) => p.id === prop.id.slice(0, -TWO_WAY_SUFFIX.length))
    if (partner(fwd)) return { db: target, prop: fwd }
  }
  return null
}

/** A property already holds the reverse id on the target (e.g. the old synced property, retyped). */
export function twoWayBlocker(dbId: ID, prop: PropertyDef): PropertyDef | null {
  if (prop.type !== 'relation' || !prop.relationDatabaseId || pairedRelation(dbId, prop)) return null
  return ws().databases[prop.relationDatabaseId]?.properties.find((p) => p.id === prop.id + TWO_WAY_SUFFIX) ?? null
}

/** Write a property value; keeps two-way relations in sync. */
export function writeValue(dbId: ID, prop: PropertyDef, rowId: ID, value: PropertyValue): void {
  if (isDbReadOnly()) return
  const s = ws()
  if (prop.type === 'title') {
    s.updatePage(rowId, { title: String(value ?? '') })
    return
  }
  if (prop.type === 'relation') {
    const before = new Set((s.pages[rowId]?.properties[prop.id] as string[] | undefined) ?? [])
    // sub-items / dependencies: one parent per row, no loops (no-op for other relations)
    const after = new Set(constrainRelationWrite(dbId, prop, rowId, [...before], (value as string[] | null) ?? []))
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
  if (!schemaEditable(dbId) || !schemaEditable(prop.relationDatabaseId)) return
  if (!prop.relationDatabaseId || !ws().databases[prop.relationDatabaseId] || pairedRelation(dbId, prop) || twoWayBlocker(dbId, prop)) return
  // the reverse side is named after where it points back to; on a self-relation that would just be
  // this database's own name, so it is named after the forward property instead
  const name = prop.relationDatabaseId === dbId ? t('database.relation.reverseName', { name: prop.name }) : ws().pages[dbId]?.title || t('common.untitled')
  const backId = ws().addProperty(prop.relationDatabaseId, { id: prop.id + TWO_WAY_SUFFIX, type: 'relation', name, relationDatabaseId: dbId })
  const back = new Map<ID, ID[]>()
  for (const row of rowsOf(dbId)) {
    for (const id of (row.properties[prop.id] as string[] | undefined) ?? []) back.set(id, [...(back.get(id) ?? []), row.id])
  }
  for (const [id, ids] of back) ws().setRowProperty(id, backId, ids)
}

/** Remove the partner property of an explicit two-way pair (undo via toast). */
export function disableTwoWay(dbId: ID, prop: PropertyDef): void {
  const pair = pairedRelation(dbId, prop)
  if (pair && schemaEditable(dbId)) deletePropertyWithUndo(pair.db, pair.prop)
}

/* ---------------- delete property: undo + dangling references ---------------- */

/** The filter without rules on a property (groups left empty go too). */
function stripFilter(g: FilterGroup | null | undefined, propId: ID): FilterGroup | null {
  if (!g) return null
  const items = g.items.flatMap((it): FilterGroup['items'] => {
    if ('items' in it) {
      const sub = stripFilter(it, propId)
      return sub ? [sub] : []
    }
    return it.propertyId === propId ? [] : [it]
  })
  return items.length ? { ...g, items } : null
}

/** View settings that would point at a deleted property (the store only clears placement, sorts, group, date). */
function danglingViewPatch(v: View, propId: ID): Partial<View> | null {
  const patch: Partial<View> = {}
  const filter = stripFilter(v.filter, propId)
  if (JSON.stringify(filter) !== JSON.stringify(v.filter ?? null)) patch.filter = filter
  if (v.calculations && propId in v.calculations) {
    const rest = { ...v.calculations }
    delete rest[propId]
    patch.calculations = rest
  }
  if (v.chart && (v.chart.xPropertyId === propId || v.chart.yPropertyId === propId)) {
    patch.chart = { ...v.chart }
    if (v.chart.xPropertyId === propId) patch.chart.xPropertyId = null
    if (v.chart.yPropertyId === propId) Object.assign(patch.chart, { yPropertyId: null, aggregate: 'count' })
  }
  if (v.cardPreview === propId) patch.cardPreview = v.type === 'gallery' ? 'cover' : 'none'
  if (v.colorRules?.length) {
    // a condition on a missing property would match every row: drop it (the rule stays, inert)
    const rules = v.colorRules.map((r) => ({ ...r, filter: stripFilter(r.filter, propId) ?? { ...r.filter, items: [] } }))
    if (!same(rules, v.colorRules)) patch.colorRules = rules
  }
  return Object.keys(patch).length ? patch : null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Delete a property; the toast offers undo (definition, values and every reference). Filter rules,
 * calculations, chart axes, card previews, colour rules and rollups that used it are cleared, so
 * nothing is left pointing at a property that no longer exists.
 */
export function deletePropertyWithUndo(db: Database, prop: PropertyDef): void {
  deletePropertiesWithUndo(db, [prop])
}

/** Delete several properties of one database behind a single undo toast. */
export function deletePropertiesWithUndo(db: Database, props: PropertyDef[], opts: { message?: string; onUndo?: () => void } = {}): void {
  if (!schemaEditable(db.id)) return
  const undos = props.map((p) => removeProperty(db.id, p.id)).filter((u): u is () => void => !!u)
  if (!undos.length) return
  useUI.getState().toast({
    message: opts.message ?? t('database.prop.deleted', { name: props[0].name }),
    action: {
      label: t('common.undo'),
      run: () => {
        for (const undo of [...undos].reverse()) undo()
        opts.onUndo?.()
      },
    },
  })
}

/**
 * Remove properties without a toast of their own — the undo of an on-the-fly creation
 * (database/create): definition, values and every reference go, like a normal delete.
 */
export function dropProperties(dbId: ID, propIds: ID[]): void {
  if (isDbReadOnly()) return
  for (const id of propIds) removeProperty(dbId, id)
}

/** Delete one property and clear what pointed at it; returns how to put everything back. */
function removeProperty(dbId: ID, propId: ID): (() => void) | null {
  const st = ws()
  const fresh = st.databases[dbId]
  if (!fresh) return null
  const index = fresh.properties.findIndex((p) => p.id === propId)
  if (index < 0) return null
  const def: PropertyDef = JSON.parse(JSON.stringify(fresh.properties[index]))
  // what the store clears on delete: placement, sorts, grouping, date property
  const refs = fresh.views.map((v) => ({
    id: v.id,
    at: v.visibleProperties.indexOf(propId),
    sortAt: v.sorts.findIndex((x) => x.propertyId === propId),
    sort: v.sorts.find((x) => x.propertyId === propId) ?? null,
    groupBy: v.groupBy === propId,
    dateProperty: v.dateProperty === propId,
  }))
  // what we clear on top: [view id, before, after] per changed field set
  const viewPatches = fresh.views.flatMap((v) => {
    const after = danglingViewPatch(v, propId)
    if (!after) return []
    const before = Object.fromEntries(Object.keys(after).map((k) => [k, JSON.parse(JSON.stringify(v[k as keyof View] ?? null))])) as Partial<View>
    return [{ id: v.id, before, after }]
  })
  // rollups that went through this relation, or rolled up this property from another database
  const rollups: Array<{ dbId: ID; propId: ID; before: NonNullable<PropertyDef['rollup']>; after: NonNullable<PropertyDef['rollup']> }> = []
  for (const d of Object.values(st.databases)) {
    for (const p of d.properties) {
      if (p.type !== 'rollup' || !p.rollup) continue
      const rel = d.properties.find((x) => x.id === p.rollup!.relationPropertyId)
      if (d.id === dbId && p.rollup.relationPropertyId === propId) rollups.push({ dbId: d.id, propId: p.id, before: p.rollup, after: { ...p.rollup, relationPropertyId: '', targetPropertyId: '' } })
      else if (rel?.relationDatabaseId === dbId && p.rollup.targetPropertyId === propId) rollups.push({ dbId: d.id, propId: p.id, before: p.rollup, after: { ...p.rollup, targetPropertyId: '' } })
    }
  }
  const values = rowsOf(dbId)
    .filter((r) => r.properties[propId] !== undefined)
    .map((r) => [r.id, JSON.parse(JSON.stringify(r.properties[propId]))] as const)

  st.deleteProperty(dbId, propId)
  for (const vp of viewPatches) st.updateView(dbId, vp.id, vp.after)
  for (const r of rollups) st.updateProperty(r.dbId, r.propId, { rollup: r.after })

  return () => {
    const w = ws()
    if (w.databases[dbId]?.properties.some((p) => p.id === propId)) return
    w.addProperty(dbId, def, index)
    const d = ws().databases[dbId]
    for (const ref of refs) {
      const v = d?.views.find((x) => x.id === ref.id)
      if (!v) continue
      const patch: Partial<View> = {}
      const list = v.visibleProperties.filter((x) => x !== propId)
      if (ref.at >= 0) list.splice(Math.min(ref.at, list.length), 0, propId)
      patch.visibleProperties = list
      if (ref.sort) {
        const sorts = v.sorts.filter((x) => x.propertyId !== propId)
        sorts.splice(Math.min(ref.sortAt, sorts.length), 0, ref.sort)
        patch.sorts = sorts
      }
      // only take a slot back if nobody changed it meanwhile
      if (ref.groupBy && !v.groupBy) patch.groupBy = propId
      if (ref.dateProperty && !v.dateProperty) patch.dateProperty = propId
      const vp = viewPatches.find((x) => x.id === ref.id)
      if (vp) for (const k of Object.keys(vp.after) as Array<keyof View>) if (same(v[k], vp.after[k])) Object.assign(patch, { [k]: vp.before[k] ?? undefined })
      w.updateView(dbId, ref.id, patch)
    }
    for (const r of rollups) {
      const cur = ws().databases[r.dbId]?.properties.find((p) => p.id === r.propId)
      if (cur && same(cur.rollup, r.after)) w.updateProperty(r.dbId, r.propId, { rollup: r.before })
    }
    for (const [rowId, v] of values) w.setRowProperty(rowId, propId, v)
  }
}

const nextColor = (opts: SelectOption[]): ColorName => COLOR_NAMES.filter((c) => c !== 'default')[opts.length % (COLOR_NAMES.length - 1)]

export function newOption(name: string, existing: SelectOption[], group?: SelectOption['group']): SelectOption {
  return { id: newId(), name, color: nextColor(existing), ...(group ? { group } : {}) }
}

/** Change a property's type, converting stored values where it makes sense; the toast can undo it. */
export function changePropertyType(r: Resolver, db: Database, prop: PropertyDef, type: PropertyType): void {
  if (prop.type === type || prop.type === 'title' || !schemaEditable(db.id)) return
  const cur = ws().databases[db.id]?.properties.find((p) => p.id === prop.id)
  if (!cur) return
  const def: PropertyDef = JSON.parse(JSON.stringify(cur))
  const values = rowsOf(db.id).map((row) => [row.id, JSON.parse(JSON.stringify(row.properties[prop.id] ?? null))] as const)
  convertPropertyType(r, db, cur, type)
  useUI.getState().toast({
    message: t('database.prop.typeChanged', { name: def.name, type: t(`database.type.${type}`) }),
    action: {
      label: t('common.undo'),
      run: () => {
        const now = ws().databases[db.id]?.properties.find((p) => p.id === prop.id)
        if (!now) return
        // put the old definition back exactly: fields the new type added are cleared
        const patch: Record<string, unknown> = { ...def }
        for (const k of Object.keys(now)) if (!(k in def)) patch[k] = undefined
        ws().updateProperty(db.id, prop.id, patch as Partial<PropertyDef>)
        for (const [rowId, v] of values) if (ws().pages[rowId]) ws().setRowProperty(rowId, prop.id, v)
      },
    },
  })
}

function convertPropertyType(r: Resolver, db: Database, prop: PropertyDef, type: PropertyType): void {
  const s = ws()
  const rows = rowsOf(db.id)
  const texts = new Map<ID, string>()
  const lists = new Map<ID, string[]>()
  for (const row of rows) {
    const v = r.value(db, prop, row)
    // dates become full, year-bearing text so converting back to a date finds them again
    texts.set(row.id, prop.type === 'date' && isDateValue(v) ? dateValueText(v, r.ctx.lang) : r.textOf(db, prop, v))
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
        const n = parseNumberText(text.replace(/[^\d.,+-]/g, ''), false, r.ctx.lang) ?? NaN
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
        const resolved = r.value(db, prop, row)
        if (isDateValue(old)) v = old
        else if (resolved instanceof Date) v = { start: isoWithTime(resolved, true), end: null, includeTime: true }
        else v = parseDateText(text, r.ctx.lang)
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
  if (!schemaEditable(db.id)) return ''
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
  if (!schemaEditable(db.id)) return ''
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
  if (!ids.length || isDbReadOnly()) return
  const s = ws()
  for (const id of ids) s.trashPage(id)
  useUI.getState().toast({
    message: t(`database.toast.deleted.${ids.length === 1 ? 'one' : 'other'}`, { count: ids.length }),
    action: { label: t('common.undo'), run: () => ids.forEach((id) => ws().restorePage(id)) },
  })
}

export function duplicateRows(dbId: ID, ids: ID[]): ID[] {
  if (isDbReadOnly()) return []
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
    relinkCopy(dbId, nid)
  }
  return out
}

/**
 * A duplicated row joins its original's parent and blockers (both sides synced), but it does not
 * take over the original's sub-items or dependents — each row has one parent.
 */
function relinkCopy(dbId: ID, rowId: ID): void {
  const db = ws().databases[dbId]
  const links: Array<[PropertyDef, PropertyDef]> = []
  const sub = subItemsOf(db)
  if (sub) links.push([sub.parent, sub.children])
  const dep = dependenciesOf(db)
  if (dep) links.push([dep.blockedBy, dep.blocking])
  for (const [up, down] of links) {
    const ids = ws().pages[rowId]?.properties[up.id]
    ws().setRowProperty(rowId, down.id, [])
    ws().setRowProperty(rowId, up.id, [])
    if (Array.isArray(ids) && ids.length) writeValue(dbId, up, rowId, ids)
  }
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

/**
 * Text a spreadsheet would run as a formula (=, +, -, @, tab, CR) gets a leading "'" — row text can
 * come from imports or opened share links. Plain numbers and percentages ("-5", "12%") stay numeric.
 * Same rule as the importer's guard, which strips the "'" again on the way back in.
 */
function guardCell(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[-+]?[\d.,\s]*\d[\d.,\s]*%?$/.test(s) ? `'${s}` : s
}

/** Machine-friendly CSV values: ISO dates, raw numbers; everything else as display text. */
function csvValue(r: Resolver, db: Database, p: PropertyDef, row: Page): string {
  const v = r.value(db, p, row)
  // ranges as an ISO 8601 interval ("start/end") — one cell, still machine-readable
  if (p.type === 'date' && isDateValue(v)) return v.end ? `${v.start}/${v.end}` : v.start
  if ((p.type === 'created_time' || p.type === 'last_edited_time') && v instanceof Date) return v.toISOString()
  if ((p.type === 'number' || p.type === 'rating') && typeof v === 'number') return String(v)
  if (p.type === 'checkbox') return v === true ? 'true' : 'false'
  return guardCell(r.text(db, p, row))
}

export function exportCsv(r: Resolver, db: Database, props: PropertyDef[], rows: Page[], filename: string): void {
  const header = props.map((p) => csvCell(guardCell(p.name))).join(',')
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
