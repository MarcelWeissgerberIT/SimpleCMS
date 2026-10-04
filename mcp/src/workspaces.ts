/**
 * Which connected tab a call goes to — the workspace boundary of the bridge, kept pure so the rules
 * are tested on their own (test/workspaces.test.ts).
 *
 *  - `workspace` given: an exact id → else the exact name (case-insensitive, trimmed) → a name (or an
 *    id) that fits more than one tab is an error listing their ids; nothing that fits is an error
 *    listing what is connected. Something shaped like an id ("team:…") only ever matches ids: a tab
 *    named like another workspace's id never receives that workspace's calls.
 *  - `workspace` left out: the only connected workspace — as long as it is the one this MCP session
 *    last worked in. When the tab switched to another workspace since (or another workspace took the
 *    old one's place), the call is refused (workspace_mismatch) until the agent names the workspace:
 *    a call never silently lands in another workspace than the one the agent was reading. With
 *    several connected it is an error that asks for `workspace` — never a guess.
 *
 * Ids route, names are for people: two workspaces may share a name, so a name only ever resolves when
 * exactly one connected workspace carries it.
 */
import { MCP_ERR, MCP_WORKSPACE_ID, type McpAgentMode, type McpWorkspaceInfo } from '../../src/app/features/mcp/contract.ts'

export interface Candidate {
  info: { workspace: McpWorkspaceInfo; mode: McpAgentMode }
  /** the page origin of the tab (https://getonecms.com …) */
  origin: string
  /** speaks one-mcp.v2 (its calls are bound to `workspace.id`) */
  bound: boolean
  /** connection order: higher = connected later */
  seq: number
}

export type Resolved<T extends Candidate> = { ok: true; target: T } | { ok: false; error: string }

/** The longest `workspace` argument looked at (ids are ≤ 69 chars, names ≤ 120). */
export const WORKSPACE_ARG_MAX = 200

const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

/** `"Acme" (team:7f3c)` — how errors name a workspace. */
export function label(w: McpWorkspaceInfo): string {
  return `${JSON.stringify(w.name)} (${w.id ?? 'old One version, no id'})`
}

const listing = (all: Candidate[]) => all.map((c) => label(c.info.workspace)).join(', ')

/**
 * @param last the workspace this MCP session last sent a call to (id and name), if any
 */
export function resolveWorkspace<T extends Candidate>(all: T[], arg: unknown, last: McpWorkspaceInfo | null = null): Resolved<T> {
  if (arg === undefined || arg === null || (typeof arg === 'string' && !arg.trim())) {
    if (all.length === 1) {
      const only = all[0]!
      if (last?.id && only.info.workspace.id && only.info.workspace.id !== last.id) {
        return {
          ok: false,
          error: `${MCP_ERR.mismatch}: the connected One tab now shows the workspace ${label(only.info.workspace)}, but your earlier calls went to ${label(last)}. Nothing was done. Ask the person whether to continue in ${JSON.stringify(only.info.workspace.name)}; if so, pass "workspace": ${JSON.stringify(only.info.workspace.id)}.`,
        }
      }
      return { ok: true, target: only }
    }
    return {
      ok: false,
      error: `${MCP_ERR.required}: ${all.length} One workspaces are connected: ${listing(all)}. Pass "workspace" with the id or the name of the one you mean — if it is not clear which one, ask the person. Nothing was done.`,
    }
  }
  if (typeof arg !== 'string') return { ok: false, error: `"workspace" must be a string: the id or the name of a connected workspace (one_list_workspaces). Nothing was done.` }
  if (arg.length > WORKSPACE_ARG_MAX) return { ok: false, error: `"workspace" is too long: pass the id or the name of a connected workspace (one_list_workspaces). Nothing was done.` }
  const want = arg.trim()

  const byId = all.filter((c) => c.info.workspace.id === want)
  if (byId.length === 1) return { ok: true, target: byId[0]! }
  if (byId.length > 1) {
    const sites = byId.map((c) => c.origin).join(', ')
    return {
      ok: false,
      error: `${MCP_ERR.ambiguous}: more than one tab claims the workspace id ${JSON.stringify(want)} (from ${sites}). Ask the person to close the tab that should not be connected. Nothing was done.`,
    }
  }

  const name = norm(want)
  const byName = MCP_WORKSPACE_ID.test(want) ? [] : all.filter((c) => norm(c.info.workspace.name) === name)
  if (byName.length === 1) return { ok: true, target: byName[0]! }
  if (byName.length > 1) {
    return {
      ok: false,
      error: `${MCP_ERR.ambiguous}: ${byName.length} connected workspaces are called ${JSON.stringify(want)}: ${byName.map((c) => c.info.workspace.id ?? '(no id)').join(', ')}. Pass "workspace" with the id of the one you mean — ask the person if it is not clear. Nothing was done.`,
    }
  }
  return {
    ok: false,
    error: `${MCP_ERR.unknown}: no connected workspace has the id or name ${JSON.stringify(want)}. Connected: ${listing(all) || 'none'}. Use one of these, or ask the person to open that workspace in One (with Settings → Agents · MCP switched on). Nothing was done.`,
  }
}

/** What one_list_workspaces answers about one tab. No content. */
export function describe(c: Candidate, newest: boolean) {
  const readOnly = c.info.workspace.readOnly || c.info.mode === 'read'
  return {
    id: c.info.workspace.id ?? null,
    name: c.info.workspace.name,
    kind: c.info.workspace.kind,
    access: readOnly ? 'read-only' : 'read-write',
    readOnly: c.info.workspace.readOnly,
    mode: c.info.mode,
    changes: c.info.workspace.readOnly
      ? 'Refused: the person can only view this workspace.'
      : c.info.mode === 'ask'
        ? 'Each change waits for the person to approve it in One.'
        : c.info.mode === 'apply'
          ? 'Changes are applied directly.'
          : 'Refused (read only).',
    site: c.origin,
    newest,
    ...(c.bound ? {} : { note: 'This tab runs an older One version: update One (reload the tab) so its calls are bound to this workspace.' }),
  }
}
