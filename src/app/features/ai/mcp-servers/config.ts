/**
 * Remote MCP servers for One's built-in Claude — the Messages API MCP connector: Anthropic connects
 * to the server (Streamable HTTP / SSE over https) while it answers, so nothing runs in this browser
 * and there is no CORS. Used by the workspace agent, the free-form "Ask Claude" request (AI menu,
 * ⌘K "?") — never by the one-click actions.
 *
 *  - Settings (per device): `settings.mcpServers` (tokens as vault markers, store/secrets.ts) and
 *    `settings.mcpInstructions` (the editable template; '' = the default in the UI language).
 *  - A request: `mcp_servers` (url, name, authorization_token) + one `mcp_toolset` per server in
 *    `tools` + the beta header, and the system prompt gets the template and each server's usage prompt.
 *  - Readers sanitize: names / URLs are checked again here, whatever the stored list says.
 */
import type { BetaMCPToolset, BetaRequestMCPServerURLDefinition } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { useWorkspace } from '../../../store/store'
import { getMcpToken } from '../../../store/secrets'
import type { McpServerConfig, Settings } from '../../../store/types'
import { t } from '../../../i18n'

/** The MCP connector beta. */
export const MCP_BETA = 'mcp-client-2025-11-20'

export const NAME_MAX = 32
export const PROMPT_MAX = 6000
export const INSTRUCTIONS_MAX = 8000
export const MAX_SERVERS = 12

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** A typed name as an `mcp_server_name` ("Atlas KB" → "atlas-kb"). */
export function slugName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, NAME_MAX)
}

/** Why a name can't be used ('' = fine). `others`: the names of the other servers. */
export function nameProblem(name: string, others: string[]): '' | 'empty' | 'format' | 'taken' {
  if (!name) return 'empty'
  if (!NAME_RE.test(name)) return 'format'
  if (others.includes(name)) return 'taken'
  return ''
}

/** Why a URL can't be used ('' = fine): https only (Anthropic connects to it over the internet). */
export function urlProblem(raw: string): '' | 'empty' | 'format' | 'https' | 'local' {
  const v = raw.trim()
  if (!v) return 'empty'
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return 'format'
  }
  if (u.protocol !== 'https:') return 'https'
  if (u.username || u.password) return 'format'
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|0\.)/.test(host) || host === '[::1]') return 'local'
  return ''
}

/** The stored list, sanitized (bad entries are left out, never "fixed" into something else). */
export function readServers(settings: Pick<Settings, 'mcpServers'> = useWorkspace.getState().settings): McpServerConfig[] {
  const list = Array.isArray(settings.mcpServers) ? settings.mcpServers : []
  const seen = new Set<string>()
  const out: McpServerConfig[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.url !== 'string') continue
    if (!NAME_RE.test(s.name) || seen.has(s.name) || urlProblem(s.url)) continue
    seen.add(s.name)
    out.push({
      id: s.id,
      name: s.name,
      url: s.url.trim(),
      token: typeof s.token === 'string' ? s.token : '',
      enabled: s.enabled !== false,
      prompt: typeof s.prompt === 'string' ? s.prompt.slice(0, PROMPT_MAX) : '',
      promptSource: s.promptSource === 'auto' || s.promptSource === 'edited' ? s.promptSource : undefined,
      tools: Array.isArray(s.tools) ? s.tools.filter((x): x is string => typeof x === 'string').slice(0, 200) : undefined,
      checkedAt: typeof s.checkedAt === 'number' ? s.checkedAt : undefined,
    })
    if (out.length >= MAX_SERVERS) break
  }
  return out
}

/** Write the list (a plaintext `token` on an entry is sealed by the store; markers stay as they are). */
export function writeServers(list: McpServerConfig[]): void {
  useWorkspace.getState().updateSettings({ mcpServers: list })
}

/** Change one server. */
export function patchServer(id: string, patch: Partial<McpServerConfig>): void {
  writeServers(readServers().map((s) => (s.id === id ? { ...s, ...patch } : s)))
}

/* ------------------------------------------------------------------ */
/* The system prompt part                                              */
/* ------------------------------------------------------------------ */

/** The default instructions template, in the UI language. */
export function defaultInstructions(): string {
  return t('features.ai.mcp.template')
}

/** The template a request uses: the user's own, or the default. */
export function instructionsText(settings: Pick<Settings, 'mcpInstructions'> = useWorkspace.getState().settings): string {
  const own = typeof settings.mcpInstructions === 'string' ? settings.mcpInstructions.trim() : ''
  return own ? own.slice(0, INSTRUCTIONS_MAX) : defaultInstructions()
}

/** The system prompt part for these servers: the template, then each server's usage prompt. */
export function mcpSystemText(servers: McpServerConfig[], instructions: string): string {
  const parts = [`<mcp_instructions>\n${instructions.trim()}\n</mcp_instructions>`]
  for (const s of servers) {
    const prompt = s.prompt.trim()
    parts.push(`<mcp_server name="${s.name}">\n${prompt || 'No usage guide yet: read the tool descriptions carefully before you use them.'}\n</mcp_server>`)
  }
  return parts.join('\n\n')
}

/* ------------------------------------------------------------------ */
/* Attaching servers to a request                                      */
/* ------------------------------------------------------------------ */

/** What one request sends for MCP. */
export interface McpAttachment {
  servers: BetaRequestMCPServerURLDefinition[]
  toolsets: BetaMCPToolset[]
  /** appended to the request's system prompt */
  system: string
  names: string[]
}

/** A snapshot of the MCP setup (the agent pins one per conversation: same prompt, same tools). */
export interface McpSetup {
  servers: McpServerConfig[]
  instructions: string
}

/** The enabled servers and the template of `settings` (default: right now). */
export function currentSetup(settings: Pick<Settings, 'mcpServers' | 'mcpInstructions'> = useWorkspace.getState().settings): McpSetup {
  return { servers: readServers(settings).filter((s) => s.enabled), instructions: instructionsText(settings) }
}

/** A stable signature of a setup (what the prompt and the tool list are made of). */
export function setupKey(setup: McpSetup): string {
  return JSON.stringify([setup.instructions, setup.servers.map((s) => [s.id, s.name, s.url, s.prompt])])
}

/**
 * The attachment for a request (null = no server to attach). Tokens are opened from the vault
 * for this request only; a server whose token is not available in this browser is left out.
 */
export async function attachMcp(setup: McpSetup = currentSetup()): Promise<McpAttachment | null> {
  const usable: Array<{ s: McpServerConfig; token: string }> = []
  for (const s of setup.servers) {
    const token = await getMcpToken(s)
    if (token === null) continue
    usable.push({ s, token })
  }
  if (!usable.length) return null
  return {
    servers: usable.map(({ s, token }) => ({ type: 'url', url: s.url, name: s.name, ...(token ? { authorization_token: token } : {}) })),
    toolsets: usable.map(({ s }) => ({ type: 'mcp_toolset', mcp_server_name: s.name })),
    system: mcpSystemText(
      usable.map(({ s }) => s),
      setup.instructions,
    ),
    names: usable.map(({ s }) => s.name),
  }
}

/** Token state of a server in this browser. */
export async function tokenState(server: McpServerConfig): Promise<'none' | 'ok' | 'missing'> {
  const token = await getMcpToken(server)
  return token === null ? 'missing' : token ? 'ok' : 'none'
}
