/**
 * Form model: which properties become questions, what an answer looks like per kind,
 * validation, and turning answers into a row (workspace) or a webhook JSON (shared form).
 *
 * Questions = the title property + view.visibleProperties (in that order), minus computed
 * properties. Per-question settings live in view.form.questions[propertyId].
 */
import type { ColorName, Database, FormConfig, FormQuestion, ID, PropertyDef, PropertyType, PropertyValue, View } from '../../store/types'
import { parseNumberText } from '../model/format'

export type FieldKind = 'short' | 'long' | 'number' | 'select' | 'multi' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'rating' | 'files' | 'person' | 'relation'

export interface FieldOption {
  id: string
  name: string
  color: ColorName
}

export interface Field {
  /** Answer key: property id (workspace form) or "q<n>" (shared form). */
  key: string
  name: string
  kind: FieldKind
  required: boolean
  help: string
  options?: FieldOption[]
  includeTime?: boolean
  /** rating: number of stars */
  max?: number
  /** number: shown / typed as percent, stored as a fraction */
  percent?: boolean
  /** Workspace form only. */
  prop?: PropertyDef
}

export interface DateAnswer {
  date: string
  time: string
}

/**
 * short/long/url/email/phone/number → string (number: the typed text)
 * select → option id | null · multi/person/relation → string[] · checkbox → boolean
 * rating → number (0 = none) · date → DateAnswer · files → File[]
 */
export type Answer = string | null | string[] | boolean | number | DateAnswer | File[]
export type Answers = Record<string, Answer>

/** Property types a form can ask for (computed ones fill themselves). */
export const FORM_TYPES: PropertyType[] = ['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone', 'files', 'relation', 'rating']
export const isFormable = (p: PropertyDef) => FORM_TYPES.includes(p.type)

export function kindOf(type: PropertyType): FieldKind | null {
  switch (type) {
    case 'title':
      return 'short'
    case 'text':
      return 'long'
    case 'number':
      return 'number'
    case 'select':
    case 'status':
      return 'select'
    case 'multi_select':
      return 'multi'
    case 'date':
      return 'date'
    case 'checkbox':
      return 'checkbox'
    case 'url':
      return 'url'
    case 'email':
      return 'email'
    case 'phone':
      return 'phone'
    case 'rating':
      return 'rating'
    case 'files':
      return 'files'
    case 'person':
      return 'person'
    case 'relation':
      return 'relation'
    default:
      return null
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The view's form settings (defensive: older or damaged views may have none). */
export function formConfig(view: View): FormConfig {
  return isObj(view.form) ? view.form : {}
}

export function questionOf(cfg: FormConfig, id: ID): FormQuestion {
  const q = isObj(cfg.questions) ? cfg.questions[id] : undefined
  return isObj(q) ? q : {}
}

/** Title property of a database (every database has one; see persistence repair). */
export function titlePropOf(db: Database): PropertyDef {
  return db.properties.find((p) => p.type === 'title') ?? { id: '__title__', name: 'Name', type: 'title' }
}

/** Shown questions (title first, then view order) and the formable properties left out. */
export function formProps(db: Database, view: View): { shown: PropertyDef[]; hidden: PropertyDef[]; computed: PropertyDef[]; title: PropertyDef } {
  const cfg = formConfig(view)
  const title = titlePropOf(db)
  const byId = new Map(db.properties.map((p) => [p.id, p]))
  const listed = view.visibleProperties.map((id) => byId.get(id)).filter((p): p is PropertyDef => !!p && p.type !== 'title' && isFormable(p))
  const shown = [...(questionOf(cfg, title.id).hidden ? [] : [title]), ...listed]
  const hidden = db.properties.filter((p) => isFormable(p) && !shown.includes(p))
  const computed = db.properties.filter((p) => !isFormable(p))
  return { shown, hidden, computed, title }
}

/** One field per shown question of a workspace form view. */
export function fieldsOf(db: Database, view: View): Field[] {
  const cfg = formConfig(view)
  return formProps(db, view).shown.map((p) => fieldFor(p, questionOf(cfg, p.id)))
}

export function fieldFor(p: PropertyDef, q: FormQuestion): Field {
  const kind = kindOf(p.type) ?? 'short'
  const f: Field = { key: p.id, name: p.name, kind, required: !!q.required, help: typeof q.help === 'string' ? q.help : '', prop: p }
  if (kind === 'select' || kind === 'multi') f.options = (p.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color }))
  if (kind === 'date') f.includeTime = !!q.includeTime
  if (kind === 'rating') f.max = Math.max(1, Math.min(10, p.ratingMax ?? 5))
  if (kind === 'number') f.percent = p.numberFormat === 'percent'
  return f
}

/* ---------------- answers ---------------- */

