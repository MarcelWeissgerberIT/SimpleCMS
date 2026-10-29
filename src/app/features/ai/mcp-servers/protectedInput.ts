/** Protected input stays in a separate authenticated server window, never in One's chat or storage. */
export function protectedInputOf(content: unknown): string | undefined {
  const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.map((b) => b?.type === 'text' ? b.text : '').filter((x): x is string => typeof x === 'string') : []
  for (const text of texts) {
    try {
      const data = JSON.parse(text)
      const action = data?.interaction ?? data?.result?.interaction
      if (action?.type === 'url' && action?.purpose === 'authentication' && typeof action.url === 'string') return action.url
    } catch { /* Page text is not an input request. */ }
  }
}

/** A tool result cannot redirect a secret-entry action away from its configured MCP server. */
export function trustedProtectedInput(candidate: string | undefined, server: string): string | undefined {
  if (!candidate) return
  try {
    const url = new URL(candidate), expected = new URL(server)
    if (url.origin !== expected.origin || url.username || url.password || url.search || url.hash) return
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return
    if (!/^\/mcp\/secure-input\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)) return
    return url.href
  } catch { return }
}
