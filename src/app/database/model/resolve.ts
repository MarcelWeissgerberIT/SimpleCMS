/**
 * Value resolution: stored values, computed values (formula, rollup, timestamps),
 * plain-text rendering. A Resolver caches per render pass.
 */
import type { Lang } from '@/shared/i18n'
import type { Database, DateValue, ID, Page, Person, PropertyDef, PropertyValue, RollupFn } from '../../store/types'
import { FormulaError, runFormula, toText, isDate, withRangeEnd, type FValue } from '../formula'
import { aggregate } from './calc'
import { formatDateValue, formatNumber, formatTimestamp, isDateValue, parseLocal } from './format'
import { cachedFileName } from './files'
import { actorName, actorOf, type ActorLabels, type MeCtx } from './actors'

export interface Ctx {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  people: Person[]
  lang: Lang
  now: number
  labels: { today: string; tomorrow: string; yesterday: string; untitled: string; yes: string; no: string } & ActorLabels
  /** Who "Me" / the local user is (created_by, last_edited_by, "Me" filters). */
  me: MeCtx
}

/** Resolved values: stored PropertyValue for plain types, FValue / FormulaError for computed ones. */
export type Resolved = PropertyValue | FValue | FormulaError | undefined

const MAX_DEPTH = 8

export class Resolver {
  ctx: Ctx
  private cache = new Map<string, Resolved>()
  private stack = new Set<string>()
  private propsByName = new Map<ID, Map<string, PropertyDef>>()

  constructor(ctx: Ctx) {
    this.ctx = ctx
  }

  /** Raw stored value or computed value for a property of a row. */
  value(db: Database, prop: PropertyDef, row: Page, depth = 0): Resolved {
    switch (prop.type) {
      case 'title':
        return row.title
      case 'created_time':
        return new Date(row.createdAt)
      case 'last_edited_time':
        return new Date(row.updatedAt)
      case 'created_by':
      case 'last_edited_by':
        return actorOf(prop, row, this.ctx.me)
      case 'formula':
      case 'rollup': {
        const key = row.id + ':' + prop.id
        if (this.cache.has(key)) return this.cache.get(key)
        if (this.stack.has(key) || depth > MAX_DEPTH) return new FormulaError('circular')
        this.stack.add(key)
        let v: Resolved
        try {
          v = prop.type === 'formula' ? this.formula(db, prop, row, depth) : this.rollup(db, prop, row, depth)
        } finally {
          this.stack.delete(key)
        }
        this.cache.set(key, v)
        return v
      }
      case 'checkbox':
        return row.properties[prop.id] === true
      default:
        return row.properties[prop.id] ?? null
    }
  }

  private propByName(db: Database, name: string): PropertyDef | undefined {
    let m = this.propsByName.get(db.id)
    if (!m) {
      m = new Map()
      for (const p of db.properties) m.set(p.name, p)
      for (const p of db.properties) if (!m.has(p.name.toLowerCase())) m.set(p.name.toLowerCase(), p)
      this.propsByName.set(db.id, m)
    }
    return m.get(name) ?? m.get(name.toLowerCase())
  }

  formula(db: Database, prop: PropertyDef, row: Page, depth = 0): FValue | FormulaError {
    const src = prop.formula ?? ''
    if (!src.trim()) return null
    return runFormula(src, {
      now: this.ctx.now,
      lang: this.ctx.lang,
      prop: (name) => {
        const p = this.propByName(db, name)
        if (!p) throw new FormulaError('unknownProperty', { name })
        if (p.id === prop.id) throw new FormulaError('circular')
        const v = this.value(db, p, row, depth + 1)
        if (v instanceof FormulaError) throw v
        return this.toFValue(db, p, v)
      },
    })
  }

  /** Convert a resolved property value into a formula value. */
  toFValue(_db: Database, p: PropertyDef, v: Resolved): FValue {
    if (v === undefined || v === null) return p.type === 'checkbox' ? false : p.type === 'multi_select' || p.type === 'person' || p.type === 'relation' || p.type === 'files' ? [] : null
    switch (p.type) {
      case 'select':
      case 'status':
        return p.options?.find((o) => o.id === v)?.name ?? ''
      case 'multi_select':
        return (v as string[]).map((id) => p.options?.find((o) => o.id === id)?.name).filter((x): x is string => !!x)
      case 'person':
        return (v as string[]).map((id) => this.ctx.people.find((x) => x.id === id)?.name).filter((x): x is string => !!x)
      case 'relation':
        return (v as string[]).map((id) => this.ctx.pages[id]).filter((x) => x && !x.trashed).map((x) => x.title || this.ctx.labels.untitled)
      case 'files':
        return (v as string[]).map(fileLabel)
      case 'created_by':
      case 'last_edited_by':
        return this.actorName(String(v))
      case 'date':
        if (!isDateValue(v)) return null
        {
          const start = parseLocal(v.start)
          return start ? withRangeEnd(start, parseLocal(v.end)) : null
        }
      default:
        return v as FValue
    }
  }

