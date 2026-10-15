/**
 * Arrow keys on the rack (plan §3.9): a 2D roving tab stop over the layout's slots — modules, net flags, folds and "+n"
 * bus chips are all stops. ↑ / ↓ move to the stop above / below in the same column; ← / → to the neighbouring column
 * (an empty one is skipped), onto the stop whose rows hold the current row, else the nearest one (the upper one on a
 * tie); Home / End to the column's first / last stop. Pure: the page focuses `[data-stop="<id>"]`.
 */
import type { Layout, Slot } from '../layout'
import type { Column } from '../types'

export interface Stop {
  id: string
  col: Column
  row: number
  span: number
}

export type RoveKey = 'up' | 'down' | 'left' | 'right' | 'home' | 'end'

/** The arrow keys' names → a move (other keys: null). */
export function roveKeyOf(key: string): RoveKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'Home':
      return 'home'
    case 'End':
      return 'end'
    default:
      return null
  }
}

/** Every stop of a layout (each slot once), by column then row. */
export function stopsOf(layout: Pick<Layout, 'slots'>): Stop[] {
  return layout.slots
    .map((s: Slot) => ({ id: s.id, col: s.col, row: s.row, span: s.kind === 'module' ? s.span : 1 }))
    .sort((a, b) => a.col - b.col || a.row - b.row)
}

/** How far a stop's rows are from `row` (0 when it holds it). */
const dist = (s: Stop, row: number): number => (row < s.row ? s.row - row : row > s.row + s.span - 1 ? row - (s.row + s.span - 1) : 0)

/** The stop a key moves to from `from` (null: nowhere to go — the edge of the rack, or an unknown stop). */
export function nextStop(stops: readonly Stop[], from: string, key: RoveKey): string | null {
  const cur = stops.find((s) => s.id === from)
  if (!cur) return null
  const col = (c: number) => stops.filter((s) => s.col === c)
  const same = col(cur.col)
  const i = same.indexOf(cur)
  switch (key) {
    case 'up':
      return i > 0 ? same[i - 1].id : null
    case 'down':
      return i < same.length - 1 ? same[i + 1].id : null
    case 'home':
      return same[0] && same[0] !== cur ? same[0].id : null
    case 'end':
      return same.length && same[same.length - 1] !== cur ? same[same.length - 1].id : null
    case 'left':
    case 'right': {
      const step = key === 'left' ? -1 : 1
      for (let c = cur.col + step; c >= 1 && c <= 3; c += step) {
        const list = col(c)
        if (!list.length) continue
        let best = list[0]
        for (const s of list) if (dist(s, cur.row) < dist(best, cur.row)) best = s
        return best.id
      }
      return null
    }
  }
}
