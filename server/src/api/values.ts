/**
 * Property values over the public API (docs/API.md § Values):
 *  in  — friendly input (option names, "2026-10-05", member emails …) → the value the app stores
 *        (types.ts PropertyValue: option ids, DateValue, person / page ids …);
 *  out — stored value → friendly output (option names, ISO dates, names + emails, row titles).
 */
import { iso } from '../tokens.ts'
import { type PropertyDef, type Roots, outOfReach, pageMap } from './meta.ts'

/** Computed by the app (or set by it): never written over the API. */
export const READ_ONLY_TYPES = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button'])

/** Values formula / rollup show are computed in the app: they are not in the API's row output. */
const COMPUTED_OUT = new Set(['formula', 'rollup', 'button'])

export class ValueError extends Error {
  readonly property: string
  readonly allowed?: string[]
  constructor(property: string, message: string, allowed?: string[]) {
    super(message)
    this.property = property
    this.allowed = allowed
  }
}

export interface ValueContext {
  r: Roots
  /** Workspace members (account id = person id in the meta document's `people`). */
  members: Array<{ id: string; email: string; name: string | null }>
  people: Map<string, { id: string; name: string }>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v])

/* ------------------------------------------------------------------ in */

const TRUE = new Set(['true', 'yes', 'y', '1', 'on', 'checked', 'x', 'ja', 'wahr'])
const FALSE = new Set(['false', 'no', 'n', '0', 'off', 'unchecked', '', 'nein', 'falsch'])

/** "2026-10-05" · "2026-10-05T14:30" (seconds and a zone are dropped: times are wall-clock, like the app's). */
export function parseDate(raw: string): { value: string; time: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  if (h === undefined) return { value: `${y}-${mo}-${d}`, time: false }
  if (Number(h) > 23 || Number(mi) > 59) return null
  return { value: `${y}-${mo}-${d}T${h}:${mi}`, time: true }
}

function optionOf(prop: PropertyDef, raw: unknown): string {
  const opts = prop.options ?? []
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null
  if (s === null) throw new ValueError(prop.name, `${prop.name}: expected an option name`, opts.map((o) => o.name))
  const hit = opts.find((o) => o.id === s) ?? opts.find((o) => o.name.trim().toLowerCase() === s.toLowerCase())
  if (!hit) throw new ValueError(prop.name, `${prop.name}: unknown option "${s}"`, opts.map((o) => o.name))
  return hit.id
}

function personOf(prop: PropertyDef, raw: unknown, ctx: ValueContext): string {
  const s = typeof raw === 'string' ? raw.trim() : isObj(raw) && typeof raw.email === 'string' ? raw.email.trim() : isObj(raw) && typeof raw.id === 'string' ? raw.id : null
  const allowed = ctx.members.map((m) => m.email)
  if (!s) throw new ValueError(prop.name, `${prop.name}: expected a member's email or a person id`, allowed)
  const byEmail = ctx.members.find((m) => m.email === s.toLowerCase())
  if (byEmail) return byEmail.id
  if (ctx.people.has(s) || ctx.members.some((m) => m.id === s)) return s
  throw new ValueError(prop.name, `${prop.name}: "${s}" is not a member of this workspace`, allowed)
}

function relationOf(prop: PropertyDef, raw: unknown, ctx: ValueContext): string {
  const id = typeof raw === 'string' ? raw.trim() : isObj(raw) && typeof raw.id === 'string' ? raw.id : ''
  const yp = id ? pageMap(ctx.r, id) : null
  if (!yp || !prop.relationDatabaseId || yp.get('databaseId') !== prop.relationDatabaseId || outOfReach(ctx.r, id)) {
    throw new ValueError(prop.name, `${prop.name}: "${id}" is not a row of the related database`)
  }
  return id
}

/**
 * Friendly input → the stored value. `null` (or "") clears. Throws ValueError (→ 422) for a value
 * that does not fit, read-only types included.
 */
