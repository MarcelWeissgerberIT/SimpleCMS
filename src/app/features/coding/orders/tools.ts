/**
 * Work orders — the picked MCP server's part in a plan (spec §2.4), pure (a Node spec reads it):
 *  - `serverPick`: whether the server the person picked in the work orders' settings takes part, and why not — missing
 *    here, switched off, never tested on this device (no tool list: "Server testen"), its token refused in this tab, a
 *    data rule that withholds MCP from the route, a route that is not Anthropic's (the neutral wire connects no server).
 *    Without a pick: nothing (`mcp: false`).
 *  - `pickedTools`: its READ tools only — the tools the matching integration profiles declare as reads (a declaration
 *    confirms only a name that reads as a read and carries no send word: declaredReadOk), else the tested tools whose
 *    names read as reads (isReadTool); OUT tools (a profile's send routes) never. Every other tested tool is listed as
 *    left out with its reason ('out' · 'notRead').
 * The name classifiers come from the agents area (agents/mcpTools.ts, passed in): this module stays free of imports.
 */
import type { OrderServerSkip, OrderToolLeft } from './types'

/** Why the picked server does not take part (null: it does) — 'noReads' / 'token' are decided later (planner.ts). */
export type ServerSkip = Exclude<OrderServerSkip, 'noReads' | 'token'>

export interface PickFacts {
  /** the server as this device has it (null: no server of that name here) */
  server: { name: string; enabled: boolean; tools: readonly string[] | null; refused: boolean } | null
  /** the route the planner's request takes may receive MCP (a data rule) */
  mayMcp: boolean
  /** the route is Anthropic's (only it connects MCP servers) */
  anthropic: boolean
}

/** Does the picked server take part? (null: yes — see the head of this file). */
export function serverSkip(f: PickFacts): ServerSkip | null {
  if (!f.server) return 'missing'
  if (!f.server.enabled) return 'off'
  if (!f.server.tools?.length) return 'untested'
  if (f.server.refused) return 'refused'
  if (!f.anthropic) return 'route'
  if (!f.mayMcp) return 'rule'
  return null
}

export interface ToolClassifiers {
  /** the name reads as a read (agents isReadTool) */
  isRead: (name: string) => boolean
  /** a profile's declaration may confirm the name as a read (agents declaredReadOk) */
  declaredOk: (name: string) => boolean
}

/**
 * The tools the planner may call on the picked server, and the rest of its tested tools with the reason they are left
 * out. `tested`: its tools from the last connection test; `out`: its OUT tools; `declared`: the `reads` of every matching
 * profile (none: the name heuristic decides).
 */
export function pickedTools(tested: readonly string[], out: readonly string[], declared: readonly string[] | null, c: ToolClassifiers): { reads: string[]; left: Array<{ tool: string; why: OrderToolLeft }> } {
  const outSet = new Set(out)
  const declaredSet = declared?.length ? new Set(declared) : null
  const reads: string[] = []
  const left: Array<{ tool: string; why: OrderToolLeft }> = []
  for (const tool of new Set(tested)) {
    if (outSet.has(tool)) left.push({ tool, why: 'out' })
    else if (declaredSet ? declaredSet.has(tool) && c.declaredOk(tool) : c.isRead(tool)) reads.push(tool)
    else left.push({ tool, why: 'notRead' })
  }
  return { reads, left }
}
