/**
 * Fields compared between draft time and the press (pure). Paths follow the fixed grammar ROUTE_PATH
 * (store/integrations.ts): names, array indexes (negative = from the end: "comments.-1"), and `length`.
 * Values are compared as short texts (`show`), never as objects.
 */
import { ROUTE_PATH, show } from '../../store/integrations'

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** The value at a path (undefined: not there, or the path is off the grammar). Never reaches prototypes. */
export function pickPath(root: unknown, path: string): unknown {
  if (!ROUTE_PATH.test(path)) return undefined
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    if (seg === 'length') {
      if (Array.isArray(cur) || typeof cur === 'string') {
        cur = cur.length
        continue
      }
      if (typeof cur === 'object' && own(cur, 'length')) {
        cur = (cur as Record<string, unknown>).length
        continue
      }
      return undefined
    }
    if (/^-?\d+$/.test(seg)) {
      if (!Array.isArray(cur)) return undefined
      const i = Number(seg)
      cur = cur[i < 0 ? cur.length + i : i]
      continue
    }
    if (typeof cur !== 'object' || Array.isArray(cur) || !own(cur, seg)) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** A value as the slip compares and shows it ('' for nothing). */
export function fieldText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return show(v)
}

/** The named fields of a record, as texts. */
export function pickFields(record: unknown, paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of paths) out[p] = fieldText(pickPath(record, p))
  return out
}

export interface FieldChange {
  field: string
  before: string
  now: string
}

/** What changed between two readings (fields only in one of them count as changed). */
export function diffFields(before: Record<string, string>, now: Record<string, string>): FieldChange[] {
  const out: FieldChange[] = []
  for (const field of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const a = before[field] ?? ''
    const b = now[field] ?? ''
    if (a !== b) out.push({ field, before: a, now: b })
  }
  return out
}

/** A row's reading for the slice-1 pre-read ("per mirror"): its source fields by role, and its newest comment. */
export interface RowReading {
  fields: Record<string, string>
  labels: Record<string, string>
  latest?: string
}

/** The roles the mirror keeps that say "the record moved": compared at draft time and after every mirror write. */
export const BASELINE_ROLES = ['comments', 'lastCommentAt', 'srcStatus', 'changedAt'] as const

/**
 * The baseline of a row from its typed source fields (`values`: role → { label, text }) and the last comment's text.
 * Only roles the database has count.
 */
export function rowBaseline(values: Partial<Record<string, { label: string; text: string }>>, latest?: string): RowReading {
  const fields: Record<string, string> = {}
  const labels: Record<string, string> = {}
  for (const role of BASELINE_ROLES) {
    const v = values[role]
    if (!v) continue
    fields[role] = v.text
    labels[role] = v.label
  }
  return { fields, labels, ...(latest ? { latest } : {}) }
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 400)

/**
 * The baseline against a later reading: what changed, minus what this device's own sends explain. `own.texts`: the
 * replies this device sent (marked sent) on the row since the baseline — each adds one to the comment count, and
 * when the newest comment now IS one of them, its time moving is explained too.
 */
export function rowChanges(baseline: Record<string, string>, now: Record<string, string>, own: { texts: string[]; latest?: string } = { texts: [] }): FieldChange[] {
  const n = own.texts.length
  if (!n) return diffFields(baseline, now)
  const latestIsOwn = !!own.latest && own.texts.some((t) => squash(t) === squash(own.latest!))
  return diffFields(baseline, now).filter((c) => {
    if (c.field === 'comments') {
      const a = Number(c.before)
      const b = Number(c.now)
      return !(Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= n)
    }
    if (c.field === 'lastCommentAt') return !latestIsOwn
    return true
  })
}
