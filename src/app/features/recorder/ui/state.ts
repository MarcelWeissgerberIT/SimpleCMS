/**
 * The deck's own UI store (never `useWorkspace`): open, the playhead, the span (zoom + right edge), the loupe, the
 * bracketed window, the focused lane, the lane filter, the loaded ops, the desktop height. Per-device prefs in
 * localStorage `one.recorder.ui` = { zoom, loupe, filter, height } (never synced; may be unavailable). One dock at a
 * time: opening the deck hides the AI terminal (which never stops its task) and the terminal's opening closes the deck.
 */
import { create } from 'zustand'
import { closeAgent, useAgent } from '../../ai/agent/state'
import { closeOutboxSheet, onOutboxSheetOpen } from '../../outbox'
import { canFocus, focusIsNowhere, takeFocusHandoff } from '../../../ui/focus'
import { ZOOM, ZOOMS, type Zoom } from '../model/axis'
import type { EjectRecord, JOp, JRun, LaneKey, PlaceKey, Scope } from '../model/types'
import type { HeldMark } from '../window/read'

/** Opens / closes the deck (shell/lib/global.ts, the status key, ⌘K). */
export const REWIND_SHORTCUT = 'Mod+Alt+Z'

const PREFS_KEY = 'one.recorder.ui'
/** a closed deck keeps its window this long */
const BRACKET_KEEP_MS = 10 * 60_000
export const HEIGHT_MIN = 220
export const HEIGHT_DEFAULT = 360

/** The selected window: a writer's lane (and run, from its flag), half-open [a, b). */
export interface Bracket {
  lane: LaneKey
  run?: string
  a: number
  b: number
}

/** The loaded part of the tape: ops by lane (sorted by `at`), the runs they belong to — plus live pushes. */
export interface OpsWindow {
  scope: Scope | null
  from: number
  to: number
  lanes: Record<LaneKey, JOp[]>
  runs: Record<string, JRun>
  /** bumped with every change */
  rev: number
  status: 'idle' | 'loading' | 'ready'
  /** 24 STD: only the runs were read (the lanes draw from the minute histogram) */
  runsOnly?: boolean
  /** a dense span's first paint: the lanes draw from the minute histogram until its ops are read */
  interim?: boolean
}

export interface RecorderUI {
  open: boolean
  /** 'rewind' arrives with the ghost (R4), 'after' with the eject (R3) */
  mode: 'live'
  /** null = now (follows the clock) */
  playhead: number | null
  /** the zoom and the right edge ('now' = follows the clock) */
  span: { zoom: Zoom; t1: number | 'now' }
  loupe: boolean
  /** while a drag runs, the loupe's factor and window stay as they were */
  axisFrozen: { k: number; zone: [number, number] } | null
  bracket: Bracket | null
  focusLane: LaneKey | null
  /** hidden lanes (null: all shown) */
  filter: LaneKey[] | null
  ops: OpsWindow
  /** the 24 h strip: Vorgänge per quarter (quarter index → count) from `q0` on */
  strip: { q0: number; counts: Record<number, number> } | null
  /** 24 STD: the minute histogram of the span (lane → [minute, count]) */
  hist: { from: number; to: number; lanes: Record<LaneKey, Array<[number, number]>> } | null
  /** every lane this scope ever recorded (the filter's list) */
  known: LaneKey[]
  /** stretches whose recording was lost (a tab closed before it wrote what it had recorded) */
  gaps: Array<{ from: number; to: number }>
  /** desktop deck height (px) */
  height: number
  /** when the deck was last closed (its window is kept for 10 minutes) */
  closedAt: number
  /** the deck asks to take focus (bumped on every open) */
  focusTick: number
  /** the read dialog ("Fenster lesen"): open, and the place picked in its list */
  read: { open: boolean; pick: PlaceKey | null } | null
  /** the selected window's held places (the plate's note, the tape's diamonds) for the window `key` */
  held: { key: string; marks: HeldMark[]; count: number; who: Array<LaneKey | null> } | null
  /** live eject records of the loaded span (R3 draws them; "ejected" is never read from JRun.state) */
  ejects: EjectRecord[]
}

interface Prefs {
  zoom: Zoom
  loupe: boolean
  filter: LaneKey[] | null
  height: number
}

const DEFAULT_PREFS: Prefs = { zoom: '75m', loupe: true, filter: null, height: HEIGHT_DEFAULT }

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS
    return {
      zoom: ZOOMS.includes(raw.zoom as Zoom) ? (raw.zoom as Zoom) : DEFAULT_PREFS.zoom,
      loupe: typeof raw.loupe === 'boolean' ? raw.loupe : DEFAULT_PREFS.loupe,
      filter: Array.isArray(raw.filter) ? raw.filter.filter((l): l is string => typeof l === 'string' && l.length <= 120).slice(0, 200) : null,
      height: typeof raw.height === 'number' && Number.isFinite(raw.height) ? Math.max(HEIGHT_MIN, Math.round(raw.height)) : DEFAULT_PREFS.height,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(): void {
  const s = useRecorderUI.getState()
  const p: Prefs = { zoom: s.span.zoom, loupe: s.loupe, filter: s.filter, height: s.height }
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* private mode: this session only */
  }
}

export const emptyOps = (): OpsWindow => ({ scope: null, from: 0, to: 0, lanes: {}, runs: {}, rev: 0, status: 'idle' })

const prefs = typeof window === 'undefined' ? DEFAULT_PREFS : readPrefs()

