/**
 * Preflight's tab memory (never stored): which lamp's queue is open, whether the plate was unfolded, which lamp the
 * aside's rule card shows, where focus goes next. Reset on a scope change and on a new Preflight day. The queue
 * itself (cards, done list, the optimistic overlay) joins here in P2.
 */
import { create } from 'zustand'
import type { LampId } from '../registry'

export type QueueTab = LampId | 'all'

export interface QueueState {
  /** the open tab; null = no queue shown */
  lamp: QueueTab | null
  /** the plate was unfolded in this tab (the day's first full render, a lamp turning new, the chevron, ⌘K, MASTER CAUTION with nothing new) */
  unfolded: boolean
  /** the lamp the aside's rule card shows (↵ on a dark cap, a grey cap without a fix); null = the default */
  aside: LampId | null
  /** the cap holding focus while focus is in the plate (the aside follows it) */
  cursor: LampId | null
  /** the overflow list (lamps past 16) shown in the aside */
  overflow: boolean
  /** consumed by the plate / strip mount effect: where focus goes once it is there */
  pendingFocus: 'card' | 'plate' | null
  /** the optimistic overlay: ids an action runs on or just finished · ids an Undo just brought back */
  pending: Array<{ lamp: LampId; id: string; at: number }>
  undone: Array<{ lamp: LampId; id: string; at: number }>
}

export const initialQueue = (): QueueState => ({ lamp: null, unfolded: false, aside: null, cursor: null, overflow: false, pendingFocus: null, pending: [], undone: [] })

export const useQueue = create<QueueState>()(() => initialQueue())

/** Forget the tab memory (scope change, a new Preflight day). */
export function resetQueue(): void {
  useQueue.setState(initialQueue())
}
