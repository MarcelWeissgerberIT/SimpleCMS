/**
 * Workspace agent — what a tool call may see, and the error a call has to fix. Its own module (tools.ts re-exports
 * it) so the task tools (workItems.ts) read the scope without importing the tool list that lists them.
 *  - withToolScope(filter, fn): custom agents (features/agents) — the pages a scoped run may see (null = everything).
 *  - withReadLimit(limit, fn): the AI terminal — what the person lets Claude read of a page (context marks).
 * Both hold for the synchronous part of one tool call only; an async tool takes them along first, before any await.
 *  - afterRead(out, record) / idsIn(text, pages): custom agents (slice SJ) — what a tool call returned to Claude, once
 *    it resolves: the pages it names are the run's touched pages (their classes go into the run's `touched` set, the
 *    classes a pre-check of its proposals declares).
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

/**
 * Run `fn` (a tool call) seeing only the pages `filter` lets through — within any scope already open (an agent's scope
 * inside the pages its route may see: both hold; null keeps the scope open around it).
 */
export function withToolScope<T>(filter: ((id: ID) => boolean) | null, fn: () => T): T {
  const prev = visible
  visible = prev && filter ? (id) => prev(id) && filter(id) : (filter ?? prev)
  try {
    return fn()
  } finally {
    visible = prev
  }
}

/** Hand a tool call's result to `record` once it is there (sync or async) — the call's outcome is unchanged. */
export function afterRead<T extends { content: string }>(out: T | Promise<T>, record: ((content: string) => void) | null): T | Promise<T> {
  if (!record) return out
  const take = (o: T): T => {
    try {
      record(o.content)
    } catch (e) {
      console.warn('[one] agents: could not note what a tool read', e)
    }
    return o
  }
  return out instanceof Promise ? out.then(take) : take(out)
}

/** The page ids a text names (tool results name every page they show by its id). */
export function idsIn(text: string, has: (id: string) => boolean, into: Set<ID>, max = 5000): void {
  for (const tok of text.match(/[A-Za-z0-9_-]{6,64}/g) ?? []) {
    if (into.size >= max) return
    if (has(tok)) into.add(tok)
  }
}