export const useRecorderUI = create<RecorderUI>()(() => ({
  open: false,
  mode: 'live',
  playhead: null,
  span: { zoom: prefs.zoom, t1: 'now' },
  loupe: prefs.loupe,
  axisFrozen: null,
  bracket: null,
  focusLane: null,
  filter: prefs.filter,
  ops: emptyOps(),
  strip: null,
  hist: null,
  known: [],
  gaps: [],
  height: prefs.height,
  closedAt: 0,
  focusTick: 0,
  read: null,
  held: null,
  ejects: [],
}))

/** Is the deck open (the shell's slots: the status key, quick capture's cover check …)? */
export const useRecorderOpen = (): boolean => useRecorderUI((s) => s.open)
/** The same, outside React (the global keys). */
export const isRecorderOpen = (): boolean => useRecorderUI.getState().open

/** Who opened the deck (focus goes back there when it closes): what had focus — never a menu or the palette, which
 * are gone by then and hand their own opener over. */
let opener: HTMLElement | null = null

/** The deck's opener, taken once (Deck, on mount): the key a menu / ⌘K handed over, else what had focus. */
export function takeOpener(): HTMLElement | null {
  const handed = takeFocusHandoff()
  const own = opener
  opener = null
  return handed ?? own
}

/** Open the deck at now (the AI terminal and the Outbox sheet step aside — their work goes on). */
export function openRecorder(): void {
  const s = useRecorderUI.getState()
  const active = typeof document === 'undefined' ? null : document.activeElement
  opener = canFocus(active) && !focusIsNowhere(active) && !active.closest('[data-popover], [role="menu"], .pal-scrim, [cmdk-root], section.deck') ? active : null
  try {
    performance.mark('rec-open')
  } catch {
    /* no performance marks */
  }
  if (useAgent.getState().open) closeAgent()
  closeOutboxSheet()
  const keep = s.bracket && Date.now() - s.closedAt < BRACKET_KEEP_MS
  useRecorderUI.setState({ open: true, playhead: null, span: { ...s.span, t1: 'now' }, bracket: keep ? s.bracket : null, axisFrozen: null, focusTick: s.focusTick + 1 })
}

/** Close the deck: the playhead goes back to now; the window is kept for 10 minutes. */
export function closeRecorder(): void {
  if (!useRecorderUI.getState().open) return
  useRecorderUI.setState({ open: false, playhead: null, axisFrozen: null, closedAt: Date.now(), ops: emptyOps(), strip: null, hist: null, gaps: [], read: null, held: null, ejects: [] })
}

/* ---------- reading a window (R2) ---------- */

/** Open "Fenster lesen" on the selected window (never ejects; without a window nothing). */
export function openRead(): void {
  const s = useRecorderUI.getState()
  if (!s.open || !s.bracket) return
  useRecorderUI.setState({ read: { open: true, pick: s.read?.pick ?? null } })
}

export function closeRead(): void {
  if (useRecorderUI.getState().read) useRecorderUI.setState({ read: null })
}

/** The place picked in the read dialog's list (its preview follows). */
export function pickPlace(p: PlaceKey | null): void {
  const r = useRecorderUI.getState().read
  if (r && r.pick !== p) useRecorderUI.setState({ read: { ...r, pick: p } })
}

/** The held check of the window `key` (or null: none yet / no window). */
export function setHeld(held: RecorderUI['held']): void {
  useRecorderUI.setState({ held })
}

export function toggleRecorder(): void {
  if (useRecorderUI.getState().open) closeRecorder()
  else openRecorder()
}

/* ---------- the deck's own changes ---------- */

export function setZoom(zoom: Zoom): void {
  useRecorderUI.setState((s) => ({ span: { zoom, t1: s.playhead === null ? 'now' : s.span.t1 } }))
  writePrefs()
}

export function setLoupe(on: boolean): void {
  useRecorderUI.setState({ loupe: on })
  writePrefs()
}

export function setFilter(hidden: LaneKey[] | null): void {
  useRecorderUI.setState({ filter: hidden && hidden.length ? [...new Set(hidden)] : null })
  writePrefs()
}

export function setDeckHeight(h: number): void {
  useRecorderUI.setState({ height: Math.max(HEIGHT_MIN, Math.round(h)) })
  writePrefs()
}

/** The playhead (null or a moment at / after now = back to now). */
export function setPlayhead(t: number | null): void {
  useRecorderUI.setState({ playhead: t === null || t >= Date.now() - 500 ? null : Math.round(t) })
}

/** The span's right edge (a moment, or 'now' = follow the clock). */
export function setSpanEnd(t1: number | 'now'): void {
  useRecorderUI.setState((s) => ({ span: { ...s.span, t1 } }))
}

export function setBracket(b: Bracket | null): void {
  const next = b && b.b > b.a ? b : null
  const s = useRecorderUI.getState()
  // another window: the read dialog's pick and the held marks belonged to the old one
  const same = !!next && !!s.bracket && next.lane === s.bracket.lane && next.run === s.bracket.run && next.a === s.bracket.a && next.b === s.bracket.b
  useRecorderUI.setState(same ? { bracket: next } : { bracket: next, held: null, read: next && s.read ? { open: s.read.open, pick: null } : null })
}

export function setFocusLane(lane: LaneKey | null): void {
  useRecorderUI.setState({ focusLane: lane })
}

export function freezeAxis(f: RecorderUI['axisFrozen']): void {
  useRecorderUI.setState({ axisFrozen: f })
}

/** The span of a zoom (ms). */
export const spanOf = (zoom: Zoom): number => ZOOM[zoom].span

/* ---------- one dock at a time ---------- */

if (typeof window !== 'undefined') {
  useAgent.subscribe((s, p) => {
    if (s.open && !p.open && useRecorderUI.getState().open) closeRecorder()
  })
  // below 1200 px the Outbox is a sheet over the page's right side: it and the deck never share the screen
  onOutboxSheetOpen(() => {
    if (useRecorderUI.getState().open) closeRecorder()
  })
}
