/** Classify without echoing raw errors, URLs or credentials into guidance. */
export type ConnectionProblem = 'tls' | 'auth' | 'permission' | 'timeout' | 'network' | 'worker' | 'identity' | 'policy' | 'tools' | 'schema' | 'response' | 'limit' | 'query' | 'rate' | 'server' | 'unknown'
export function connectionProblem(error: unknown): ConnectionProblem {
  const e = error as { message?: unknown; detail?: unknown; code?: unknown; status?: unknown; cause?: { code?: unknown } } | null
  const text = (typeof error === 'string' ? error : [e?.message, e?.detail, e?.code, e?.status, e?.cause?.code].filter(v => typeof v === 'string' || typeof v === 'number').join(' ')).toLowerCase()
  // Prefer transport status over prose, including guidance that mentions an invalid token only to exclude it.
  if (e?.status === 401) return 'auth'
  if (e?.status === 403) return 'permission'
  if (/certificate|zertifikat|cert_|self.signed|\btls\b|issuer/.test(text)) return 'tls'
  if (/\b401\b|\bmcp_auth\b/.test(text)) return 'auth'
  if (/\b403\b|mcp_permission|permission (?:denied|refused)|access denied|forbidden|fehlende berechtigung|zugriff verweigert/.test(text)) return 'permission'
  if (/\b429\b|rate[ _-]?limit|too many requests/.test(text)) return 'rate'
  if (/authenticat.{0,20}(?:fail|reject|required)|unauthoriz|invalid.token|(?:expired|revoked)[ _-]?token|token.{0,30}(?:refused|rejected|abgelehnt|expired|revoked|invalid)/.test(text) || text === 'token') return 'auth'
  if (/timeout|timed.out|zeitüberschreitung/.test(text)) return 'timeout'
  if (/network|netzwerk|enotfound|eai_again|econn|dns|fetch failed/.test(text)) return 'network'
  if (text === 'worker' || /mcpworker|worker.{0,25}(?:unavailable|not connected|nicht verbunden)/.test(text)) return 'worker'
  if (text === 'identity' || /atlas identity does not match/.test(text)) return 'identity'
  if (/\bpolicy\b|destination|datenregel|mcp-required|quantum.blocked/.test(text)) return 'policy'
  if (/invalid[ _-]?(?:query|aql)|mcp_query|query[ _-]?(?:syntax|parse)|(?:parse|parsing).{0,20}(?:query|aql)|(?:search query|query syntax).{0,20}(?:invalid|reject)|reject.{0,20}search query|unsupported.{0,15}(?:operator|filter)|unknown.{0,10}(?:field|operator)|operator.{0,25}not valid for field/.test(text)) return 'query'
  if (/mcp_arguments_invalid|\b32602\b|invalid[ _-]?params|unsupported schema|schema (?:changed|validation)|arguments.{0,30}(?:invalid|match)|invalid arguments/.test(text)) return 'schema'
  if (/response_limit|catalogue_limit|bounded source cache|exceed the bounded limit|result.{0,20}too large|up to 20,000|exceeds.{0,20}20,000|180 kb/.test(text)) return 'limit'
  if (/invalid.{0,15}(?:mcp|tool).{0,15}response|malformed response|invalid json/.test(text)) return 'response'
  if (text === 'tools' || /tool_unavailable|tool.{0,25}(?:unavailable|not available|not permitted)|werkzeug.{0,25}nicht freigegeben/.test(text)) return 'tools'
  if (/\b50[0-9]\b|\b5xx\b|mcp_server|server error|service unavailable|bad gateway/.test(text)) return 'server'
  return 'unknown'
}

/** Fixed diagnostic text only: the transport's raw error may contain credentials. */
export function mcpConnectionMessage(error:unknown, phase:'discovery'|'call'='discovery'):string {
  const problem=connectionProblem(error)
  const details:Record<ConnectionProblem,string>={
    tls:'TLS certificate verification failed. Check the company certificate setup for Node; do not disable verification.',
    auth:'Authentication rejected by this endpoint. Check the connection address and your personal sign-in or token.',
    permission:'Permission denied. Check project membership and tool permissions; this does not prove an invalid token.',
    timeout:'Connection timed out. Check VPN, proxy and network access from this worker.',
    network:'Network connection failed. Check VPN, proxy, DNS and network access.',
    worker:'Personal worker unavailable. Start the existing worker or check the configured connection route.',
    identity:'Atlas identity does not match the personal access.',
    policy:'A data policy blocks the selected MCP destination or tool.',
    tools:'The selected tool is unavailable or not permitted. Check the actual tool catalogue and permissions.',
    schema:'MCP arguments do not match the current tool schema. Refresh discovery and review the arguments; nothing should be repeated blindly.',
    response:'Invalid MCP tool response. No successful source result was verified.',
    limit:'MCP result or arguments exceed the bounded limit. Select a smaller source excerpt or narrower query.',
    query:'The connected service rejected the search query. Check the query syntax, supported filters and actual tool schema; preserve the requested tenant and project scope.',
    rate:'MCP rate limit reached. Wait before explicitly retrying a read; do not automatically repeat writes.',
    server:'MCP server returned a server error (5xx). The failed call has no verified result; check already accepted writes before retrying.',
    unknown:`MCP ${phase} failed without a classified cause. This call has no verified source result. Inspect its request and receipt before retrying.`,
  }
  return details[problem]
}
