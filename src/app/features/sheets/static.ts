/**
 * Static renders of a spreadsheet block with computed values: HTML (exports, share links, read-only
 * documents — one table per sheet under a "01 · Budget" caption) and Markdown (one table per sheet).
 */
import { displayGrid, currentLang, type DisplayCell } from './compute'
import { readAttrs, type SpreadsheetAttrs } from './model'
import { colName } from './engine'
import { chartDomSpec } from '../charts/render/static'
import { chartMarkdown } from '../charts/export'
import { chartSpec, sheetChartData } from './charts'

type Spec = [string, Record<string, string>, ...unknown[]]

export const sheetLabel = (index: number, name: string) => `${String(index + 1).padStart(2, '0')} · ${name}`

function tableSpec(grid: DisplayCell[][]): Spec {
  const cols = grid[0]?.length ?? 0
  const head: Spec = ['tr', {}, ['th', { class: 'sheet-static__corner' }, ''], ...Array.from({ length: cols }, (_, c) => ['th', { scope: 'col' }, colName(c)])]
  const body = grid.map((row, r): Spec => [
    'tr',
    {},
    ['th', { scope: 'row' }, String(r + 1)],
    ...row.map((cell) => {
      const cls = [cell.align !== 'left' ? `is-${cell.align}` : '', cell.b ? 'is-bold' : '', cell.i ? 'is-italic' : '', cell.error ? 'is-error' : ''].filter(Boolean).join(' ')
      return ['td', cls ? { class: cls } : {}, cell.text]
    }),
  ])
  return ['table', { class: 'sheet-static__table' }, ['thead', {}, head], ['tbody', {}, ...body]]
}

/** The block's static HTML body (inside the node's wrapper element). */
export function spreadsheetHTML(raw: Record<string, unknown> | SpreadsheetAttrs, lang: 'en' | 'de' = currentLang()): unknown[] {
  const attrs = readAttrs(raw)
  const out: unknown[] = []
  if (attrs.title) out.push(['p', { class: 'sheet-static__title' }, attrs.title])
  attrs.sheets.forEach((sheet, i) => {
    const fig: Spec = ['figure', { class: 'sheet-static__sheet', 'data-sheet': sheet.id }, ['figcaption', {}, sheetLabel(i, sheet.name)]]
    const grid = displayGrid(attrs, sheet, lang)
    fig.push(grid.length ? tableSpec(grid) : ['p', { class: 'sheet-static__empty' }, '—'])
    // the sheet's charts as static SVG (design-token colours: the reader's theme)
    for (const chart of attrs.charts) {
      const spec = chart.sheet === sheet.id ? chartSpec(chart) : null
      if (!spec) continue
      const svg = chartDomSpec(spec, sheetChartData(attrs, chart, lang), { lang })
      fig.push(['figure', { class: 'sheet-static__chart', 'data-chart': chart.id }, ...(spec.title ? [['figcaption', {}, spec.title]] : []), svg])
    }
    out.push(fig)
  })
  return out
}

const mdCell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || ' '

/** One Markdown table per sheet (first used row = header), sheet names as captions when there are several. */
export function spreadsheetMarkdown(raw: Record<string, unknown> | SpreadsheetAttrs, lang: 'en' | 'de' = currentLang()): string {
  const attrs = readAttrs(raw)
  const parts: string[] = []
  if (attrs.title) parts.push(`**${mdCell(attrs.title)}**`)
  attrs.sheets.forEach((sheet, i) => {
    const grid = displayGrid(attrs, sheet, lang)
    if (attrs.sheets.length > 1) parts.push(`*${mdCell(sheetLabel(i, sheet.name))}*`)
    if (!grid.length) return
    const lines = grid.map((row) => `| ${row.map((c) => mdCell(c.text)).join(' | ')} |`)
    const sep = `| ${grid[0].map((c) => (c.align === 'right' ? '---:' : c.align === 'center' ? ':---:' : '---')).join(' | ')} |`
    parts.push([lines[0], sep, ...lines.slice(1)].join('\n'))
    for (const chart of attrs.charts) {
      const spec = chart.sheet === sheet.id ? chartSpec(chart) : null
      if (spec) parts.push(chartMarkdown(spec, sheetChartData(attrs, chart, lang)))
    }
  })
  return parts.join('\n\n')
}

/** Plain text (search index, renderText). */
export function spreadsheetText(raw: Record<string, unknown> | SpreadsheetAttrs, lang: 'en' | 'de' = currentLang()): string {
  const attrs = readAttrs(raw)
  const out: string[] = attrs.title ? [attrs.title] : []
  for (const sheet of attrs.sheets) for (const row of displayGrid(attrs, sheet, lang)) out.push(row.map((c) => c.text).join('\t'))
  return out.join('\n')
}

/** CSV of a sheet's computed values (spreadsheet formula guard on text that looks like a formula). */
export function sheetCsv(raw: Record<string, unknown> | SpreadsheetAttrs, sheetId: string, lang: 'en' | 'de' = currentLang()): string {
  const attrs = readAttrs(raw)
  const sheet = attrs.sheets.find((s) => s.id === sheetId) ?? attrs.sheets[0]
  const grid = displayGrid(attrs, sheet, lang)
  const delim = lang === 'de' ? ';' : ','
  const quote = (s: string) => {
    const g = /^[=+\-@\t\r]/.test(s) && !/^[-+]?[\d.,\s]*\d[\d.,\s]*%?$/.test(s) ? `'${s}` : s
    return /["\n\r]/.test(g) || g.includes(delim) ? `"${g.replace(/"/g, '""')}"` : g
  }
  return grid.map((row) => row.map((c) => quote(c.text)).join(delim)).join('\r\n') + '\r\n'
}
