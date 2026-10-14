/**
 * MCP · Connections (#/mcp) — the page's rules (pure). Every lamp here is a rule that already exists elsewhere:
 *  - One's Claude's servers: the Preflight Token lamp's rule (ai/mcp-servers/health.ts `tokenTrouble`) — a row is red /
 *    amber exactly when the lamp counts it; a switched-off server is 'off' (the lamp never counts it)
 *  - the coding worker: the Preflight Worker lamp's rule (preflight/sources/workerRule.ts, its grace included) — red
 *    exactly when the lamp is; inside the grace a link that is connecting / waiting shows 'on'
 *  - Claude Code's own server names: read like the Settings overview table (ai/mcp-servers/overview.ts `workerNames`)
 *  - agents: only those whose runs happen in this browser (agents/runner.ts `runsHere`)
 * Nothing here reads a token or sends a request.
 */
import type { CustomAgent, McpServerConfig } from '../../../store/types'
import type { WorkerInfo } from '../../coding/protocol'
import { workerOutdated, workerUnsafe } from '../../coding/protocol'
import { tokenTrouble } from '../../ai/mcp-servers/health'
import { workerNames } from '../../ai/mcp-servers/overview'
import { workerLinkDown } from '../../preflight/sources/workerRule'

export type ServerState = 'off' | 'untested' | 'ok' | 'refusedTest' | 'refusedTab' | 'expired' | 'failed'
export type Level = 'ok' | 'red' | 'amber' | 'on' | 'off'

type ServerFacts = Pick<McpServerConfig, 'enabled' | 'checkAuth' | 'checkError' | 'checkedAt' | 'oauth'>

/** One server's state as the page shows it (`refused` = refusedHere(s): refused in this tab). */
export function serverState(s: ServerFacts, now: number, refused: boolean): ServerState {
  if (!s.enabled) return 'off'
  return tokenTrouble(s, now, refused)?.why ?? (s.checkedAt ? 'ok' : 'untested')
}

/** The row's LED: refused / ran out → red · failed → amber · ok → ok · not tested / off → off. */
export function ledOf(st: ServerState): Exclude<Level, 'on'> {
  if (st === 'refusedTest' || st === 'refusedTab' || st === 'expired') return 'red'
  if (st === 'failed') return 'amber'
  return st === 'ok' ? 'ok' : 'off'
}

/** The rows that need the person — the Preflight Token lamp's count (enabled servers with a token trouble). */
export function needsYou<S extends ServerFacts>(servers: S[], now: number, refused: (s: S) => boolean): number {
  return servers.filter((s) => s.enabled && tokenTrouble(s, now, refused(s)) !== null).length
}

/**
 * The worker link's lamp, by the Preflight Worker lamp's rule: connected → amber for a security gap / an older worker
 * (`oldHere`: older than 1.9.0 on this Windows computer — coding `workerOldHere`, which reads the browser), else ok · switched off here → off · down (refused / blocked / replaced at once; connecting / waiting / off once down
 * for the lamp's grace — `since` is the lamp's own clock, workerDownSince) → red · inside the grace: connecting /
 * waiting 'on', off 'off'.
 */
export function workerLed(s: { enabled: boolean; conn: string; worker: Pick<WorkerInfo, 'worker'> | null; can: readonly string[] | null; oldHere?: boolean }, since: number | null, now: number): Level {
  if (!s.enabled) return 'off'
  if (s.conn === 'connected') return workerUnsafe(s.worker?.worker) || s.oldHere || workerOutdated(s.can) ? 'amber' : 'ok'
  if (workerLinkDown(s.conn, since, now)) return 'red'
  if (s.conn === 'connecting' || s.conn === 'waiting') return 'on'
  return 'off'
}

export type WorkerPlaces = { kind: 'none' } | { kind: 'old' } | { kind: 'unknown' } | { kind: 'named'; places: Array<{ repo: string | null; names: string[] }> }

/**
 * Claude Code's own MCP servers per place, as the connected worker names them (names only): null worker → none; a
 * worker that names none (overview.ts `workerNames`: false → old, null → not known yet — it has not asked for a task
 * since it connected); repo null = tasks without a repository.
 */
export function workerPlaces(worker: Pick<WorkerInfo, 'repos' | 'mcp'> | null, can: readonly string[] | null): WorkerPlaces {
  if (!worker) return { kind: 'none' }
  const named = workerNames(worker, can)
  if (named === null) return { kind: 'unknown' }
  if (!named) return { kind: 'old' }
  const clean = (list: unknown): string[] | null => (Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : null)
  const places: Array<{ repo: string | null; names: string[] }> = []
  for (const r of worker.repos) {
    const names = clean(r.mcp)
    if (names) places.push({ repo: r.name, names })
  }
  const own = clean(worker.mcp)
  if (own) places.push({ repo: null, names: own })
  return { kind: 'named', places }
}

/** A Claude Code server name that is also one of One's servers (by name or codeword, case-folded — as the overview). */
export function alsoOnes(name: string, servers: Array<Pick<McpServerConfig, 'name' | 'codeword'>>): boolean {
  const n = name.toLowerCase()
  return servers.some((s) => s.name.toLowerCase() === n || (!!s.codeword && s.codeword.toLowerCase() === n))
}

/**
 * The browser agents whose runs happen in this browser (agents/runner.ts `runsHere`, switched-off ones kept — the page
 * strikes them through): every one in a local workspace (`team` null); in a team only the member's own (`createdBy`),
 * never while a viewer, and not one another member saved last (it waits for its creator's confirm, confirm.ts).
 */
export function agentsOfThisBrowser<A extends Pick<CustomAgent, 'runner' | 'createdBy' | 'updatedBy'>>(agents: A[], team: { me: string | null; readOnly: boolean } | null): A[] {
  return agents.filter((a) => {
    if (a.runner === 'server') return false
    if (!team) return true
    if (!team.me || team.readOnly || a.createdBy !== team.me) return false
    return !a.updatedBy || a.updatedBy === a.createdBy
  })
}

/**
 * Servers that switched-on browser agents name but this device does not have — their runs leave them out (exec.ts
 * notes it in the run). Sorted by name; each with the agents that name it. Pass only the agents that run here
 * (agentsOfThisBrowser).
 */
export function missingNamed(agents: Array<Pick<CustomAgent, 'name' | 'runner' | 'enabled' | 'mcpServers'>>, servers: Array<Pick<McpServerConfig, 'name'>>): Array<{ name: string; agents: string[] }> {
  const have = new Set(servers.map((s) => s.name))
  const out = new Map<string, string[]>()
  for (const a of agents) {
    if (a.runner === 'server' || !a.enabled) continue
    for (const n of a.mcpServers ?? []) {
      if (typeof n !== 'string' || !n || have.has(n)) continue
      const list = out.get(n) ?? []
      if (!list.includes(a.name)) list.push(a.name)
      out.set(n, list)
    }
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => ({ name, agents: list.sort((a, b) => a.localeCompare(b)) }))
}

/** The team server's MCP endpoint for this app's origin and base (cloud servers serve the app at '/'). */
export function teamEndpoint(origin: string, base: string): string {
  return new URL('mcp', origin + (base.endsWith('/') ? base : `${base}/`)).href
}

/** A server URL's host only — never its path or query (a query string may carry a key). */
export function hostOnly(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
