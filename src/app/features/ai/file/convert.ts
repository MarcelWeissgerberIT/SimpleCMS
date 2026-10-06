/**
 * Local conversions of a file block's file — no AI, nothing leaves the device:
 *  - filePage(kind, bytes, name): Word / text / Markdown / HTML / RTF → { title, doc } for a page
 *    (HTML: parsed inert, scripts and active content dropped, sanitised with DOMPurify, read with the
 *    editor's schema — the import's converter; web images become links, nothing loads by itself)
 *  - fileSheets(kind, bytes, name): CSV / TSV / Excel → its tables
 *  - fileText(kind, bytes, name): the text Claude gets for a non-PDF file (Markdown of the converted page;
 *    the tables as CSV)
 *  - docStats(doc): what a converted page holds (the preview's spec line)
 */
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown, markdownToDoc } from '../../../editor'
import { decodeText } from '../../io/import/plan'
import { htmlTitle } from '../../io/import/htmltext'
import { guardCell } from '../../io/import/csv'
import { docxToDoc } from './docx'
import { csvSheet, xlsxSheets, type DataSheet } from './xlsx'
import { FileLoadError } from './load'
import { withoutWebLoads } from '../../agents/images'
import type { FileKind } from './kinds'

export interface PageResult {
  title: string
  doc: JSONContent
  /** pictures left out (Word) */
  images?: number
}

/** "report.final.docx" → "report.final" */
export const baseName = (name: string) => (name.trim().replace(/\.[a-z0-9]{1,8}$/i, '') || name.trim()).slice(0, 200)

const MAX_PARAGRAPHS = 20_000

/** Plain text → paragraphs: blank lines separate them (lines inside keep their breaks); without blank lines, one per line. */
export function textDoc(text: string): JSONContent {
  const src = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  const blocks = /\n[ \t]*\n/.test(src) ? src.split(/\n[ \t]*\n+/) : src.split('\n')
  const content: JSONContent[] = []
  for (const b of blocks) {
    if (content.length >= MAX_PARAGRAPHS) break
    const lines = b.split('\n').map((l) => l.replace(/\s+$/, ''))
    if (!lines.some((l) => l.trim())) continue
    const inline: JSONContent[] = []
    lines.forEach((l, i) => {
      if (i) inline.push({ type: 'hardBreak' })
      if (l) inline.push({ type: 'text', text: l.replace(/\t/g, '    ') })
    })
    content.push({ type: 'paragraph', content: inline })
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/* ------------------------------------------------------------------ */
/* RTF                                                                  */
/* ------------------------------------------------------------------ */

/** Destinations whose text is not the document's (fonts, colours, styles, pictures, metadata …). */
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst'])

/** RTF → plain text (paragraphs, line breaks, tabs, \'hh and \u characters); formatting is dropped. */
export function rtfToText(rtf: string): string {
  let out = ''
  const stack: Array<{ skip: boolean; uc: number }> = []
  let skip = false
  let uc = 1
  let drop = 0
  const cp1252 = new TextDecoder('windows-1252')
  const emit = (s: string) => {
    if (skip) return
    if (drop > 0) {
      // the replacement characters after a \u go
      const n = Math.min(drop, s.length)
      drop -= n
      s = s.slice(n)
    }
    out += s
  }
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i]
    if (c === '{') {
      stack.push({ skip, uc })
      // {\* … } = an ignorable destination
      if (rtf.startsWith('\\*', i + 1)) skip = true
      continue
    }
    if (c === '}') {
      const prev = stack.pop()
      if (prev) ({ skip, uc } = prev)
      continue
    }
    if (c === '\\') {
      const next = rtf[i + 1]
      if (next === '\\' || next === '{' || next === '}') {
        emit(next)
        i++
        continue
      }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4)
        if (drop > 0) drop--
        else if (!skip) out += cp1252.decode(new Uint8Array([parseInt(hex, 16) || 32]))
        i += 3
        continue
      }
      if (next === '\n' || next === '\r') {
        emit('\n')
        i++
        continue
      }
      if (next === '~') {
        emit(' ')
        i++
        continue
      }
      if (next === '-' || next === '*') {
        i++
        continue
      }
      if (next === '_') {
        emit('-')
        i++
        continue
      }
      const m = /^([a-z]{1,32})(-?\d{1,10})? ?/i.exec(rtf.slice(i + 1, i + 46))
      if (!m) continue
      i += m[0].length
      const word = m[1]
      const arg = m[2] !== undefined ? Number(m[2]) : null
      if (RTF_SKIP.has(word)) skip = true
      else if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') emit('\n')
      else if (word === 'tab' || word === 'cell') emit('\t')
      else if (word === 'uc' && arg !== null) uc = arg
      else if (word === 'u' && arg !== null) {
        if (!skip) out += String.fromCharCode(arg < 0 ? arg + 65536 : arg)
        drop = uc
      } else if (word === 'emdash') emit('—')
      else if (word === 'endash') emit('–')
      else if (word === 'bullet') emit('•')
      else if (word === 'lquote' || word === 'rquote') emit(word === 'lquote' ? '‘' : '’')
      else if (word === 'ldblquote' || word === 'rdblquote') emit(word === 'ldblquote' ? '“' : '”')
      continue
    }
    if (c === '\r' || c === '\n') continue
    emit(c)
  }
  // paragraphs: one blank line between them
  return out
    .split('\n')
    .map((l) => l.replace(/\t+$/, '').trimEnd())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------------ */
