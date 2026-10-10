/**
 * The gutter column: where the grips of blocks stand (hover handle, pinned grip, gutter rule, menu
 * anchors). ONE column in front of the page content, the same x for every block at any depth —
 * paragraphs, headings, nested list / to-do / numbered items, toggles and their content, callouts,
 * quotes, tabs, tables — so a grip never sits between a marker and its text, on a marker, an icon, a
 * quote's bar or on content. Its right edge is the left edge of the page content, less what a wide
 * top-level number ("12.") reaches past it.
 *
 * Only a column right of the first one has its own: its grips stand at that column's left edge, in the
 * gap between the columns — grip only, the gap has no room for "+" (`compact`).
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/** Containers with chrome around their blocks (padding, an icon, a bar): left of / above / below their blocks they are the target. */
const CHROME = new Set(['callout', 'blockquote', 'syncedBlock', 'workItem'])

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

/** Position of the innermost ancestor of the block at `pos` whose type is in `types`, or -1. */
function ancestorAt(doc: PMNode, pos: number, types: Set<string>): number {
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) if (types.has($pos.node(d).type.name)) return $pos.before(d)
  return -1
}

const COLUMN = new Set(['column'])

/** Left edge of the column (right of the first one) the block at `pos` sits in, or null. */
export function columnLeftAt(view: EditorView, pos: number): number | null {
  const column = ancestorAt(view.state.doc, pos, COLUMN)
  const dom = column < 0 ? null : view.nodeDOM(column)
  if (!(dom instanceof HTMLElement)) return null
  const left = dom.getBoundingClientRect().left
  return left > contentLeft(view) + 1 ? left : null
}

export interface Gutter {
  /** the x of the grips' right edge */
  x: number
  /** grip only, no "+" (a column's gap) */
  compact: boolean
}

/** Where the grips of the block at `pos` stand: the page column, or (grip only) a later column's edge. */
export function gutterAt(view: EditorView, pos: number): Gutter {
  const column = columnLeftAt(view, pos)
  return column === null ? { x: pageColumn(view), compact: false } : { x: column, compact: true }
}

export const gutterLeftAt = (view: EditorView, pos: number): number => gutterAt(view, pos).x

/**
 * The blocks' box inside the innermost callout / quote / synced block around the block at `pos` (its
 * first block's left and top, its last block's bottom), or null outside one.
 */
export function chromeBoxAt(view: EditorView, pos: number): { left: number; top: number; bottom: number } | null {
  const doc = view.state.doc
  const at = ancestorAt(doc, pos, CHROME)
  const node = at < 0 ? null : doc.nodeAt(at)
  if (!node?.firstChild || !node.lastChild) return null
  const first = view.nodeDOM(at + 1)
  const last = view.nodeDOM(at + 1 + node.content.size - node.lastChild.nodeSize)
  if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return null
  const a = first.getBoundingClientRect()
  return { left: a.left, top: a.top, bottom: last.getBoundingClientRect().bottom }
}

/**
 * The line a block owns, the row its grip belongs to: a text block's or a leaf's own box; a block of
 * blocks from its top to the bottom of its first text (a list item's first line, a toggle's title, a
 * callout's padding and first line) — not the blocks nested under it.
 */
export function ownBox(view: EditorView, pos: number): DOMRect | null {
  const node = view.state.doc.nodeAt(pos)
  const dom = view.nodeDOM(pos)
  if (!node || !(dom instanceof HTMLElement)) return null
  const r = dom.getBoundingClientRect()
  if (node.isTextblock || node.isLeaf) return r
  let first = -1
  node.descendants((child, offset) => {
    if (first >= 0) return false
    if (child.isTextblock || child.isLeaf) first = pos + 1 + offset
    return first < 0
  })
  const inner = first >= 0 ? view.nodeDOM(first) : null
  if (!(inner instanceof HTMLElement)) return r
  return new DOMRect(r.left, r.top, r.width, Math.max(0, inner.getBoundingClientRect().bottom - r.top))
}
