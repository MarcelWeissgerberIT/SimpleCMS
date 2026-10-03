/**
 * Shared form links: the form's schema IS the URL.
 *   <app>#/f/<base64url(deflate(JSON))>
 * The payload holds only what a respondent needs (title, description, questions with their
 * type / options / required / help, submit label, webhook URL) — never workspace data:
 * no property ids, no rows, no people. Person and relation questions become text questions.
 * Received payloads are untrusted: everything is type-checked, clamped and whitelisted.
 *
 * Versions: v1 = questions only. v2 (forms 2.0) adds per question a placeholder, a presentation,
 * "show only if" conditions (by question INDEX; option values by option index) and page breaks,
 * plus the closing screen. A form that uses none of these is still written as v1, so links keep
 * opening in older copies of the app; v1 links open unchanged.
 */
import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate'
import { COLOR_NAMES, type ColorName, type FormCondition, type FormConditionOp } from '../../store/types'
import { isValidHttpUrl, isValidWebhookUrl, type Field, type FieldKind } from './fields'
import { conditionIssue, opsFor, valueKind } from './logic'

export type SharedKind = Exclude<FieldKind, 'person' | 'relation'>
const SHARED_KINDS: SharedKind[] = ['short', 'long', 'number', 'select', 'multi', 'date', 'checkbox', 'url', 'email', 'phone', 'rating', 'files']

export interface SharedQuestion {
  name: string
  kind: SharedKind
  req?: 1
  help?: string
  /** select / multi: [name, colour] */
  opts?: Array<[string, ColorName]>
  /** date: ask for a time too */
  time?: 1
  /** rating: stars */
  max?: number
  /** number: percent */
  pct?: 1
  /* ---- v2 ---- */
  /** placeholder */
  ph?: string
  /** presentation: l = list, d = dropdown (select), s = scale (rating / number) */
  d?: 'l' | 'd' | 's'
  /** number scale: keys 1…10 (default 1…5) */
  sc?: 10
  /** show only if: o = 1 → any condition (else all); c = [question index, operator, value?] */
  if?: { o?: 1; c: SharedCondition[] }
  /** a new page starts here: section title / description */
  pg?: { t?: string; d?: string }
}

/** [index of an earlier question, operator, value] — select / multi values are option indexes. */
export type SharedCondition = [number, FormConditionOp] | [number, FormConditionOp, string | number]

/** The closing screen (v2): title, message, redirect URL, one = no "submit another response". */
export interface SharedEnd {
  t?: string
  m?: string
  url?: string
  one?: 1
}

export interface FormPayload {
  v: 1 | 2
  title: string
  desc: string
  submit: string
  hook: string
  q: SharedQuestion[]
  end?: SharedEnd
}

/** The form-level settings a shared link carries besides the questions. */
export interface ShareClosing {
  doneTitle?: string
  doneMessage?: string
  redirectUrl?: string
  allowAnother?: boolean
}

export class FormDecodeError extends Error {
  constructor(public code: 'empty' | 'corrupt' | 'version') {
    super(code)
  }
}

/**
 * What a shared link may carry. decodeForm() clamps received payloads to these limits, so the
 * share dialog refuses (formLimitIssue) any form that would lose questions, options or text.
 */
export const FORM_LIMITS = {
  questions: 80,
  options: 120,
  /** characters */
  name: 200,
  help: 1000,
  option: 200,
  title: 300,
  desc: 4000,
  submit: 80,
  hook: 2000,
  placeholder: 200,
  conditions: 20,
  section: 200,
  sectionDesc: 1000,
  doneTitle: 200,
  doneMessage: 2000,
  redirect: 2000,
  /** characters of the encoded payload in the link */
  encoded: 256 * 1024,
} as const

const MAX_QUESTIONS = FORM_LIMITS.questions
const MAX_OPTIONS = FORM_LIMITS.options
const MAX_INFLATED = 512 * 1024
const MAX_ENCODED = FORM_LIMITS.encoded

