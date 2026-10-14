/**
 * #/mcp — MCP · Connections: a lazy chunk. Nothing of the page loads at boot; opening it reads only what this tab
 * already knows (never a token, never a request).
 */
import { lazy, Suspense } from 'react'

const Page = lazy(() => import('./ConnectionsPage'))

export function McpConnectionsRoute() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  )
}
