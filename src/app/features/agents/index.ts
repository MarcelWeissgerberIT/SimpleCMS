/**
 * CUSTOM AGENTS — public API (re-exported by features/index.ts). Saved AI helpers for recurring work
 * (Workspace.agents, store/agents.ts), started by a schedule or a trigger, run in the browser (the
 * leader tab, runner.ts) or on the team server (server.ts). Runs: this device's IndexedDB "one-agents".
 *  - startAgents(): background service (main.tsx, once after hydrate) — leader election, schedules,
 *    row triggers, the local "Last edited by" keeper
 *  - AgentsRoute { agentId? }: the #/agents area (lazy) · AgentsNavBadge: proposals waiting for review
 *  - ServerAgentsSettings: Settings → Agents · MCP → "Server agents" (team workspaces; renders nothing elsewhere)
 *  - agentLabel(actor): "Agent · <name>" for an `agent:<id>` createdBy / updatedBy (null for other ids)
 *  - runAgentNow(agent): "Run now" — the agent page's run key (browser: this tab, toasts for busy / waiting for
 *    its creator / done; server agents: started on the team server) — database commands use it
 */
export { startAgents } from './runner'
export { AgentsRoute } from './AgentsRoute'
export { AgentsNavBadge, useAgentsAttention } from './NavBadge'
export { ServerAgentsSettings } from './ServerAgentsSettings'
export { agentLabel } from './label'
export { runNow as runAgentNow } from './actions'
/** An agent's editor opened at section 06 "Check" (Preflight's Vorprüfer lamps) */
export { openAgentCheck } from './try'
/** Read-outs for overviews (the workspace page's Automation section): a trigger in words · this device's runs of an agent */
export { triggerText as agentTriggerText, nextRunAt as agentNextRunAt } from './format'
export { loadRuns as loadAgentRuns, useAgentRuns } from './runs'
/**
 * The Preflight lamps (proposals, mirror stale, agent missed) — reads only:
 *  - onRunsChanged(fn): another tab wrote an agent's runs · primeSlots(ids) / cachedSlot(id): the schedule slots this
 *    device handled, read ahead so the lamps read them synchronously
 *  - staleMirrors(now) · missedAgents(now, me) · creatorConfirms(me) · healthFitted(me) · scheduledHere() (health.ts)
 *  - useServerAgents (read only) · loadOpenServerRuns() · startOpenServerPoll(): the staged runs of this member's own
 *    server agents (agent-runs/open, polled only while the tab is visible) → useServerAgents.open / openLatest
 */
export { onRunsChanged, primeSlots, cachedSlot } from './runs'
export { staleMirrors, missedAgents, creatorConfirms, healthFitted, scheduledHere, workingMsBetween, jevHealth, type HealthItem } from './health'
export { useServerAgents, loadOpenServerRuns, startOpenServerPoll, ownServerAgentIds, type ServerRunHead } from './server'
/**
 * Integration profiles (integrations/): useUnlocked(feature) / unlocked(feature) — is it unlocked on this device (an
 * active profile names it) · IntegrationsPanel — the body of Workspace → Integrations
 */
export { useUnlocked, unlocked } from './integrations/status'
export { IntegrationsPanel } from './integrations/IntegrationsPanel'
/**
 * mirrorSourceOf(dbId) → { agentId, servers } | null: the agent that mirrors into a database (its `mirrorOf` marker, or
 * an older one that reads a matching server; in a team the member's own) and the MCP servers it reads — the Outbox
 * offers a profile's send routes on the rows of that database.
 */
export { mirrorSourceOf } from './mirror'
/** recipeRoleNames(profile) → role → its property names in both languages (the profile's first recipe, else the built-in mirror) */
export { recipeRoleNames } from './integrations/recipe'
/** recipeOptionNames(profile) → property name → the option names the profile declares (both languages, lower case) */
export { recipeOptionNames } from './integrations/recipe'
/**
 * Preflight's proposals queue (P2) — the review entry points, with their own safety rules (review.ts: the run lock, the
 * stored run read again, open proposals only, a patch of what changed):
 *  - applyRun(run, ids?, { row, judged, whole }) → ApplyResult | null · discardRun(run, ids | null, { undo, row, reason,
 *    judged, whole }) → { dropped, undo, refused? } ·
 *    undoChange(run, changeId) → kept | null · undoChangeEach(run, changeId) → { changeId: 'undone' | 'kept' | 'final' } | null
 *  - AgentChangeBody { run, change, bare? }: the run history's own body of a proposal, loaded with the agents page's code
 *    on first use (AGENT_BODY_KINDS: the kinds it shows; `bare`: the caller's Suspense waits for it)
 *  - setSupersedeGuard(fn): which proposals were opened as cards (never replaced; null = not known yet → no pass) ·
 *    catchUpSupersede(): the leader looks again (call it once that is known) · setProposalsShown(fn): while it says
 *    true, an agent's "has N proposals" toast stays away
 */
export { applyRun, discardRun, undoChange, undoChangeEach, type Discarded } from './review'
/**
 * Per-field trust (trust/): the ONE discard-reason key map of the run review and Preflight — reasonKeys(lang) (1 = wrong
 * + F de / W en, 2 not now, 3 duplicate, 4 handled already), wrongLetter(lang) · useTrust: this device's verdict books
 * (read only; written only by the review entry points above, given `judged` / `reason`)
 */
export { reasonKeys, reasonOfKey, wrongLetter, REASONS } from './trust/reasons'
export { useTrust } from './trust/book'
export type { DiscardReason } from '../ai/agent/types'
export type { TrustBook, Verdict } from './trust/types'
/**
 * The flight recorder's eject (features/recorder, imported lazily) — call settle / unsettle ONLY inside withRunLock(agentId):
 *  - ejectBusy(run): the agent runs (any tab), the run is running or a change applies → no eject now
 *  - settleEjected(cur, o) → { run, discarded, slips, state } · unsettleEjected(cur, ejectId, back, pending, state)
 *  - forgetUndos(runId, ids) · forgetRunUndo(runId): the Undo closures of ejected changes go
 *  - withRunLock(agentId, fn): the agent's run lock (one review at a time, across this browser's tabs)
 */
export { ejectBusy, settleEjected, unsettleEjected, forgetUndos, type EjectState } from './review'
export { forgetRunUndo } from './undos'
export { withRunLock } from './runs'
export { AgentChangeBody, AGENT_BODY_KINDS } from './body'
export { setSupersedeGuard, supersedeGuard, type SupersedeGuard } from './supersede'
export { catchUpSupersede } from './runner'
export { setProposalsShown } from './hold'
