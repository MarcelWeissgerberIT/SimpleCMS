/**
 * The MCP side: the tool list comes straight from the shared contract; every call is forwarded
 * to the One tab through the bridge. Results are the tab's JSON, errors are tool errors
 * (isError) with the tab's human-readable message.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { MCP_INSTRUCTIONS, MCP_TOOLS, type McpToolDef, type McpToolName } from '../../src/app/features/mcp/contract.ts'
import type { Bridge } from './bridge.ts'

/** How often a call waiting for approval reports progress (clients that reset timeouts on it keep waiting). */
const PROGRESS_MS = 10_000

export function toMcpTool(def: McpToolDef): Tool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema as Tool['inputSchema'],
    annotations: {
      title: def.title,
      readOnlyHint: !def.write,
      destructiveHint: !!def.destructive,
      idempotentHint: !def.write,
      // everything stays inside the person's workspace
      openWorldHint: false,
    },
  }
}

const text = (s: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) })

export function createMcpServer(bridge: Bridge, version: string): McpServer {
  const mcp = new McpServer({ name: 'one', title: 'SimpleCMS One', version }, { capabilities: { tools: { listChanged: false } }, instructions: MCP_INSTRUCTIONS })
  const server = mcp.server

  server.oninitialized = () => {
    const client = server.getClientVersion()
    bridge.setClient(client ? { name: client.name, version: client.version } : null)
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS.map(toMcpTool) }))

  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
    const name = req.params.name
    const def = MCP_TOOLS.find((t) => t.name === name)
    if (!def) return text(`Unknown tool ${JSON.stringify(name)}. Tools: ${MCP_TOOLS.map((t) => t.name).join(', ')}.`, true)
    const args = req.params.arguments && typeof req.params.arguments === 'object' ? (req.params.arguments as Record<string, unknown>) : {}
    const token = req.params._meta?.progressToken
    let ticker: ReturnType<typeof setInterval> | null = null
    let step = 0
    const progress = () => {
      if (token === undefined) return
      step += 1
      extra
        .sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: step, message: 'Waiting for approval in One…' } })
        .catch(() => {})
    }
    try {
      const out = await bridge.call(def.name as McpToolName, args, {
        signal: extra.signal,
        onPending: () => {
          progress()
          ticker ??= setInterval(progress, PROGRESS_MS)
        },
      })
      if (!out.ok) return text(out.error, true)
      return text(typeof out.result === 'string' ? out.result : JSON.stringify(out.result, null, 2))
    } finally {
      if (ticker) clearInterval(ticker)
    }
  })

  return mcp
}
