/**
 * The page's own state (plan §3.3, §3.9) — per tab, in memory, never stored: which module the pointer is over, which
 * module is selected (its chains lit, the rest dimmed), the fuse selected (the readout's FUSE cell, `?f=`, the plate's
 * tabs — B8), the filter the person picked and the folds opened. B7 (cables, keyboard) and B8 (plate, strands) read and
 * write it too. The page resets it when it closes (the filter stays for the tab: coming back shows what was asked for).
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
  /** the selected fuse's path key */
  fuse: string | null
  /** 'auto' = the page's default (defaultPreset: "Fuse paths only" past 30 modules with an open fuse) */
  filter: FilterPreset | null | 'auto'
  /** fold ids the person opened */
  unfolded: string[]
}

const FRESH: Omit<PbUI, 'filter'> = { hover: null, selected: null, net: null, fuse: null, unfolded: [] }

export const usePbUI = create<PbUI>(() => ({ ...FRESH, filter: 'auto' }))

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

/** The page closed: hover, selection, lit flags, fuse and opened folds go (the filter stays for this tab). */
export const resetPbUI = (): void => usePbUI.setState({ ...FRESH })
