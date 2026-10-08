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
 *    A custom agent's tool allow-list (`opts.allow`, CustomAgent.mcpTools) switches the other tools off.
 *  - Readers sanitize: names / URLs / codewords are checked again here, whatever the stored list says.
 *  - Codewords (codeword.ts): a free-form request starting with "kb:" gets that server attached
 *    whatever its scope (codewordsIn + attachMcp(…, { forced })); client.ts decides, every caller gets it.
 */
import type { BetaMCPToolset, BetaRequestMCPServerURLDefinition } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { useWorkspace } from '../../../store/store'
import { getMcpToken } from '../../../store/secrets'
import type { McpServerConfig, Settings } from '../../../store/types'
import { t } from '../../../i18n'
import { linkBaseOf } from '../../../lib/foreignLinks'
import { addressedLine, codewordGuideLine, codewordProblem, normalizeCodeword, parseCodewords, switchedOffLine, pickedTool, pickedToolLine } from './codeword'
import { readOAuth } from './oauthConfig'
import { tokenFor } from './oauth'
import { newId } from '../../../lib/ids'

/** The MCP connector beta. */
export const MCP_BETA = 'mcp-client-2025-11-20'

export const NAME_MAX = 32
export const PROMPT_MAX = 6000
export const INSTRUCTIONS_MAX = 8000
export const MAX_SERVERS = 12

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** A typed name as an `mcp_server_name` ("Team KB" → "team-kb"). */
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

/** Path parts and host labels that say nothing about which server it is. */
const GENERIC = new Set(['mcp', 'sse', 'api', 'apis', 'server', 'servers', 'http', 'https', 'stream', 'streamable', 'rpc', 'jsonrpc', 'www', 'app', 'remote', 'connect', 'public', 'latest', 'tools', 'index'])

/**
 * A name for a server from its URL: the last meaningful path part, else a meaningful subdomain,
 * else the domain ("https://example.com/api/kb/mcp" → "kb", "https://mcp.tracker.example/sse" →
 * "tracker"), made unique among `others`.
 */
export function deriveName(url: string, others: string[]): string {
  let base = ''
  try {
    const u = new URL(url.trim())
    const parts = u.pathname
      .split('/')
      .map((p) => {
        try {
          return slugName(decodeURIComponent(p))
        } catch {
          return slugName(p)
        }
      })
      .map((p) => p.replace(/[-_]+$/, ''))
      .filter((p) => p && !GENERIC.has(p) && !/^v\d+$/.test(p))
    base = parts[parts.length - 1] ?? ''
    if (!base) {
      const labels = u.hostname.toLowerCase().split('.').filter(Boolean)
      const domain = labels.length >= 2 ? labels[labels.length - 2] : (labels[0] ?? '')
      base = slugName(labels.slice(0, -2).find((l) => !GENERIC.has(l)) ?? domain).replace(/[-_]+$/, '')
    }
  } catch {
    base = ''
  }
  if (!NAME_RE.test(base)) base = 'server'
  let name = base
  for (let n = 2; others.includes(name); n++) name = `${base.slice(0, NAME_MAX - String(n).length - 1)}-${n}`
  return name
}

