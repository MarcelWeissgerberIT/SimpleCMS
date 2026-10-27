/** Classify without echoing raw errors, URLs or credentials into guidance. */
export type ConnectionProblem = 'tls' | 'auth' | 'timeout' | 'network' | 'worker' | 'identity' | 'policy' | 'tools' | 'unknown'
export function connectionProblem(error: unknown): ConnectionProblem {
  const e = error as { message?: unknown; detail?: unknown; code?: unknown } | null
  const text = [e?.message, e?.detail, e?.code].filter(v => typeof v === 'string').join(' ').toLowerCase()
  if (/certificate|zertifikat|cert_|self.signed|\btls\b|issuer/.test(text)) return 'tls'
  if (/\b(?:401|403)\b|authentication rejected|invalid.token/.test(text) || text === 'token') return 'auth'
  if (/timeout|timed.out|zeitüberschreitung/.test(text)) return 'timeout'
  if (/network|netzwerk|enotfound|econn|dns|fetch failed/.test(text)) return 'network'
  if (text === 'worker' || /mcpworker/.test(text)) return 'worker'
  if (text === 'identity') return 'identity'
  if (/\bpolicy\b|destination|datenregel|mcp-required/.test(text)) return 'policy'
  if (text === 'tools') return 'tools'
  return 'unknown'
}
