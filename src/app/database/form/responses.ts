/**
 * Responses: how form-made rows are told apart, and what the Responses tab shows about them.
 *
 * A form that tracks its responses marks every row it creates in the workspace with an option of
 * a select property (default name "Form"; one option per form, so several forms of a database can
 * share it). That marker is ordinary data: the table can filter by it, automations can react to
 * it, and a workflow that writes shared-link answers back as rows (public API, n8n …) can set it
 * so those count, too. Answers that only reach the webhook can't be counted here.
 */
import type { ColorName, Database, FilterGroup, ID, Page, PropertyDef, SelectOption, View } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { newId } from '../../lib/ids'
import { isDbLocked } from '../model/lock'
import { isDateValue } from '../model/format'
import { formConfig, type Field } from './fields'

export interface Marker {
  prop: PropertyDef
  option: SelectOption
}

/** The form's marker when its property and option still exist. */
export function markerOf(db: Database, view: View): Marker | null {
  const mk = formConfig(view).marker
  if (!mk || typeof mk.propertyId !== 'string') return null
  const prop = db.properties.find((p) => p.id === mk.propertyId && p.type === 'select')
  const option = prop?.options?.find((o) => o.id === mk.optionId)
  return prop && option ? { prop, option } : null
}

/** Rows this form made (newest first). */
export function responseRows(rows: Page[], marker: Marker): Page[] {
  return rows.filter((r) => r.properties[marker.prop.id] === marker.option.id).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Start marking responses: reuse the marker property of another form of this database, or add
 * a select property `propName`; give this form its own option (named after the form).
 */
export function startTracking(dbId: ID, viewId: ID, propName: string, optionName: string): void {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db || isDbLocked(dbId)) return
  const view = db.views.find((v) => v.id === viewId)
  if (!view) return
  const cur = markerOf(db, view)
  if (cur) return
  const option: SelectOption = { id: newId(), name: optionName.slice(0, 200), color: 'orange' }
  const shared = db.views.map((v) => formConfig(v).marker?.propertyId).find((id) => !!id && db.properties.some((p) => p.id === id && p.type === 'select'))
  let propId: ID
  if (shared) {
    propId = shared
    const prop = db.properties.find((p) => p.id === shared)!
    // a form of the same name already has an option: reuse it
    const same = prop.options?.find((o) => o.name === option.name)
    if (same) option.id = same.id
    else s.updateProperty(dbId, propId, { options: [...(prop.options ?? []), option] })
  } else {
    const taken = new Set(db.properties.map((p) => p.name))
    let name = propName
    for (let n = 2; taken.has(name); n++) name = `${propName} ${n}`
    propId = s.addProperty(dbId, { type: 'select', name, options: [option] })
  }
  // never a question in any form of the database (addProperty shows it in every view)
  const fresh = useWorkspace.getState().databases[dbId]
  for (const v of fresh?.views ?? []) {
    if (v.type === 'form' && v.visibleProperties.includes(propId)) s.updateView(dbId, v.id, { visibleProperties: v.visibleProperties.filter((id) => id !== propId) })
  }
  const latest = useWorkspace.getState().databases[dbId]?.views.find((v) => v.id === viewId)
  if (latest) s.updateView(dbId, viewId, { form: { ...formConfig(latest), marker: { propertyId: propId, optionId: option.id } } })
}

/** Stop marking new responses (the property and the marks already made stay). */
export function stopTracking(dbId: ID, viewId: ID): void {
  const s = useWorkspace.getState()
  const v = s.databases[dbId]?.views.find((x) => x.id === viewId)
  if (!v || isDbLocked(dbId)) return
  const { marker: _drop, ...rest } = formConfig(v)
  void _drop
  s.updateView(dbId, viewId, { form: rest })
}

/** The filter "marker property is this form's option". */
export function markerFilter(marker: Marker): FilterGroup {
  return { id: newId(), op: 'and', items: [{ id: newId(), propertyId: marker.prop.id, operator: 'is', value: marker.option.id }] }
}

/** A table view of the database showing exactly this form's responses, if there is one. */
export function responsesViewOf(db: Database, marker: Marker): View | undefined {
  return db.views.find((v) => {
    if (v.type !== 'table' || !v.filter || v.filter.op !== 'and' || v.filter.items.length !== 1) return false
    const f = v.filter.items[0]
    return !('items' in f) && f.propertyId === marker.prop.id && f.operator === 'is' && f.value === marker.option.id
  })
}

/* ---------------- summaries ---------------- */

export interface Bar {
  id: string
  label: string
  count: number
  color?: ColorName
}

export type Summary =
  | { type: 'bars'; answered: number; bars: Bar[]; average?: number }
  | { type: 'number'; answered: number; average: number | null; min: number | null; max: number | null }
  | { type: 'dates'; answered: number; first: string | null; last: string | null }
  | { type: 'texts'; answered: number; latest: string[] }
  | { type: 'count'; answered: number }

const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)

/** Per-question summary over the responses (values as they are in the rows now). */
export function summarize(f: Field, rows: Page[], people: Array<{ id: ID; name: string }>): Summary {
  const p = f.prop
  const values = rows.map((r) => (p?.type === 'title' ? r.title : p ? r.properties[p.id] : undefined))
  const answered = values.filter(hasValue).length
  const count = (ids: string[]): Bar[] => {
    const n = new Map<string, number>()
    for (const v of values) for (const id of Array.isArray(v) ? v : typeof v === 'string' ? [v] : []) n.set(id, (n.get(id) ?? 0) + 1)
    return ids.map((id) => ({ id, label: id, count: n.get(id) ?? 0 }))
  }
  switch (f.kind) {
    case 'select':
    case 'multi': {
      const opts = f.options ?? []
      return { type: 'bars', answered, bars: count(opts.map((o) => o.id)).map((b, i) => ({ ...b, label: opts[i].name, color: opts[i].color })) }
    }
    case 'person':
      return { type: 'bars', answered, bars: count(people.map((x) => x.id)).map((b, i) => ({ ...b, label: people[i].name })).filter((b) => b.count > 0) }
    case 'checkbox': {
      const yes = values.filter((v) => v === true).length
      return { type: 'bars', answered: rows.length, bars: [{ id: 'yes', label: 'yes', count: yes }, { id: 'no', label: 'no', count: rows.length - yes }] }
    }
    case 'rating':
    case 'number': {
      const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && !(f.kind === 'rating' && v <= 0))
      const average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
      const steps = f.kind === 'rating' ? (f.max ?? 5) : f.display === 'scale' ? (f.scale ?? 5) : 0
      if (steps) {
        const bars = Array.from({ length: steps }, (_, i) => ({ id: String(i + 1), label: String(i + 1), count: nums.filter((n) => Math.round(n) === i + 1).length }))
        return { type: 'bars', answered: nums.length, bars, average: average ?? undefined }
      }
      return { type: 'number', answered: nums.length, average, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null }
    }
    case 'date': {
      const days = values.filter(isDateValue).map((d) => d.start.slice(0, 10)).sort()
      return { type: 'dates', answered: days.length, first: days[0] ?? null, last: days.at(-1) ?? null }
    }
    case 'short':
    case 'long':
    case 'url':
    case 'email':
    case 'phone':
      return { type: 'texts', answered, latest: values.filter((v): v is string => typeof v === 'string' && !!v.trim()).slice(0, 3) }
    default:
      return { type: 'count', answered }
  }
}
