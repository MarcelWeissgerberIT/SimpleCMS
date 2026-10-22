/** Ephemeral handoff: no credential files or environment. Claude gets only the run's proxy tools. */
import { validConnection, type PersonalConnection } from '../../../src/shared/personalVault.ts'
import { LocalMcp } from './local-mcp.ts'
export function personalConnections(raw: unknown): PersonalConnection[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 8 || !raw.every(validConnection) || new Set(raw.map(e => e.name)).size !== raw.length) return null
  // Reconstruct, never accept arbitrary transport settings, headers, launchers or environment.
  return raw.map(e => ({ id: e.id, name: e.name, url: e.url, token: e.token, tools: [...new Set(e.tools)] }))
}
export class PersonalMcp {
  readonly client: LocalMcp
  private connections: PersonalConnection[]
  constructor(connections: PersonalConnection[], readOnly: boolean) { this.connections = connections;this.client = new LocalMcp(readOnly) }
  async connect(signal: AbortSignal): Promise<void> {
    const config = Object.fromEntries(this.connections.map(e => [e.name, { type: 'http', url: e.url, headers: { Authorization: 'Bearer ' + e.token }, oneAllowedTools: e.tools }]))
    await this.client.connect(this.connections.map(e => e.name), {}, signal, undefined, config)
    const failed = this.connections.filter(e => !this.client.probe(e.name, []).connected)
    if (failed.length) throw new Error('A selected personal MCP connection is unavailable. Check its URL, token and permissions in My secrets.')
  }
  async close() { await this.client.close();this.connections = [] }
}
