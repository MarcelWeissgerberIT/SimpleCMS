/**
 * One MCP — what the person lets an MCP client read of a page (their context marks, editor/context; spec § 2.1, Q10), for
 * the paths that read through another area's code:
 *  - mcpReadLimit(id): the workspace agent's ReadLimit (as the AI terminal's terminalReadLimit) — the agent tools MCP
 *    stages through and the task index (one_list_work_items, one_update_work_item) run under it (withReadLimit), so a task
 *    in an excluded block is neither listed, nor resolved, nor named.
 *  - mcpPageText(id): what a One Script run started over MCP gets from a page's `.markdown` / `.text` (one_run_query,
 *    one_run_script — RunOptions.textLimit): only the readable blocks.
 *  - mcpReadableTop(id, blocks): the indexes of the top-level blocks that may be read — a tool that takes a block by its
 *    ref (one_create_database inline.afterBlock) refuses any other one and never names its ref now.
 * All are null for a page without marks (all of it).
 */
import type { JSONContent } from '@tiptap/core'
import type { ID } from '../../store/types'
import { docToMarkdown, isContextLimited, readableBlocks, readableContent, stripPrivate } from '../../editor'
import type { ReadLimit } from '../ai/agent/tools'

/** The top-level block ids of what may be read. */
const idsOf = (blocks: readonly JSONContent[]) => blocks.flatMap((b) => (typeof b.attrs?.id === 'string' && b.attrs.id ? [b.attrs.id] : []))

/** The agent tools' read limit for a page under context marks (null: no marks — the whole page). */
export function mcpReadLimit(id: ID): ReadLimit | null {
  if (!isContextLimited(id)) return null
  // the file form: dates and people as `one:` links (as the terminal's)
  const r = readableContent(id, { form: 'file' })
  if (r.mode === 'marked' && r.blocks) return { mode: 'marked', markdown: r.markdown, plain: r.plain, blocks: r.blocks, ids: idsOf(readableBlocks(id)) }
  return { mode: 'none', markdown: '', plain: '', blocks: 0, ids: [] }
}

/** A page's text as a script run over MCP may read it (null: no marks — the whole page). */
export function mcpPageText(id: ID): { markdown: string; plain: string } | null {
  if (!isContextLimited(id)) return null
  const blocks = readableBlocks(id)
  if (!blocks.length) return { markdown: '', plain: '' }
  return { markdown: docToMarkdown(stripPrivate({ type: 'doc', content: blocks })).trim(), plain: readableContent(id).plain }
}

/** The indexes of a page's top-level blocks the person lets Claude read (null: no marks — every block). */
export function mcpReadableTop(id: ID, blocks: readonly JSONContent[]): Set<number> | null {
  if (!isContextLimited(id)) return null
  const ids = new Set(idsOf(readableBlocks(id)))
  const keep = new Set<number>()
  blocks.forEach((b, i) => {
    if (typeof b.attrs?.id === 'string' && ids.has(b.attrs.id)) keep.add(i)
  })
  return keep
}