export function coerce(prop: PropertyDef, raw: unknown, ctx: ValueContext): unknown {
  const t = prop.type
  if (READ_ONLY_TYPES.has(t)) throw new ValueError(prop.name, `${prop.name}: ${t} values are computed and cannot be set`)
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim() && t !== 'text')
  switch (t) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      if (empty) return ''
      if (typeof raw === 'string') return t === 'text' || t === 'title' ? raw : raw.trim()
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
      throw new ValueError(prop.name, `${prop.name}: expected a string`)
    }
    case 'number':
    case 'rating': {
      if (empty) return null
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim().replace(/,(?=\d{1,2}$)/, '.')) : NaN
      if (!Number.isFinite(n)) throw new ValueError(prop.name, `${prop.name}: expected a number`)
      if (t === 'rating') {
        const max = prop.ratingMax ?? 5
        if (!Number.isInteger(n) || n < 0 || n > max) throw new ValueError(prop.name, `${prop.name}: expected a whole number from 0 to ${max}`)
      }
      return n
    }
    case 'checkbox': {
      if (raw === null || raw === undefined) return false
      if (typeof raw === 'boolean') return raw
      if (typeof raw === 'number' && (raw === 0 || raw === 1)) return raw === 1
      if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase()
        if (TRUE.has(s)) return true
        if (FALSE.has(s)) return false
      }
      throw new ValueError(prop.name, `${prop.name}: expected true or false`)
    }
    case 'select':
    case 'status':
      return empty ? null : optionOf(prop, raw)
    case 'multi_select': {
      if (empty) return []
      let items = list(raw)
      // "a, b" from a form field: a whole-string option name wins, else split at commas
      if (typeof raw === 'string' && !(prop.options ?? []).some((o) => o.name.trim().toLowerCase() === raw.trim().toLowerCase() || o.id === raw.trim())) {
        items = raw.split(',').map((x) => x.trim()).filter(Boolean)
      }
      return [...new Set(items.map((x) => optionOf(prop, x)))]
    }
    case 'date': {
      if (empty) return null
      const start = typeof raw === 'string' ? raw : isObj(raw) ? raw.start : null
      const end = isObj(raw) ? raw.end : null
      const a = typeof start === 'string' ? parseDate(start) : null
      const b = typeof end === 'string' && end.trim() ? parseDate(end) : null
      if (!a || (typeof end === 'string' && end.trim() && !b) || (end !== null && end !== undefined && typeof end !== 'string')) {
        throw new ValueError(prop.name, `${prop.name}: expected "YYYY-MM-DD", "YYYY-MM-DDTHH:MM" or { "start", "end" }`)
      }
      const time = a.time || !!b?.time
      const fit = (d: { value: string; time: boolean }) => (time && !d.time ? `${d.value}T00:00` : d.value)
      const startV = fit(a)
      const endV = b ? fit(b) : null
      if (endV && endV < startV) throw new ValueError(prop.name, `${prop.name}: the end is before the start`)
      return { start: startV, end: endV, ...(time ? { includeTime: true } : {}) }
    }
    case 'person':
      return empty ? [] : [...new Set(list(raw).map((x) => personOf(prop, x, ctx)))]
    case 'relation':
      return empty ? [] : [...new Set(list(raw).map((x) => relationOf(prop, x, ctx)))]
    case 'files': {
      if (empty) return []
      return list(raw).map((x) => {
        const url = typeof x === 'string' ? x.trim() : isObj(x) && typeof x.url === 'string' ? x.url.trim() : ''
        if (!/^https?:\/\/\S+$/i.test(url)) throw new ValueError(prop.name, `${prop.name}: files are http(s) URLs`)
        return url
      })
    }
    default:
      throw new ValueError(prop.name, `${prop.name}: ${t} properties cannot be set over the API`)
  }
}

/* ------------------------------------------------------------------ out */

/** Stored value → what the API returns; `undefined` = left out (computed in the app). */
export function friendly(prop: PropertyDef, row: { id: string; createdAt: number; updatedAt: number; createdBy?: string | null; updatedBy?: string | null; properties: Record<string, unknown> }, ctx: ValueContext): unknown {
  const v = row.properties[prop.id]
  const names = (ids: unknown) => list(ids).flatMap((id) => {
    const o = (prop.options ?? []).find((x) => x.id === id)
    return o ? [o.name] : []
  })
  switch (prop.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' && v ? v : null
    case 'number':
    case 'rating':
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'checkbox':
      return v === true
    case 'select':
    case 'status':
      return names(v)[0] ?? null
    case 'multi_select':
      return names(v)
    case 'date': {
      if (!isObj(v) || typeof v.start !== 'string') return null
      return { start: v.start, end: typeof v.end === 'string' && v.end ? v.end : null }
    }
    case 'person':
      return list(v).flatMap((id) => {
        if (typeof id !== 'string') return []
        const m = ctx.members.find((x) => x.id === id)
        const p = ctx.people.get(id)
        return [{ id, name: p?.name ?? m?.name ?? m?.email ?? '', email: m?.email ?? null }]
      })
    case 'relation':
      return list(v).flatMap((id) => {
        if (typeof id !== 'string') return []
        const yp = pageMap(ctx.r, id)
        return yp ? [{ id, title: typeof yp.get('title') === 'string' ? (yp.get('title') as string) : '' }] : []
      })
    case 'files':
      return list(v).filter((x): x is string => typeof x === 'string')
    case 'unique_id':
      return typeof v === 'number' ? (prop.idPrefix ? `${prop.idPrefix}-${v}` : v) : null
    case 'created_time':
      return iso(row.createdAt)
    case 'last_edited_time':
      return iso(row.updatedAt)
    case 'created_by':
      return actorOut(row.createdBy ?? null, ctx)
    case 'last_edited_by':
      return actorOut(row.updatedBy ?? null, ctx)
    default:
      return COMPUTED_OUT.has(prop.type) ? undefined : (v ?? null)
  }
}

/** Who wrote a page: a member like a person value, or the API token / incoming webhook / custom agent that did. */
function actorOut(actor: string | null, ctx: ValueContext) {
  if (!actor) return null
  if (actor.startsWith('api:')) return { kind: 'api', id: actor.slice(4) }
  if (actor.startsWith('hook:')) return { kind: 'webhook', id: actor.slice(5) }
  if (actor.startsWith('agent:')) return { kind: 'agent', id: actor.slice(6) }
  const m = ctx.members.find((x) => x.id === actor)
  const p = ctx.people.get(actor)
  return { kind: 'person', id: actor, name: p?.name ?? m?.name ?? m?.email ?? '', email: m?.email ?? null }
}

/** A database's schema as the API shows it. */
export function schemaOut(p: PropertyDef) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    readOnly: READ_ONLY_TYPES.has(p.type),
    ...(p.options ? { options: p.options.map((o) => ({ id: o.id, name: o.name, ...(o.color ? { color: o.color } : {}), ...(o.group ? { group: o.group } : {}) })) } : {}),
    ...(p.type === 'relation' && p.relationDatabaseId ? { relationDatabaseId: p.relationDatabaseId } : {}),
    ...(p.type === 'unique_id' && p.idPrefix ? { prefix: p.idPrefix } : {}),
    ...(p.type === 'rating' ? { max: p.ratingMax ?? 5 } : {}),
  }
}
