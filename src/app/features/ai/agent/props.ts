/**
 * Workspace agent — turn the property values Claude sends (by property NAME, plain JSON) into
 * staged property changes. Nothing here writes: a value that does not fit becomes an error
 * message for Claude (English, it is model-facing), so it can fix the call and try again.
 * select / status / multi_select stay option NAMES until the change is applied (apply.ts).
 */
import type { Database, ID, Page, PropertyDef, PropertyType, PropertyValue } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { propertyValueToText } from '../../../database'
import { t } from '../../../i18n'
import type { PropChange, PropIntent } from './types'

/** Computed or file properties Claude cannot set. */
const READ_ONLY = new Set<PropertyType>(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'files'])

export const isSettable = (p: PropertyDef) => p.type !== 'title' && !READ_ONLY.has(p.type)

type Result = { ok: true; change: PropChange } | { ok: false; error: string }

const MAX_TEXT = 5000

const show = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

const unquote = (s: string) => s.trim().replace(/^["'“„«]+|["'”“»]+$/g, '').trim()

/** http(s) URL ("example.com/x" gets https://), or null. */
function normalizeUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z\d+.-]*:/i.test(s) && /^(www\.)?[\w-]+(\.[\w-]+)+([/?#]|$)/i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) return s
  } catch {
    /* not a URL */
  }
  return null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

function isoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(' ', 'T').slice(0, 16)
  if (!DATE_RE.test(s)) return null
  return Number.isNaN(new Date(s.length === 10 ? `${s}T12:00` : s).getTime()) ? null : s
}

const listOf = (raw: unknown): string[] | null => {
  if (raw === null || raw === undefined) return []
  if (typeof raw === 'string') return raw.split(',').map(unquote).filter(Boolean)
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) return (raw as string[]).map(unquote).filter(Boolean)
  return null
}

/** Display text of the stored value of a row ('' for a new row). */
function beforeText(db: Database, prop: PropertyDef, row: Page | null): string {
  if (!row) return ''
  try {
    return propertyValueToText(db, prop, row)
  } catch {
    return ''
  }
}

function ok(db: Database, prop: PropertyDef, row: Page | null, intent: PropIntent, after: string, newOptions?: string[]): Result {
  return { ok: true, change: { propId: prop.id, name: prop.name, type: prop.type, before: beforeText(db, prop, row), after, intent, ...(newOptions?.length ? { newOptions } : {}) } }
}

const value = (v: PropertyValue): PropIntent => ({ kind: 'value', value: v })

