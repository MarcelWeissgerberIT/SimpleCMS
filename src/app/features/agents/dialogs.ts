/**
 * Custom agents — the agents' dialogs over any route (the Patchbay's setup lamps 04 / 05, §1.11): MirrorSetup and the
 * AgentEditor as one-shot requests in a tiny agents-owned store; AgentDialogsHost (mounted once in ModalHost) renders
 * them on whatever route is open, and closing gives focus back to `from`.
 *
 * Boot code (features/index.ts re-exports the openers and the host): this file imports React and types only — the
 * dialogs themselves load with AgentDialogs.tsx, a lazy chunk the host fetches only while a request is open.
 *
 * B1 (Patchbay seams): the request store and the typed openers; the dialogs (AgentDialogs.tsx), focus back to the opener
 * and the ModalHost mount are B11's.
 */
import { useSyncExternalStore } from 'react'
import type { CustomAgent, ID } from '../../store/types'

export interface MirrorSetupRequest {
  /** the integration profile whose recipe sets the mirror up */
  profileId: string
  /** the recipe (none: the profile's first) */
  recipeId?: string
  /** where focus goes back to when the dialog closes (default: what has focus now) */
  from?: HTMLElement | null
}

export interface AgentEditorRequest {
  /** where focus goes back to when the dialog closes (default: what has focus now) */
  from?: HTMLElement | null
  /** open scrolled to this section (as AgentEditor's own `section`) */
  section?: '06'
}

/** The dialog open now (one at a time; `seq` tells a new request from the one before). */
export type AgentDialogRequest =
  | { kind: 'mirrorSetup'; req: MirrorSetupRequest; seq: number }
  | { kind: 'agentEditor'; agent: ID | CustomAgent; req: AgentEditorRequest; seq: number }

let open: AgentDialogRequest | null = null
let seq = 0
const listeners = new Set<() => void>()

function put(next: AgentDialogRequest | null): void {
  open = next
  for (const fn of listeners) fn()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The request open now (null: none). */
export const agentDialog = (): AgentDialogRequest | null => open

/** The request open now, for React (the host renders the lazy dialogs only while one is open). */
export const useAgentDialog = (): AgentDialogRequest | null => useSyncExternalStore(subscribe, agentDialog, agentDialog)

/** The dialog closed (`seq`: only that request — a newer one stays open). */
export function closeAgentDialog(seqOf?: number): void {
  if (open && (seqOf === undefined || open.seq === seqOf)) put(null)
}

/** MirrorSetup as a dialog over the current route. */
export function openMirrorSetup(req: MirrorSetupRequest): void {
  put({ kind: 'mirrorSetup', req, seq: ++seq })
}

/** The AgentEditor as a dialog over the current route — a saved agent by id, or a draft. */
export function openAgentEditor(agent: ID | CustomAgent, req: AgentEditorRequest = {}): void {
  put({ kind: 'agentEditor', agent, req, seq: ++seq })
}
