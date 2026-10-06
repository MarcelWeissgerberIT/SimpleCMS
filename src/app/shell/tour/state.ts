/**
 * The guided tour — its state (light: the shell imports it at boot; the overlay itself loads on start).
 *
 * Per device (localStorage `one.tour`, never synced): the offer on a freshly seeded workspace (the id of its
 * Welcome page — main.tsx calls offerTour() right after seeding), "not now" for good (`off`), finished once
 * (`done`) and the throw-away Tour page it writes in (`page`). In memory: whether it runs, the step, the
 * finish card.
 */
import { create } from 'zustand'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

export const TOUR_KEY = 'one.tour'

export interface TourMemory {
  /** the Welcome page of the freshly seeded workspace the tour is offered on (null: no offer) */
  offer?: string | null
  /** "Not now" — never offered again on this device */
  off?: boolean
  /** finished once */
  done?: boolean
  /** the Tour page (created on start, offered for deletion at the end) */
  page?: string | null
}

function readMemory(): TourMemory {
  try {
    const raw = safeLocalGet(TOUR_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : {}
    if (!v || typeof v !== 'object') return {}
    const m = v as Record<string, unknown>
    return {
      offer: typeof m.offer === 'string' ? m.offer : null,
      off: m.off === true,
      done: m.done === true,
      page: typeof m.page === 'string' ? m.page : null,
    }
  } catch {
    return {}
  }
}

export interface TourState {
  running: boolean
  /** index into TOUR_STEPS */
  step: number
  /** the finish card shows (after the last step) */
  finished: boolean
  memory: TourMemory
}

export const useTour = create<TourState>()(() => ({ running: false, step: 0, finished: false, memory: readMemory() }))

export function rememberTour(patch: Partial<TourMemory>): void {
  const next = { ...readMemory(), ...patch }
  safeLocalSet(TOUR_KEY, JSON.stringify(next))
  useTour.setState({ memory: next })
}

/** main.tsx, right after a fresh workspace was seeded: offer the tour on its Welcome page (not after "Not now"). */
export function offerTour(welcomePageId: string): void {
  if (readMemory().off) return
  rememberTour({ offer: welcomePageId })
}

/** "Not now" on the offer card: gone for good on this device (⌘K, Help and "What can One do?" still start it). */
export function dismissTourOffer(): void {
  rememberTour({ offer: null, off: true })
}

/** The offer card shows on this page. */
export const useTourOffer = (pageId: string): boolean => useTour((s) => !s.running && !s.memory.off && s.memory.offer === pageId)

/** Number of steps (steps.ts lists them; kept here so the offer card and the help need not load them). */
export const TOUR_STEP_COUNT = 8

/** Start (or restart) the tour, at step `at` (0-based). The overlay loads on its first start. */
export function startTour(at = 0): void {
  rememberTour({ offer: null })
  useTour.setState({ running: true, step: Math.max(0, Math.min(TOUR_STEP_COUNT - 1, at)), finished: false })
}

/** End it (Esc, ×, "Done" on the finish card). */
export function endTour(): void {
  useTour.setState({ running: false, finished: false, step: 0 })
}
