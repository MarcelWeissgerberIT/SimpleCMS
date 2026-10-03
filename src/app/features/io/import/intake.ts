/**
 * CSV into an EXISTING database (pure — no store writes, no DOM). The database area's
 * "Import CSV into this database…" reads the file, shows the mapping dialog and writes the rows:
 *
 *  - planCsvIntake(text, db): columns matched to properties by name (the title too; without a
 *    matching column the first unmatched one fills the title), the rest with a suggested type
 *    inferred from their values (number, date, checkbox, select / status for few repeating
 *    values, url, email … — csv.ts inferColumn) and a few sample values.
 *  - csvIntakeRows(plan, targets, ctx): one { title, values } per CSV line, each cell converted to
 *    the type of the property its column went into (options matched by name — missing ones are
 *    added to `options` when allowed —, people by name, related rows by title, dates / numbers in
 *    the column's own style).
 */
import type { ColorName, Database, ID, NumberFormat, Page, Person, PropertyDef, PropertyType, PropertyValue, SelectOption } from '../../../store/types'
import { COLOR_NAMES } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { cellValue, decimalStyleOf, inferColumn, parseCSV, parseDateValue, parseNumber, sniffDelimiter, splitList, statusGroupFor, unguardCell, type DecimalStyle, type Delimiter } from './csv'

/** Rows beyond this are left out (reported as `dropped`). */
export const CSV_INTAKE_MAX_ROWS = 5000

export interface CsvIntakeColumn {
  index: number
  name: string
  /** The property with the same name (or the title, for the first unmatched column), else null. */
  match: ID | null
  /** Suggested type for a new property, with its options / number format. */
  type: PropertyType
  options?: SelectOption[]
  numberFormat?: NumberFormat
  /** A few distinct non-empty values (for the dialog). */
  samples: string[]
}

export interface CsvIntakePlan {
  columns: CsvIntakeColumn[]
  /** The data lines (header removed, empty lines dropped, at most CSV_INTAKE_MAX_ROWS). */
  rows: string[][]
  dropped: number
  delimiter: Delimiter
}

const SUGGESTABLE = new Set<PropertyType>(['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email'])

export function planCsvIntake(text: string, db: Database): CsvIntakePlan | null {
  const table = parseCSV(text)
  if (!table.length) return null
  const delimiter = sniffDelimiter(text)
  const [header, ...lines] = table
  const body = lines.filter((r) => r.some((c) => c.trim() !== ''))
  const rows = body.slice(0, CSV_INTAKE_MAX_ROWS)
  const taken = new Set<ID>()
  const columns: CsvIntakeColumn[] = header.map((raw, index) => {
    const name = unguardCell(raw).trim() || `Column ${index + 1}`
    const values = rows.map((r) => unguardCell(r[index] ?? '').trim())
    const match = db.properties.find((p) => !taken.has(p.id) && p.name.trim().toLowerCase() === name.toLowerCase()) ?? null
    if (match) taken.add(match.id)
    // index 1: inferColumn treats index 0 as the title — here every column is data
    const spec = inferColumn(name, values, 1, { delimiter })
    const type: PropertyType = SUGGESTABLE.has(spec.type) ? spec.type : 'text'
    const samples: string[] = []
    for (const v of values) if (v && !samples.includes(v) && samples.push(v) >= 3) break
    return { index, name, match: match?.id ?? null, type, options: type === spec.type ? spec.options : undefined, numberFormat: spec.numberFormat, samples }
  })
  const title = db.properties.find((p) => p.type === 'title')
  if (title && !taken.has(title.id)) {
    const first = columns.find((c) => !c.match)
    if (first) first.match = title.id
  }
  return { columns, rows, dropped: body.length - rows.length, delimiter }
}

export interface CsvIntakeContext {
  pages: Record<ID, Page>
  people: Person[]
  /** Missing select / status / multi-select options may be added (not on a locked database). */
  addOptions: boolean
}

export interface CsvIntakeRows {
  rows: Array<{ title: string; values: Record<ID, PropertyValue> }>
  /** Properties that gained options: their complete new option list. */
  options: Record<ID, SelectOption[]>
}

interface Column {
  index: number
  prop: PropertyDef
  decimal: DecimalStyle
  dayFirst: boolean
}

const PALETTE = COLOR_NAMES.filter((c) => c !== 'default')
const lower = (s: string) => s.trim().toLowerCase()

