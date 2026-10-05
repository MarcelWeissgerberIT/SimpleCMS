/**
 * MCP activity of a response: `mcp_tool_use` / `mcp_tool_result` blocks run inside one response
 * (Anthropic calls the server), so they are only watched here — shown as "ATLAS · search" chips.
 */
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages'

export interface McpCall {
  /** the mcp_tool_use id */
  id: string
  server: string
  tool: string
  /** a short readout of the input ("launch plan") */
  arg: string
  state: 'run' | 'ok' | 'err'
  /** an error result's text (clipped) */
  error?: string
  /**
   * Not a call: the request addressed this server by codeword, but it did not join — 'off' = switched
   * off, 'token' = no token in this browser (client.ts reports it first, so the result can say so).
   */
  skipped?: 'off' | 'token'
}

/** The entry for a server a codeword addressed that could not join the request. */
export function skippedCall(server: string, why: 'off' | 'token'): McpCall {
  return { id: `skip:${server}`, server, tool: '', arg: '', state: 'err', skipped: why }
}

/** The first short string in a tool input (a query, an id …), for the readout. */
export function inputLabel(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  for (const v of Object.values(input as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) return clip(v.trim().replace(/\s+/g, ' '), 80)
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  }
  return ''
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** End a server's message like a sentence (it is followed by one of ours). */
const sentence = (s: string) => (!s || /[.!?…:)]$/.test(s) ? s : `${s}.`)

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b) => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join(' ')
  return ''
}

/** Fold one finished content block into the call list (returns the same list when nothing changed). */
export function foldMcpBlock(calls: McpCall[], block: BetaContentBlock): McpCall[] {
  if (block.type === 'mcp_tool_use') {
    if (calls.some((c) => c.id === block.id)) return calls
    return [...calls, { id: block.id, server: block.server_name, tool: block.name, arg: inputLabel(block.input), state: 'run' }]
  }
  if (block.type === 'mcp_tool_result') {
    const i = calls.findIndex((c) => c.id === block.tool_use_id)
    if (i < 0) return calls
    const next = [...calls]
    next[i] = block.is_error ? { ...calls[i], state: 'err', error: sentence(clip(resultText(block.content).trim().replace(/\s+/g, ' '), 240)) } : { ...calls[i], state: 'ok' }
    return next
  }
  return calls
}

/** "ATLAS · search_records" */
export function callLabel(c: Pick<McpCall, 'server' | 'tool'>): string {
  return `${c.server.toUpperCase()} · ${c.tool}`
}