export function emptyAnswer(f: Field): Answer {
  switch (f.kind) {
    case 'select':
      return null
    case 'multi':
    case 'person':
    case 'relation':
      return []
    case 'files':
      return [] as File[]
    case 'checkbox':
      return false
    case 'rating':
      return 0
    case 'date':
      return { date: '', time: '' }
    default:
      return ''
  }
}

export function emptyAnswers(fields: Field[]): Answers {
  return Object.fromEntries(fields.map((f) => [f.key, emptyAnswer(f)]))
}

export function isEmptyAnswer(f: Field, a: Answer | undefined): boolean {
  if (a === undefined || a === null) return true
  if (f.kind === 'checkbox') return a !== true
  if (f.kind === 'rating') return !a
  if (f.kind === 'date') return !(a as DateAnswer).date
  if (Array.isArray(a)) return a.length === 0
  return typeof a === 'string' ? !a.trim() : false
}

/** "example.com" → "https://example.com"; anything already carrying a scheme stays. */
export function normalizeUrl(s: string): string {
  const v = s.trim()
  if (!v) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

export function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return (u.protocol === 'https:' || u.protocol === 'http:') && /\S+\.\S+|^localhost$/.test(u.hostname)
  } catch {
    return false
  }
}

/** Hosts a shared form may post to over plain http (local testing only). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Webhook of a shared form: https only — the answers travel from strangers' browsers, so they
 * must not cross the network in clear text. http://localhost / 127.0.0.1 stay allowed for testing.
 */
