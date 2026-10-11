/**
 * The tape's keys — only while focus is on the playhead (a slider), a track or a flag; the deck's buttons, the zoom
 * group and menus keep their own keys:
 *   ← / →  playhead ∓ 1 min (Shift: 10 s)        Home / End  span start / now
 *   [ / ]  the window's start / end at the playhead on the focused track (else the selected one, else "Du") —
 *          also with Ctrl / Alt / AltGr / Option (German Windows: AltGr+8 / 9, macOS: ⌥5 / ⌥6)
 *   ↑ / ↓  previous / next track (roving)          PageUp / PageDown  previous / next flag on the track
 *   ↵      reads the window — on the playhead or a track while one is chosen; on a flag: its run bracketed, then read
 *          (never ejects; handled here, so the flag's own click does not run as well)
 */
import type { KeyboardEvent } from 'react'
import { bracketEdge, bracketRuns, movePlayhead, playheadAt, runStarts, stepPlayhead } from './actions'
import { spanOfState } from './clock'
import { sayRun } from './live'
import { openRead, setFocusLane, useRecorderUI } from './state'

const MIN = 60_000

/** The element the tape's keys work on (or null: leave the key alone). */
const tapeTarget = (el: EventTarget | null): HTMLElement | null => (el as HTMLElement | null)?.closest?.('.playhead__h, .lane, .flag') ?? null

/** The lane a key acts on: the focused track, else the selected one, else "you". */
function laneFor(target: HTMLElement): string {
  const own = target.closest<HTMLElement>('.lane')?.dataset.lane
  return own ?? useRecorderUI.getState().focusLane ?? useRecorderUI.getState().bracket?.lane ?? 'you'
}

function focusLane(root: HTMLElement, lane: string): void {
  const el = root.querySelector<HTMLElement>(`.lane[data-lane="${CSS.escape(lane)}"]`)
  if (!el) return
  setFocusLane(lane)
  el.focus({ preventScroll: false })
}

export function onTapeKey(e: KeyboardEvent<HTMLElement>, lanes: string[]): void {
  if (e.nativeEvent.isComposing) return
  const target = tapeTarget(e.target)
  if (!target) return
  const root = e.currentTarget
  const key = e.key
  // [ and ]: whatever modifier made the character (German AltGr+8 / 9, macOS ⌥5 / ⌥6)
  if (key === '[' || key === ']') {
    e.preventDefault()
    bracketEdge(key === '[' ? 'start' : 'end', laneFor(target))
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  switch (key) {
    case 'Enter': {
      if (e.shiftKey || e.repeat) return
      if (target.matches('.flag')) {
        e.preventDefault()
        const lane = target.closest<HTMLElement>('.lane')?.dataset.lane
        const runs = (target.dataset.runs ?? '').split(' ').filter(Boolean)
        if (!lane || !runs.length) return
        bracketRuns(lane, runs)
        openRead()
        return
      }
      if (!useRecorderUI.getState().bracket) return
      e.preventDefault()
      openRead()
      return
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault()
      stepPlayhead((key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10_000 : MIN))
      return
    }
    case 'Home': {
      e.preventDefault()
      movePlayhead(spanOfState(useRecorderUI.getState()).t0)
      return
    }
    case 'End': {
      e.preventDefault()
      movePlayhead(null)
      return
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!lanes.length) return
      e.preventDefault()
      const own = target.closest<HTMLElement>('.lane')?.dataset.lane
      if (!own) {
        // from the playhead (or a flag's head): into the tracks at the roving one — no step yet
        const s = useRecorderUI.getState()
        focusLane(root, [s.focusLane, s.bracket?.lane].find((l): l is string => !!l && lanes.includes(l)) ?? lanes[0])
        return
      }
      const i = lanes.indexOf(own)
      const next = i < 0 ? 0 : Math.max(0, Math.min(lanes.length - 1, i + (key === 'ArrowUp' ? -1 : 1)))
      focusLane(root, lanes[next])
      return
    }
    case 'PageUp':
    case 'PageDown': {
      e.preventDefault()
      const lane = laneFor(target)
      const at = playheadAt()
      const starts = runStarts(lane)
      const hit = key === 'PageUp' ? [...starts].reverse().find((r) => r.t < at - 999) : starts.find((r) => r.t > at + 999)
      if (!hit) return
      movePlayhead(hit.t)
      sayRun(hit.run, lane, hit.t)
      // the flag takes focus once it is drawn at its new place
      requestAnimationFrame(() => root.querySelector<HTMLElement>(`.lane[data-lane="${CSS.escape(lane)}"] .flag[data-runs~="${CSS.escape(hit.run)}"]`)?.focus())
      return
    }
  }
}