/* Pages                                                                */
/* ------------------------------------------------------------------ */

const WEB = /^(https?:)?\/\//i

/**
 * Web images → a link line ("Image: alt"): a converted file never loads anything by itself — web video,
 * audio, files and frames (a Markdown file's raw HTML makes those too) become links as well.
 */
export function webImagesToLinks(nodes: JSONContent[]): JSONContent[] {
  return withoutWebLoads({ type: 'doc', content: imagesToLinks(nodes) }).content ?? []
}

function imagesToLinks(nodes: JSONContent[]): JSONContent[] {
  return nodes.map((n) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && WEB.test(n.attrs.src.trim())) {
      const alt = String(n.attrs.alt ?? '').trim()
      const href = n.attrs.src.trim().replace(/^\/\//, 'https://')
      return { type: 'paragraph', content: [{ type: 'text', text: alt ? `Image: ${alt}` : href, marks: [{ type: 'link', attrs: { href } }] }] }
    }
    return n.content ? { ...n, content: imagesToLinks(n.content) } : n
  })
}

/** A leading H1 that is the title: taken out of the content. */
function takeH1(doc: JSONContent): { title: string | null; doc: JSONContent } {
  const first = doc.content?.[0]
  if (first?.type !== 'heading' || first.attrs?.level !== 1) return { title: null, doc }
  const title = (first.content ?? []).map((n) => n.text ?? '').join('').trim()
  if (!title) return { title: null, doc }
  const rest = doc.content!.slice(1)
  return { title, doc: { ...doc, content: rest.length ? rest : [{ type: 'paragraph' }] } }
}

/** Markdown (Claude's transcription, a .md file) → a page: a leading H1 is its title; web images become links. */
export function markdownPage(md: string, fallback: string): PageResult {
  const r = takeH1(markdownToDoc(md))
  return { title: r.title || fallback, doc: { type: 'doc', content: webImagesToLinks(r.doc.content ?? []) } }
}

