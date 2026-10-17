/**
 * Work orders — what the picked MCP server offers the planner, read from this device's settings (spec §1.1 / §2.4): the
 * one place the planner (planner.ts serverPart) and the work orders' settings (OrderSettings.tsx: "liest" · "nicht dabei")
 * read it from. READ tools only — the matching integration profiles' declared reads (confirmed by name), else the tested
 * tools whose names read as reads; OUT tools never; every other tested tool left out with its reason. A server never
 * tested on this device has no tool list: all of it is 'untested'.
 */
import { useWorkspace } from '../../../store/store'
import { matchMiss } from '../../../store/integrations'
import type { McpServerConfig } from '../../../store/types'
import { outToolsFor, readServers } from '../../ai/mcp-servers/config'
// a dependency-free leaf of the agents area (the Patchbay reads it the same way): the tool-name rules
import { declaredReadOk, isReadTool } from '../../agents/mcpTools'
import { pickedTools } from './tools'
import type { OrderToolLeft } from './types'

export interface ServerReads {
  reads: string[]
  left: Array<{ tool: string; why: OrderToolLeft }>
}

/** The integration profiles that match this server (by name, address or tools) and declare read tools. */
function matchingProfiles(server: McpServerConfig) {
  const profiles = useWorkspace.getState().integrations ?? []
  return profiles.filter((p) => p.reads?.length && p.match && (p.match.name || p.match.host || p.match.tools?.length) && !matchMiss(p.match, { name: server.name, url: server.url, enabled: true, tools: server.tools }))
}

/** The server's READ tools for the planner, and the tools left out with their reasons. */
export function serverReads(server: McpServerConfig): ServerReads {
  const declared = matchingProfiles(server).flatMap((p) => p.reads ?? [])
  return pickedTools(server.tools ?? [], outToolsFor(server), declared.length ? declared : null, { isRead: isReadTool, declaredOk: declaredReadOk })
}

/** The id of the first integration profile that matches this server (the settings' key to it), null: none. */
export const profileOf = (server: McpServerConfig): string | null => matchingProfiles(server)[0]?.id ?? null

/** One server as the work orders' settings list it. */
export interface ServerRow {
  id: string
  name: string
  tested: boolean
  reads: string[]
  left: Array<{ tool: string; why: OrderToolLeft }>
  profile: string | null
}

/**
 * This device's enabled MCP servers, by the names the person gave them (none preselected — the caller marks the pick):
 * tested or not, the read tools, the tools left out with their reasons.
 */
export function serverRows(): ServerRow[] {
  return readServers()
    .filter((s) => s.enabled)
    .map((s) => {
      const tested = !!s.tools?.length
      const { reads, left } = tested ? serverReads(s) : { reads: [], left: [] }
      return { id: s.id, name: s.name, tested, reads, left, profile: profileOf(s) }
    })
}
