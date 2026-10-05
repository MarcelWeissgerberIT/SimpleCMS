/**
 * The gutter column: where the grips of blocks stand (hover handle, pinned grip, gutter rule, menu
 * anchors). ONE column in front of the page content, the same x for every block at any depth —
 * paragraphs, headings, nested list / to-do / numbered items, toggles and their content, tabs, tables —
 * so a grip never sits between a marker and its text, on a marker or on content. Its right edge is the
 * left edge of the page content, less what a wide top-level number ("12.") reaches past it.
 *
 * Inside a callout, a quote, a column or a synced block the grips stand at that container's own content
 * edge instead: those share their first line with their first block (or stand side by side), so a grip
 * in the page column could not tell them apart — the page column there is the container's.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/** Containers whose blocks keep their grips at the container's own content edge. */
const EDGE_CONTAINERS = new Set(['callout', 'blockquote', 'column', 'syncedBlock'])

let measureCtx: CanvasRenderingContext2D | null | undefined

function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

function roman(n: number): string {
  let out = ''
  for (const [value, digits] of ROMAN)
    while (n >= value) {
      out += digits
      n -= value
    }
  return out
}

function alpha(n: number): string {
  let out = ''
  while (n > 0) {
    n--
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}

/** The counter text of an ordered list item ("12", "b", "iv"), as its list-style-type writes it. */
function counterText(n: number, type: string): string {
  const text = n > 0 && n < 4000 && type.endsWith('roman') ? roman(n) : n > 0 && /alpha|latin/.test(type) ? alpha(n) : String(n)
  return type.startsWith('upper') ? text.toUpperCase() : text
}

/** Width of the outside marker ("12. " — the suffix space included) of a list's last item: its widest number. */
function lastMarkerWidth(list: HTMLOListElement): number {
  const items = [...list.children].filter((el) => el.tagName === 'LI')
  const last = items[items.length - 1]
  if (!last) return 0
  const n = (Number.isFinite(list.start) ? list.start : 1) + items.length - 1
  const m = getComputedStyle(last, '::marker')
  return textWidth(`${counterText(n, getComputedStyle(list).listStyleType)}. `, `${m.fontStyle} ${m.fontWeight} ${m.fontSize} ${m.fontFamily}`)
}

/** Left edge of the page content (the editor's top-level blocks). */
export function contentLeft(view: EditorView): number {
  const dom = view.dom as HTMLElement
  return dom.getBoundingClientRect().left + (parseFloat(getComputedStyle(dom).paddingLeft) || 0)
}

let memo: { doc: PMNode | null; left: number; column: number } = { doc: null, left: Number.NaN, column: 0 }

/** The page's gutter column (its right edge): the content's left edge, left of any top-level number. */
export function pageColumn(view: EditorView): number {
  const left = contentLeft(view)
  if (memo.doc === view.state.doc && memo.left === left) return memo.column
  let column = left
  for (const ol of view.dom.querySelectorAll(':scope > ol')) {
    const last = ol.lastElementChild
    if (last instanceof HTMLElement && ol instanceof HTMLOListElement) column = Math.min(column, last.getBoundingClientRect().left - lastMarkerWidth(ol))
  }
  memo = { doc: view.state.doc, left, column }
  return column
}

/** Position of the innermost callout / quote / column / synced block holding the block at `pos`, or -1. */
function edgeContainerAt(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) if (EDGE_CONTAINERS.has($pos.node(d).type.name)) return $pos.before(d)
  return -1
}

/** The content edge of such a container (its first block's left), or null. */
function containerColumn(view: EditorView, container: number): number | null {
  const first = view.nodeDOM(container + 1)
  if (first instanceof HTMLElement) return first.getBoundingClientRect().left
  const dom = view.nodeDOM(container)
  return dom instanceof HTMLElement ? dom.getBoundingClientRect().left : null
}

/**
 * The column the grips of the block at `pos` stand in (the x of their right edge): the page column, or
 * the content edge of the callout / quote / column / synced block it sits in.
 */
export function gutterLeftAt(view: EditorView, pos: number): number | null {
  const container = edgeContainerAt(view.state.doc, pos)
  return container < 0 ? pageColumn(view) : containerColumn(view, container)
}

/** The container column of a block inside a callout / quote / column / synced block (null elsewhere). */
export function containerColumnAt(view: EditorView, pos: number): number | null {
  const container = edgeContainerAt(view.state.doc, pos)
  return container < 0 ? null : containerColumn(view, container)
}
