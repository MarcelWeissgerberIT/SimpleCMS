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

/**
 * Words that hand data to someone else ("forward_email", "share_document", "notify_channel", "trigger_webhook" …) —
 * a profile's declaration never confirms a name carrying one (declaredReadOk). Several are nouns in read tools as well
 * ("get_email"): they decide only about declarations, never the heuristic (isReadTool) — such a name keeps its "?".
 */
const SEND_WORDS = new Set([
  'forward', 'share', 'notify', 'email', 'mail', 'message', 'comment', 'transfer', 'export', 'sync', 'trigger', 'call', 'request',
  'deploy', 'dispatch', 'broadcast', 'webhook', 'invoke', 'emit', 'enqueue', 'tweet', 'sms', 'escalate', 'relay', 'transmit',
  'deliver', 'distribute', 'announce',
])

/** The words of a tool name: snake_case, kebab-case, dotted and camelCase split, lower case. */
export function toolWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Carries a write word ("create", "update", "send", "post" … — WRITE_WORDS), whatever else it says: such a tool is never
 * read as a read, not even when a profile declares it one (the Patchbay keeps it WRITE?, §1.5).
 */
export function isWriteNamed(name: string): boolean {
  return toolWords(name).some((w) => WRITE_WORDS.has(w))
}

/** Carries a word that hands data to someone else (SEND_WORDS: forward, share, notify, email, webhook …). */
export function isSendNamed(name: string): boolean {
  return toolWords(name).some((w) => SEND_WORDS.has(w))
}

/**
 * May a profile's declaration confirm this tool as a read? Only a name that reads as one (a READ word) and carries no
 * write word and no send word: a declaration confirms a reading name, it never makes a read of a tool that may carry data
 * out — the profile can be imported or edited by any owner or admin (the Patchbay, §1.5 / §6 A4).
 */
export function declaredReadOk(name: string): boolean {
  return isReadTool(name) && !isSendNamed(name)
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
