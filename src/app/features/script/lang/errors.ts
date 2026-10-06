/**
 * One Script — errors. Every error carries a code (its message is the i18n key
 * `features.script.err.<code>`, EN + DE, rendered by the UI), parameters for that message and where
 * it happened (line:col, 1-based, plus the source offsets for the squiggle). Pure: no app imports.
 */

/** A place in the source: offsets (0-based, end exclusive) and the line / column of `start` (1-based). */
export interface Pos {
  start: number
  end: number
  line: number
  col: number
}

export type ScriptErrorCode =
  // lexer / parser
  | 'bad_char'
  | 'unterminated_string'
  | 'unterminated_ident'
  | 'bad_number'
  | 'bad_ref'
  | 'unexpected'
  | 'expected'
  | 'bad_assign'
  | 'bad_interpolation'
  | 'too_long'
  | 'too_deep'
  // runtime
  | 'unknown_name'
  | 'not_callable'
  | 'no_member'
  | 'bad_args'
  | 'bad_type'
  | 'div_zero'
  | 'index'
  | 'steps'
  | 'timeout'
  | 'depth'
  | 'too_big'
  | 'stopped'
  | 'break_outside'
  | 'return_outside'
  | 'not_found'
  | 'ambiguous'
  | 'read_only'
  | 'readonly_prop'
  | 'bad_value'
  | 'unknown_prop'
  | 'no_write'
  | 'no_effect'
  | 'refused'
  | 'effect_failed'
  | 'no_context'
  | 'custom'
  | 'internal'

export type ErrorParams = Record<string, string | number>

export class ScriptError extends Error {
  readonly code: ScriptErrorCode
  readonly params: ErrorParams
  pos: Pos | null

  constructor(code: ScriptErrorCode, params: ErrorParams = {}, pos: Pos | null = null) {
    super(`${code}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''}`)
    this.name = 'ScriptError'
    this.code = code
    this.params = params
    this.pos = pos
  }

  /** The same error placed at `pos` when it has no place yet (natives throw without one). */
  at(pos: Pos | null): ScriptError {
    if (!this.pos && pos) this.pos = pos
    return this
  }
}

export const isScriptError = (e: unknown): e is ScriptError => e instanceof ScriptError

/** English fallback texts (tests, logs, Claude-facing tools); the app shows the i18n ones. */
export const ERROR_TEXT_EN: Record<ScriptErrorCode, string> = {
  bad_char: 'Unexpected character {char}.',
  unterminated_string: 'This text has no closing quote.',
  unterminated_ident: 'This `name` has no closing backtick.',
  bad_number: 'This is not a valid number: {text}.',
  bad_ref: 'This @ reference is not complete.',
  unexpected: 'Unexpected {found}.',
  expected: 'Expected {expected}, found {found}.',
  bad_assign: 'You can only assign to a name, a field or a list item.',
  bad_interpolation: 'The {…} inside this text is not a complete expression.',
  too_long: 'The script is too long ({max} characters at most).',
  too_deep: 'Nested too deeply ({max} levels at most).',
  unknown_name: 'Unknown name {name}.',
  not_callable: '{name} is not a function.',
  no_member: '{type} has no {name}.',
  bad_args: '{name}: {detail}',
  bad_type: 'Cannot use {op} with {left} and {right}.',
  div_zero: 'Division by zero.',
  index: 'Item {index} does not exist (the list has {n}).',
  steps: 'The script took too many steps ({max}) — is there an endless loop?',
  timeout: 'The script ran longer than {seconds} s and was stopped.',
  depth: 'Too many nested calls ({max}) — is a function calling itself without end?',
  too_big: '{what} is too big ({max} at most).',
  stopped: 'Stopped.',
  break_outside: 'break / continue only work inside a loop.',
  return_outside: 'return only works inside a function.',
  not_found: 'No {what} {name}.',
  ambiguous: '{name} matches {n} {what} — use @ to pick one.',
  read_only: 'This run only reads: {what} is not allowed here.',
  readonly_prop: '{name} is computed and cannot be set.',
  bad_value: '{name}: {detail}',
  unknown_prop: '{db} has no property {name}.',
  no_write: 'You can view this workspace but not change it.',
  no_effect: 'The effect {name} is not available.',
  refused: '{name} was not allowed in this run.',
  effect_failed: '{name} failed: {detail}',
  no_context: 'There is no current page here.',
  custom: '{message}',
  internal: 'Something went wrong inside the script runner: {detail}',
}

/** The English text of an error (with "line:col" when it has a place). */
export function errorTextEn(e: ScriptError): string {
  const tpl = ERROR_TEXT_EN[e.code] ?? e.code
  const text = tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in e.params ? String(e.params[k]) : m))
  return e.pos ? `${e.pos.line}:${e.pos.col} ${text}` : text
}
