/**
 * AI autofill — turn Claude's raw `value` into a stored property value, or a readable error.
 * Nothing here writes: an answer that doesn't fit the property becomes a per-row error.
 *
 * select / multi_select answers carry option *names*; ids are resolved when a proposal is applied
 * (new options — "allow new options" — are created only then).
 */
import type { AutofillConfig, PropertyDef, PropertyValue } from '../../store/types'
import { t } from '../../i18n'

export type Coerced =
  | { ok: true; value: PropertyValue; names?: string[]; newNames?: string[] }
  | { ok: false; error: string }

const MAX_TEXT = 5000

const show = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

const unquote = (s: string) => s.trim().replace(/^["'“„«]+|["'”“»]+$/g, '').trim()

function fail(key: string, vars: Record<string, string | number>): Coerced {
  return { ok: false, error: t(`database.autofill.err.${key}`, vars) }
}

/** http(s) URL from an answer ("example.com/x" gets https://), or null. */
export function normalizeUrl(raw: string): string | null {
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

function options(prop: PropertyDef, cfg: AutofillConfig, raw: string[]): Coerced {
  const names: string[] = []
  const newNames: string[] = []
  const bad: string[] = []
  for (const r of raw) {
    const name = unquote(r)
    if (!name) continue
    const hit = prop.options?.find((o) => o.name.toLowerCase() === name.toLowerCase())
    const final = hit?.name ?? name.slice(0, 60)
    if (names.some((n) => n.toLowerCase() === final.toLowerCase())) continue
    if (!hit) {
      if (!cfg.allowNewOptions) {
        bad.push(name)
        continue
      }
      newNames.push(final)
    }
    names.push(final)
  }
  if (bad.length) return fail('option', { value: bad.join(', '), name: prop.name })
  const ids = names.map((n) => prop.options?.find((o) => o.name === n)?.id).filter((x): x is string => !!x)
  const value: PropertyValue = prop.type === 'select' ? (names.length ? (ids[0] ?? null) : null) : ids
  return { ok: true, value, names: prop.type === 'select' ? names.slice(0, 1) : names, newNames: prop.type === 'select' ? newNames.slice(0, 1) : newNames }
}

/** Validate / coerce a raw answer for a property. */
export function coerceAnswer(prop: PropertyDef, cfg: AutofillConfig, raw: unknown): Coerced {
  const typeName = t(`database.type.${prop.type}`)
  switch (prop.type) {
    case 'text': {
      if (raw === null || raw === undefined) return { ok: true, value: '' }
      if (typeof raw === 'number' || typeof raw === 'boolean') return { ok: true, value: String(raw) }
      if (typeof raw !== 'string') return fail('type', { value: show(raw), type: typeName })
      return { ok: true, value: raw.trim().slice(0, MAX_TEXT) }
    }
    case 'number': {
      if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[\s+-]*[\d.,]+\s*$/.test(raw) ? Number(raw.replace(/[\s,]/g, '')) : NaN
      return Number.isFinite(n) ? { ok: true, value: n } : fail('number', { value: show(raw) })
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === null) return { ok: true, value: false }
      const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      if (['true', 'yes', 'ja', '1'].includes(s)) return { ok: true, value: true }
      if (['false', 'no', 'nein', '0'].includes(s)) return { ok: true, value: false }
      return fail('checkbox', { value: show(raw) })
    }
    case 'url': {
      if (raw === null || raw === undefined || raw === '') return { ok: true, value: '' }
      if (typeof raw !== 'string') return fail('type', { value: show(raw), type: typeName })
      const url = normalizeUrl(raw)
      return url ? { ok: true, value: url } : fail('url', { value: show(raw) })
    }
    case 'select': {
      if (raw === null || raw === undefined || raw === '') return { ok: true, value: null, names: [], newNames: [] }
      if (Array.isArray(raw) && raw.length <= 1 && raw.every((x) => typeof x === 'string')) return options(prop, cfg, raw as string[])
      if (typeof raw !== 'string') return fail('type', { value: show(raw), type: typeName })
      return options(prop, cfg, [raw])
    }
    case 'multi_select': {
      if (raw === null || raw === undefined) return { ok: true, value: [], names: [], newNames: [] }
      if (typeof raw === 'string') return options(prop, cfg, raw.split(','))
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) return fail('type', { value: show(raw), type: typeName })
      return options(prop, cfg, raw)
    }
  }
  return fail('type', { value: show(raw), type: typeName })
}

/** Same value as what's stored? (proposals equal to the current value need no review) */
export function sameValue(prop: PropertyDef, current: PropertyValue | undefined, next: Coerced & { ok: true }): boolean {
  if (next.newNames?.length) return false
  const norm = (v: PropertyValue | undefined): string => {
    if (v === undefined || v === null || v === '') return prop.type === 'checkbox' ? 'false' : prop.type === 'multi_select' ? '[]' : ''
    if (Array.isArray(v)) return JSON.stringify([...v].sort())
    return typeof v === 'string' ? v.trim() : JSON.stringify(v)
  }
  return norm(current) === norm(next.value)
}
