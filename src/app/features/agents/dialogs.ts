/**
 * Custom agents — the agents' dialogs over any route (the Patchbay's setup lamps 04 / 05, §1.11): MirrorSetup and the
 * AgentEditor as one-shot requests in a tiny agents-owned store; AgentDialogsHost (mounted once in ModalHost) renders
 * them on whatever route is open, and closing gives focus back to `from` (the lamp's key).
 *
 * Boot code (features/index.ts re-exports the openers and the host): this file imports React and types only — the
 * dialogs themselves load with AgentDialogs.tsx, a lazy chunk the host fetches only while a request is open.
 *
 * The mirror drafts this tab holds: MirrorSetup's Create makes the database and its report page and hands over the
 * agent draft (mirror.ts MirrorMade). Over the Patchbay the setup closes then (lamp 04 green) and the draft waits here
 * until lamp 05 opens it in the editor (`openAgentEditor(draftId)`) — saved, discarded or undone, it goes. Per tab, in
 * memory only: a reload loses it (the tab asks before it closes while a kept draft's setup made pages), and lamp 05
 * then has MirrorSetup make it again ("Use …" → reuseMirror).
 */
import { useSyncExternalStore } from 'react'
import type { AgentRun } from './types'
import type { CustomAgent, ID } from '../../store/types'
import type { MirrorMade } from './mirror'

/** How a dialog ended: the setup made a database (its draft kept here), the editor saved an agent, or it closed. */
export type AgentDialogOutcome = { kind: 'created'; dbId: ID; draftId: ID } | { kind: 'saved'; agentId: ID } | { kind: 'closed' }

export interface MirrorSetupRequest {
  /** the integration profile whose recipe sets the mirror up */
  profileId: string
  /** the recipe (none: the profile's first) */
  recipeId?: string
  /** the database's name the setup opens with (the Patchbay's lamp 04 names a renamed one in the trash: Restore · Open) */
  name?: string
  /** where focus goes back to when the dialog closes (default: what has focus now) */
  from?: HTMLElement | null
  /** after the dialog closed and gave focus back (the Patchbay moves it on to the next lamp's key) */
  after?: (outcome: AgentDialogOutcome) => void
}

export interface AgentEditorRequest {
  /** where focus goes back to when the dialog closes (default: what has focus now) */
  from?: HTMLElement | null
  /** open scrolled to this section (as AgentEditor's own `section`) */
  section?: '06'
  /** after the dialog closed and gave focus back (the Patchbay moves it on to the next lamp's key) */
  after?: (outcome: AgentDialogOutcome) => void
}

/** The dialog open now (one at a time; `seq` tells a new request from the one before). */
export type AgentDialogRequest =
  | { kind: 'agentReport'; run: AgentRun; req: AgentEditorRequest & {pageId?: ID}; seq: number }
  | { kind: 'agentRun'; req: { agentId?: ID; pageId?: ID; from?: HTMLElement | null; after?: (outcome: AgentDialogOutcome) => void }; seq: number }
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

/** The AgentEditor as a dialog over the current route — a saved agent or a kept mirror draft by id, or a draft. */
export function openAgentEditor(agent: ID | CustomAgent, req: AgentEditorRequest = {}): void {
  put({ kind: 'agentEditor', agent, req, seq: ++seq })
}

/* ------------------------------------------------------------------ the mirror drafts this tab holds */

/** A draft MirrorSetup made over the Patchbay, waiting for the editor (lamp 05). */
export interface KeptDraft {
  made: MirrorMade
  profileId: string
  recipeId: string
}

const kept = new Map<ID, KeptDraft>()
let keptRev = 0
const keptListeners = new Set<() => void>()

function keptChanged(): void {
  keptRev++
  guardUnload()
  for (const fn of keptListeners) fn()
}

/**
 * A kept draft whose setup made pages lives only in this tab's memory (fix ui-words): closing or reloading the tab
 * asks first, as the editor does while it holds one.
 */
const warn = (e: BeforeUnloadEvent) => {
  e.preventDefault()
  e.returnValue = ''
}
let warning = false
function guardUnload(): void {
  if (typeof window === 'undefined') return
  const need = [...kept.values()].some((k) => k.made.created.length > 0)
  if (need === warning) return
  warning = need
  if (need) window.addEventListener('beforeunload', warn)
  else window.removeEventListener('beforeunload', warn)
}

/** Keep the draft a setup made (by its draft id; one per profile recipe — a newer one replaces it). */
export function keepMirrorDraft(made: MirrorMade, profileId: string, recipeId: string): void {
  for (const [id, k] of kept) if (k.profileId === profileId && k.recipeId === recipeId) kept.delete(id)
  kept.set(made.draft.id, { made, profileId, recipeId })
  keptChanged()
}

/** The kept draft of this id (null: none). */
export const keptDraft = (draftId: ID): KeptDraft | null => kept.get(draftId) ?? null

/** The kept draft of a profile's recipe (null: none). */
export function keptDraftFor(profileId: string, recipeId: string): KeptDraft | null {
  for (const k of kept.values()) if (k.profileId === profileId && k.recipeId === recipeId) return k
  return null
}

/** The draft is saved, discarded or undone: it goes. */
export function dropMirrorDraft(draftId: ID): void {
  if (kept.delete(draftId)) keptChanged()
}

const subscribeKept = (fn: () => void) => {
  keptListeners.add(fn)
  return () => keptListeners.delete(fn)
}
const keptNow = () => keptRev

/** Re-renders when the kept drafts change (the setup lamps read them). */
export const useKeptDrafts = (): number => useSyncExternalStore(subscribeKept, keptNow, keptNow)

/** Every change of the kept drafts (the setup's facts listen outside React too). */
export const onKeptDrafts = (fn: () => void): (() => void) => subscribeKept(fn)

/** Select an agent and one-time assignment without leaving the current page. */
export function openAgentRun(req: { agentId?: ID; pageId?: ID; from?: HTMLElement | null } = {}): void {
  put({ kind: 'agentRun', req, seq: ++seq })
}

export function openAgentReport(run: AgentRun, req: AgentEditorRequest & {pageId?: ID} = {}): void { put({ kind: 'agentReport', run, req, seq: ++seq }) }