  /** Display name of a created_by / last_edited_by value. */
  actorName(id: string): string {
    return actorName(id, this.ctx.people, this.ctx.me, this.ctx.labels)
  }

  rollup(db: Database, prop: PropertyDef, row: Page, depth = 0): FValue | FormulaError {
    const cfg = prop.rollup
    if (!cfg) return null
    const rel = db.properties.find((p) => p.id === cfg.relationPropertyId && p.type === 'relation')
    const target = rel?.relationDatabaseId ? this.ctx.databases[rel.relationDatabaseId] : undefined
    const tprop = target?.properties.find((p) => p.id === cfg.targetPropertyId)
    if (!rel || !target || !tprop) return null
    const ids = (row.properties[rel.id] as string[] | undefined) ?? []
    const related = ids.map((id) => this.ctx.pages[id]).filter((p): p is Page => !!p && !p.trashed)
    const values = related.map((r) => this.value(target, tprop, r, depth + 1))
    if (cfg.fn === 'show_original') {
      const out: FValue[] = []
      for (const v of values) {
        if (v instanceof FormulaError) continue
        const f = this.toFValue(target, tprop, v)
        if (Array.isArray(f)) out.push(...f)
        else if (f !== null && f !== '') out.push(f)
      }
      return out
    }
    const res = aggregate(cfg.fn as Exclude<RollupFn, 'show_original'>, tprop, values, this.ctx.lang)
    return res.value
  }

  /** Plain-text rendering (search, export, AI). */
  text(db: Database, prop: PropertyDef, row: Page): string {
    return this.textOf(db, prop, this.value(db, prop, row))
  }

  textOf(db: Database, prop: PropertyDef, v: Resolved): string {
    const { lang, labels } = this.ctx
    if (v instanceof FormulaError) return '#ERROR'
    if (v === null || v === undefined) return ''
    switch (prop.type) {
      case 'title':
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        return String(v)
      case 'number':
        return typeof v === 'number' ? formatNumber(v, prop.numberFormat, lang) : ''
      case 'rating':
        return typeof v === 'number' && v > 0 ? `${v}/${prop.ratingMax ?? 5}` : ''
      case 'unique_id':
        return typeof v === 'number' ? (prop.idPrefix ? `${prop.idPrefix}-${v}` : String(v)) : ''
      case 'checkbox':
        return v === true ? labels.yes : labels.no
      case 'date':
        return isDateValue(v) ? formatDateValue(v as DateValue, lang, labels, false) : ''
      case 'created_time':
      case 'last_edited_time':
        return isDate(v) ? formatTimestamp(v.getTime(), lang) : ''
      case 'created_by':
      case 'last_edited_by':
        return typeof v === 'string' ? this.actorName(v) : ''
      case 'formula':
      case 'rollup': {
        if (typeof v === 'number' && prop.type === 'rollup' && prop.rollup) return this.rollupNumberText(db, prop, v)
        return toText(v as FValue, lang)
      }
      default: {
        const f = this.toFValue(db, prop, v)
        return toText(f, lang)
      }
    }
  }

  private rollupNumberText(db: Database, prop: PropertyDef, v: number): string {
    const fn = prop.rollup!.fn
    if (fn.startsWith('percent')) return `${formatNumber(Math.round(v * 1000) / 10, undefined, this.ctx.lang)}%`
    const rel = db.properties.find((p) => p.id === prop.rollup!.relationPropertyId)
    const tdb = rel?.relationDatabaseId ? this.ctx.databases[rel.relationDatabaseId] : undefined
    const tprop = tdb?.properties.find((p) => p.id === prop.rollup!.targetPropertyId)
    // averages and medians are rarely whole: show them like Notion does (4.67), never as raw floats
    const round = (n: number) => Math.round(n * 100) / 100
    const fmt = tprop?.type === 'number' && ['sum', 'average', 'median', 'min', 'max', 'range'].includes(fn) ? tprop.numberFormat : undefined
    if (fmt && fmt !== 'number' && fmt !== 'comma') return formatNumber(v, fmt, this.ctx.lang)
    return formatNumber(round(v), fmt, this.ctx.lang)
  }
}

export function fileLabel(src: string): string {
  if (src.startsWith('onefile:')) return cachedFileName(src) ?? 'file'
  try {
    const u = new URL(src)
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname)
  } catch {
    return src.split('/').pop() || src
  }
}

/** Is a resolved value "empty" for this property? */
export function isEmptyValue(prop: PropertyDef, v: Resolved): boolean {
  if (v === null || v === undefined || v === '') return true
  if (v instanceof FormulaError) return true
  if (Array.isArray(v)) return v.length === 0
  if (prop.type === 'checkbox') return v !== true
  if (typeof v === 'number') return Number.isNaN(v)
  return false
}
