/**
 * One MCP — an Undo that takes back only the call's own nodes from a page the person wrote in since: the database block
 * of one_create_database { inline }, the links of one_create_page { linkInParent } (database.ts, pages.ts). The rest of
 * the page — the person's edits — stays as it is. Pure over TipTap JSON.
 */
import type { JSONContent } from '@tiptap/core'

/** Blocks that must hold at least one block (an emptied one gets an empty paragraph). */
const HOLDS_BLOCKS = new Set(['doc', 'column', 'tab', 'detailsContent', 'syncedBlock', 'callout', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader', 'meetingNotes'])

/**
 * The doc without every node `drop` matches (at any depth): a paragraph that held nothing else goes with it, a container
 * left empty keeps an empty paragraph. null when nothing matched (nothing to write).
 */
export function withoutNodes(doc: JSONContent | null | undefined, drop: (n: JSONContent) => boolean): JSONContent | null {
  if (!doc) return null
  let hit = false
  const walk = (n: JSONContent): JSONContent | null => {
    if (drop(n)) {
      hit = true
      return null
    }
    if (!n.content?.length) return n
    const kids = n.content.map(walk)
    if (kids.every((k, i) => k === n.content![i])) return n
    const left = kids.filter((k): k is JSONContent => k !== null)
    // a paragraph that only held what went (a page mention line): gone with it
    if (n.type === 'paragraph' && !left.length) return null
    return { ...n, content: left.length || !HOLDS_BLOCKS.has(n.type ?? '') ? left : [{ type: 'paragraph' }] }
  }
  const next = walk(doc)
  if (!hit) return null
  return next ?? { type: 'doc', content: [{ type: 'paragraph' }] }
}