/** The page of a document file (Word, text, Markdown, HTML, RTF). Throws FileLoadError. */
export async function filePage(kind: FileKind, bytes: Uint8Array, name: string): Promise<PageResult> {
  const fallback = baseName(name)
  switch (kind) {
    case 'docx': {
      const r = docxToDoc(bytes)
      return { title: r.title || fallback, doc: r.doc, images: r.images }
    }
    case 'html': {
      const html = decodeText(bytes)
      const title = htmlTitle(html)
      const { htmlConverter } = await import('../../io/import/htmldoc')
      const doc = (await htmlConverter())(html, { title: title ?? undefined })
      return { title: title || fallback, doc: { type: 'doc', content: webImagesToLinks(doc.content ?? []) } }
    }
    case 'markdown':
      return markdownPage(decodeText(bytes), fallback)
    case 'rtf': {
      const text = decodeText(bytes)
      if (!text.trimStart().startsWith('{\\rtf')) throw new FileLoadError('unreadable', 'not RTF')
      return { title: fallback, doc: textDoc(rtfToText(text)) }
    }
    case 'text':
      return { title: fallback, doc: textDoc(decodeText(bytes)) }
    default:
      throw new FileLoadError('unreadable', `no page from ${kind}`)
  }
}

/** The tables of a data file (CSV / TSV: one; Excel: one per visible sheet). Throws FileLoadError. */
export function fileSheets(kind: FileKind, bytes: Uint8Array, name: string): DataSheet[] {
  if (kind === 'xlsx') {
    const sheets = xlsxSheets(bytes)
    if (!sheets.length) throw new FileLoadError('empty')
    return sheets
  }
  if (kind !== 'csv') throw new FileLoadError('unreadable', `no table from ${kind}`)
  const sheet = csvSheet(baseName(name), decodeText(bytes))
  if (!sheet) throw new FileLoadError('empty')
  return [sheet]
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** A sheet as CSV (cells that a spreadsheet would run as a formula are guarded). */
export function sheetCsvText(sheet: DataSheet): string {
  return [sheet.header, ...sheet.rows].map((r) => r.map((c) => csvCell(guardCell(c))).join(',')).join('\n')
}

/** The text Claude gets for a file that is not a PDF. Throws FileLoadError. */
export async function fileText(kind: FileKind, bytes: Uint8Array, name: string): Promise<{ text: string; format: 'markdown' | 'text' | 'csv' }> {
  switch (kind) {
    case 'text':
      return { text: decodeText(bytes), format: 'text' }
    case 'markdown':
      return { text: decodeText(bytes), format: 'markdown' }
    case 'rtf':
      return { text: rtfToText(decodeText(bytes)), format: 'text' }
    case 'csv':
    case 'xlsx': {
      const sheets = fileSheets(kind, bytes, name)
      const text = sheets.length === 1 ? sheetCsvText(sheets[0]) : sheets.map((s) => `## Sheet: ${s.name}\n${sheetCsvText(s)}`).join('\n\n')
      return { text, format: 'csv' }
    }
    default: {
      const page = await filePage(kind, bytes, name)
      const body = docToMarkdown(page.doc).trim()
      return { text: page.title ? `# ${page.title}\n\n${body}` : body, format: 'markdown' }
    }
  }
}

export interface DocStats {
  headings: number
  paragraphs: number
  lists: number
  tables: number
  words: number
}

/** What a page holds: headings, paragraphs, lists, tables (top level and inside), words. */
export function docStats(doc: JSONContent): DocStats {
  const s: DocStats = { headings: 0, paragraphs: 0, lists: 0, tables: 0, words: 0 }
  const walk = (nodes: JSONContent[] | undefined, inList: boolean) => {
    for (const n of nodes ?? []) {
      if (n.type === 'heading') s.headings++
      else if (n.type === 'paragraph' && !inList && n.content?.length) s.paragraphs++
      else if ((n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') && !inList) s.lists++
      else if (n.type === 'table') s.tables++
      if (n.type === 'text' && n.text) s.words += n.text.split(/\s+/).filter(Boolean).length
      walk(n.content, inList || n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList' || n.type === 'table')
    }
  }
  walk(doc.content, false)
  return s
}
