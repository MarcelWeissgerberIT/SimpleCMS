/**
 * The Token lamp's rule for one MCP server of this device (pure, types only): red when its token was refused (at the
 * last test, or in this tab) or its sign-in ran out without a way to renew; amber when the last test failed for
 * another reason; null otherwise. The Preflight Token lamp (preflight/sources/token.ts) and #/mcp (MCP · Connections,
 * features/mcp/connections) both read it — their red / amber rows are always the same servers.
 */
import type { McpServerConfig } from '../../../store/types'

export type TokenTrouble = { level: 'red'; why: 'refusedTest' | 'refusedTab' | 'expired' } | { level: 'amber'; why: 'failed' } | null

/** One ENABLED server (the caller leaves switched-off ones out). `refused` = refusedHere(s) — refused in this tab. */
export function tokenTrouble(s: Pick<McpServerConfig, 'checkAuth' | 'checkError' | 'oauth'>, now: number, refused: boolean): TokenTrouble {
  if (s.checkAuth === true) return { level: 'red', why: 'refusedTest' }
  if (refused) return { level: 'red', why: 'refusedTab' }
  if (s.oauth?.expiresAt && s.oauth.expiresAt < now && !s.oauth.refresh) return { level: 'red', why: 'expired' }
  if (s.checkError) return { level: 'amber', why: 'failed' }
  return null
}