export type FormLimitKind =
  | 'questions'
  | 'options'
  | 'name'
  | 'help'
  | 'option'
  | 'title'
  | 'desc'
  | 'submit'
  | 'hook'
  | 'placeholder'
  | 'conditions'
  | 'section'
  | 'sectionDesc'
  | 'doneTitle'
  | 'doneMessage'
  | 'redirect'
  | 'encoded'

/** A form that cannot travel in a link as it is: which limit, and the question it concerns. */
export interface FormLimitIssue {
  kind: FormLimitKind
  limit: number
  /** the question (name) concerned, if any */
  question?: string
  /** current size (questions, options, characters) */
  count: number
}

export class FormLimitError extends Error {
  constructor(public issue: FormLimitIssue) {
    super(`form over the ${issue.kind} limit`)
  }
}

/** The first limit a payload breaks (decodeForm would cut it), or null when it fits. */
export function formLimitIssue(p: FormPayload, encoded?: string): FormLimitIssue | null {
  const over = (kind: FormLimitKind, count: number, question?: string): FormLimitIssue | null => (count > FORM_LIMITS[kind] ? { kind, limit: FORM_LIMITS[kind], count, ...(question !== undefined ? { question } : {}) } : null)
  const top =
    over('title', p.title.length) ??
    over('desc', p.desc.length) ??
    over('submit', p.submit.length) ??
    over('hook', p.hook.trim().length) ??
    over('questions', p.q.length) ??
    over('doneTitle', p.end?.t?.length ?? 0) ??
    over('doneMessage', p.end?.m?.length ?? 0) ??
    over('redirect', p.end?.url?.length ?? 0)
  if (top) return top
  for (const q of p.q) {
    const issue =
      over('name', q.name.length, q.name.slice(0, 60)) ??
      over('help', q.help?.length ?? 0, q.name) ??
      over('options', q.opts?.length ?? 0, q.name) ??
      over('option', Math.max(0, ...(q.opts ?? []).map(([name]) => name.length)), q.name) ??
      over('placeholder', q.ph?.length ?? 0, q.name) ??
      over('conditions', q.if?.c.length ?? 0, q.name) ??
      over('section', q.pg?.t?.length ?? 0, q.name) ??
      over('sectionDesc', q.pg?.d?.length ?? 0, q.name)
    if (issue) return issue
  }
  return encoded !== undefined ? over('encoded', encoded.length) : null
}

/* ---------------- base64url ---------------- */

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Inflate with an output cap (a few bytes of zeros can expand to gigabytes). */
function inflateCapped(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  let total = 0
  let done = false
  const inflater = new Inflate((chunk, final) => {
    total += chunk.length
    if (total > MAX_INFLATED) throw new Error('too large')
    parts.push(chunk)
    if (final) done = true
  })
  const CHUNK = 1024
  for (let i = 0; i < data.length; i += CHUNK) inflater.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length)
  if (!done) throw new Error('truncated')
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/* ---------------- build / encode ---------------- */

/**
 * The share payload of a form (workspace fields → respondent-facing schema).
 * Throws FormLimitError when the form is over a link limit (nothing is cut silently).
 */
export interface ShareInput {
  title: string
  description: string
  submitLabel: string
  webhookUrl: string
  fields: Field[]
  closing?: ShareClosing
}

export function buildPayload(input: ShareInput): FormPayload {
  const p = payloadOf(input)
  const issue = formLimitIssue(p)
  if (issue) throw new FormLimitError(issue)
  return p
}

