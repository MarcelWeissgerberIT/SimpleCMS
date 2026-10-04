/**
 * Touch: where the "⋯" key and the fill tab sit — on the selection's own edges, so they never
 * cover another cell's text and their hit areas stop short of the neighbouring cells' centres:
 *  - room on the bottom edge: the key centred on it (on its part in view), the fill tab at its right
 *    end, just short of the bottom-right knob;
 *  - a narrow selection (one column): the key on the bottom edge, the tab on the right edge above
 *    the knob — on a single row at the row's top.
 * Both reach OUT px past the border, into the neighbours' padding (no text there). The knobs are
 * drawn over them: a knob keeps its whole hit area, the key and the tab take what is left.
 */

/* sizes as in sheet.css (.sg-menukey, .sg-fill.is-tab, .sg-handle and their ::before hit areas) */
export const KEY_W = 32
export const KEY_H = 24
export const TAB = 18
/** how far the key and the tab reach past the selection's border */
export const OUT = 4
const KEY_HIT = 44
const TAB_HIT = 34
/** how far the bottom-right knob's hit area reaches into the selection */
const KNOB_IN = 14
/** the top-left knob's hit area: 22 px around its centre */
const TL_HIT = 22
/** the bottom-right knob's visual radius (+ a hair of air) */
const KNOB_R = 9

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EdgeInput {
  /** the selection's box in the layer of its last row */
  sel: Box
  /** the part of that layer in view (under no header) */
  view: Box
  /** the bottom-right knob is shown, in view */
  br: boolean
  /** the top-left knob's centre, when it is shown in this layer */
  tl: { x: number; y: number } | null
  key: boolean
  tab: boolean
}

export interface EdgePlaces {
  key: { left: number; top: number } | null
  tab: { left: number; top: number; side: 'bottom' | 'right' } | null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function edgePlaces({ sel, view, br, tl, key, tab }: EdgeInput): EdgePlaces {
  const out: EdgePlaces = { key: null, tab: null }
  // the bottom edge's part in view
  const x0 = Math.max(sel.left, view.left)
  const x1 = Math.min(sel.right, view.right)
  if (x1 <= x0) return out
  // the hit areas end short of the bottom-right knob's (or of the view's right edge)
  const end = br ? sel.right - KNOB_IN : x1 - 2
  let lo = x0 + KEY_HIT / 2
  // a single row: the top-left knob's hit area comes down to the key's — its centre stays clear of it
  if (tl && tl.y + TL_HIT > sel.bottom + OUT - KEY_H) lo = Math.max(lo, tl.x + TL_HIT + 8)
  const both = end - TAB_HIT - KEY_HIT / 2
  const tabBelow = tab && (key ? both >= lo : end - TAB_HIT >= x0)
  if (tabBelow) out.tab = { left: Math.round(end - (TAB_HIT + TAB) / 2), top: sel.bottom + OUT - TAB, side: 'bottom' }
  // the key: wherever its face fits between the view's edge (or the left border) and the knob
  if (key && (br ? sel.right - KNOB_R : x1) - x0 >= KEY_W + 2) {
    const hi = tabBelow ? both : end - KEY_HIT / 2
    const x = lo <= hi ? clamp((x0 + x1) / 2, lo, hi) : Math.max((lo + hi) / 2, x0 + KEY_W / 2 + 1)
    out.key = { left: Math.round(x - KEY_W / 2), top: sel.bottom + OUT - KEY_H }
  }
  // no room below: the right edge, above the knob — no further up than the row above's padding,
  // nor under the headers
  if (tab && !tabBelow && br && sel.right + OUT - TAB >= view.left) {
    const top = Math.max(sel.bottom - KNOB_IN - (TAB_HIT + TAB) / 2, sel.top - 2, view.top + 1)
    out.tab = { left: sel.right + OUT - TAB, top: Math.round(top), side: 'right' }
  }
  return out
}
