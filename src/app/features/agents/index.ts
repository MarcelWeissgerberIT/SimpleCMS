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
/** The Regler's holds (#/regler): an agent's not-started record of a day, a run held at the line */
export { heldId, isHeld } from './held'
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
/**
 * The Patchbay's reads (features/patchbay — §1.2, §2.3; every export below exists for it, the rules are this area's own):
 *  - tool names: isReadTool(name) · isWriteNamed(name) (a write word: never read as a read) · toolWords(name) ·
 *    testedTools(name, local, remote?) (a server's tools as this browser knows them; null = never tested)
 *  - scope: scopeFilter(agent) (null = everything outside templates) · scopeText(agent)
 *  - routeBlock(agent) / RUNNABLE_PROVIDERS: an agent this build cannot run · awaitsConfirm(agent): a browser agent
 *    another member changed waits for its creator · runsHere(agent): this browser runs it
 *  - integration profiles on this device: integrationStatuses() / useIntegrationStatuses() · deviceServers() ·
 *    openIntegrations(profileId?) (Workspace › Integrations; the profile focused from B11 on)
 *  - mirrors: mirrorAgentOf(agents, dbId, servers, owner?) · sameNamedDb(…) · mirrorTitles(…) — browser only (mirror.ts
 *    loads the store, the cloud and CSS): the Patchbay's setup reads them into RecipeFacts (patchbay/types.ts)
 *  - the editor's save checks live in features/agents/saveChecks.ts — import THAT file directly (dependency-free and
 *    Node-loadable, like patchbay/hint.ts and preflight/registry.ts; kept out of this index so it stays off the boot
 *    path): agentSaveIssues(draft, facts) → { field: [{ key, vars, titles? }] } (message refs, never text) ·
 *    savePagesOf(pages, draft) · agentSaveText(t, issue) / agentSaveTexts(t, issues) (an issue with `titles` reads only
 *    through them) — the trash / gone rules of gone.ts; lostPages, lostText, runBlock below
 *  - dialogs over any route (B11 fills them): openMirrorSetup({ profileId, recipeId?, from? }) ·
 *    openAgentEditor(idOrDraft, { from?, section? }) · AgentDialogsHost (mounted once in ModalHost, B11) — a lazy
 *    wrapper that must stay one (AgentDialogsHost.tsx imports no dialog: they load with AgentDialogs.tsx)
 *  - profiles: resolveRecipe(…) · validateProfileText(…) — browser only (store, i18n, CSS): the setup's pure parts
 *    take what they make as data (patchbay types RecipeFacts)
 *  - the team server's agents: loadRuntime() (GET agent-runtime → useServerAgents.state / runtime: 'forbidden' for a
 *    viewer) · loadServerRuns(agentId) (→ useServerAgents.runs[agentId]) — the Patchbay reads them on open
 *  - mirrors this device's setups made: rememberedReports(dbId) (report page ids, newest first; not checked against
 *    the pages)
 */
export { isReadTool, isWriteNamed, toolWords, testedTools } from './mcpTools'
export { scopeFilter, scopeText } from './scope'
export { routeBlock, RUNNABLE_PROVIDERS } from './routeBlock'
export { awaitsConfirm } from './confirm'
export { runsHere } from './runner'
export { integrationStatuses, useIntegrationStatuses, deviceServers, type IntegrationState } from './integrations/status'
export { openIntegrations } from './integrations/open'
export { mirrorAgentOf, sameNamedDb, mirrorTitles, type SameNamed, type MirrorTitles } from './mirror'
export { lostPages, lostText, runBlock, type LostPage, type LostRole } from './gone'
export { openMirrorSetup, openAgentEditor, type MirrorSetupRequest, type AgentEditorRequest } from './dialogs'
export { AgentDialogsHost } from './AgentDialogsHost'
/** profiles for the setup lamps / the profile drop (B11 / B12): resolveRecipe(profile, recipe, lang) (what a recipe makes) · validateProfileText(text, t, lang) */
export { resolveRecipe, type ResolvedRecipe } from './integrations/recipe'
export { validateProfileText, type Validation as ProfileValidation } from './integrations/validate'
export { loadRuntime, loadServerRuns } from './server'
export { rememberedReports } from './mirrorMemory'
