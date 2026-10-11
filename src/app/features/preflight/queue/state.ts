/**
 * Preflight's tab memory (never stored): which lamp's queue is open, whether the plate was unfolded, which lamp the
 * aside's rule card shows, where focus goes next — and the queue itself (§7.1): the cards per lamp as their sources
 * listed them, the order they were shown in, the current card per tab, what was shown in full (⇧A), what was done in
 * this tab today (Z), the confirm row, the optimistic overlay. Reset on a scope change and on a new Preflight day.
 */
import { create } from 'zustand'
import type { HandWhy, LampId, QueueItem } from '../registry'
import type { DoneEntry } from '../types'

export type QueueTab = LampId | 'all'

export interface QueueState {
  /** the open tab; null = no queue opened in this tab (the full plate then shows its default tab) */
  lamp: QueueTab | null
  /** the plate was unfolded in this tab (the day's first full render, a lamp turning new, the chevron, ⌘K, MASTER CAUTION with nothing new) */
  unfolded: boolean
  /** the lamp the aside's rule card shows (↵ on a dark cap, a grey cap without a fix); null = the default */
  aside: LampId | null
  /** the cap holding focus while focus is in the plate (the aside follows it) */
  cursor: LampId | null
  /** the overflow list (lamps past 16) shown in the aside */
  overflow: boolean
  /** consumed by the plate / queue mount effect: where focus goes once it is there */
  pendingFocus: 'card' | 'plate' | null
  /** the optimistic overlay: ids an action runs on or just finished · ids an Undo just brought back */
  pending: Array<{ lamp: LampId; id: string; at: number }>
  undone: Array<{ lamp: LampId; id: string; at: number }>

  /** the cards of each lamp as its source listed them last (loaded while the queue is on screen) */
  items: Partial<Record<LampId, QueueItem[]>>
  /** ids in the order shown when the tab opened (done ones stay for the gauge); arrivals join at their risk place */
  order: Partial<Record<QueueTab, string[]>>
  /** the current card per tab (kept when the person leaves Start) */
  card: Partial<Record<QueueTab, string>>
  /** the last known item of a card that went elsewhere (the tombstone draws it) */
  seen: Record<string, QueueItem>
  /** cards shown in full (current, body rendered) in this tab, with the content revision shown — ⇧A takes only these, and
   *  only while that is still their revision */
  viewed: Record<string, string>
  prepared: Record<string, 'loading' | 'ready' | 'error'>
  /** this tab, this Preflight day (Z undoes the newest; a batch together) */
  done: DoneEntry[]
  /** keys whose source decides by its reading (an Outbox slip, a sign-in): written to `done` when the id leaves */
  inWork: Record<string, DoneEntry>
  /** E: the diff open */
  expanded: Record<string, true>
  /** the VON HAND confirm row on a card */
  confirm: { id: string; key: string; why: HandWhy[]; input?: string } | null
  /** the open text field of a card (an answer, a rework note) */
  input: { id: string; key: string } | null
  /** an action runs on this card */
  busy: string | null
  /** the last error per card (a message key or text) */
  error: Record<string, string>
  /** cards decided elsewhere while shown */
  tombstones: Record<string, 'elsewhere'>
  /** the bulk sheet: clean cards not yet shown in full, before ⇧A applies */
  bulk: { tab: QueueTab; ids: string[] } | null
  /** bumped when the opened set changes (here or in another tab): ANGESTAUBT is worked out again */
  openedRev: number
  /** a card leaving (its exit motion) */
  leaving: Record<string, 'right' | 'left'>
  /** the live region's text (polite) */
  live: string
}

export const initialQueue = (): QueueState => ({
  lamp: null,
  unfolded: false,
  aside: null,
  cursor: null,
  overflow: false,
  pendingFocus: null,
  pending: [],
  undone: [],
  items: {},
  order: {},
  card: {},
  seen: {},
  viewed: {},
  prepared: {},
  done: [],
  inWork: {},
  expanded: {},
  confirm: null,
  input: null,
  busy: null,
  error: {},
  tombstones: {},
  bulk: null,
  openedRev: 0,
  leaving: {},
  live: '',
})

export const useQueue = create<QueueState>()(() => initialQueue())

/** Forget the tab memory (scope change, a new Preflight day). */
export function resetQueue(): void {
  useQueue.setState(initialQueue())
}

/* ---------------- focus leaving with the plate (the strip takes it in the same commit) */

let focusGoneAt = 0

/** The full plate (or its queue) unmounts with focus inside: the strip mounting in its place takes the keyboard. */
export function noteFocusGone(now = Date.now()): void {
  focusGoneAt = now
}

/** Read once by the strip's mount: the plate it replaces had the keyboard a moment ago (the same commit; never later). */
export function takeFocusGone(now = Date.now()): boolean {
  const v = focusGoneAt > 0 && now - focusGoneAt < 1000
  focusGoneAt = 0
  return v
}

/* ---------------- the queue on screen (the agents area holds its "has N proposals" toast back meanwhile) */

let shownTab: QueueTab | null = null

/** The queue component reports the tab it shows (null: none on screen). */
export function noteShownTab(tab: QueueTab | null): void {
  shownTab = tab
}

/** The tab the queue shows now (null: none on screen). */
export const notedTab = (): QueueTab | null => shownTab

/** The proposals queue is on screen now (its tab or "All", the document visible). */
export function proposalsOnScreen(): boolean {
  return (shownTab === 'proposals' || shownTab === 'all') && typeof document !== 'undefined' && document.visibilityState === 'visible'
}