/** The stored list, sanitized (bad entries are left out, never "fixed" into something else). */
export function readServers(settings: Pick<Settings, 'mcpServers'> = useWorkspace.getState().settings): McpServerConfig[] {
  const list = Array.isArray(settings.mcpServers) ? settings.mcpServers : []
  const seen = new Set<string>()
  const words: string[] = []
  const out: McpServerConfig[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.url !== 'string') continue
    if (!NAME_RE.test(s.name) || seen.has(s.name) || urlProblem(s.url)) continue
    seen.add(s.name)
    // a codeword that can't be used (format, "one", a duplicate) is left out; the server stays
    const cw = typeof s.codeword === 'string' ? normalizeCodeword(s.codeword) : ''
    const codeword = cw && !codewordProblem(cw, words) ? cw : undefined
    if (codeword) words.push(codeword)
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
      checkError: typeof s.checkError === 'string' && s.checkError ? s.checkError.slice(0, 300) : undefined,
      scope: s.scope === 'all' ? 'all' : undefined,
      codeword,
      linkBase: linkBaseOf(s.linkBase) ?? undefined,
      checkAuth: s.checkAuth === true ? true : undefined,
      oauth: readOAuth(s.oauth),
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

/**
 * Add a server by its address (Settings → Claude AI "Add", the AI terminal's /connect https://…): its name from the
 * address, switched on. The caller starts the background check (checks.ts) — this module never imports it.
 */
export function addServer(raw: string, token = ''): { server: McpServerConfig } | { problem: Exclude<ReturnType<typeof urlProblem>, ''> | 'full' } {
  const problem = urlProblem(raw)
  if (problem) return { problem }
  const list = readServers()
  if (list.length >= MAX_SERVERS) return { problem: 'full' }
  const url = raw.trim()
  const server: McpServerConfig = { id: newId(), name: deriveName(url, list.map((s) => s.name)), url, token: token.trim(), enabled: true, prompt: '' }
  // the store seals a plaintext token and keeps its marker (store/secrets.ts)
  writeServers([...list, server])
  return { server: readServers().find((s) => s.id === server.id) ?? server }
}

const sameUrl = (a: string, b: string) => {
  try {
    const x = new URL(a.trim())
    const y = new URL(b.trim())
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '') && x.search === y.search
  } catch {
    return false
  }
}

