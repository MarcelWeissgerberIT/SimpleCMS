/**
 * ui/code — the shared highlighted code area (public API).
 *
 *  - <CodeArea value onChange tokenize markers placeholders lineNumbers wrap resizable brackets enter … />: the
 *    editable field (CodeArea.tsx says what it does); <CodeView code tokenize /> read-only lines
 *  - tokenizers: markdownTokenizer({ tools, placeholders }) · tokenizeJson + jsonError / jsonPathRange (schema
 *    errors at their key or value) · lowlightTokenizer(lowlight, language) + HLJS_SYN / synOfHljs
 *  - placeholders: PLACEHOLDER_PATTERN · findPlaceholders · countPlaceholders
 *  - brackets: scanBrackets (pairs + unmatched) · pairAt
 *  - colours: tokens.css --syn-*; classes .syn-<class> and .hljs-* inside .hljs / .syn-hl (syntax.css)
 */
import type { Translate } from '@/shared/i18n'
import type { CodeMarker } from './types'
import { jsonError } from './tokenizers/json'
import { scanBrackets } from './brackets'
import { lineColAt, lineStarts } from './lines'
import type { CodeToken } from './types'

export { CodeArea, type CodeAreaHandle, type CodeAreaProps, type CodeGeometry } from './CodeArea'
export { CodeView } from './CodeView'
export type { CodeMarker, CodeToken, MarkerSeverity, SynClass, Tokenizer } from './types'
export type { RenderToken } from './render'
export { markdownTokenizer, type MarkdownOptions } from './tokenizers/markdown'
export { tokenizeJson, jsonError, jsonPathRange, type JsonError, type JsonErrorCode } from './tokenizers/json'
export { lowlightTokenizer, synOfHljs, HLJS_SYN, type LowlightLike } from './tokenizers/lowlight'
export { PLACEHOLDER_PATTERN, findPlaceholders, countPlaceholders, type PlaceholderHit } from './placeholders'
export { scanBrackets, pairAt, type Brackets } from './brackets'
export { lineStarts, lineColAt, offsetAt, lineIndexAt } from './lines'

/** The JSON syntax error of a text as a marker (in the UI language), or none. */
export function jsonMarkers(code: string, t: Translate, opts: { strict?: boolean } = {}): CodeMarker[] {
  const e = jsonError(code, opts)
  if (!e) return []
  return [{ line: e.line, col: e.col, endCol: e.endCol > e.col ? e.endCol : undefined, severity: 'error', message: t(`ui.code.json.${e.code}`, { found: e.found.length > 24 ? `${e.found.slice(0, 24)}…` : e.found }) }]
}

/**
 * Markers for brackets that never close (or close nothing) — the cause behind a parser's "expected ')'" further
 * down. `before`: only those before this offset (the parser's error), so a later, unrelated one is not blamed.
 */
export function bracketMarkers(code: string, tokens: CodeToken[], t: Translate, opts: { before?: number; severity?: CodeMarker['severity'] } = {}): CodeMarker[] {
  const { unmatched } = scanBrackets(code, tokens)
  const starts = lineStarts(code)
  return unmatched
    .filter((off) => opts.before === undefined || off < opts.before)
    .map((off) => {
      const c = code[off]
      const at = lineColAt(starts, off)
      return { line: at.line, col: at.col, endCol: at.col + 1, severity: opts.severity ?? 'error', message: t('([{'.includes(c) ? 'ui.code.unclosed' : 'ui.code.unopened', { char: c }) }
    })
}
