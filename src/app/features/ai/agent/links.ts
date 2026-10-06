/**
 * Workspace agent — page links in content Claude wrote. Claude links pages as Markdown
 * `[Title](#/p/<id>)`; once applied they become what a person would have made by hand:
 *
 *  - a link whose text is the page's title → a page mention (live title, in a table cell too);
 *  - a paragraph on the page itself holding nothing but such a link → a page link block;
 *  - a link to a row staged in this batch points at the row's real id (rows get their id on apply).
 *
 * Other `#/p/` links (another text, a block anchor `?b=`) stay links — they open the page on click.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'

const PAGE_HREF = /^#\/p\/([\w-]+)$/

/** What a link may point at: the page's id now, its title, and whether its title stays out of mentions (a private page). */
export interface LinkTarget {
  id: ID
  title: string
  private?: boolean
}

const norm = (s: string) => s.replace(/^@/, '').replace(/\s+/g, ' ').trim().toLowerCase()

function hrefOf(n: JSONContent): string | null {
  const href = n.marks?.find((m) => m.type === 'link')?.attrs?.href
  return typeof href === 'string' ? href : null
}

/** A live page of the workspace as a link target (null: none, or in the trash). */
export function livePage(id: ID): LinkTarget | null {
  const p = useWorkspace.getState().pages[id]
  return p && !p.trashed ? { id: p.id, title: p.title, ...(p.private ? { private: true } : {}) } : null
}

/**
 * The doc with page links turned into page nodes. `target(id)`: the page an id stands for (a live page,
 * a page staged in this batch, a row created from a staged row) — null: unknown, the link stays.
 * `blocks: false`: mentions only (content that goes into a list).
 */
export function withPageNodes(doc: JSONContent, target: (id: ID) => LinkTarget | null, opts: { blocks?: boolean } = {}): JSONContent {
  const inline = (n: JSONContent): JSONContent => {
    if (n.type === 'text' && n.text) {
      const id = hrefOf(n)?.match(PAGE_HREF)?.[1]
      const page = id ? target(id) : null
      if (!page) return n
      if (norm(page.title) && norm(n.text) === norm(page.title)) return { type: 'mention', attrs: { id: page.id, label: page.private ? null : page.title, kind: 'page' } }
      // a staged row's link follows the row to its real id
      return page.id === id ? n : { ...n, marks: n.marks?.map((m) => (m.type === 'link' ? { ...m, attrs: { ...m.attrs, href: `#/p/${page.id}` } } : m)) }
    }
    if (!n.content?.length) return n
    const content = n.content.map(inline)
    return content.some((c, i) => c !== n.content![i]) ? { ...n, content } : n
  }
  const out = inline(doc)
  if (opts.blocks === false || !out.content?.length) return out
  // a paragraph of the page itself holding only one page mention: a page link block
  const blocks = out.content.map((b) => {
    const only = b.type === 'paragraph' && b.content?.length === 1 ? b.content[0] : null
    return only?.type === 'mention' && only.attrs?.kind === 'page' && only.attrs.id ? { type: 'pageLink', attrs: { pageId: only.attrs.id } } : b
  })
  return blocks.some((b, i) => b !== out.content![i]) ? { ...out, content: blocks } : out
}
