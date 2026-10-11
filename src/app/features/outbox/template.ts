/**
 * A send route's templates filled in (pure). The values are BUILT — never a JSON string with text pasted in: a draft
 * that reads `"}, "x": 1` stays one string value. Rules (store/integrations.ts `placeholderProblem` checks them again
 * here, because a sanitized copy may keep a route whose template holds a bad placeholder):
 *  - `{key}` anywhere (inside a text too: "LDG-{key}"); `{key|number}` only as the whole value, digits only
 *  - `{<param>}` (the draft, minutes, an option …) only as the whole value — it takes the typed value
 *  - `{sentAt}` as the whole value: the time of the press (not known before it — the token stays until then)
 *  - `{result.<path>}` only in the read-back; `{check.…}` never; anything else is refused
 */
import type { RouteParam, SendRoute } from '../../store/types'
import { SEND_LIMITS, placeholderProblem, placeholdersIn, type TemplateSlot } from '../../store/integrations'
import { pickPath } from './fields'

/** The press time's placeholder, kept as it is until the press (slice 2 fills it in the send). */
export const SENT_AT = '{sentAt}'

export interface FillContext {
  key: string
  params: Record<string, string | number>
  /** ISO time of the press; absent: the token stays */
  sentAt?: string
  /** the send's result (read-back only) */
  result?: unknown
}

export type FillResult = { ok: true; value: Record<string, unknown> } | { ok: false; why: string; token: string; path: string }

class FillError extends Error {
  constructor(
    readonly why: string,
    readonly token: string,
    readonly path: string,
  ) {
    super(why)
  }
}

const DIGITS = /^\d{1,15}$/

function fillString(s: string, slot: TemplateSlot, ctx: FillContext, names: readonly string[], path: string): unknown {
  const found = placeholdersIn(s)
  if (!found.length) return s
  for (const p of found) {
    const why = placeholderProblem(p, slot, names)
    if (why) throw new FillError(why, p.token, path)
  }
  const one = found.length === 1 && found[0].whole ? found[0] : null
  if (one) {
    switch (one.kind) {
      case 'key':
        return ctx.key
      case 'keyNumber':
        if (!DIGITS.test(ctx.key)) throw new FillError('keyNumber', one.token, path)
        return Number(ctx.key)
      case 'sentAt':
        return ctx.sentAt ?? SENT_AT
      case 'param': {
        const v = ctx.params[one.name]
        if (v === undefined) throw new FillError('param', one.token, path)
        return v
      }
      case 'result': {
        const v = pickPath(ctx.result, one.name)
        if (v === undefined) throw new FillError('result', one.token, path)
        return v
      }
    }
  }
  // inside a longer text: only {key} and {result.*} (placeholderProblem refused the rest)
  let out = ''
  let at = 0
  for (const m of s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*(?:\.-?[A-Za-z0-9_]+)*(?:\|[a-z]+)?)\}/g)) {
    out += s.slice(at, m.index)
    at = (m.index ?? 0) + m[0].length
    const inner = m[1]
    if (inner === 'key') out += ctx.key
    else if (inner.startsWith('result.')) {
      const v = pickPath(ctx.result, inner.slice(7))
      if (v === undefined || (typeof v === 'object' && v !== null)) throw new FillError('result', m[0], path)
      out += String(v)
    } else out += m[0]
  }
  return out + s.slice(at)
}

function fillValue(v: unknown, slot: TemplateSlot, ctx: FillContext, names: readonly string[], path: string): unknown {
  if (typeof v === 'string') return fillString(v, slot, ctx, names, path)
  if (Array.isArray(v)) return v.map((x, i) => fillValue(x, slot, ctx, names, `${path}[${i}]`))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new FillError('argKey', k, path)
      out[k] = fillValue(x, slot, ctx, names, path ? `${path}.${k}` : k)
    }
    return out
  }
  return v
}

/** A template filled for one slot ('args' = what goes out, 'check', 'confirm', 'match'). */
export function fillTemplate(template: Record<string, unknown>, slot: TemplateSlot, ctx: FillContext, params: readonly RouteParam[] = []): FillResult {
  const names = params.map((p) => p.name)
  try {
    const value = fillValue(template, slot, ctx, names, '')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, why: 'object', token: '', path: '' }
    return { ok: true, value: value as Record<string, unknown> }
  } catch (e) {
    if (e instanceof FillError) return { ok: false, why: e.why, token: e.token, path: e.path }
    throw e
  }
}

/** What goes out for a route: its `args` filled ('args' slot). */
export function fillArgs(route: Pick<SendRoute, 'args' | 'params'>, ctx: FillContext): FillResult {
  return fillTemplate(route.args, 'args', ctx, route.params ?? [])
}

/** Every placeholder token a template holds (in order, each once). */
export function placeholdersOf(template: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const p of placeholdersIn(v)) !out.includes(p.token) && out.push(p.token)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(template)
  return out
}

/** The route's text param (the draft Claude may write) — at most one. */
export const textParam = (route: Pick<SendRoute, 'params'>): RouteParam | null => route.params?.find((p) => p.type === 'text') ?? null

/** A text param's character limit. */
export const textMax = (p: RouteParam | null): number => Math.min(SEND_LIMITS.draftMax, Math.max(1, p?.max ?? SEND_LIMITS.draft))

export type ParamProblem = { why: 'param' | 'tooLong'; name: string }

/**
 * The typed params of a route from what a person or caller gave (text: the draft; numbers, minutes, options). A
 * missing or wrong value is a problem; minutes are rounded to the route's step; an option must be one of its values.
 * `draft`: the text param's value (null = no text yet — the slip is 'missing').
 */
export function cleanParams(route: Pick<SendRoute, 'params'>, input: Record<string, string | number>, draft: string | null | undefined): { ok: true; params: Record<string, string | number> } | { ok: false; problem: ParamProblem } {
  const out: Record<string, string | number> = {}
  for (const p of route.params ?? []) {
    if (p.type === 'text') {
      const text = draft ?? (typeof input[p.name] === 'string' ? (input[p.name] as string) : undefined)
      if (draft === null) {
        out[p.name] = ''
        continue
      }
      if (text === undefined) return { ok: false, problem: { why: 'param', name: p.name } }
      if ([...text].length > textMax(p)) return { ok: false, problem: { why: 'tooLong', name: p.name } }
      out[p.name] = text
      continue
    }
    const raw = input[p.name]
    if (p.type === 'option') {
      if (typeof raw !== 'string' || !(p.values ?? []).includes(raw)) return { ok: false, problem: { why: 'param', name: p.name } }
      out[p.name] = raw
      continue
    }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(',', '.')) : NaN
    if (!Number.isFinite(n) || n < 0) return { ok: false, problem: { why: 'param', name: p.name } }
    let v = n
    if (p.type === 'minutes') {
      const step = p.round && p.round > 0 ? p.round : 1
      v = Math.round(n / step) * step
      if (v <= 0) return { ok: false, problem: { why: 'param', name: p.name } }
    }
    if (p.max !== undefined && v > p.max) return { ok: false, problem: { why: 'param', name: p.name } }
    out[p.name] = v
  }
  return { ok: true, params: out }
}
