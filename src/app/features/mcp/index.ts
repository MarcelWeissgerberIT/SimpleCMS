/**
 * One MCP, local bridge (features/mcp) — re-exported by features/index.ts.
 *  - startMcp(): background service (main.tsx, after the workspace loaded); idle until switched on
 *  - McpTab: Settings → Agents · MCP · McpStatusCell: status bar "AGENT" LED
 *  - openMcpSettings() / consumeMcpSettingsRequest(): open Settings on the Agents · MCP tab
 *  - McpConnectionsRoute (#/mcp, a lazy chunk) · openMcpConnections(): MCP · Connections — One's Claude's servers, the
 *    bridge, the coding worker and the team server on one page (connections/; reads only what the tab knows)
 *  - contract.ts: tool names + schemas + the bridge ⇄ tab protocol (also bundled into mcp/)
 */
export { startMcp } from './service'
/** The flight recorder's eject: mcpBusy(session) · settleMcpCall / unsettleMcpCall(session, call, ejectId) — the call's activity 'undone', its Undo gone */
export { mcpBusy, settleMcpCall, unsettleMcpCall } from './service'
export { McpTab } from './McpTab'
export { McpStatusCell, openMcpSettings, consumeMcpSettingsRequest } from './McpStatus'
export { useMcp } from './state'
export { McpConnectionsRoute } from './connections/route'
export { openMcpConnections, type McpConnectionsOptions } from './connections/open'
/**
 * The Patchbay's reads (features/patchbay — §1.3 the bridge as a decider, §1.11 setup lamps 01 / 02; pure rules of MCP ·
 * Connections): serverState(server, now, refused) · ledOf(state) · needsYou(servers, now, refused) ·
 * missingNamed(agents, servers) — and this browser's bridge: useMcpSettings() / mcpSettings() ({ enabled, mode }),
 * setMcpMode(mode) (the bridge's own setter: 'ask' · 'apply' · 'read', this browser only)
 */
export { serverState, ledOf, needsYou, missingNamed, type ServerState, type Level as ConnectionLevel } from './connections/model'
export { setMcpMode } from './service'
export { useMcpSettings, mcpSettings, type BridgeSettings } from './state'
export type { McpAgentMode } from './contract'