/** A server by its name, codeword ("kb" or "kb:"), address, or a name typed loosely ("Team KB" → team-kb). */
export function findServer(query: string, list: McpServerConfig[] = readServers()): McpServerConfig | null {
  const raw = query.trim()
  if (!raw) return null
  const low = raw.toLowerCase()
  const word = low.replace(/:$/, '')
  return (
    list.find((s) => s.name === low) ??
    (word !== 'one' ? list.find((s) => !!s.codeword && s.codeword === word) : undefined) ??
    (/^https?:\/\//i.test(raw) ? list.find((s) => sameUrl(s.url, raw)) : undefined) ??
    list.find((s) => s.name === slugName(raw).replace(/[-_]+$/, '')) ??
    null
  )
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

/** How Claude links this server's records: absolute URLs only (a relative "/r/1" would open One's own site). */
function linkLine(s: McpServerConfig): string {
  let base = linkBaseOf(s.linkBase)
  if (!base) {
    try {
      base = `${new URL(s.url).origin}/`
    } catch {
      base = null
    }
  }
  return base
    ? `When you link one of its records in your answer or in a page, write an absolute URL: put ${base} in front of a relative path (e.g. ${base}r/123), never a link that starts with "/".`
    : 'When you link one of its records, write an absolute URL (https://…), never a link that starts with "/".'
}

/**
 * The system prompt part for these servers: the template, then each server's usage prompt (with its
 * codeword, if it has one, and the tools an allow-list leaves switched on), then — for a request that
 * starts with codewords — who was addressed.
 */
export function mcpSystemText(servers: McpServerConfig[], instructions: string, addressed: string[] = [], picked: { server: string; tool: string } | null = null, allow: McpToolAllow = {}): string {
  const parts = [`<mcp_instructions>\n${instructions.trim()}\n</mcp_instructions>`]
  for (const s of servers) {
    const prompt = s.prompt.trim() || 'No usage guide yet: read the tool descriptions carefully before you use them.'
    const only = allowedTools(allow, s.name)
    const onlyLine = only ? `\nOnly these of its tools are switched on for you: ${only.join(', ')}. Its other tools are not available — never try to call them.` : ''
    parts.push(`<mcp_server name="${s.name}">\n${prompt}${s.codeword ? `\n${codewordGuideLine(s.codeword)}` : ''}${onlyLine}\n${linkLine(s)}\n</mcp_server>`)
  }
  const pickedLine = picked && addressed.includes(picked.server) ? [pickedToolLine(picked.server, picked.tool)] : []
  if (addressed.length) parts.push(`<mcp_codeword>\n${[...addressed.map(addressedLine), ...pickedLine].join('\n')}\n</mcp_codeword>`)
  return parts.join('\n\n')
}

/* ------------------------------------------------------------------ */
/* Attaching servers to a request                                      */
/* ------------------------------------------------------------------ */

/**
 * What kind of request asks: 'free' = a free-form one (the agent, "Ask Claude" with your own words,
 * ⌘K "?") gets every enabled server · 'fixed' = everything else (one-click actions, autofill, meeting
 * summaries, "Ask your workspace") gets only the servers whose scope is "All AI calls".
 */
export type McpRequestKind = 'free' | 'fixed'

/**
 * Tool allow-lists per server name (a custom agent's `mcpTools`): a listed server offers only those tools — its
 * toolset switches every tool off (`default_config`) and the listed ones on (`configs`); [] = no tool, the server
 * is left out. A server without an entry offers all its tools.
 */
export type McpToolAllow = Record<string, string[]>

/** The allow-list of a server (null = all its tools). Own entries only. */
export function allowedTools(allow: McpToolAllow | undefined, name: string): string[] | null {
  if (!allow || !Object.prototype.hasOwnProperty.call(allow, name)) return null
  const list = allow[name]
  return Array.isArray(list) ? list : null
}

/** The `mcp_toolset` of one server: all its tools, or only the allowed ones (every other tool switched off). */
export function toolsetFor(name: string, only: string[] | null = null): BetaMCPToolset {
  if (!only) return { type: 'mcp_toolset', mcp_server_name: name }
  return { type: 'mcp_toolset', mcp_server_name: name, default_config: { enabled: false }, configs: Object.fromEntries(only.map((tool) => [tool, { enabled: true }])) }
}

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
  return JSON.stringify([setup.instructions, setup.servers.map((s) => [s.id, s.name, s.url, s.prompt, s.scope ?? 'free', s.codeword ?? '', s.linkBase ?? ''])])
}

/**
 * The attachment for a request (null = no server to attach). Tokens are opened from the vault
 * for this request only; a server whose token is not available in this browser is left out.
 * `forced`: servers the request addressed by codeword (codewordsIn) — they join whatever their
 * scope, and the system prompt says they were addressed.
 */
/*
 * Servers that turned their token down in this tab (an API error named them): left out of requests that do not
 * address them — one server that needs a new token or a sign-in no longer breaks every request — until their
 * token changes (a new token or sign-in = a new vault marker) or a connection test passes. In memory only.
 */
const refused = new Map<string, string>()
const isRefused = (s: McpServerConfig) => refused.has(s.id) && refused.get(s.id) === (s.token ?? '')

/** This tab left the server out because it rejected its token (until the token changes). */
export const refusedHere = (s: Pick<McpServerConfig, 'id' | 'token'>) => refused.has(s.id) && refused.get(s.id) === (s.token ?? '')

/**
 * The server needs a sign-in before it can be used: the last check said its token was rejected, this tab saw it
 * rejected, or it has no token and was never checked (an open server that works has `checkedAt`).
 */
export const needsSignIn = (s: McpServerConfig) => s.checkAuth === true || refusedHere(s) || (!s.token && !s.checkedAt)

/**
 * A pinned server (a conversation's setup) with the token and sign-in it has NOW: a sign-in or a new token during the
 * conversation takes effect at once. Only while the server is the same one — its address and name unchanged (an
 * edited address keeps the old token: a new server's credential never goes to the old address); a removed one: null.
 */
export function liveOf(pinned: McpServerConfig, list: McpServerConfig[] = readServers()): McpServerConfig | null {
  const live = list.find((s) => s.id === pinned.id)
  if (!live) return null
  if (live.url !== pinned.url || live.name !== pinned.name) return pinned
  return { ...pinned, token: live.token, oauth: live.oauth }
}

/** An API error said this server rejected its token. */
export function noteRefused(name: string): void {
  const s = readServers().find((x) => x.name === name)
  if (s) refused.set(s.id, s.token ?? '')
}

/** The server works again (a connection test passed). */
export function clearRefused(name: string): void {
  const s = readServers().find((x) => x.name === name)
  if (s) refused.delete(s.id)
}

/** Servers a request of this kind would take but leaves out because they rejected their token here. */
export function refusedNames(setup: McpSetup = currentSetup(), kind: McpRequestKind = 'free', forced: string[] = []): string[] {
  const list = readServers()
  return setup.servers
    .map((p) => liveOf(p, list))
    .filter((s): s is McpServerConfig => !!s && !(kind === 'fixed' && s.scope !== 'all' && !forced.includes(s.name)) && !forced.includes(s.name) && isRefused(s))
    .map((s) => s.name)
}

export async function attachMcp(
  setup: McpSetup = currentSetup(),
  kind: McpRequestKind = 'free',
  opts: { forced?: string[]; picked?: { server: string; tool: string } | null; allow?: McpToolAllow } = {},
): Promise<McpAttachment | null> {
  const forced = opts.forced ?? []
  const allow = opts.allow ?? {}
  const usable: Array<{ s: McpServerConfig; token: string }> = []
  // a pinned setup keeps its servers (prompt, tools) but uses their current token / sign-in (liveOf)
  const list = readServers()
  for (const pinned of setup.servers) {
    const s = liveOf(pinned, list)
    if (!s) continue
    if (kind === 'fixed' && s.scope !== 'all' && !forced.includes(s.name)) continue
    if (isRefused(s) && !forced.includes(s.name)) continue
    // an allow-list without a tool: the server has nothing to offer
    if (allowedTools(allow, s.name)?.length === 0) continue
    // a signed-in server's access token is refreshed shortly before it expires (oauth.ts)
    const token = await tokenFor(s)
    if (token === null) continue
    usable.push({ s, token })
  }
  if (!usable.length) return null
  const names = usable.map(({ s }) => s.name)
  return {
    servers: usable.map(({ s, token }) => ({ type: 'url', url: s.url, name: s.name, ...(token ? { authorization_token: token } : {}) })),
    toolsets: usable.map(({ s }) => toolsetFor(s.name, allowedTools(allow, s.name))),
    system: mcpSystemText(
      usable.map(({ s }) => s),
      setup.instructions,
      forced.filter((n) => names.includes(n)),
      opts.picked ?? null,
      allow,
    ),
    names,
  }
}

/* ------------------------------------------------------------------ */
/* Codewords ("kb: …")                                                 */
/* ------------------------------------------------------------------ */

/** A free-form request's leading codewords: the text without them, the servers addressed (on / switched off). */
export interface Codewords {
  text: string
  /** enabled servers addressed — attachMcp(…, { forced }) */
  forced: string[]
  /** addressed, but switched off: they stay off (the result says so) */
  off: string[]
  /** a tool picked right after the codeword (the terminal's tool list, or typed) */
  picked?: { server: string; tool: string } | null
}

/** Read the codewords a request starts with (null = none). */
export function codewordsIn(text: string, servers: McpServerConfig[] = readServers()): Codewords | null {
  const hit = parseCodewords(text, servers)
  if (!hit.servers.length) return null
  return { text: hit.text, forced: hit.servers.filter((s) => s.enabled).map((s) => s.name), off: hit.servers.filter((s) => !s.enabled).map((s) => s.name), picked: pickedTool(hit.text, hit.servers) }
}

/**
 * A task for the workspace agent with its codewords applied: the prefix removed, a line for Claude in
 * front of it (the agent's pinned system prompt stays as it is). Without a codeword: `task` unchanged.
 */
export function codewordTask(task: string, servers: McpServerConfig[] = readServers()): string {
  const hit = parseCodewords(task, servers)
  if (!hit.servers.length) return task
  const lines = hit.servers.map((s) => (s.enabled ? addressedLine(s.name) : switchedOffLine(s.name)))
  const picked = pickedTool(hit.text, hit.servers)
  if (picked) lines.push(pickedToolLine(picked.server, picked.tool))
  return `${lines.join('\n')}\n\n${hit.text}`
}

/** Token state of a server in this browser. */
export async function tokenState(server: McpServerConfig): Promise<'none' | 'ok' | 'missing'> {
  const token = await getMcpToken(server)
  return token === null ? 'missing' : token ? 'ok' : 'none'
}