/** Validate / coerce one value Claude sent for a property. `row` is null for a new row. */
export function coerceProperty(db: Database, prop: PropertyDef, raw: unknown, row: Page | null): Result {
  const fail = (msg: string): Result => ({ ok: false, error: `"${prop.name}" (${prop.type}): ${msg}` })
  if (READ_ONLY.has(prop.type)) return fail('this property is computed and cannot be set.')
  switch (prop.type) {
    case 'title':
      return fail('use the title parameter (or set_page_title) for the title.')
    case 'text':
    case 'phone': {
      if (raw === null || raw === undefined) return ok(db, prop, row, value(''), '')
      if (typeof raw === 'number' || typeof raw === 'boolean') return ok(db, prop, row, value(String(raw)), String(raw))
      if (typeof raw !== 'string') return fail(`expected a string, got ${show(raw)}.`)
      const s = raw.trim().slice(0, MAX_TEXT)
      return ok(db, prop, row, value(s), s)
    }
    case 'email': {
      if (raw === null || raw === undefined || raw === '') return ok(db, prop, row, value(''), '')
      if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) return fail(`expected an e-mail address, got ${show(raw)}.`)
      return ok(db, prop, row, value(raw.trim()), raw.trim())
    }
    case 'url': {
      if (raw === null || raw === undefined || raw === '') return ok(db, prop, row, value(''), '')
      const url = typeof raw === 'string' ? normalizeUrl(raw) : null
      return url ? ok(db, prop, row, value(url), url) : fail(`expected an http(s) URL, got ${show(raw)}.`)
    }
    case 'number': {
      if (raw === null || raw === undefined || raw === '') return ok(db, prop, row, value(null), '')
      let n = NaN
      if (typeof raw === 'number') n = raw
      else if (typeof raw === 'string') {
        const s = raw.trim()
        const pct = /%$/.test(s)
        if (/^[+-]?[\d\s.,]+%?$/.test(s)) n = Number(s.replace(/[\s,%]/g, '')) / (pct ? 100 : 1)
      }
      if (!Number.isFinite(n)) return fail(`expected a number, got ${show(raw)}.`)
      return ok(db, prop, row, value(n), prop.numberFormat === 'percent' ? `${Math.round(n * 1000) / 10} %` : String(n))
    }
    case 'rating': {
      const max = prop.ratingMax ?? 5
      if (raw === null || raw === undefined || raw === '') return ok(db, prop, row, value(null), '')
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
      if (!Number.isInteger(n) || n < 0 || n > max) return fail(`expected a whole number from 0 to ${max}, got ${show(raw)}.`)
      return ok(db, prop, row, value(n), `${n}/${max}`)
    }
    case 'checkbox': {
      let b: boolean | null = null
      if (typeof raw === 'boolean') b = raw
      else if (raw === null) b = false
      else if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase()
        if (['true', 'yes', 'ja', '1', 'checked', 'x'].includes(s)) b = true
        if (['false', 'no', 'nein', '0', 'unchecked', ''].includes(s)) b = false
      }
      if (b === null) return fail(`expected true or false, got ${show(raw)}.`)
      return ok(db, prop, row, value(b), b ? t('database.yes') : t('database.no'))
    }
    case 'date': {
      if (raw === null || raw === undefined || raw === '') return ok(db, prop, row, value(null), '')
      let start: string | null = null
      let end: string | null = null
      if (typeof raw === 'string') start = isoDate(raw)
      else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as { start?: unknown; end?: unknown }
        start = isoDate(o.start)
        end = o.end === undefined || o.end === null || o.end === '' ? null : isoDate(o.end)
        if (o.end && !end) return fail(`"end" must be "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm", got ${show(o.end)}.`)
      }
      if (!start) return fail(`expected "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" or {"start": …, "end": …}, got ${show(raw)}.`)
      const includeTime = start.includes('T') || !!end?.includes('T')
      const v = { start, ...(end ? { end } : {}), ...(includeTime ? { includeTime: true } : {}) }
      return ok(db, prop, row, value(v), end ? `${start.replace('T', ' ')} → ${end.replace('T', ' ')}` : start.replace('T', ' '))
    }
    case 'select':
    case 'status':
    case 'multi_select': {
      const names = listOf(raw)
      if (!names) return fail(`expected ${prop.type === 'multi_select' ? 'a list of option names' : 'one option name'}, got ${show(raw)}.`)
      const opts = prop.options ?? []
      const all = opts.map((o) => o.name)
      if (prop.type !== 'multi_select' && names.length > 1) return fail(`only one option allowed, got ${names.length}. Options: ${all.map((n) => JSON.stringify(n)).join(', ')}.`)
      const final: string[] = []
      const fresh: string[] = []
      for (const name of names) {
        const hit = opts.find((o) => o.name.toLowerCase() === name.toLowerCase())
        if (!hit && prop.type === 'status') return fail(`unknown status ${JSON.stringify(name)}. Use one of: ${all.map((n) => JSON.stringify(n)).join(', ')}.`)
        // a locked database keeps its options (database/model/lock.ts): only existing ones can be picked
        if (!hit && db.locked) return fail(`unknown option ${JSON.stringify(name)} — the database is locked, so no new options can be created. Use one of: ${all.map((n) => JSON.stringify(n)).join(', ')}.`)
        const n = hit?.name ?? name.slice(0, 60)
        if (final.some((x) => x.toLowerCase() === n.toLowerCase())) continue
        if (!hit) fresh.push(n)
        final.push(n)
      }
      return ok(db, prop, row, { kind: 'options', names: final }, final.join(', '), fresh)
    }
    case 'person': {
      const names = listOf(raw)
      if (!names) return fail(`expected a list of people's names, got ${show(raw)}.`)
      const people = useWorkspace.getState().people
      const ids: ID[] = []
      const shown: string[] = []
      for (const name of names) {
        const hit = people.find((p) => p.name.toLowerCase() === name.toLowerCase() || p.id === name)
        if (!hit) return fail(`no person named ${JSON.stringify(name)}. People in this workspace: ${people.map((p) => JSON.stringify(p.name)).join(', ') || '(none)'}.`)
        if (!ids.includes(hit.id)) {
          ids.push(hit.id)
          shown.push(hit.name)
        }
      }
      return ok(db, prop, row, value(ids), shown.join(', '))
    }
    case 'relation': {
      const refs = listOf(raw)
      if (!refs) return fail(`expected a list of page titles or ids from the related database, got ${show(raw)}.`)
      const target = prop.relationDatabaseId
      const pages = useWorkspace.getState().pages
      const rows = Object.values(pages).filter((p) => p.databaseId === target && !p.trashed)
      const ids: ID[] = []
      const shown: string[] = []
      for (const ref of refs) {
        const hit = rows.find((r) => r.id === ref) ?? rows.find((r) => r.title.trim().toLowerCase() === ref.toLowerCase())
        if (!hit) return fail(`no row ${JSON.stringify(ref)} in the related database "${pages[target ?? '']?.title ?? '?'}". Query it with query_database to find the exact title or id.`)
        if (!ids.includes(hit.id)) {
          ids.push(hit.id)
          shown.push(hit.title.trim() || t('common.untitled'))
        }
      }
      return ok(db, prop, row, value(ids), shown.join(', '))
    }
  }
  return fail('this property type cannot be set.')
}

