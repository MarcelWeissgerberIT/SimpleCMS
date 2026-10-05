/**
 * Where the gutter buttons of a block end (hover handle, pinned grip, gutter rule, menu anchors): the
 * left edge of the block — or, for a list item, of its bullet / number / checkbox, so the grips sit
 * BESIDE the marker, never on it (the same gap as in front of a paragraph's text). A nested item's
 * grip lands in its parent's indent, just left of its own marker.
 *
 *  - bullet: the li's `::before` square (its computed `left`)
 *  - number / letter / roman numeral: `::marker` has no box to measure — its text ("12. ") is measured
 *    in the marker's own font; an outside marker ends at the li's left edge
 *  - to-do: the checkbox (its label)
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

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

/**
 * Width of an ordered list item's outside marker ("12. " — the suffix space included), at least that
 * of the list's last item: the grips of one list stand in one column ("9." and "10." alike).
 */
function markerWidth(li: HTMLElement, list: HTMLOListElement): number {
  const start = Number.isFinite(list.start) ? list.start : 1
  let n = start
  let total = 0
  for (const el of list.children)
    if (el.tagName === 'LI') {
      if (el === li) n = start + total
      total++
    }
  const m = getComputedStyle(li, '::marker')
  const font = `${m.fontStyle} ${m.fontWeight} ${m.fontSize} ${m.fontFamily}`
  const type = getComputedStyle(list).listStyleType
  const width = (k: number) => textWidth(`${counterText(k, type)}. `, font)
  return Math.max(width(n), width(start + total - 1))
}

/** The x (viewport) where the gutter of the block `node` (rendered as `dom`) begins. */
export function gutterLeft(dom: HTMLElement, node: PMNode): number {
  const left = dom.getBoundingClientRect().left
  const name = node.type.name
  if (name === 'taskItem') {
    // (a nested to-do's own box reaches further left, over its parent's checkbox column — editor.css)
    const box = dom.querySelector(':scope > label')?.getBoundingClientRect()
    return box && box.width > 0 ? box.left : left
  }
  if (name !== 'listItem') return left
  const list = dom.parentElement
  if (list instanceof HTMLOListElement) return left - markerWidth(dom, list)
  const bullet = parseFloat(getComputedStyle(dom, '::before').left)
  return Number.isFinite(bullet) ? left + Math.min(0, bullet) : left
}

/** gutterLeft for the block at `pos` of a view (null when it has no element). */
export function gutterLeftAt(view: EditorView, pos: number): number | null {
  const dom = view.nodeDOM(pos)
  const node = view.state.doc.nodeAt(pos)
  return dom instanceof HTMLElement && node ? gutterLeft(dom, node) : null
}
