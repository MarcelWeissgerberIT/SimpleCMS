/**
 * Form logic: "show this question only if …" conditions on earlier answers, and pages.
 *
 * A condition names an EARLIER question (field key) and tests its answer. Conditions that can't
 * be evaluated — the question is gone or no longer earlier, the operator doesn't fit its kind, the
 * value is missing or names a deleted option — are ignored (the builder flags them). A question
 * whose conditions are all ignored is shown: showing is the safe side.
 *
 * Hidden questions count as unanswered for the conditions after them (their answers are never
 * submitted), so chains hide as expected. A page whose questions are all hidden is skipped.
 */
import type { FormCondition, FormConditionOp, FormLogic } from '../../store/types'
import type { Translate } from '@/shared/i18n'
import { parseNumberText } from '../model/format'
import { emptyAnswer, isEmptyAnswer, type Answer, type Answers, type DateAnswer, type Field, type FieldKind } from './fields'

/** Operators per question kind (first = the default for a new condition). */
export function opsFor(kind: FieldKind): FormConditionOp[] {
  switch (kind) {
    case 'select':
      return ['is', 'is_not', 'empty', 'not_empty']
    case 'multi':
      return ['contains', 'not_contains', 'empty', 'not_empty']
    case 'checkbox':
      return ['checked', 'unchecked']
    case 'number':
    case 'rating':
      return ['eq', 'gt', 'lt', 'empty', 'not_empty']
    case 'date':
      return ['before', 'after', 'empty', 'not_empty']
    case 'short':
    case 'long':
    case 'url':
    case 'email':
    case 'phone':
      return ['contains', 'not_contains', 'empty', 'not_empty']
    default:
      // person / relation / files (shared links ask person and relation as text: these two still fit)
      return ['empty', 'not_empty']
  }
}

/** Operators that compare with a value. */
export const needsValue = (op: FormConditionOp): boolean => !['empty', 'not_empty', 'checked', 'unchecked'].includes(op)

