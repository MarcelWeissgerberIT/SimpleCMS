/**
 * Claude for files — what a file block holds (by its name, then its stored type) and what can be done with
 * it. Pure.
 *
 *  - Claude actions (the file goes to Anthropic, only on these): summarize · extract (a PDF's text as a page)
 *    · tables (a PDF's tables) · ask
 *  - local actions (nothing leaves the device): page (Word / text / Markdown / HTML / RTF / PowerPoint → a
 *    page) · database / sheet (CSV / TSV / Excel → a database, a spreadsheet block or a table)
 */
export type FileKind = 'pdf' | 'docx' | 'text' | 'markdown' | 'html' | 'rtf' | 'csv' | 'xlsx' | 'pptx'

export type FileAction = 'summarize' | 'extract' | 'tables' | 'ask' | 'page' | 'database' | 'sheet'

/** Actions that run here only (no request). */
export const isLocalAction = (a: FileAction): boolean => a === 'page' || a === 'database' || a === 'sheet'

/** Actions whose result is data, not text the panel streams (tables JSON, a converted page, sheets). */
export const isStructuredAction = (a: FileAction): boolean => a === 'tables' || isLocalAction(a)

/** What each kind offers, in menu order. */
export const FILE_ACTIONS: Record<FileKind, FileAction[]> = {
  pdf: ['summarize', 'extract', 'tables', 'ask'],
  docx: ['page', 'summarize', 'ask'],
  text: ['page', 'summarize', 'ask'],
  markdown: ['page', 'summarize', 'ask'],
  html: ['page', 'summarize', 'ask'],
  rtf: ['page', 'summarize', 'ask'],
  csv: ['database', 'sheet', 'ask'],
  xlsx: ['database', 'sheet', 'ask'],
  pptx: ['page', 'summarize', 'ask'],
}

/** The mono code each action shows in the panel. */
export const FILE_CODES: Record<FileAction, string> = { summarize: 'SUM', extract: 'TXT', tables: 'TBL', ask: 'ASK', page: 'PG', database: 'DB', sheet: 'SHT' }

const EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  docm: 'docx',
  txt: 'text',
  text: 'text',
  log: 'text',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  rtf: 'rtf',
  csv: 'csv',
  tsv: 'csv',
  tab: 'csv',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  pptx: 'pptx',
  pptm: 'pptx',
}

const MIME: Array<[RegExp, FileKind]> = [
  [/^application\/pdf$/, 'pdf'],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, 'docx'],
  [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/, 'xlsx'],
  [/^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/, 'pptx'],
  [/^text\/(csv|tab-separated-values)$/, 'csv'],
  [/^text\/markdown$/, 'markdown'],
  [/^text\/html$/, 'html'],
  [/^(application|text)\/rtf$/, 'rtf'],
  [/^text\/plain$/, 'text'],
]

export const extOf = (name: string): string => (name ?? '').trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? ''

/** The kind of a file by its name (first) or its media type; null = nothing to offer. */
export function fileKind(name: string, mime = ''): FileKind | null {
  const ext = extOf(name)
  if (ext) return EXT[ext] ?? null
  const m = mime.toLowerCase().split(';')[0].trim()
  return MIME.find(([re]) => re.test(m))?.[1] ?? null
}

/** The short type label of a kind ("PDF", "DOCX" …) for spec lines. */
export function kindLabel(kind: FileKind, name = ''): string {
  if (kind === 'csv') return extOf(name) === 'tsv' ? 'TSV' : 'CSV'
  if (kind === 'markdown') return 'MD'
  if (kind === 'text') return 'TXT'
  return kind.toUpperCase()
}
