/**
 * Spreadsheet block: `spreadsheet` (atom; attrs: id, title, sheets, active, datasets, charts).
 * Several sheets of cells with Excel-style formulas and datasets DS(…); values are computed,
 * never stored. The grid UI and the engine live in features/sheets; this file is the schema:
 *  - HTML: <div data-type="spreadsheet" data-sheets=… > + one static table of computed values per
 *    sheet (exports, share links, read-only documents) — the data attributes round-trip on paste
 *  - Markdown: one table per sheet with values (sheet names as captions)
 *
 * Imports the sheets sub-area's own index directly (not features/index.ts): the schema must not
 * pull the whole features area into an import cycle with the editor.
 */
import { Node, mergeAttributes, type Editor, type JSONContent, type Range } from '@tiptap/core'
import { readAttrs, newSpreadsheetAttrs, spreadsheetHTML, spreadsheetMarkdown, spreadsheetText } from '../../features/sheets'
import { t } from '../../i18n'
import { insertBlock } from '../lib/blocks'

export const SPREADSHEET = 'spreadsheet'

const json = (v: unknown) => {
  try {
    return JSON.stringify(v)
  } catch {
    return '[]'
  }
}

function parseJson(el: HTMLElement, name: string): unknown {
  const raw = el.getAttribute(`data-${name}`)
  if (!raw || raw.length > 20_000_000) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const parsed = new WeakMap<HTMLElement, ReturnType<typeof readAttrs>>()

/** Attrs read from pasted / imported HTML: sanitized right away (once per element). */
function parseAttrs(el: HTMLElement) {
  const hit = parsed.get(el)
  if (hit) return hit
  const attrs = readAttrs({
    title: el.getAttribute('data-title') ?? '',
    sheets: parseJson(el, 'sheets'),
    active: el.getAttribute('data-active') ?? '',
    datasets: parseJson(el, 'datasets'),
    charts: parseJson(el, 'charts'),
  })
  parsed.set(el, attrs)
  return attrs
}

export function newSpreadsheetJson(): JSONContent {
  return { type: SPREADSHEET, attrs: newSpreadsheetAttrs(t('editor.spreadsheet.sheet1')) }
}

/** Slash menu: a new spreadsheet block. */
export function insertSpreadsheet(editor: Editor, range?: Range | null): void {
  insertBlock(editor, newSpreadsheetJson(), range)
}

export const Spreadsheet = Node.create({
  name: SPREADSHEET,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (el: HTMLElement) => parseAttrs(el).title,
        renderHTML: (a: Record<string, unknown>) => (a.title ? { 'data-title': String(a.title) } : {}),
      },
      sheets: {
        default: [],
        parseHTML: (el: HTMLElement) => parseAttrs(el).sheets,
        renderHTML: (a: Record<string, unknown>) => ({ 'data-sheets': json(a.sheets ?? []) }),
      },
      active: {
        default: '',
        parseHTML: (el: HTMLElement) => parseAttrs(el).active,
        renderHTML: (a: Record<string, unknown>) => (a.active ? { 'data-active': String(a.active) } : {}),
      },
      datasets: {
        default: [],
        parseHTML: (el: HTMLElement) => parseAttrs(el).datasets,
        renderHTML: (a: Record<string, unknown>) => (Array.isArray(a.datasets) && a.datasets.length ? { 'data-datasets': json(a.datasets) } : {}),
      },
      charts: {
        default: [],
        parseHTML: (el: HTMLElement) => parseAttrs(el).charts,
        renderHTML: (a: Record<string, unknown>) => (Array.isArray(a.charts) && a.charts.length ? { 'data-charts': json(a.charts) } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="spreadsheet"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'spreadsheet', class: 'sheet-static' }), ...spreadsheetHTML(node.attrs)] as never
  },
  renderText({ node }) {
    return spreadsheetText(node.attrs)
  },
  renderMarkdown(node) {
    return spreadsheetMarkdown((node.attrs ?? {}) as Record<string, unknown>)
  },
})