/** One { title, values } per CSV line; `targets` = which property each used column goes into. */
export function csvIntakeRows(plan: CsvIntakePlan, targets: Array<{ index: number; prop: PropertyDef }>, ctx: CsvIntakeContext): CsvIntakeRows {
  const cols: Column[] = targets.map(({ index, prop }) => {
    const values = plan.rows.map((r) => unguardCell(r[index] ?? '').trim()).filter(Boolean)
    // ambiguous slash dates: day first in European CSVs, or when a first number can't be a month
    const dayFirst =
      plan.delimiter === ';' ||
      values.some((v) => {
        const m = v.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/)
        return !!m && +m[1] > 12
      })
    return { index, prop, decimal: decimalStyleOf(values, plan.delimiter), dayFirst }
  })

  // options first: every name a select-like column brings that its property doesn't have yet
  const options: Record<ID, SelectOption[]> = {}
  const optionsOf = (p: PropertyDef) => options[p.id] ?? p.options ?? []
  if (ctx.addOptions)
    for (const c of cols) {
      const p = c.prop
      if (p.type !== 'select' && p.type !== 'status' && p.type !== 'multi_select') continue
      for (const r of plan.rows) {
        const raw = unguardCell(r[c.index] ?? '').trim()
        const names = p.type === 'multi_select' ? splitList(raw) : raw ? [raw] : []
        for (const name of names) {
          const list = optionsOf(p)
          if (list.some((o) => lower(o.name) === lower(name))) continue
          const color: ColorName = PALETTE[list.length % PALETTE.length]
          options[p.id] = [...list, { id: newId(), name, color, ...(p.type === 'status' ? { group: statusGroupFor(name) } : {}) }]
        }
      }
    }

  const titleIndex = new Map<ID, Map<string, ID>>()
  const rowsByTitle = (dbId: ID): Map<string, ID> => {
    let m = titleIndex.get(dbId)
    if (!m) {
      m = new Map()
      for (const p of Object.values(ctx.pages)) if (p.databaseId === dbId && !p.trashed && p.title.trim() && !m.has(lower(p.title))) m.set(lower(p.title), p.id)
      titleIndex.set(dbId, m)
    }
    return m
  }

  const convert = (c: Column, raw: string): PropertyValue | undefined => {
    const p = c.prop
    switch (p.type) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        return raw
      case 'number':
      case 'rating': {
        const n = raw ? parseNumber(raw, c.decimal) : null
        if (!n) return null
        return p.type === 'rating' ? Math.max(0, Math.min(p.ratingMax ?? 5, Math.round(n.value))) : n.value
      }
      case 'checkbox':
        return cellValue({ name: p.name, type: 'checkbox' }, raw)
      case 'date':
        return raw ? parseDateValue(raw, c.dayFirst) : null
      case 'select':
      case 'status':
        return raw ? (optionsOf(p).find((o) => lower(o.name) === lower(raw))?.id ?? null) : null
      case 'multi_select': {
        const ids = splitList(raw)
          .map((name) => optionsOf(p).find((o) => lower(o.name) === lower(name))?.id)
          .filter((id): id is string => !!id)
        return [...new Set(ids)]
      }
      case 'person': {
        const ids = splitList(raw)
          .map((name) => ctx.people.find((x) => lower(x.name) === lower(name))?.id)
          .filter((id): id is string => !!id)
        return [...new Set(ids)]
      }
      case 'relation': {
        if (!p.relationDatabaseId) return undefined
        const byTitle = rowsByTitle(p.relationDatabaseId)
        const ids = splitList(raw)
          .map((name) => byTitle.get(lower(name)))
          .filter((id): id is string => !!id)
        return [...new Set(ids)]
      }
      case 'files':
        return splitList(raw).filter((tok) => /^https?:\/\/\S+$/i.test(tok))
      default:
        // computed properties fill themselves
        return undefined
    }
  }

  const rows = plan.rows.map((r) => {
    let title = ''
    const values: Record<ID, PropertyValue> = {}
    for (const c of cols) {
      const raw = unguardCell(r[c.index] ?? '').trim()
      if (c.prop.type === 'title') {
        title = raw
        continue
      }
      const v = convert(c, raw)
      if (v !== undefined) values[c.prop.id] = v
    }
    return { title, values }
  })
  return { rows, options }
}
