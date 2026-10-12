/**
 * One MCP, local bridge (features/mcp) — re-exported by features/index.ts.
 *  - startMcp(): background service (main.tsx, after the workspace loaded); idle until switched on
 *  - McpTab: Settings → Agents · MCP · McpStatusCell: status bar "AGENT" LED
 *  - openMcpSettings() / consumeMcpSettingsRequest(): open Settings on the Agents · MCP tab
 *  - contract.ts: tool names + schemas + the bridge ⇄ tab protocol (also bundled into mcp/)
 */
export { startMcp } from './service'
/** The flight recorder's eject: mcpBusy(session) · settleMcpCall / unsettleMcpCall(session, call, ejectId) — the call's activity 'undone', its Undo gone */
export { mcpBusy, settleMcpCall, unsettleMcpCall } from './service'
export { McpTab } from './McpTab'
export { McpStatusCell, openMcpSettings, consumeMcpSettingsRequest } from './McpStatus'
export { useMcp } from './state'
