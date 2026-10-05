/**
 * One Script runtime — database values with the database's own semantics. Reading: option names,
 * dates, people and related rows as objects, computed values (formula, rollup, timestamps) the way
 * the database computes them. Writing: option names (a select gets new options, a status never; a
 * locked database keeps its options), dates, people by name, relations by row / title / id; computed
 * and file properties are read-only.
 */
import type { Database, DateValue, ID, Page, Person, PropertyDef, PropertyValue } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { propertyFormulaValue } from '../../../database'
import { HostObject, SDate, ScriptError, parseDate, toText, truthy, typeName, type Value } from '../lang'

/** How rows and people become script values (objects.ts provides them). */
export interface Makers {
  row(page: Page): Value
  person(p: Person): Value
}

const COMPUTED = new Set<PropertyDef['type']>(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])

export const isReadOnlyProp = (p: PropertyDef) => COMPUTED.has(p.type) || p.type === 'files'

const isDateValue = (v: unknown): v is DateValue => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'

function sdateOf(start: string | null | undefined): SDate | null {
  if (!start) return null
  return parseDate(start)
}

/** A formula value (number, text, Date, list …) as a script value. */
function fromFormula(v: unknown): Value {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const allDay = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0
    return allDay ? SDate.day(v) : SDate.at(v)
  }
  if (Array.isArray(v)) return v.map(fromFormula)
  return null
}

/** A property value of a row (or a page without a database: nothing). */
export function readProp(db: Database, prop: PropertyDef, row: Page, mk: Makers): Value {
  const v = row.properties[prop.id]
  const s = useWorkspace.getState()
  switch (prop.type) {
    case 'title':
      return row.title
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' ? v : ''
    case 'number':
    case 'rating':
    case 'unique_id':
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'checkbox':
      return v === true
    case 'select':
    case 'status':
      return prop.options?.find((o) => o.id === v)?.name ?? null
    case 'multi_select':
      return Array.isArray(v) ? v.map((id) => prop.options?.find((o) => o.id === id)?.name).filter((n): n is string => !!n) : []
    case 'date': {
      if (!isDateValue(v)) return null
      const start = sdateOf(v.start)
      if (!start) return null
      const end = sdateOf(v.end)
      return end ? new SDate(start.t, start.time, end) : start
    }
    case 'person':
      return Array.isArray(v) ? v.map((id) => s.people.find((p) => p.id === id)).filter((p): p is Person => !!p).map((p) => mk.person(p)) : []
    case 'relation':
      return Array.isArray(v) ? v.map((id) => s.pages[id]).filter((p): p is Page => !!p && !p.trashed).map((p) => mk.row(p)) : []
    case 'files':
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    case 'created_time':
      return SDate.at(new Date(row.createdAt))
    case 'last_edited_time':
      return SDate.at(new Date(row.updatedAt))
    default:
      // formula, rollup, created_by, last_edited_by: as the database computes them
      return fromFormula(propertyFormulaValue(db, prop, row))
  }
}

/** A property by name: exact, then ignoring case and surrounding spaces. */
export function propByName(db: Database, name: string): PropertyDef | undefined {
  return db.properties.find((p) => p.name === name) ?? db.properties.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
}

/** What will be written: a stored value, or option names that become ids when it is written. */
export interface Coerced {
  prop: PropertyDef
  value: PropertyValue
  /** select / status / multi_select: option names (new ones are created when written) */
  names?: string[]
  /** option names that don't exist yet */
  fresh?: string[]
  /** how the new value reads */
  text: string
}

const bad = (prop: PropertyDef, detail: string) => new ScriptError('bad_value', { name: prop.name, detail })

const listOf = (v: Value): Value[] => (v === null ? [] : Array.isArray(v) ? v : [v])

function dateValueOf(v: Value, prop: PropertyDef): DateValue | null {
  if (v === null || v === '') return null
  let d: SDate | null = null
  if (v instanceof SDate) d = v
  else if (typeof v === 'string') d = parseDate(v)
  if (!d) throw bad(prop, `expected a date, got ${typeName(v)}`)
  const iso = (x: SDate) => {
    const dt = x.date
    const p = (n: number) => String(n).padStart(2, '0')
    const day = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
    return x.time ? `${day}T${p(dt.getHours())}:${p(dt.getMinutes())}` : day
  }
  const out: DateValue = { start: iso(d) }
  if (d.end) out.end = iso(d.end)
  if (d.time || d.end?.time) out.includeTime = true
  return out
}

