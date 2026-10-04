/**
 * Drags inside the grid (fill handle, selection handles, long-press and header drags): the grid
 * scrolls by itself while the pointer is near (or past) an edge of the visible cells.
 */
import { ROW_HEIGHT, type SheetData } from '../model'
import { HEAD_H, RH_W } from './Grid'

const EDGE = 28
const MAX_SPEED = 36

export interface Pt {
  x: number
  y: number
}

/** One autoscroll step towards the edge the pointer is near (true: the grid scrolled). */
export function edgeScroll(vp: HTMLElement, sheet: SheetData, pt: Pt, axis: 'x' | 'y' | 'both' = 'both'): boolean {
  const box = vp.getBoundingClientRect()
  const frozen = Math.min(sheet.frozenRows ?? 0, sheet.rows) * ROW_HEIGHT
  const top = Math.max(box.top, 0) + HEAD_H + frozen
  const bottom = Math.min(box.bottom, window.innerHeight)
  const left = Math.max(box.left, 0) + RH_W
  const right = Math.min(box.right, window.innerWidth)
  const speed = (d: number) => Math.min(MAX_SPEED, Math.ceil(d / 3) + 2)
  let dy = 0
  let dx = 0
  if (axis !== 'x') {
    if (pt.y > bottom - EDGE) dy = speed(pt.y - (bottom - EDGE))
    else if (pt.y < top) dy = -speed(top - pt.y)
  }
  if (axis !== 'y') {
    if (pt.x > right - EDGE) dx = speed(pt.x - (right - EDGE))
    else if (pt.x < left) dx = -speed(left - pt.x)
  }
  if (!dy && !dx) return false
  const before = vp.scrollTop + vp.scrollLeft
  vp.scrollTop += dy
  vp.scrollLeft += dx
  return vp.scrollTop + vp.scrollLeft !== before
}
