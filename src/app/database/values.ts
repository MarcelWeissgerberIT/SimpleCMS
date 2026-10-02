// STUB — replaced by the database area.
import type { Database, Page, PropertyDef } from '../store/types'

export function propertyValueToText(_db: Database, prop: PropertyDef, row: Page): string {
  const v = row.properties[prop.id]
  if (prop.type === 'title') return row.title
  if (v === null || v === undefined) return ''
  return Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? v.start : String(v)
}