/** What kind of value an operator of a field kind takes. */
export function valueKind(kind: FieldKind, op: FormConditionOp): 'option' | 'number' | 'date' | 'text' | null {
  if (!needsValue(op)) return null
  if (kind === 'select' || kind === 'multi') return 'option'
  if (kind === 'number' || kind === 'rating') return 'number'
  if (kind === 'date') return 'date'
  return 'text'
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Why a condition can't be evaluated (null = it can). */
export type ConditionIssue = 'source' | 'order' | 'op' | 'value' | 'option'

export function conditionIssue(c: FormCondition, index: number, fields: Field[]): ConditionIssue | null {
  const j = fields.findIndex((f) => f.key === c.q)
  if (j < 0) return 'source'
  if (j >= index) return 'order'
  const src = fields[j]
  if (!opsFor(src.kind).includes(c.op)) return 'op'
  const vk = valueKind(src.kind, c.op)
  if (!vk) return null
  const v = c.value
  if (vk === 'option') {
    if (typeof v !== 'string' || !v) return 'value'
    return src.options?.some((o) => o.id === v) ? null : 'option'
  }
  if (vk === 'number') return typeof v === 'number' && Number.isFinite(v) ? null : 'value'
  if (vk === 'date') return typeof v === 'string' && ISO_DATE.test(v) ? null : 'value'
  return typeof v === 'string' && v.trim() ? null : 'value'
}

/** A number answer in typed units (a percent question compares what was typed: "75" for 75 %). */
function numberOf(f: Field, a: Answer | undefined, lang: string): number | null {
  if (f.kind === 'rating') return typeof a === 'number' && a > 0 ? a : null
  return typeof a === 'string' ? parseNumberText(a, false, lang) : null
}

export function testCondition(src: Field, c: FormCondition, a: Answer | undefined, lang: string): boolean {
  const empty = isEmptyAnswer(src, a)
  switch (c.op) {
    case 'empty':
      return empty
    case 'not_empty':
      return !empty
    case 'checked':
      return a === true
    case 'unchecked':
      return a !== true
    case 'is':
      return a === c.value
    case 'is_not':
      return a !== c.value
    case 'contains':
    case 'not_contains': {
      let hit: boolean
      if (Array.isArray(a)) hit = (a as unknown[]).includes(c.value)
      else hit = typeof a === 'string' && a.toLocaleLowerCase().includes(String(c.value ?? '').trim().toLocaleLowerCase())
      return c.op === 'contains' ? hit : !hit
    }
    case 'eq':
    case 'gt':
    case 'lt': {
      const n = numberOf(src, a, lang)
      const v = Number(c.value)
      if (n === null) return false
      return c.op === 'eq' ? n === v : c.op === 'gt' ? n > v : n < v
    }
    case 'before':
    case 'after': {
      const d = (a as DateAnswer | undefined)?.date ?? ''
      if (!ISO_DATE.test(d)) return false
      return c.op === 'before' ? d < String(c.value) : d > String(c.value)
    }
    default:
      return true
  }
}

/** Keys of the questions shown for these answers (in form order). */
export function visibleKeys(fields: Field[], answers: Answers, lang: string): Set<string> {
  const visible = new Set<string>()
  const byKey = new Map(fields.map((f) => [f.key, f]))
  fields.forEach((f, i) => {
    const logic = f.showIf
    if (!logic || !logic.conditions.length) {
      visible.add(f.key)
      return
    }
    const results: boolean[] = []
    for (const c of logic.conditions) {
      if (conditionIssue(c, i, fields)) continue
      const src = byKey.get(c.q)!
      results.push(testCondition(src, c, visible.has(src.key) ? answers[src.key] : emptyAnswer(src), lang))
    }
    if (!results.length || (logic.op === 'or' ? results.some(Boolean) : results.every(Boolean))) visible.add(f.key)
  })
  return visible
}

/** The form's pages: a new one starts at every field with a page break. */
export function pagesOf(fields: Field[]): Field[][] {
  const pages: Field[][] = []
  fields.forEach((f, i) => {
    if (i === 0 || f.page) pages.push([f])
    else pages[pages.length - 1].push(f)
  })
  return pages
}

function defaultValue(src: Field, vk: ReturnType<typeof valueKind>): string | number | null {
  switch (vk) {
    case 'option':
      return src.options?.[0]?.id ?? null
    case 'number':
      return src.kind === 'rating' ? Math.min(3, src.max ?? 5) : 0
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'text':
      return ''
    default:
      return null
  }
}

/** A fresh condition on a field: its first operator and a sensible value. */
export function newCondition(src: Field): FormCondition {
  const op = opsFor(src.kind)[0]
  const value = defaultValue(src, valueKind(src.kind, op))
  return value === null ? { q: src.key, op } : { q: src.key, op, value }
}

/** A condition with another operator: the value is kept when it still fits. */
export function withOp(src: Field, c: FormCondition, op: FormConditionOp): FormCondition {
  const vk = valueKind(src.kind, op)
  if (valueKind(src.kind, c.op) === vk) return { ...c, op }
  const value = defaultValue(src, vk)
  return value === null ? { q: c.q, op } : { q: c.q, op, value }
}

/** Short operator text: a symbol where one is universal, a word otherwise. */
export function opSymbol(t: Translate, op: FormConditionOp): string {
  switch (op) {
    case 'is':
    case 'eq':
      return '='
    case 'is_not':
      return '≠'
    case 'gt':
      return '>'
    case 'lt':
      return '<'
    default:
      return t(`database.form.logic.sym.${op}`)
  }
}

/** "IF Q02 = Review AND Q04 > 3" — the mono tag on a question with logic (builder numbering). */
export function logicTag(t: Translate, logic: FormLogic, fields: Field[], index: number, num: (i: number) => string): string {
  const parts: string[] = []
  for (const c of logic.conditions) {
    if (conditionIssue(c, index, fields)) continue
    const j = fields.findIndex((f) => f.key === c.q)
    const src = fields[j]
    const vk = valueKind(src.kind, c.op)
    const value = vk === 'option' ? (src.options?.find((o) => o.id === c.value)?.name ?? '') : vk === 'text' ? `“${String(c.value)}”` : vk ? String(c.value) : ''
    parts.push([num(j), opSymbol(t, c.op), value].filter(Boolean).join(' '))
  }
  if (!parts.length) return ''
  return `${t('database.form.logic.if')} ${parts.join(` ${t(logic.op === 'or' ? 'database.form.logic.or' : 'database.form.logic.and')} `)}`
}
