/**
 * EXTERNAL MCP SERVERS for One's own Claude — public API for other areas (features/ai/mcp-servers; the settings UI and
 * the request path import the modules directly). This device's list (`settings.mcpServers`), never a token.
 *  - readServers(settings?): the list, sanitized · patchServer(id, patch): THE write of one server's fields
 *  - outToolsFor(server, profiles?): the tools integration profiles lock OUT on it (store/integrations.ts outToolsOf)
 *  - refusedHere(server) / onRefusedChanged(fn): a token an API error refused in this tab
 *  - tokenState(server): 'none' | 'ok' | 'missing' — is a sealed token there (opens nothing)
 *  - useMcpChecks: connection tests running now (`running[id]`) · overviewRows(…): Settings › AI's MCP table (pure)
 */
export { readServers, patchServer, outToolsFor, refusedHere, onRefusedChanged, tokenState } from './config'
export { useMcpChecks, type CheckMode } from './checks'
export { overviewRows, type OverviewRow } from './overview'
