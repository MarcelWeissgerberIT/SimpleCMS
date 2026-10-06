/**
 * "Turn into list" (AI menu, no Claude): the items of a selection — one per list item (bullet, numbered,
 * to-do), else one per line of the selected text blocks (table cells: one per cell). Duplicates and
 * empty lines are left out; nothing is sent anywhere.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { itemsFromText } from './model'

const LIST_ITEMS = new Set(['listItem', 'taskItem'])

/** The text of a block's first line of content (a list item's paragraph, not its nested list). */
function ownText(node: PMNode): string {
  const first = node.firstChild
  return (first && first.isTextblock ? first.textContent : node.textContent).trim()
}

export function listItemsIn(doc: PMNode, from: number, to: number): string[] {
  const lines: string[] = []
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (LIST_ITEMS.has(node.type.name)) {
      lines.push(ownText(node))
      // nested lists are items too
      return true
    }
    if (node.isTextblock) {
      // a list item's own line was taken whole above
      if (parent && LIST_ITEMS.has(parent.type.name)) return false
      const start = Math.max(from, pos + 1)
      const end = Math.min(to, pos + 1 + node.content.size)
      if (end <= start && node.content.size) return false
      const text = node.textBetween(start - pos - 1, end - pos - 1, '\n', '\n')
      lines.push(...text.split('\n'))
      return false
    }
    return true
  })
  return itemsFromText(lines.join('\n'))
}
