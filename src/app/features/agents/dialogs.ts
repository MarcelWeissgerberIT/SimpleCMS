/**
 * Custom agents — the agents' dialogs over any route (the Patchbay's setup lamps 04 / 05, §1.11): MirrorSetup and the
 * AgentEditor as one-shot requests in a tiny agents-owned store; AgentDialogsHost (mounted once in ModalHost) renders
 * them on whatever route is open, and closing gives focus back to `from`.
 *
 * B1 (Patchbay seams): the typed openers only — they do nothing yet. B11 fills them (the request store, the host,
 * MirrorSetup / AgentEditor as dialogs, focus back to the opener).
 */
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

/** MirrorSetup as a dialog over the current route (B11 fills it; until then nothing opens). */
export function openMirrorSetup(req: MirrorSetupRequest): void {}

/** The AgentEditor as a dialog over the current route — a saved agent by id, or a draft (B11 fills it). */
export function openAgentEditor(agent: ID | CustomAgent, req: AgentEditorRequest = {}): void {}
