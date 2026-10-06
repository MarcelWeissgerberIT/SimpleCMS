/**
 * Building blocks — a value script's answer (JSON from the runtime) as the stored value of its property's
 * base type: texts, numbers, true / false, option names (→ option ids; a missing option is added unless
 * the database is locked or the options come from a list), ISO dates, people. Throws a message when the
 * answer does not fit.
 */
import { useWorkspace } from '../../store/store'
import { newId } from '../../lib/ids'
import type { Database, DateValue, ID, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { t } from '../../i18n'
import { itemColor } from './model'

export class ValueMisfit extends Error {}

const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/

const textOf = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return textOf(o.title ?? o.name ?? JSON.stringify(v))
  }
  return ''
}

const listOf = (v: unknown): unknown[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v])

/** The options a name list needs (new ones only where the property may get them). */
function optionIds(db: Database, prop: PropertyDef, names: string[], added: SelectOption[]): ID[] {
  const opts = [...(prop.options ?? []), ...added]
  const ids: ID[] = []
  for (const n of names) {
    const name = n.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!name) continue
    const hit = opts.find((o) => o.id === name || o.name.trim().toLowerCase() === name.toLowerCase())
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id)
      continue
    }
    if (db.locked || prop.listId) throw new ValueMisfit(t('features.kit.value.noOption', { name }))
    const opt: SelectOption = { id: newId(), name, color: itemColor(opts.length) }
    opts.push(opt)
    added.push(opt)
    ids.push(opt.id)
  }
  return ids
}

/**
 * The stored value for a value script's answer. `added`: options the property needs first (the caller
 * writes them with updateProperty before the value).
 */
export function storedValueOf(db: Database, prop: PropertyDef, plain: unknown, added: SelectOption[] = []): PropertyValue {
  switch (prop.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return textOf(plain).slice(0, 100_000)
    case 'number': {
      if (plain === null || plain === '' || plain === undefined) return null
      const n = typeof plain === 'number' ? plain : Number(String(plain).trim().replace(',', '.'))
      if (!Number.isFinite(n)) throw new ValueMisfit(t('features.kit.value.notNumber'))
      return n
    }
    case 'rating': {
      if (plain === null || plain === undefined) return null
      const n = Math.round(Number(plain))
      if (!Number.isFinite(n)) throw new ValueMisfit(t('features.kit.value.notNumber'))
      return Math.max(0, Math.min(prop.ratingMax ?? 5, n)) || null
    }
    case 'checkbox':
      return plain === true || (typeof plain === 'string' && ['true', 'yes', 'ja', '1', 'x'].includes(plain.trim().toLowerCase())) || (typeof plain === 'number' && plain !== 0)
    case 'select': {
      const names = listOf(plain).map(textOf).filter(Boolean)
      if (names.length > 1) throw new ValueMisfit(t('features.kit.value.oneOption'))
      return optionIds(db, prop, names, added)[0] ?? null
    }
    case 'multi_select':
      return optionIds(db, prop, listOf(plain).flatMap((x) => (typeof x === 'string' ? x.split(',') : [textOf(x)])), added)
    case 'date': {
      if (plain === null || plain === undefined || plain === '') return null
      const m = ISO.exec(textOf(plain).trim())
      if (!m) throw new ValueMisfit(t('features.kit.value.notDate'))
      const v: DateValue = { start: m[2] ? `${m[1]}T${m[2]}` : m[1] }
      if (m[2]) v.includeTime = true
      return v
    }
    case 'person': {
      const people = useWorkspace.getState().people
      const ids: ID[] = []
      for (const x of listOf(plain)) {
        const id = x && typeof x === 'object' ? String((x as Record<string, unknown>).id ?? '') : ''
        const name = textOf(x).trim().toLowerCase()
        const hit = people.find((p) => (id && p.id === id) || p.id === name || p.name.trim().toLowerCase() === name)
        if (!hit) throw new ValueMisfit(t('features.kit.value.noPerson', { name: textOf(x) }))
        if (!ids.includes(hit.id)) ids.push(hit.id)
      }
      return ids
    }
  }
  throw new ValueMisfit(t('features.kit.value.notStored'))
}

/** Two stored values are the same ('' and null, [] and absent alike). */
export function sameValue(a: PropertyValue | undefined, b: PropertyValue | undefined): boolean {
  const norm = (v: PropertyValue | undefined) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? null : v)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}
