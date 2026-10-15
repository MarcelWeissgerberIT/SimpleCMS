/**
 * The page's own state (plan §3.3, §3.9) — per tab, in memory, never stored: which module the pointer is over, which
 * module is selected (its chains lit, the rest dimmed), the fuse selected (the readout's FUSE cell, `?f=`, the glyph,
 * F, the plate's tabs — B8), the filter the person picked and the folds opened; the rack's roving cursor (the stop Tab
 * enters on), the jack the keyboard is on (its cables lit) and the page's polite announcement (B7). The page resets it
 * when it closes (the filter stays for the tab: coming back shows what was asked for).
 */
import { create } from 'zustand'
import type { FilterPreset, ModuleKey } from '../types'

export interface PbUI {
  /** the module under the pointer (its cables and twin net flags light in ink) */
  hover: ModuleKey | null
  /** the selected module (click / Space): its chains light, the rest dims; "Open ↵" shows on it */
  selected: ModuleKey | null
  /** a net flag lit by the person (click / ↵ on a flag: both twins light) */
  net: string | null
  /** the selected fuse's path key (null: the first open one is the active fuse — activeFuse) */
  fuse: string | null
  /** 'auto' = the page's default (defaultPreset: "Fuse paths only" past 30 modules with an open fuse) */
  filter: FilterPreset | null | 'auto'
  /** fold ids the person opened */
  unfolded: string[]
  /** the rack's roving tab stop (a slot id: module key, flag id, fold id, bus id) — the one Tab enters on */
  cursor: string | null
  /** the jack the keyboard is on (J picked it): its cables light in ink */
  jack: string | null
  /** the page's polite announcement (n: a new one, also with the same words) */
  say: { text: string; n: number }
  /** modules whose name box stays under 12ch after their own tiers (Module.tsx useJackFit): > 0 → the strands view */
  tight: number
}

const FRESH: Omit<PbUI, 'filter' | 'say'> = { hover: null, selected: null, net: null, fuse: null, unfolded: [], cursor: null, jack: null, tight: 0 }

export const usePbUI = create<PbUI>(() => ({ ...FRESH, filter: 'auto', say: { text: '', n: 0 } }))

export const setHover = (hover: ModuleKey | null): void => {
  if (usePbUI.getState().hover !== hover) usePbUI.setState({ hover })
}

/** Select a module (null: nothing) — a selection replaces a lit net flag. */
export const selectModule = (selected: ModuleKey | null): void => usePbUI.setState({ selected, net: null })

/** Light a net flag pair (null: none) — it replaces a selected module. */
export const lightNet = (net: string | null): void => usePbUI.setState({ net, selected: null })

export const selectFuse = (fuse: string | null): void => usePbUI.setState({ fuse })

export const setFilter = (filter: FilterPreset | null | 'auto'): void => usePbUI.setState({ filter, unfolded: [] })

export function toggleFold(id: string): void {
  const cur = usePbUI.getState().unfolded
  usePbUI.setState({ unfolded: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
}

export function openFold(id: string): void {
  const cur = usePbUI.getState().unfolded
  if (!cur.includes(id)) usePbUI.setState({ unfolded: [...cur, id] })
}

/** The rack's roving stop moved (a stop took the keyboard). */
export const setCursor = (cursor: string | null): void => {
  if (usePbUI.getState().cursor !== cursor) usePbUI.setState({ cursor })
}

/** The keyboard is on a jack (null: left it). */
export const setJack = (jack: string | null): void => {
  if (usePbUI.getState().jack !== jack) usePbUI.setState({ jack })
}

const tightKeys = new Set<string>()

/** A module's name box is (or is no longer) under 12ch with every tier of its own spent. */
export function noteTight(key: string, on: boolean): void {
  if (tightKeys.has(key) === on) return
  if (on) tightKeys.add(key)
  else tightKeys.delete(key)
  usePbUI.setState({ tight: tightKeys.size })
}

/** Say something politely (the page's live region). */
export const announce = (text: string): void => usePbUI.setState((s) => ({ say: { text, n: s.say.n + 1 } }))

/**
 * The fuse the rack points at: the one the person selected while it is still on the rack (open or allowed), else the
 * first open fuse (the plate always shows one — B8's tab list keeps a tab selected). `open` in F-order.
 */
export function activeFuse(selected: string | null, all: readonly { key: string }[], open: readonly { key: string }[]): string | null {
  if (selected && all.some((f) => f.key === selected)) return selected
  return open[0]?.key ?? null
}

/** The page closed: hover, selection, lit flags, fuse, opened folds, the cursor go (the filter stays for this tab). */
export const resetPbUI = (): void => {
  tightKeys.clear()
  usePbUI.setState({ ...FRESH })
}