/** A property by the name Claude wrote (trimmed, any case), else by its id — how every value Claude sends is matched. */
export function findProp(db: Pick<Database, 'properties'>, key: string): PropertyDef | undefined {
  const name = key.trim().toLowerCase()
  return db.properties.find((p) => p.name.trim().toLowerCase() === name) ?? db.properties.find((p) => p.id === key)
}

/**
 * Coerce a `properties` object (property name → value). All-or-nothing: any problem fails the
 * whole call with every error listed, so Claude fixes them in one go.
 */
export function coerceProperties(db: Database, raw: unknown, row: Page | null): { ok: true; changes: PropChange[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, changes: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '"properties" must be an object: property name → value.' }
  const errors: string[] = []
  const changes: PropChange[] = []
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const prop = findProp(db, key)
    if (!prop) {
      errors.push(`unknown property ${JSON.stringify(key)}. Properties: ${db.properties.filter(isSettable).map((p) => JSON.stringify(p.name)).join(', ')}.`)
      continue
    }
    const res = coerceProperty(db, prop, v, row)
    if (res.ok) changes.push(res.change)
    else errors.push(res.error)
  }
  if (errors.length) return { ok: false, error: `Nothing was staged. Fix these values and call again:\n- ${errors.join('\n- ')}` }
  return { ok: true, changes }
}

/** Later values win: merge property changes of the same property. */
export function mergeProps(prev: PropChange[] = [], next: PropChange[]): PropChange[] {
  const out = prev.map((p) => {
    const n = next.find((x) => x.propId === p.propId)
    return n ? { ...n, before: p.before } : p
  })
  for (const n of next) if (!out.some((p) => p.propId === n.propId)) out.push(n)
  return out
}
