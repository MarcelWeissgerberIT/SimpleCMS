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
 *  - mcpChartSource(source) / withMcpCharts(fn): a chart's live source is read only where the client may read it itself
 *    — a spreadsheet on a live, non-template page and inside what that page's marks let through, a live database —
 *    else the chart answers "not available" (no data, no table in its Markdown, no numbers in a frozen copy).
 *  - linksReadably(page, id): does a page link `id` in what the person lets Claude read of it (one_get_page backlinks).
 * All are null for a page without marks (all of it).
 */
import type { JSONContent } from '@tiptap/core'
import type { ID } from '../../store/types'
import { linkedPageIds } from '../../store/store'
import { docToMarkdown, isContextLimited, readableBlocks, readableContent, stripPrivate } from '../../editor'
import type { ReadLimit } from '../ai/agent/tools'
import { withChartSourceGate, type ChartSource } from '../charts'
import { live, ws } from './values'
import type { CallerText } from '../script'

/** The top-level block ids of what may be read. */
const idsOf = (blocks: readonly JSONContent[]) => blocks.flatMap((b) => (typeof b.attrs?.id === 'string' && b.attrs.id ? [b.attrs.id] : []))

/** The agent tools' read limit for a page under context marks (null: no marks — the whole page). */
export function mcpReadLimit(id: ID): ReadLimit | null {
  if (!isContextLimited(id)) return null
  // the file form: dates and people as `one:` links (as the terminal's); charts only from sources the client may read
  const r = withMcpCharts(() => readableContent(id, { form: 'file' }))
  if (r.mode === 'marked' && r.blocks) return { mode: 'marked', markdown: r.markdown, plain: r.plain, blocks: r.blocks, ids: idsOf(readableBlocks(id)) }
  return { mode: 'none', markdown: '', plain: '', blocks: 0, ids: [] }
}

/**
 * A page's text as a script run over MCP may read it: only the readable blocks under context marks; without marks the
 * whole page (`whole`), its charts' tables only from sources the client may read (mcpChartSource) — built on first read.
 */
export function mcpPageText(id: ID): CallerText | null {
  if (!isContextLimited(id)) {
    const page = ws().pages[id]
    if (!page) return null
    let md: string | null = null
    return {
      whole: true,
      plain: page.plain ?? '',
      get markdown() {
        md ??= page.content ? withMcpCharts(() => docToMarkdown(stripPrivate(page.content!)).trim()) : ''
        return md
      },
    }
  }
  const blocks = readableBlocks(id)
  if (!blocks.length) return { markdown: '', plain: '' }
  return withMcpCharts(() => ({ markdown: docToMarkdown(stripPrivate({ type: 'doc', content: blocks })).trim(), plain: readableContent(id).plain }))
}

/** Does this subtree hold the spreadsheet block `blockId`? */
const holdsSheet = (nodes: readonly JSONContent[], blockId: string): boolean => nodes.some((n) => (n.type === 'spreadsheet' && n.attrs?.id === blockId) || (!!n.content && holdsSheet(n.content, blockId)))

/**
 * May an MCP client read this chart source (spec § 2.1 / § 2.8)? A spreadsheet only on a live page that is no template's
 * and only inside what that page's context marks let through; a database only while it is live (no template's, not in
 * the trash); a workspace metric or manual data always.
 */
export function mcpChartSource(source: ChartSource): boolean {
  if (source.kind === 'sheet') {
    const page = live(source.pageId)
    if (!page) return false
    return holdsSheet(isContextLimited(page.id) ? readableBlocks(page.id) : (page.content?.content ?? []), source.sheetBlockId)
  }
  if (source.kind === 'database') return !!live(source.databaseId)
  return true
}

/** Build a page's Markdown (or anything that resolves its charts) the way an MCP client may read its charts' sources. */
export const withMcpCharts = <T>(fn: () => T): T => withChartSourceGate(mcpChartSource, fn)

/** Does `page` link `id` (page link, mention, link) in what the person lets Claude read of it (all of it without marks)? */
export function linksReadably(pageId: ID, id: ID): boolean {
  if (!isContextLimited(pageId)) return true
  return linkedPageIds({ type: 'doc', content: readableBlocks(pageId) }).includes(id)
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
