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
