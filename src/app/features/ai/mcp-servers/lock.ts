/**
 * The OUT lock (pure): a send tool of an integration profile (`sends[].tool`, store/integrations.ts outToolsOf) is
 * switched off in every toolset One builds — an allow-list loses it, a server without one gets it disabled by name.
 * `forced`, codewords, a picked tool or an allow-list never lift it; only the Outbox calls such a tool, outside any
 * Claude request. The team server's runner has the same rules (server/src/agents/runner.ts toolsetOf).
 *
 * A connection test runs under the lock too: the tool listing it returns may leave the switched-off tools out, so a
 * re-test keeps the OUT tools the server had (mergeTestedTools) — a profile that matches by tools never flips.
 */
import type { BetaMCPToolset } from '@anthropic-ai/sdk/resources/beta/messages/messages'

/**
 * Whether a raw `mcp_tool_listing` still lists the tools a toolset switched off (spike SP1). Until it is known to, a
 * re-test never takes an OUT tool off a server's tool list.
 */
export const LISTING_SHOWS_DISABLED = false

/** An allow-list without the OUT tools (null = no allow-list: all tools). [] = nothing left: leave the server out. */
export function lockedOnly(only: readonly string[] | null | undefined, out: readonly string[]): string[] | null {
  if (!only) return null
  return only.filter((t) => !out.includes(t))
}

/**
 * The `mcp_toolset` of one server: all its tools, or only the allowed ones (every other tool switched off) — the OUT
 * tools off in both cases. An allow-list left empty by the lock still switches everything off (callers leave such a
 * server out of the request).
 */
export function toolsetFor(name: string, only: readonly string[] | null = null, out: readonly string[] = []): BetaMCPToolset {
  const allowed = lockedOnly(only, out)
  if (allowed) return { type: 'mcp_toolset', mcp_server_name: name, default_config: { enabled: false }, configs: Object.fromEntries(allowed.map((tool) => [tool, { enabled: true }])) }
  if (!out.length) return { type: 'mcp_toolset', mcp_server_name: name }
  return { type: 'mcp_toolset', mcp_server_name: name, configs: Object.fromEntries(out.map((tool) => [tool, { enabled: false }])) }
}

/** What Claude is told about a server's OUT tools (none: ''). */
export function outLine(out: readonly string[]): string {
  if (!out.length) return ''
  return `These tools of it send data out and are switched off for you: ${out.join(', ')}. If the person wants something sent there, write the text in your answer instead: the person sends it themselves, from One's Outbox.`
}

/**
 * A server's tool list after a connection test: the fresh names, plus every OUT tool the server had before — the test
 * ran with those switched off, so their absence proves nothing (unless `exact`: a listing known to name switched-off
 * tools too).
 */
export function mergeTestedTools(previous: readonly string[] | undefined, fresh: readonly string[], out: readonly string[], exact = false): string[] {
  const merged = [...new Set(fresh)]
  if (exact) return merged
  for (const t of previous ?? []) if (out.includes(t) && !merged.includes(t)) merged.push(t)
  return merged
}
