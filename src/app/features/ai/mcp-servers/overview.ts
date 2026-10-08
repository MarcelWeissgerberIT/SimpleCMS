/**
 * Settings → Claude AI → MCP servers, "Where each server may be used" — the rows of the overview table (pure).
 *
 * One row per MCP server of this device: its codeword, which of One's Claude requests take it (scope, switched
 * off), the custom agents that attach it (browser runner; a tool list narrows it, [] leaves it out), the integration
 * profiles it activates, and whether Claude Code in the coding worker has a server of the same name (or codeword) —
 * per repo and for tasks without a repo. Claude Code's servers are its own (the person's `claude mcp` setup, named in
 * worker.json); a name One does not know gets a row of its own. Nothing here is fixed per service.
 */
import type { CustomAgent, IntegrationProfile, McpServerConfig } from '../../../store/types'
import { matchingServers } from '../../../store/integrations'

/** What One knows of the coding worker's Claude Code servers (features/coding WorkerInfo, names only). */
export interface WorkerMcp {
  repos: Array<{ name: string; mcp?: string[] }>
  mcp?: string[]
  /** the worker names its servers (it lists 'mcp-list' in `can`; older workers send no names) */
  named: boolean
}

/** Claude Code: not connected · a worker too old to name its servers · the repos (and "no repo") that have it */
export type CodeUse = { kind: 'none' } | { kind: 'old' } | { kind: 'has'; repos: string[]; noRepo: boolean }

export interface OverviewRow {
  key: string
  /** One's server (absent: a server only Claude Code has) */
  server?: McpServerConfig
  name: string
  host: string
  codeword: string | null
  /** One's own Claude: switched off · free-form requests · every AI call (null: not one of One's servers) */
  one: 'off' | 'free' | 'all' | null
  /** browser agents that attach it; `tools` = the size of its tool list (null = all tools) */
  agents: Array<{ id: string; name: string; tools: number | null; enabled: boolean }>
  /** integration profiles active through this server */
  integrations: string[]
  code: CodeUse
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const fold = (s: string) => s.toLowerCase()

/** Claude Code's names per place: repo name → names, '' = tasks without a repo. null = no worker / an older one. */
function codeNames(worker: WorkerMcp | null): Map<string, string[]> | 'old' | null {
  if (!worker) return null
  if (!worker.named) return 'old'
  const out = new Map<string, string[]>()
  for (const r of worker.repos) if (Array.isArray(r.mcp)) out.set(r.name, r.mcp.filter((n) => typeof n === 'string'))
  if (Array.isArray(worker.mcp)) out.set('', worker.mcp.filter((n) => typeof n === 'string'))
  return out
}

function useIn(places: Map<string, string[]>, match: (n: string) => boolean): CodeUse {
  const repos: string[] = []
  let noRepo = false
  for (const [place, names] of places) {
    if (!names.some(match)) continue
    if (place === '') noRepo = true
    else repos.push(place)
  }
  return { kind: 'has', repos, noRepo }
}

export function overviewRows(
  servers: McpServerConfig[],
  agents: CustomAgent[],
  profiles: IntegrationProfile[],
  worker: WorkerMcp | null,
): OverviewRow[] {
  const places = codeNames(worker)
  const seen = new Set<string>()
  const rows: OverviewRow[] = servers.map((s) => {
    const words = new Set([fold(s.name), ...(s.codeword ? [fold(s.codeword)] : [])])
    const match = (n: string) => words.has(fold(n))
    let code: CodeUse = { kind: 'none' }
    if (places === 'old') code = { kind: 'old' }
    else if (places) {
      code = useIn(places, match)
      for (const names of places.values()) for (const n of names) if (match(n)) seen.add(fold(n))
    }
    const attached = agents
      .filter((a) => a.runner !== 'server' && a.mcpServers.includes(s.name))
      .map((a) => ({ id: a.id, name: a.name, tools: a.mcpTools?.[s.name]?.length ?? null, enabled: a.enabled }))
      .filter((a) => a.tools !== 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    const matchServers = [{ name: s.name, url: s.url, enabled: s.enabled, tools: s.tools }]
    return {
      key: `one:${s.id}`,
      server: s,
      name: s.name,
      host: hostOf(s.url),
      codeword: s.codeword ?? null,
      one: !s.enabled ? 'off' : s.scope === 'all' ? 'all' : 'free',
      agents: attached,
      integrations: profiles.filter((p) => matchingServers(p, matchServers).length > 0).map((p) => p.name),
      code,
    }
  })
  // servers only Claude Code has: a row each (by name, case-insensitive)
  if (places && places !== 'old') {
    const extra = new Map<string, string>()
    for (const names of places.values()) for (const n of names) if (!seen.has(fold(n)) && !extra.has(fold(n))) extra.set(fold(n), n)
    for (const [key, name] of [...extra].sort((a, b) => a[0].localeCompare(b[0])))
      rows.push({ key: `code:${key}`, name, host: '', codeword: null, one: null, agents: [], integrations: [], code: useIn(places, (n) => fold(n) === key) })
  }
  return rows
}
