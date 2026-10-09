/**
 * Custom agents — the toasts a mirror setup leaves (AgentsView: "the agent was not saved …" after a route change, and
 * "… is in the trash" with its Undo). Their Undo keys sit where the next dialog's footer goes: a click meant for that
 * dialog ("Create agent") must never land on a stale Undo and trash or bring back what the new setup stands on. So
 * every agent dialog (the recipe gallery, the mirror setup, any agent editor) dismisses them all as it opens
 * (useDismissMirrorToasts).
 */
import { useLayoutEffect } from 'react'
import { useUI, type Toast } from '../../store/ui'
import type { ID } from '../../store/types'

/** The ids of the mirror toasts that may still be out. */
const out = new Set<ID>()

/** Show a mirror toast (kept track of, so the next agent dialog can take it down). */
export function mirrorToast(t: Omit<Toast, 'id'>): ID {
  const ui = useUI.getState()
  // forget the ones that are gone already (timed out, dismissed, their key pressed)
  for (const id of out) if (!ui.toasts.some((x) => x.id === id)) out.delete(id)
  const id = ui.toast(t)
  out.add(id)
  return id
}

/** Take down every mirror toast still out. */
export function dismissMirrorToasts(): void {
  const ui = useUI.getState()
  for (const id of out) ui.dismissToast(id)
  out.clear()
}

/** An agent dialog opening: before its first paint, no mirror toast stays over it. */
export function useDismissMirrorToasts(): void {
  useLayoutEffect(() => dismissMirrorToasts(), [])
}