/** Payload + its encoded form, or the limit it breaks (the share dialog's single entry point). */
export function encodeShareForm(input: ShareInput): { encoded: string; issue: null } | { encoded: null; issue: FormLimitIssue } {
  try {
    const p = buildPayload(input)
    const json = strToU8(JSON.stringify(p))
    // the receiving side inflates at most MAX_INFLATED bytes
    if (json.length > MAX_INFLATED) return { encoded: null, issue: { kind: 'encoded', limit: FORM_LIMITS.encoded, count: json.length } }
    const encoded = toBase64Url(deflateSync(json, { level: 9 }))
    const issue = formLimitIssue(p, encoded)
    return issue ? { encoded: null, issue } : { encoded, issue: null }
  } catch (e) {
    if (e instanceof FormLimitError) return { encoded: null, issue: e.issue }
    throw e
  }
}

/** A condition as it travels: question index, operator, option index / number / text / date. */
function sharedCondition(c: FormCondition, index: number, fields: Field[]): SharedCondition | null {
  if (conditionIssue(c, index, fields)) return null
  const j = fields.findIndex((f) => f.key === c.q)
  const src = fields[j]
  const vk = valueKind(src.kind, c.op)
  if (!vk) return [j, c.op]
  if (vk === 'option') return [j, c.op, src.options!.findIndex((o) => o.id === c.value)]
  return [j, c.op, vk === 'number' ? Number(c.value) : String(c.value)]
}

function payloadOf(input: ShareInput): FormPayload {
  let v2 = false
  const q = input.fields.map((f, i) => {
    const kind: SharedKind = f.kind === 'person' || f.kind === 'relation' ? 'short' : f.kind
    const q: SharedQuestion = { name: f.name, kind }
    if (f.required) q.req = 1
    if (f.help.trim()) q.help = f.help.trim()
    if ((kind === 'select' || kind === 'multi') && f.options) q.opts = f.options.map((o) => [o.name, o.color])
    if (kind === 'date' && f.includeTime) q.time = 1
    if (kind === 'rating') q.max = f.max ?? 5
    if (kind === 'number' && f.percent) q.pct = 1
    // v2
    if (f.placeholder?.trim()) q.ph = f.placeholder.trim()
    if (f.display === 'list' || f.display === 'dropdown' || f.display === 'scale') q.d = f.display === 'list' ? 'l' : f.display === 'dropdown' ? 'd' : 's'
    if (kind === 'number' && f.display === 'scale' && f.scale === 10) q.sc = 10
    const c = (f.showIf?.conditions ?? []).map((x) => sharedCondition(x, i, input.fields)).filter((x): x is SharedCondition => !!x)
    if (c.length) q.if = f.showIf!.op === 'or' ? { o: 1, c } : { c }
    if (f.page && i > 0) {
      q.pg = {}
      if (f.page.title.trim()) q.pg.t = f.page.title.trim()
      if (f.page.description.trim()) q.pg.d = f.page.description.trim()
    }
    if (q.ph || q.d || q.sc || q.if || q.pg) v2 = true
    return q
  })
  const p: FormPayload = { v: 1, title: input.title, desc: input.description, submit: input.submitLabel, hook: input.webhookUrl, q }
  const c = input.closing
  if (c) {
    const end: SharedEnd = {}
    if (c.doneTitle?.trim()) end.t = c.doneTitle.trim()
    if (c.doneMessage?.trim()) end.m = c.doneMessage.trim()
    if (c.redirectUrl?.trim() && isValidHttpUrl(c.redirectUrl.trim())) end.url = c.redirectUrl.trim()
    if (c.allowAnother === false) end.one = 1
    if (Object.keys(end).length) {
      p.end = end
      v2 = true
    }
  }
  if (v2) p.v = 2
  return p
}

export function encodeForm(p: FormPayload): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify(p)), { level: 9 }))
}

export function formUrl(encoded: string): string {
  return `${window.location.origin}${window.location.pathname}#/f/${encoded}`
}

/* ---------------- decode (untrusted) ---------------- */

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

const OPS: FormConditionOp[] = ['is', 'is_not', 'contains', 'not_contains', 'empty', 'not_empty', 'checked', 'unchecked', 'eq', 'gt', 'lt', 'before', 'after']

