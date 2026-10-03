/**
 * Shared form links: the form's schema IS the URL.
 *   <app>#/f/<base64url(deflate(JSON))>
 * The payload holds only what a respondent needs (title, description, questions with their
 * type / options / required / help, submit label, webhook URL) — never workspace data:
 * no property ids, no rows, no people. Person and relation questions become text questions.
 * Received payloads are untrusted: everything is type-checked, clamped and whitelisted.
 */
import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate'
import { COLOR_NAMES, type ColorName } from '../../store/types'
import { isValidHttpUrl, type Field, type FieldKind } from './fields'

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
}

export interface FormPayload {
  v: 1
  title: string
  desc: string
  submit: string
  hook: string
  q: SharedQuestion[]
}

export class FormDecodeError extends Error {
  constructor(public code: 'empty' | 'corrupt' | 'version') {
    super(code)
  }
}

const MAX_QUESTIONS = 80
const MAX_OPTIONS = 120
const MAX_INFLATED = 512 * 1024
const MAX_ENCODED = 256 * 1024

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

/** The share payload of a form (workspace fields → respondent-facing schema). */
export function buildPayload(input: { title: string; description: string; submitLabel: string; webhookUrl: string; fields: Field[] }): FormPayload {
  return {
    v: 1,
    title: input.title,
    desc: input.description,
    submit: input.submitLabel,
    hook: input.webhookUrl,
    q: input.fields.map((f) => {
      const kind: SharedKind = f.kind === 'person' || f.kind === 'relation' ? 'short' : f.kind
      const q: SharedQuestion = { name: f.name, kind }
      if (f.required) q.req = 1
      if (f.help.trim()) q.help = f.help.trim()
      if ((kind === 'select' || kind === 'multi') && f.options) q.opts = f.options.map((o) => [o.name, o.color])
      if (kind === 'date' && f.includeTime) q.time = 1
      if (kind === 'rating') q.max = f.max ?? 5
      if (kind === 'number' && f.percent) q.pct = 1
      return q
    }),
  }
}

export function encodeForm(p: FormPayload): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify(p)), { level: 9 }))
}

export function formUrl(encoded: string): string {
  return `${window.location.origin}${window.location.pathname}#/f/${encoded}`
}

/* ---------------- decode (untrusted) ---------------- */

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

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
  if (d.v !== 1) throw new FormDecodeError('version')
  const hook = str(d.hook, 2000).trim()
  return {
    v: 1,
    title: str(d.title, 300),
    desc: str(d.desc, 4000),
    submit: str(d.submit, 80),
    hook: isValidHttpUrl(hook) ? hook : '',
    q: (Array.isArray(d.q) ? d.q : []).slice(0, MAX_QUESTIONS).map(sanitizeQuestion).filter((q): q is SharedQuestion => !!q),
  }
}

/** Fields of a received form (answer keys "q1", "q2" …; option ids = their index). */
export function payloadFields(p: FormPayload): Field[] {
  return p.q.map((q, i) => ({
    key: `q${i + 1}`,
    name: q.name,
    kind: q.kind,
    required: !!q.req,
    help: q.help ?? '',
    options: q.opts?.map(([name, color], j) => ({ id: `o${j}`, name, color })),
    includeTime: !!q.time,
    max: q.max,
    percent: !!q.pct,
  }))
}
