/**
 * Which column of the stage the user is working in. Stage publishes it; the topbar, the
 * status bar and the palette act on that column's page, so their actions never target a
 * page other than the one you are reading or typing in.
 */
import { create } from 'zustand'
import type { ID } from '../../store/types'

interface StageView {
  /** Main column folded into a spine (panes took the room). */
  mainFolded: boolean
  /** Columns on the stage (main + panes). */
  columns: number
  /** Page of the active pane, or null while the main column is active. */
  activePaneId: ID | null
  /** Index of the active pane in useUI.panes, -1 for the main column. */
  activePaneIndex: number
  /** Bumped to ask the stage to bring the main column back into view. */
  revealTick: number
  publish: (v: { mainFolded: boolean; columns: number; activePaneId: ID | null; activePaneIndex: number }) => void
}

export const useStageView = create<StageView>()((set, get) => ({
  mainFolded: false,
  columns: 1,
  activePaneId: null,
  activePaneIndex: -1,
  revealTick: 0,
  publish: (v) => {
    const s = get()
    if (s.mainFolded === v.mainFolded && s.columns === v.columns && s.activePaneId === v.activePaneId && s.activePaneIndex === v.activePaneIndex) return
    set(v)
  },
}))

/** Unfold the main column and make it the active one (e.g. its page was picked again). */
export function revealMain() {
  useStageView.setState((s) => ({ revealTick: s.revealTick + 1 }))
}
