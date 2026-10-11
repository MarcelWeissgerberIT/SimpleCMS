/**
 * The tape's label pass (pure; the deck measures, this decides, the deck applies): event labels flip to the
 * left of their mark when they would run into the now line or off the visible edge (a range's label flips to the
 * range's start, never over it); a label still cut at either edge is left out, never shown half; labels on one
 * lane never overlap (the later one goes); the playhead head and the now label align inward at the edges ("Jetzt →"
 * pinned when now is off to the right); ruler labels under either head (± 4 px) or cut at a visible edge are hidden.
 * Port of the mock's tape.js settle(). All positions are px in the tape's inner coordinates.
 */

export interface LabelIn {
  /** the mark's x */
  anchor: number
  /** the label's width */
  w: number
  /** left edge relative to the anchor when not flipped (14 after a flag, 8 after a range / point, −24 − w for the lead) */
  shift: number
  /** gap between a flipped label's right edge and its mark (6, or 8 after a range / point) */
  flipGap: number
  /** a range's start x: a flipped range label moves there */
  start?: number
  /** may flip (the selected run's lead label never does) */
  flips: boolean
  /** labels of one lane never overlap */
  lane?: string
  /** where the label goes when it is cut at its own place (the lead label: right of the window's end) */
  alt?: number
}

export interface LabelOut {
  flip: boolean
  hidden: boolean
  /** the label's left edge */
  left: number
}

export interface View {
  left: number
  right: number
}

const EDGE_ROOM = 6
const SAME_LANE_GAP = 4

/** Decide every event / held label at once. `nowX` null: now is not on this tape. */
export function settleLabels(labels: LabelIn[], view: View, nowX: number | null): LabelOut[] {
  const out: LabelOut[] = labels.map((l) => {
    const left = l.anchor + l.shift
    const limit = (nowX !== null && l.anchor < nowX - 2 ? Math.min(view.right, nowX) : view.right) - EDGE_ROOM
    if (l.flips && left + l.w > limit) {
      const at = l.start ?? l.anchor
      return { flip: true, hidden: false, left: at - l.flipGap - l.w }
    }
    return { flip: false, hidden: false, left }
  })
  // still cut at an edge: its other place, else left out
  const cut = (left: number, w: number) => left < view.left - 1 || left + w > view.right + 1
  out.forEach((o, i) => {
    const l = labels[i]
    if (!cut(o.left, l.w)) return
    if (l.alt !== undefined && !cut(l.alt, l.w)) {
      o.left = l.alt
      o.flip = false
      return
    }
    o.hidden = true
  })
  // one lane: the later label of two overlapping goes
  const lanes = new Map<string, number[]>()
  labels.forEach((l, i) => {
    if (l.lane === undefined || out[i].hidden) return
    const list = lanes.get(l.lane) ?? []
    list.push(i)
    lanes.set(l.lane, list)
  })
  for (const idx of lanes.values()) {
    idx.sort((a, b) => out[a].left - out[b].left)
    let right = -Infinity
    for (const i of idx) {
      if (out[i].left < right + SAME_LANE_GAP) {
        out[i].hidden = true
        continue
      }
      right = out[i].left + labels[i].w
    }
  }
  return out
}

/** 'center' · 'edge-r' (left-aligned on the line) · 'edge-l' (right-aligned) · 'pinned' (off to the right, at the edge). */
export type HeadPlace = 'center' | 'edge-r' | 'edge-l' | 'pinned'

export interface HeadOut {
  place: HeadPlace
  left: number
  right: number
}

/**
 * A head on a line: the playhead's ('head': centred on the line) or the now label ('now': 4 px right of the line).
 * `w` = its width — for 'pinned' the width with " →".
 */
export function settleHead(line: number, w: number, view: View, kind: 'head' | 'now' = 'head'): HeadOut {
  if (line > view.right) return { place: 'pinned', left: view.right - 2 - w, right: view.right - 2 }
  if (kind === 'now') {
    if (line + 4 + w > view.right - 1) return { place: 'edge-l', left: line - 4 - w, right: line - 4 }
    return { place: 'center', left: line + 4, right: line + 4 + w }
  }
  const left = line - w / 2
  if (left < view.left + 1) return { place: 'edge-r', left: line, right: line + w }
  if (left + w > view.right - 1) return { place: 'edge-l', left: line - w, right: line }
  return { place: 'center', left, right: left + w }
}

/** Ruler labels that a head covers or comes within 4 px of: true = hide. */
export function underHeads(labels: Array<{ left: number; right: number }>, heads: Array<{ left: number; right: number }>): boolean[] {
  return labels.map((r) => heads.some((h) => r.left <= h.right + 4 && r.right >= h.left - 4))
}

/** Ruler labels to hide: under a head (± 4 px) or cut at a visible edge of the tape — never shown half. */
export function hiddenRulerLabels(labels: Array<{ left: number; right: number }>, heads: Array<{ left: number; right: number }>, view: View): boolean[] {
  const under = underHeads(labels, heads)
  return labels.map((r, i) => under[i] || r.left < view.left - 1 || r.right > view.right + 1)
}
