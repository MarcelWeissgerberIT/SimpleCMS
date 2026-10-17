/**
 * Work orders — the planner's calls on the picked server, as the plate lists them ("Wissensbasis · kb_search(4711) →
 * 3,2 kB"), pure (a Node spec reads it). Read from the `mcp_tool_use` / `mcp_tool_result` blocks of each response
 * (client.ts onMcpActivity): Anthropic calls the server inside the request, so One only sees them there. `args` is what
 * One's request sent to the server (the tool input as JSON, cut), `bytes` the size of the text that came back.
 */
import type { OrderCall } from './types'

/** a call's arguments as the plate shows them */
const ARGS_MAX = 160
/** calls kept per run (the planner is asked for ≤ 6; a server may answer more rounds) */
const CALLS_MAX = 24

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** A call's arguments in one line: the input's JSON without its outer braces, cut. */
export function callArgs(input: unknown): string {
  let s: string
  try {
    s = JSON.stringify(input ?? {}) ?? ''
  } catch {
    s = ''
  }
  if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1)
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > ARGS_MAX ? `${s.slice(0, ARGS_MAX - 1)}…` : s
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b) => (isObj(b) && typeof b.text === 'string' ? b.text : '')).join('')
  return ''
}

const bytesOf = (s: string) => new TextEncoder().encode(s).length

/** Calls in progress: a use waits for its result (by the use's id). */
export interface CallFold {
  calls: OrderCall[]
  /** use id → index in `calls` */
  open: Record<string, number>
}

export const emptyFold = (): CallFold => ({ calls: [], open: {} })

/**
 * Fold one response's MCP blocks into the call list: a use of `server` adds a call (unanswered: ok false, 0 bytes until
 * its result arrives), its result sets the size and whether it failed. Blocks of another server are ignored (none can
 * join the planner's request; a stray one never lands in the list).
 */
export function foldCalls(fold: CallFold, blocks: ReadonlyArray<unknown>, server: string): CallFold {
  let calls = fold.calls
  let open = fold.open
  for (const b of blocks) {
    if (!isObj(b)) continue
    if (b.type === 'mcp_tool_use' && typeof b.id === 'string' && b.server_name === server && typeof b.name === 'string') {
      if (b.id in open || calls.length >= CALLS_MAX) continue
      calls = [...calls, { tool: b.name.slice(0, 64), args: callArgs(b.input), bytes: 0, ok: false }]
      open = { ...open, [b.id]: calls.length - 1 }
    } else if (b.type === 'mcp_tool_result' && typeof b.tool_use_id === 'string' && b.tool_use_id in open) {
      const i = open[b.tool_use_id]!
      const text = textOf(b.content)
      calls = calls.map((c, k) => (k === i ? { ...c, bytes: bytesOf(text), ok: b.is_error !== true } : c))
    }
  }
  return calls === fold.calls ? fold : { calls, open }
}

/** "Server returned nothing": it took part, and no call brought anything back (none made, all failed or empty). */
export const serverReturnedNothing = (calls: readonly OrderCall[]): boolean => !calls.some((c) => c.ok && c.bytes > 0)
