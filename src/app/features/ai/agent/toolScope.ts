/**
 * Workspace agent — what a tool call may see, and the error a call has to fix. Its own module (tools.ts re-exports
 * it) so the task tools (workItems.ts) read the scope without importing the tool list that lists them.
 *  - withToolScope(filter, fn): custom agents (features/agents) — the pages a scoped run may see (null = everything).
 *  - withReadLimit(limit, fn): the AI terminal — what the person lets Claude read of a page (context marks).
 * Both hold for the synchronous part of one tool call only; an async tool takes them along first, before any await.
 */
import type { ID } from '../../../store/types'

/** A call Claude has to fix: the message goes back to Claude as an error result. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

/**
 * The AI terminal: what the person lets Claude read of a page (its context marks, editor area) —
 * null = everything. Set only for the duration of one tool call (withReadLimit).
 */
export interface ReadLimit {
  mode: 'marked' | 'none'
  /** the marked blocks as Markdown / plain text ('' for 'none') */
  markdown: string
  plain: string
  blocks: number
  /** the marked top-level blocks (their ids) — read_page with refs and edit_page only see these */
  ids?: string[]
}

let visible: ((id: ID) => boolean) | null = null
let readLimit: ((id: ID) => ReadLimit | null) | null = null

/**
 * The read limit of the tool call running now. It holds for the call's synchronous part only (withReadLimit resets
 * it when run() returns its Promise): an async tool takes it along as its FIRST statement, before any await.
 */
export const currentReadLimit = (): ((id: ID) => ReadLimit | null) | null => readLimit

/** The pages the tool call running now may see (custom agents' scope; null = everything) — like currentReadLimit. */
export const currentToolScope = (): ((id: ID) => boolean) | null => visible

/**
 * The limit memoised per page for one tool call: it reads and measures the page each time (the terminal's
 * terminalReadLimit), and a call asks for it per task, per link, per line — never twice for one page.
 */
function memoLimit(limit: (id: ID) => ReadLimit | null): (id: ID) => ReadLimit | null {
  const memo = new Map<ID, ReadLimit | null>()
  return (id) => {
    if (memo.has(id)) return memo.get(id)!
    const out = limit(id)
    memo.set(id, out)
    return out
  }
}

/** Run `fn` (a tool call) reading pages only as `limit` allows (asked once per page during the call). */
export function withReadLimit<T>(limit: ((id: ID) => ReadLimit | null) | null, fn: () => T): T {
  const prev = readLimit
  readLimit = limit ? memoLimit(limit) : null
  try {
    return fn()
  } finally {
    readLimit = prev
  }
}

export const LIMITED_NOTE = 'The person limited what you may read on this page'

/** Run `fn` (a tool call) seeing only the pages `filter` lets through. */
export function withToolScope<T>(filter: ((id: ID) => boolean) | null, fn: () => T): T {
  const prev = visible
  visible = filter
  try {
    return fn()
  } finally {
    visible = prev
  }
}
