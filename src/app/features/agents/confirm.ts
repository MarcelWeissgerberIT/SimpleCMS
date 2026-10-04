/**
 * Custom agents — who decides what a browser agent does. In a team workspace a browser agent runs in
 * its creator's browser: with the creator's Claude key, MCP servers and (when its scope names them) the
 * creator's private pages — while every member may edit it. So it runs only while the last saved
 * version is its creator's (`updatedBy` = `createdBy`; absent on older data = the creator). After
 * someone else's change it waits until the creator confirms it (re-saves it as theirs, having seen
 * the current settings). Server agents (the workspace's runtime key) and local workspaces: unaffected.
 */
import { useWorkspace } from '../../store/store'
import { sameAgent, setAgentEditor } from '../../store/agents'
import type { CustomAgent } from '../../store/types'
import { useCloud } from '../../cloud'

/** A save in a team workspace whose account is not known yet still counts as someone else's. */
const UNKNOWN_EDITOR = '@unknown'

/** The account saving agents in this tab: the signed-in member (team) / null (local). */
function currentEditor(): string | null {
  const c = useCloud.getState()
  if (c.active.kind !== 'cloud') return null
  return c.user?.id ?? UNKNOWN_EDITOR
}
// upsertAgent stamps it as `updatedBy` (the store knows no accounts)
setAgentEditor(currentEditor)

/** A browser agent whose last save was not its creator's (older data without `updatedBy`: the creator's). */
const changedByOther = (agent: CustomAgent) => agent.runner === 'browser' && !!agent.updatedBy && agent.updatedBy !== agent.createdBy

/** A team browser agent whose last change was not its creator's: it does not run until they confirm. */
export function awaitsConfirm(agent: CustomAgent): boolean {
  return useCloud.getState().active.kind === 'cloud' && changedByOther(agent)
}

/**
 * The creator confirms the settings they see (`agent`): saved again as theirs, it runs again. A newer
 * change that arrived meanwhile is not confirmed unseen (false: nothing happened).
 */
export function confirmAgent(agent: CustomAgent): boolean {
  const c = useCloud.getState()
  if (!c.user || c.readOnly || agent.createdBy !== c.user.id) return false
  const cur = useWorkspace.getState().agents?.[agent.id]
  if (!cur || cur.updatedAt !== agent.updatedAt || !sameAgent(cur, agent)) return false
  useWorkspace.getState().upsertAgent(cur)
  return true
}

export interface ConfirmState {
  /** changed by someone else: waits for its creator */
  waiting: boolean
  /** the viewer is the creator (and may write): they see the Confirm key */
  mine: boolean
  /** the creator's account id, who changed it last */
  creator: string | null
  editor: string | null
}

/** The confirmation state of an agent for the viewer (re-renders on sign-in / workspace changes). */
export function useConfirmState(agent: CustomAgent | undefined): ConfirmState {
  const team = useCloud((s) => s.active.kind === 'cloud')
  const me = useCloud((s) => s.user?.id ?? null)
  const readOnly = useCloud((s) => s.readOnly)
  if (!agent || !team) return { waiting: false, mine: false, creator: null, editor: null }
  return { waiting: changedByOther(agent), mine: !!me && agent.createdBy === me && !readOnly, creator: agent.createdBy ?? null, editor: agent.updatedBy ?? null }
}
