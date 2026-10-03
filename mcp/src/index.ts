/**
 * One MCP bridge — entry point. An MCP client (Claude Desktop, Claude Code …) starts this over
 * stdio; it also listens on ws://127.0.0.1:47321 for the One tab, which runs the tools.
 * stdout is the MCP channel: every log line goes to stderr.
 *
 * Environment:
 *   ONE_MCP_PORT        WebSocket port (default 47321; set the same port in One → Settings → Agents · MCP)
 *   ONE_ORIGINS         extra allowed page origins, comma-separated (e.g. https://one.example.com,http://myhost:*)
 *   ONE_MCP_TIMEOUT_MS  how long the tab may take to answer a call (default 30000)
 *   ONE_MCP_WAIT_MS     how long a call waits for a tab to connect (default 10000)
 *   ONE_MCP_QUIET=1     no log output
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { MCP_DEFAULT_PORT } from '../../src/app/features/mcp/contract.ts'
import { Bridge } from './bridge.ts'
import { allowedOrigins } from './policy.ts'
import { createMcpServer } from './server.ts'

declare const __VERSION__: string
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const quiet = process.env.ONE_MCP_QUIET === '1'
const log = (msg: string) => {
  if (!quiet) process.stderr.write(`[one-mcp] ${msg}\n`)
}

/**
 * An environment variable, or undefined when it is empty or still a placeholder: a host that
 * leaves "${user_config.port}" of the extension manifest unsubstituted means "not set".
 */
const env = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return !v || /^\$\{[^}]*\}$/.test(v) || v === 'undefined' ? undefined : v
}

const num = (raw: string | undefined, def: number, min: number, max: number) => {
  const n = Number(raw)
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def
}

const argv = process.argv.slice(2)
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`One MCP bridge ${VERSION}
Lets an MCP client (Claude Desktop, Claude Code …) work in the One tab open in your browser.

  Claude Desktop: open one.mcpb (https://getonecms.com/mcp/one.mcpb) — one click, or by hand:
                  { "mcpServers": { "one": { "command": "node", "args": ["/path/to/one-mcp.mjs"] } } }
  Claude Code:    claude mcp add one -- node /path/to/one-mcp.mjs

Then open One and switch on Settings → Agents · MCP. Docs: https://getonecms.com/ (docs/MCP.md)

Environment: ONE_MCP_PORT (default ${MCP_DEFAULT_PORT}), ONE_ORIGINS, ONE_MCP_TIMEOUT_MS, ONE_MCP_WAIT_MS, ONE_MCP_QUIET=1
`)
  process.exit(0)
}

if (process.stdin.isTTY) log('this is an MCP server: an MCP client starts it and talks to it over stdin/stdout (run with --help for setup)')

const port = num(env('ONE_MCP_PORT'), MCP_DEFAULT_PORT, 1, 65535)
const bridge = new Bridge({
  port,
  origins: allowedOrigins(env('ONE_ORIGINS'), log),
  timeoutMs: num(env('ONE_MCP_TIMEOUT_MS'), 30_000, 100, 600_000),
  waitMs: num(env('ONE_MCP_WAIT_MS'), 10_000, 0, 120_000),
  version: VERSION,
  log,
})

let stopping = false
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  // never hang on exit: the client is gone, the port must be free for the next start
  setTimeout(() => process.exit(code), 1500).unref()
  try {
    await bridge.close()
  } catch {
    /* exiting anyway */
  }
  process.exit(code)
}

await bridge.start()
const server = createMcpServer(bridge, VERSION)
const transport = new StdioServerTransport()
transport.onclose = () => void shutdown()
await server.connect(transport)
log(`ready (bridge ${VERSION})`)

// the MCP client went away (stdin closed) or asked us to stop
process.stdin.on('end', () => void shutdown())
process.stdin.on('close', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
process.on('SIGHUP', () => void shutdown())
