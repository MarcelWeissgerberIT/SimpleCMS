/**
 * Clipboard formats: TSV (what Excel, Google Sheets and Numbers put on the clipboard as text) and
 * a simple HTML table; the last internal copy is remembered so pasting it back moves formulas.
 */
import type { ClipCells } from '../ops'
import type { Rect } from '../engine'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Rows of text → TSV (cells with tabs, newlines or quotes are quoted). */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\n')
}

export function toHtmlTable(rows: string[][]): string {
  return `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`
}

/** TSV (or CSV with one column of commas when there are no tabs) → rows of text. */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (!src) return []
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === '\t') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  rows.push(row)
  return rows
}

export interface InternalClip {
  text: string
  clip: ClipCells
  sheetId: string
  rect: Rect
}

let last: InternalClip | null = null
export const rememberClip = (c: InternalClip | null) => {
  last = c
}
/** The internal copy when the pasted text is exactly what it put on the clipboard. */
export const internalClip = (text: string): InternalClip | null => (last && last.text.replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n') ? last : null)