/** Turn a script value into what a property stores. Throws ScriptError for values that don't fit. */
export function coerceProp(db: Database, prop: PropertyDef, raw: Value): Coerced {
  if (isReadOnlyProp(prop)) throw new ScriptError('readonly_prop', { name: prop.name })
  const s = useWorkspace.getState()
  switch (prop.type) {
    case 'title': {
      const t = toText(raw).replace(/\s*\n\s*/g, ' ').slice(0, 2000)
      return { prop, value: t, text: t }
    }
    case 'text':
    case 'phone': {
      const t = toText(raw).slice(0, 100_000)
      return { prop, value: t, text: t }
    }
    case 'email': {
      const t = toText(raw).trim()
      if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw bad(prop, `"${t}" is not an e-mail address`)
      return { prop, value: t, text: t }
    }
    case 'url': {
      let t = toText(raw).trim()
      if (t && !/^[a-z][a-z\d+.-]*:/i.test(t)) t = `https://${t}`
      if (t) {
        try {
          const u = new URL(t)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme')
        } catch {
          throw bad(prop, `"${toText(raw)}" is not an http(s) address`)
        }
      }
      return { prop, value: t, text: t }
    }
    case 'number': {
      if (raw === null || raw === '') return { prop, value: null, text: '' }
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN
      if (!Number.isFinite(n)) throw bad(prop, `expected a number, got ${typeName(raw)}`)
      return { prop, value: n, text: String(n) }
    }
    case 'rating': {
      if (raw === null) return { prop, value: null, text: '' }
      const max = prop.ratingMax ?? 5
      const n = typeof raw === 'number' ? raw : Number(toText(raw))
      if (!Number.isInteger(n) || n < 0 || n > max) throw bad(prop, `expected a whole number from 0 to ${max}`)
      return { prop, value: n, text: `${n}/${max}` }
    }
    case 'checkbox': {
      const b = typeof raw === 'string' ? ['true', 'yes', 'ja', '1', 'x'].includes(raw.trim().toLowerCase()) : truthy(raw)
      return { prop, value: b, text: b ? '✓' : '—' }
    }
    case 'date': {
      const v = dateValueOf(raw, prop)
      return { prop, value: v, text: v ? `${v.start.replace('T', ' ')}${v.end ? ` → ${v.end.replace('T', ' ')}` : ''}` : '' }
    }
    case 'select':
    case 'status':
    case 'multi_select': {
      const parts = listOf(raw).flatMap((x) => (typeof x === 'string' && prop.type === 'multi_select' ? x.split(',') : [toText(x)])).map((x) => x.trim()).filter(Boolean)
      if (prop.type !== 'multi_select' && parts.length > 1) throw bad(prop, 'only one option')
      const opts = prop.options ?? []
      const names: string[] = []
      const fresh: string[] = []
      for (const n of parts) {
        const hit = opts.find((o) => o.name.trim().toLowerCase() === n.toLowerCase())
        if (!hit && prop.type === 'status') throw bad(prop, `no status "${n}" (${opts.map((o) => o.name).join(', ')})`)
        if (!hit && db.locked) throw bad(prop, `no option "${n}" — the database is locked (${opts.map((o) => o.name).join(', ')})`)
        const name = hit?.name ?? n.slice(0, 100)
        if (names.some((x) => x.toLowerCase() === name.toLowerCase())) continue
        if (!hit) fresh.push(name)
        names.push(name)
      }
      return { prop, value: null, names, fresh, text: names.join(', ') }
    }
    case 'person': {
      const ids: ID[] = []
      const shown: string[] = []
      for (const x of listOf(raw)) {
        const id = x instanceof HostObject && x.typeName === 'person' ? String((x.toPlain() as { id?: string }).id ?? '') : null
        const name = typeof x === 'string' ? x.trim() : null
        const hit = s.people.find((p) => (id && p.id === id) || (name && (p.name.trim().toLowerCase() === name.toLowerCase() || p.id === name)))
        if (!hit) throw bad(prop, `no person ${JSON.stringify(name ?? toText(x))} (${s.people.map((p) => p.name).join(', ') || '—'})`)
        if (!ids.includes(hit.id)) {
          ids.push(hit.id)
          shown.push(hit.name)
        }
      }
      return { prop, value: ids, text: shown.join(', ') }
    }
    case 'relation': {
      const target = prop.relationDatabaseId
      const rows = Object.values(s.pages).filter((p) => p.databaseId === target && !p.trashed)
      const ids: ID[] = []
      const shown: string[] = []
      for (const x of listOf(raw)) {
        const plain = x instanceof HostObject ? (x.toPlain() as { id?: string }) : null
        const ref = plain?.id ?? (typeof x === 'string' ? x.trim() : '')
        const hit = rows.find((r) => r.id === ref) ?? rows.find((r) => r.title.trim().toLowerCase() === ref.toLowerCase())
        if (!hit) throw bad(prop, `no entry ${JSON.stringify(x instanceof HostObject ? x.display() : ref)} in the related database`)
        if (!ids.includes(hit.id)) {
          ids.push(hit.id)
          shown.push(hit.title.trim() || '—')
        }
      }
      return { prop, value: ids, text: shown.join(', ') }
    }
  }
  throw new ScriptError('readonly_prop', { name: prop.name })
}