function sanitizeQuestion(raw: unknown): SharedQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = SHARED_KINDS.includes(r.kind as SharedKind) ? (r.kind as SharedKind) : null
  if (!kind) return null
  const q: SharedQuestion = { name: str(r.name, 200), kind }
  if (r.req) q.req = 1
  const help = str(r.help, 1000).trim()
  if (help) q.help = help
  if (kind === 'select' || kind === 'multi') {
    const opts = Array.isArray(r.opts) ? r.opts : []
    q.opts = opts
      .slice(0, MAX_OPTIONS)
      .filter((o): o is [unknown, unknown] => Array.isArray(o))
      .map(([name, color]) => [str(name, 200), COLOR_NAMES.includes(color as ColorName) ? (color as ColorName) : 'default'] as [string, ColorName])
      .filter(([name]) => !!name)
  }
  if (kind === 'date' && r.time) q.time = 1
  if (kind === 'rating') q.max = Math.max(1, Math.min(10, Math.round(Number(r.max) || 5)))
  if (kind === 'number' && r.pct) q.pct = 1
  return q
}

/** The v2 parts of a question (after all questions are known: conditions look back). */
function sanitizeV2(raw: unknown, q: SharedQuestion, index: number, all: SharedQuestion[]): void {
  const r = raw as Record<string, unknown>
  const ph = str(r.ph, FORM_LIMITS.placeholder).trim()
  if (ph) q.ph = ph
  if ((r.d === 'l' && (q.kind === 'select' || q.kind === 'multi')) || (r.d === 'd' && q.kind === 'select') || (r.d === 's' && (q.kind === 'rating' || (q.kind === 'number' && !q.pct)))) q.d = r.d
  if (q.kind === 'number' && q.d === 's' && Number(r.sc) === 10) q.sc = 10
  if (r.pg && typeof r.pg === 'object' && index > 0) {
    const pg = r.pg as Record<string, unknown>
    q.pg = {}
    const t = str(pg.t, FORM_LIMITS.section).trim()
    const d = str(pg.d, FORM_LIMITS.sectionDesc).trim()
    if (t) q.pg.t = t
    if (d) q.pg.d = d
  }
  const logic = r.if && typeof r.if === 'object' ? (r.if as Record<string, unknown>) : null
  if (!logic || !Array.isArray(logic.c)) return
  const c: SharedCondition[] = []
  for (const item of logic.c.slice(0, FORM_LIMITS.conditions)) {
    if (!Array.isArray(item)) continue
    const [j, op, value] = item as [unknown, unknown, unknown]
    if (!Number.isInteger(j) || (j as number) < 0 || (j as number) >= index || !OPS.includes(op as FormConditionOp)) continue
    const src = all[j as number]
    if (!opsFor(src.kind).includes(op as FormConditionOp)) continue
    const vk = valueKind(src.kind, op as FormConditionOp)
    if (!vk) c.push([j as number, op as FormConditionOp])
    else if (vk === 'option') {
      if (Number.isInteger(value) && (value as number) >= 0 && (value as number) < (src.opts?.length ?? 0)) c.push([j as number, op as FormConditionOp, value as number])
    } else if (vk === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) c.push([j as number, op as FormConditionOp, value])
    } else if (vk === 'date') {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) c.push([j as number, op as FormConditionOp, value])
    } else {
      const text = str(value, 200)
      if (text.trim()) c.push([j as number, op as FormConditionOp, text])
    }
  }
  if (c.length) q.if = logic.o ? { o: 1, c } : { c }
}

function sanitizeEnd(raw: unknown): SharedEnd | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const end: SharedEnd = {}
  const t = str(r.t, FORM_LIMITS.doneTitle).trim()
  const m = str(r.m, FORM_LIMITS.doneMessage).trim()
  const url = str(r.url, FORM_LIMITS.redirect).trim()
  if (t) end.t = t
  if (m) end.m = m
  // http(s) only: never a javascript: or data: address
  if (url && isValidHttpUrl(url)) end.url = url
  if (r.one) end.one = 1
  return Object.keys(end).length ? end : undefined
}

