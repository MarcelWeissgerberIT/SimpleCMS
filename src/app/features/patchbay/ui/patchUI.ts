/**
 * The patching UI's own state (P4, B16) — per tab, in memory: the drag in flight (its source jack, the jacks it lights,
 * the pointer, what is under it and the "+F2" a drop there would open), the "Connect to …" picker open on a jack, and the
 * popover at the target jack (an ask before the write, or why it did not connect). The page clears it when it closes.
 */
import { create } from 'zustand'
import type { Pt } from '../render'
import type { PatchNames, PlanOk } from '../patching'
import type { ModuleKey, MsgRef, OpenTarget, Patch } from '../types'

export interface DragState {
  /** the source jack's key and side */
  source: string
  side: 'in' | 'out'
  /** the source jack's centre and the pointer, in bench coordinates */
  a: Pt
  at: Pt
  /** the jacks a drop may plug into (`<module>.<role>`) and the modules taking it (their jack not drawn yet) */
  accept: { jacks: Set<string>; modules: Set<ModuleKey> }
  /** under the pointer: a jack, else a module */
  over: { jack: string | null; module: ModuleKey | null } | null
  /** the fuse a drop there would open ("+F2"; '' none; null: not known yet) */
  opens: string | null
}

export interface PickState {
  /** the jack the picker is open on */
  jack: string
  anchor: HTMLElement
  /** Delete on a jack with several cables: only its cables to unplug */
  only?: 'unplug'
}

export type PopState =
  | { kind: 'ask'; patch: Patch; plan: PlanOk; names: PatchNames; anchor: Element; source: string }
  | { kind: 'refused' | 'info'; patch: Patch; msg: MsgRef; open?: OpenTarget; anchor: Element; source: string }

interface PatchUI {
  drag: DragState | null
  pick: PickState | null
  pop: PopState | null
}

export const usePatchUI = create<PatchUI>(() => ({ drag: null, pick: null, pop: null }))

export const setDrag = (drag: DragState | null): void => usePatchUI.setState({ drag })
export const patchDrag = (part: Partial<DragState>): void => {
  const cur = usePatchUI.getState().drag
  if (cur) usePatchUI.setState({ drag: { ...cur, ...part } })
}
export const setPick = (pick: PickState | null): void => usePatchUI.setState({ pick })
export const setPop = (pop: PopState | null): void => usePatchUI.setState({ pop })

/** The page closed: nothing of a patch in flight stays. */
export const resetPatchUI = (): void => usePatchUI.setState({ drag: null, pick: null, pop: null })

/** A drag's look on one jack: the source, a jack it may plug into, one it may not (dimmed); null: no drag. */
export function useJackDrag(key: string): 'source' | 'accept' | 'no' | null {
  return usePatchUI((s) => (s.drag ? (s.drag.source === key ? 'source' : s.drag.accept.jacks.has(key) ? 'accept' : 'no') : null))
}

/** Is the pointer of a drag over this jack (or, its jack not drawn, this module)? */
export const useDragOver = (key: string, module = false): boolean =>
  usePatchUI((s) => !!s.drag?.over && (module ? !s.drag.over.jack && s.drag.over.module === key : s.drag.over.jack === key))

/** Does a drag light this module (a jack of it it may plug into is not drawn yet)? */
export const useModuleAccept = (key: ModuleKey): boolean => usePatchUI((s) => !!s.drag && s.drag.accept.modules.has(key))
