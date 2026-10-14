/**
 * The bridge's state in words and as an LED — Settings → Agents · MCP (§ A) and MCP · Connections (#/mcp) say the same.
 */
import type { useT } from '../../i18n'
import type { McpConn } from './state'

type T = ReturnType<typeof useT>

export function bridgeStateText(t: T, conn: McpConn, client: string | null, calls: number, bridge: string | null): string {
  switch (conn) {
    case 'off':
      return t('features.mcp.state.off')
    case 'connecting':
      return t('features.mcp.state.connecting')
    case 'waiting':
      return t('features.mcp.state.waiting')
    case 'connected':
      return t(calls === 1 ? 'features.mcp.state.connected.one' : 'features.mcp.state.connected.other', { client: client ?? t('features.mcp.bridge', { v: bridge ?? '' }).trim(), n: calls })
    case 'replaced':
      return t('features.mcp.state.replaced')
    case 'blocked':
      return t('features.mcp.state.blocked')
  }
}

/** connected → ok · connecting / waiting → on (pending) · anything else → off. */
export function bridgeLed(conn: McpConn): 'ok' | 'on' | 'off' {
  return conn === 'connected' ? 'ok' : conn === 'connecting' || conn === 'waiting' ? 'on' : 'off'
}
