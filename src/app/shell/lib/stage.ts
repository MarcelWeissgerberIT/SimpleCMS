/**
 * Which column of the stage the user is looking at. Stage publishes it; the topbar and
 * status bar follow it while the main page is folded into a spine, so their actions
 * never target a page that is out of view.
 */
import { create } from 'zustand'
import type { ID } from '../../store/types'

interface StageView {
  /** Main column folded into a spine (panes took the room). */
  mainFolded: boolean
  /** Page of the focused pane while the main column is folded. */
  focusPaneId: ID | null
  focusPaneIndex: number
  /** Bumped to ask the stage to bring the main column back into view. */
  revealTick: number
  publish: (v: { mainFolded: boolean; focusPaneId: ID | null; focusPaneIndex: number }) => void
}

export const useStageView = create<StageView>()((set, get) => ({
  mainFolded: false,
  focusPaneId: null,
  focusPaneIndex: -1,
  revealTick: 0,
  publish: (v) => {
    const s = get()
    if (s.mainFolded === v.mainFolded && s.focusPaneId === v.focusPaneId && s.focusPaneIndex === v.focusPaneIndex) return
    set(v)
  },
}))

/** Unfold the main column (e.g. its page was picked again in the sidebar). */
export function revealMain() {
  useStageView.setState((s) => ({ revealTick: s.revealTick + 1 }))
}