export function isValidWebhookUrl(s: string): boolean {
  if (!isValidHttpUrl(s)) return false
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || LOCAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
const PHONE = /^\+?[\d\s()./-]+$/

/** Per-file size limit of shared forms (files travel inside the webhook JSON). */
export const SHARED_FILE_MAX = 1.5 * 1024 * 1024
/** All files of one shared-form response together (base64 adds a third on top). */
export const SHARED_FILES_TOTAL = 5 * 1024 * 1024

export type FieldError = 'required' | 'url' | 'email' | 'phone' | 'number' | 'time' | 'fileSize' | 'filesTotal'

export function validate(f: Field, a: Answer | undefined, lang: string, opts: { shared?: boolean } = {}): FieldError | null {
  if (isEmptyAnswer(f, a)) return f.required ? 'required' : null
  switch (f.kind) {
    case 'url':
      return isValidHttpUrl(normalizeUrl(a as string)) ? null : 'url'
    case 'email':
      return EMAIL.test((a as string).trim()) ? null : 'email'
    case 'phone': {
      const v = (a as string).trim()
      return PHONE.test(v) && v.replace(/\D/g, '').length >= 5 ? null : 'phone'
    }
    case 'number':
      return parseNumberText(a as string, !!f.percent, lang) === null ? 'number' : null
    case 'date': {
      const d = a as DateAnswer
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'required'
      return d.time && !/^\d{2}:\d{2}$/.test(d.time) ? 'time' : null
    }
    case 'files':
      return opts.shared && (a as File[]).some((file) => file.size > SHARED_FILE_MAX) ? 'fileSize' : null
    default:
      return null
  }
}

export function validateAll(fields: Field[], answers: Answers, lang: string, opts: { shared?: boolean } = {}): Record<string, FieldError> {
  const out: Record<string, FieldError> = {}
  for (const f of fields) {
    const e = validate(f, answers[f.key], lang, opts)
    if (e) out[f.key] = e
  }
  // shared forms: every file travels inside one JSON request — cap them together, too
  if (opts.shared) {
    const withFiles = fields.filter((f) => f.kind === 'files' && Array.isArray(answers[f.key]) && (answers[f.key] as File[]).length > 0)
    const total = withFiles.reduce((sum, f) => sum + (answers[f.key] as File[]).reduce((s, file) => s + file.size, 0), 0)
    if (total > SHARED_FILES_TOTAL) for (const f of withFiles) out[f.key] ??= 'filesTotal'
  }
  return out
}

function dateString(d: DateAnswer, withTime: boolean): string {
  return withTime && d.time ? `${d.date}T${d.time}` : d.date
}

/* ---------------- answers → row ---------------- */

export interface RowDraft {
  title: string
  properties: Record<ID, PropertyValue>
  /** Relations are written after the row exists (two-way sync goes through writeValue). */
  relations: Array<{ prop: PropertyDef; ids: string[] }>
  /** Files to store first (IndexedDB), then set on the row. */
  files: Array<{ propId: ID; files: File[] }>
}

/** Answers of a workspace form as row values (only answered questions). */
export function answersToRow(fields: Field[], answers: Answers, lang: string): RowDraft {
  const out: RowDraft = { title: '', properties: {}, relations: [], files: [] }
  for (const f of fields) {
    const a = answers[f.key]
    const p = f.prop
    if (!p || isEmptyAnswer(f, a)) continue
    if (p.type === 'title') {
      out.title = String(a).trim()
      continue
    }
    switch (f.kind) {
      case 'short':
      case 'long':
      case 'email':
      case 'phone':
        out.properties[p.id] = String(a).trim()
        break
      case 'url':
        out.properties[p.id] = normalizeUrl(String(a))
        break
      case 'number':
        out.properties[p.id] = parseNumberText(String(a), !!f.percent, lang)
        break
      case 'select':
        out.properties[p.id] = a as string
        break
      case 'multi':
      case 'person':
        out.properties[p.id] = [...(a as string[])]
        break
      case 'relation':
        out.relations.push({ prop: p, ids: [...(a as string[])] })
        break
      case 'checkbox':
        out.properties[p.id] = a === true
        break
      case 'rating':
        out.properties[p.id] = a as number
        break
      case 'date': {
        const d = a as DateAnswer
        const withTime = !!f.includeTime && !!d.time
        out.properties[p.id] = { start: dateString(d, withTime), ...(withTime ? { includeTime: true } : {}) }
        break
      }
      case 'files':
        out.files.push({ propId: p.id, files: [...(a as File[])] })
        break
    }
  }
  return out
}

/* ---------------- answers → webhook JSON ---------------- */

/** Question names as JSON keys: unique ("Name", "Name (2)"), never empty. */
export function answerKeys(fields: Field[]): Map<string, string> {
  const used = new Map<string, number>()
  const out = new Map<string, string>()
  fields.forEach((f, i) => {
    const base = f.name.trim() || `Q${i + 1}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    out.set(f.key, n === 1 ? base : `${base} (${n})`)
  })
  return out
}

export interface FileAnswer {
  name: string
  type: string
  size: number
  /** data: URL (base64) — files of shared forms travel inside the JSON */
  data: string
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Webhook answers keyed by question name. Selects send option NAMES, never ids. */
/**
 * A record keyed by question names, which come from the form's author (a shared link is
 * untrusted): no prototype, and every key — "__proto__" included — is an own data property.
 */
function answerRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>
}

function putAnswer(out: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
}

export async function answersToJson(fields: Field[], answers: Answers, lang: string): Promise<Record<string, unknown>> {
  const keys = answerKeys(fields)
  const out = answerRecord()
  for (const f of fields) {
    const a = answers[f.key]
    const key = keys.get(f.key)!
    const empty = isEmptyAnswer(f, a)
    const optName = (id: string) => f.options?.find((o) => o.id === id)?.name ?? id
    const set = (v: unknown) => putAnswer(out, key, v)
    switch (f.kind) {
      case 'select':
        set(empty ? null : optName(a as string))
        break
      case 'multi':
      case 'person':
      case 'relation':
        set(empty ? [] : (a as string[]).map(optName))
        break
      case 'checkbox':
        set(a === true)
        break
      case 'rating':
        set(empty ? null : (a as number))
        break
      case 'number':
        set(empty ? null : parseNumberText(String(a), !!f.percent, lang))
        break
      case 'date':
        set(empty ? null : dateString(a as DateAnswer, !!f.includeTime))
        break
      case 'url':
        set(empty ? '' : normalizeUrl(String(a)))
        break
      case 'files':
        set(empty ? [] : await Promise.all((a as File[]).map(async (file): Promise<FileAnswer> => ({ name: file.name, type: file.type, size: file.size, data: await readDataUrl(file) }))))
        break
      default:
        set(empty ? '' : String(a).trim())
    }
  }
  return out
}

/** A plausible example answer per question, shaped like a shared-form response (webhook "Send test", payload preview). */
export function sampleJson(fields: Field[]): Record<string, unknown> {
  const keys = answerKeys(fields)
  // no prototype: assigning a "__proto__" question name creates an own key, like any other name
  const out = answerRecord()
  for (const f of fields) {
    const key = keys.get(f.key)!
    switch (f.kind) {
      case 'select':
        out[key] = f.options?.[0]?.name ?? null
        break
      case 'multi':
        out[key] = (f.options ?? []).slice(0, 2).map((o) => o.name)
        break
      // shared links ask person / relation questions as free text
      case 'person':
        out[key] = 'Ada Lovelace'
        break
      case 'relation':
        out[key] = 'Example'
        break
      case 'files':
        out[key] = []
        break
      case 'checkbox':
        out[key] = true
        break
      case 'rating':
        out[key] = Math.min(4, f.max ?? 5)
        break
      case 'number':
        out[key] = f.percent ? 0.5 : 42
        break
      case 'date':
        out[key] = f.includeTime ? '2026-10-15T14:30' : '2026-10-15'
        break
      case 'url':
        out[key] = 'https://example.com'
        break
      case 'email':
        out[key] = 'ada@example.com'
        break
      case 'phone':
        out[key] = '+49 30 1234567'
        break
      default:
        out[key] = f.kind === 'long' ? 'Lorem ipsum' : 'Example'
    }
  }
  return out
}
