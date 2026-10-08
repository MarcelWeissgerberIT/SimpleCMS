/**
 * The shared code area (ui/code) — the contract between tokenizers, the area and its callers.
 *
 * A tokenizer turns the whole text into tokens: absolute offsets [start, end) into the text, sorted, never
 * overlapping; characters no token covers are plain text. Every token class has one colour token in
 * tokens.css (`--syn-<class>`, Paper + Carbon, WCAG AA) and one CSS class (`.syn-<class>`, ui/code/syntax.css).
 */

/** Token classes (highlight.js scopes map onto these, see tokenizers/lowlight.ts). */
export type SynClass =
  | 'kw' // keywords: let, if, SELECT …
  | 'str' // string values
  | 'num' // numbers, durations
  | 'lit' // true / false / null and other constants
  | 'key' // object keys, attributes, properties of a record
  | 'prop' // a database property (One Script)
  | 'fn' // function and method names
  | 'type' // types, classes
  | 'var' // variables, parameters
  | 'tag' // markup tags, selectors
  | 'comment'
  | 'punct' // brackets, commas, colons
  | 'op' // operators
  | 'meta' // preprocessor lines, code fences, decorators
  | 'regex'
  | 'err' // what the tokenizer could not read
  | 'head' // Markdown heading text
  | 'list' // Markdown structure: list markers, heading hashes, quote bars
  | 'code' // Markdown inline code / fenced code
  | 'strong'
  | 'em'
  | 'link'
  | 'quote'
  | 'tool' // a known tool name (an agent's tools, an MCP server's tools)
  | 'ph' // an open placeholder ([HOW TO LIST THE ITEMS])
  | 'ref' // One Script @ reference (drawn as a chip by the caller)
  | 'add' // diff +
  | 'del' // diff −

export interface CodeToken {
  start: number
  end: number
  cls: SynClass
}

/** Text → tokens (sorted, non-overlapping, absolute offsets). Must be pure and fast: it runs on every change. */
export type Tokenizer = (code: string) => CodeToken[]

export type MarkerSeverity = 'error' | 'warning' | 'info'

/**
 * A problem at a place in the text — line and col are 1-based; `endCol` is exclusive (absent: the word at
 * col, or one character). `endLine` lets a range run over several lines (absent: the same line).
 */
export interface CodeMarker {
  line: number
  col: number
  endLine?: number
  endCol?: number
  message: string
  severity: MarkerSeverity
}
