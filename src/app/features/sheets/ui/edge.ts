/**
 * Touch: where the "⋯" key and the fill tab sit — on the selection's own edges, so they never
 * cover another cell's text and their hit areas stop short of the neighbouring cells' centres:
 *  - room on the bottom edge: the key centred on it (on its part in view), the fill tab at its right
 *    end, just short of the bottom-right knob;
 *  - a narrow selection (one column): the key on the bottom edge, the tab on the right edge above
 *    the knob — on a single row at the row's top.
 * Both straddle the border: OUT px over it, into the neighbours' padding (no text there), the rest
 * low in the selection's last row, clear of its cells' centres (a tap there is the cell's — a double
 * tap edits it; a tap on the selection opens the menu anyway). The knobs are drawn over them: a knob
 * keeps its whole hit area, the key and the tab take what is left.
 */

/* sizes as in sheet.css (.sg-menukey, .sg-fill.is-tab, .sg-handle and their ::before hit areas) */
const KEY_W = 32
const KEY_H = 16
const TAB = 16
/** how far the key and the tab reach past the selection's border */
const OUT = 5
/** their hit areas along the bottom edge: the key's 44 wide, the tab's 32 */
const KEY_HIT = 44
const TAB_HIT = 32
/** how far those two may overlap (the tab, drawn later, takes the overlap) */
const SHARE = 8
/** the right-edge tab's hit area reaches 8 px above and below its face */
const TAB_REACH = 8
/** how far the bottom-right knob's hit area reaches into the selection */
const KNOB_IN = 14
/** the top-left knob's hit area: a circle 20 px around its centre */
const TL_HIT = 20
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
  const top = sel.bottom + OUT - KEY_H
  // the hit areas end short of the bottom-right knob's (or of the view's right edge)
  const end = br ? sel.right - KNOB_IN : x1 - 2
  let lo = x0 + KEY_HIT / 2
  // a single row: the top-left knob's hit area comes down to the key's band — the key's face stays clear of it
  const dy = tl ? Math.abs(top - tl.y) : TL_HIT
  if (tl && dy < TL_HIT) lo = Math.max(lo, tl.x + Math.sqrt(TL_HIT * TL_HIT - dy * dy) + KEY_W / 2 + 1)
  const both = end - TAB_HIT - KEY_HIT / 2 + SHARE
  const tabBelow = tab && (key ? both >= lo : end - TAB_HIT >= x0)
  if (tabBelow) out.tab = { left: Math.round(end - (TAB_HIT + TAB) / 2), top: sel.bottom + OUT - TAB, side: 'bottom' }
  // the key: wherever its face fits between the view's edge (or the left border) and the knob
  if (key && (br ? sel.right - KNOB_R : x1) - x0 >= KEY_W + 2) {
    const hi = tabBelow ? both : end - KEY_HIT / 2
    const x = lo <= hi ? clamp((x0 + x1) / 2, lo, hi) : Math.max((lo + hi) / 2, x0 + KEY_W / 2 + 1)
    out.key = { left: Math.round(x - KEY_W / 2), top }
  }
  // no room below: the right edge, above the knob — no further up than the row above's padding, nor
  // under the headers
  if (tab && !tabBelow && br && sel.right + OUT - TAB >= view.left) {
    const y = Math.max(sel.bottom - KNOB_IN - TAB_REACH - TAB, sel.top - 2, view.top + 1)
    out.tab = { left: sel.right + OUT - TAB, top: Math.round(y), side: 'right' }
  }
  return out
}
