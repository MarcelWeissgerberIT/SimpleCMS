/**
 * Formula autocomplete, shared by the formula input's list (keyboard) and the touch suggestion
 * strip: the functions — inside DS(…) first the dataset names — that complete the word at the
 * caret, and what taking one does to the text.
 */
import { callAt, listFunctions, wordAt, type FnSpec } from '../engine'

export interface Suggestion {
  name: string
  kind: 'fn' | 'ds'
  hint: string
}

export interface FormulaContext {
  /** the formula without its "=" */
  body: string
  /** the identifier being typed (start: in body coordinates) */
  word: { word: string; start: number } | null
  /** the innermost function call around the caret */
  call: { name: string; arg: number } | null
  inDS: boolean
}

/** Where the caret stands in a formula (`value` with its "="), or null for plain text. */
export function formulaContext(value: string, caret: number): FormulaContext | null {
  if (value[0] !== '=') return null
  const body = value.slice(1)
  const call = callAt(body, caret - 1)
  return { body, word: wordAt(body, caret - 1), call, inDS: call?.name === 'DS' }
}

/** The suggestions for the word at the caret: dataset names inside DS(…), then functions (up to `max`). */
export function formulaSuggestions(ctx: FormulaContext | null, datasets: string[], lang: 'en' | 'de', max = 8): Suggestion[] {
  if (!ctx?.word) return []
  const w = ctx.word.word.toUpperCase()
  const caretB = ctx.word.start + ctx.word.word.length
  const out: Suggestion[] = []
  if (ctx.inDS) for (const d of datasets) if (d.toUpperCase().startsWith(w)) out.push({ name: d, kind: 'ds', hint: 'DS' })
  for (const f of listFunctions()) {
    if (out.length >= max) break
    if (f.name.startsWith(w) && !(f.name === w && ctx.body[caretB] === '(')) out.push({ name: f.name, kind: 'fn', hint: f.description[lang] || f.description.en })
  }
  return out
}

/** The text and caret after taking a suggestion for the word that starts at `start` (body coordinates). */
export function acceptSuggestion(value: string, caret: number, start: number, s: Suggestion): { text: string; caret: number } {
  const from = start + 1
  const next = value[caret] === '('
  const insert = s.kind === 'fn' && !next ? `${s.name}(` : s.name
  return { text: value.slice(0, from) + insert + value.slice(caret), caret: from + insert.length + (s.kind === 'fn' && next ? 1 : 0) }
}

/** Which of a function's arguments the caret is in (the last repeating one for every further argument). */
export function argIndex(spec: FnSpec, arg: number): number {
  const lastRepeat = spec.args.findIndex((a) => a.repeat)
  return lastRepeat >= 0 && arg >= spec.args.length ? spec.args.length - 1 : Math.min(arg, spec.args.length - 1)
}

/** "(number; [number2]; …)" — a function's arguments as one line. */
export function argsText(spec: FnSpec): string {
  return `(${spec.args.map((a) => `${a.optional ? `[${a.name}]` : a.name}${a.repeat ? '; …' : ''}`).join('; ')})`
}