export function decodeForm(raw: string): FormPayload {
  let s = (raw ?? '').trim()
  try {
    s = decodeURIComponent(s)
  } catch {
    /* already decoded */
  }
  s = s.replace(/[\s=]/g, '')
  if (!s) throw new FormDecodeError('empty')
  if (s.length > MAX_ENCODED || !/^[A-Za-z0-9_-]+$/.test(s)) throw new FormDecodeError('corrupt')
  let data: unknown
  try {
    data = JSON.parse(strFromU8(inflateCapped(fromBase64Url(s))))
  } catch {
    throw new FormDecodeError('corrupt')
  }
  if (!data || typeof data !== 'object') throw new FormDecodeError('corrupt')
  const d = data as Record<string, unknown>
  if (d.v !== 1 && d.v !== 2) throw new FormDecodeError('version')
  const hook = str(d.hook, 2000).trim()
  const rawQs = (Array.isArray(d.q) ? d.q : []).slice(0, MAX_QUESTIONS)
  const kept = rawQs.map((r) => ({ r, q: sanitizeQuestion(r) })).filter((x): x is { r: unknown; q: SharedQuestion } => !!x.q)
  const q = kept.map((x) => x.q)
  // v2 extras: conditions point at question indexes, so they are read once the questions are known
  // (a v1 link has none of them; a dropped question invalidates conditions on it — they are skipped)
  if (d.v === 2 && kept.length === rawQs.length) kept.forEach((x, i) => sanitizeV2(x.r, x.q, i, q))
  else if (d.v === 2) kept.forEach((x, i) => sanitizeV2({ ...(x.r as object), if: undefined }, x.q, i, q))
  const out: FormPayload = {
    v: d.v,
    title: str(d.title, 300),
    desc: str(d.desc, 4000),
    submit: str(d.submit, 80),
    hook: isValidWebhookUrl(hook) ? hook : '',
    q,
  }
  const end = d.v === 2 ? sanitizeEnd(d.end) : undefined
  if (end) out.end = end
  return out
}

/** Fields of a received form (answer keys "q1", "q2" …; option ids = "o" + their index). */
export function payloadFields(p: FormPayload): Field[] {
  return p.q.map((q, i) => {
    const f: Field = {
      key: `q${i + 1}`,
      name: q.name,
      kind: q.kind,
      required: !!q.req,
      help: q.help ?? '',
      options: q.opts?.map(([name, color], j) => ({ id: `o${j}`, name, color })),
      includeTime: !!q.time,
      max: q.max,
      percent: !!q.pct,
    }
    if (q.ph) f.placeholder = q.ph
    if (q.d) f.display = q.d === 'l' ? 'list' : q.d === 'd' ? 'dropdown' : 'scale'
    if (q.d === 's' && q.kind === 'number') f.scale = q.sc === 10 ? 10 : 5
    if (q.pg) f.page = { title: q.pg.t ?? '', description: q.pg.d ?? '' }
    if (q.if?.c.length)
      f.showIf = {
        op: q.if.o ? 'or' : 'and',
        conditions: q.if.c.map(([j, op, value]) => {
          const c: FormCondition = { q: `q${j + 1}`, op }
          if (value !== undefined) c.value = valueKind(p.q[j].kind, op) === 'option' ? `o${value}` : value
          return c
        }),
      }
    return f
  })
}

/** The closing settings of a received form (FormFill props). */
export function payloadClosing(p: FormPayload): ShareClosing {
  return { doneTitle: p.end?.t, doneMessage: p.end?.m, redirectUrl: p.end?.url, allowAnother: !p.end?.one }
}
