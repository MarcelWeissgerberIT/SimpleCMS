/**
 * Custom agents — the MCP tool allow-list (CustomAgent.mcpTools) in the editor: which tools a server offers (its
 * last connection test, McpServerConfig.tools) and the "Read-only tools" preset. Pure helpers.
 */
import type { McpServerConfig } from '../../store/types'

/** Words that make a tool name look like a read. */
const READ_WORDS = new Set(['get', 'list', 'search', 'query', 'read', 'fetch', 'find', 'whoami', 'context'])
/** Words that make it a write whatever else it says ("search_and_replace", "delete_search_index"). */
const WRITE_WORDS = new Set([
  'create', 'update', 'delete', 'remove', 'write', 'set', 'add', 'post', 'send', 'put', 'patch', 'edit', 'move', 'upsert',
  'insert', 'archive', 'assign', 'close', 'merge', 'publish', 'upload', 'run', 'execute', 'exec', 'trash', 'restore', 'save',
  'apply', 'import', 'rename', 'attach', 'reply', 'submit', 'approve', 'cancel', 'replace', 'commit', 'push', 'invite', 'log',
])

/** The words of a tool name: snake_case, kebab-case, dotted and camelCase split, lower case. */
export function toolWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Looks like a tool that only reads (get / list / search / query / read / fetch / find / whoami / context, no write verb). */
export function isReadTool(name: string): boolean {
  const words = toolWords(name)
  return words.some((w) => READ_WORDS.has(w)) && !words.some((w) => WRITE_WORDS.has(w))
}

const sameAddress = (a: string, b: string) => {
  try {
    const x = new URL(a.trim())
    const y = new URL(b.trim())
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '')
  } catch {
    return false
  }
}

/**
 * The tools a server offers as far as this browser knows (its last connection test), null = never tested. A server
 * agent's server lives in the team server's runtime: its tools are those of the server set up here at the same
 * address (or, failing that, under the same name).
 */
export function testedTools(name: string, local: McpServerConfig[], remote?: { name: string; url: string } | null): string[] | null {
  const own = remote ? (local.find((s) => sameAddress(s.url, remote.url)) ?? local.find((s) => s.name === name)) : local.find((s) => s.name === name)
  return own?.tools?.length ? own.tools : null
}
