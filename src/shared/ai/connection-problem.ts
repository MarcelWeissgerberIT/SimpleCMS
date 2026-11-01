/** Classify without echoing raw errors, URLs or credentials into guidance. */
export type ConnectionProblem = 'tls' | 'auth' | 'permission' | 'timeout' | 'network' | 'worker' | 'identity' | 'policy' | 'tools' | 'schema' | 'response' | 'limit' | 'unknown'
export function connectionProblem(error: unknown): ConnectionProblem {
  const e = error as { message?: unknown; detail?: unknown; code?: unknown; status?: unknown; cause?: { code?: unknown } } | null
  const text = (typeof error === 'string' ? error : [e?.message, e?.detail, e?.code, e?.status, e?.cause?.code].filter(v => typeof v === 'string' || typeof v === 'number').join(' ')).toLowerCase()
  // Prefer transport status over prose, including guidance that mentions an invalid token only to exclude it.
  if (e?.status === 401) return 'auth'
  if (e?.status === 403) return 'permission'
  if (/certificate|zertifikat|cert_|self.signed|\btls\b|issuer/.test(text)) return 'tls'
  if (/\b401\b|\bmcp_auth\b/.test(text)) return 'auth'
  if (/\b403\b|mcp_permission|permission denied|access denied|forbidden|fehlende berechtigung|zugriff verweigert/.test(text)) return 'permission'
  if (/authenticat.{0,20}(?:fail|reject|required)|unauthoriz|invalid.token|(?:expired|revoked)[ _-]?token|token.{0,30}(?:refused|rejected|abgelehnt|expired|revoked|invalid)/.test(text) || text === 'token') return 'auth'
  if (/timeout|timed.out|zeitüberschreitung/.test(text)) return 'timeout'
  if (/network|netzwerk|enotfound|eai_again|econn|dns|fetch failed/.test(text)) return 'network'
  if (text === 'worker' || /mcpworker|worker.{0,25}(?:unavailable|not connected|nicht verbunden)/.test(text)) return 'worker'
  if (text === 'identity' || /atlas identity does not match/.test(text)) return 'identity'
  if (/\bpolicy\b|destination|datenregel|mcp-required|quantum.blocked/.test(text)) return 'policy'
  if (/mcp_arguments_invalid|unsupported schema|schema (?:changed|validation)|arguments.{0,30}(?:invalid|match)|invalid arguments/.test(text)) return 'schema'
  if (/response_limit|catalogue_limit|bounded source cache|exceed the bounded limit|result.{0,20}too large|up to 20,000|exceeds.{0,20}20,000|180 kb/.test(text)) return 'limit'
  if (/invalid.{0,15}(?:mcp|tool).{0,15}response|malformed response|invalid json/.test(text)) return 'response'
  if (text === 'tools' || /tool_unavailable|tool.{0,25}(?:unavailable|not available|not permitted)|werkzeug.{0,25}nicht freigegeben/.test(text)) return 'tools'
  return 'unknown'
}

/** Fixed diagnostic text only: the transport's raw error may contain credentials. */
export function mcpConnectionMessage(error:unknown, phase:'discovery'|'call'='discovery'):string {
  const problem=connectionProblem(error)
  const details:Record<ConnectionProblem,string>={
    tls:'TLS certificate verification failed. Check the company certificate setup for Node; do not disable verification.',
    auth:'Authentication rejected by this endpoint. Check the Atlas instance and personal token.',
    permission:'Permission denied. Check project membership and tool permissions; this does not prove an invalid token.',
    timeout:'Connection timed out. Check VPN, proxy and network access from this worker.',
    network:'Network connection failed. Check VPN, proxy, DNS and network access.',
    worker:'Personal worker unavailable. Start the existing worker or check the prepared Atlas proxy.',
    identity:'Atlas identity does not match the personal access.',
    policy:'A data policy blocks the selected MCP destination or tool.',
    tools:'The selected tool is unavailable or not permitted. Check the actual tool catalogue and permissions.',
    schema:'MCP arguments do not match the current tool schema. Refresh discovery and review the arguments; nothing should be repeated blindly.',
    response:'Invalid MCP tool response. No successful source result was verified.',
    limit:'MCP result or arguments exceed the bounded limit. Select a smaller source excerpt or narrower query.',
    unknown:`MCP ${phase} failed. Check the personal worker, endpoint and selected tool. No source result was verified.`,
  }
  return details[problem]
}
