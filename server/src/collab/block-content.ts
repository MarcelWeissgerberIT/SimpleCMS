import * as Y from 'yjs'
import type { BlockContent } from '../../../src/shared/blockChanges.ts'

/** Preserve text, marks and block attributes without requiring an editor/schema on the server. */
export function blockContent(el: Y.XmlElement, depth = 0): BlockContent {
  const attrs = el.getAttributes() as Record<string, unknown>
  const node: BlockContent = { type: el.nodeName, ...(Object.keys(attrs).length ? { attrs } : {}) }
  if (depth > 64) return node
  const content: BlockContent[] = []
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlElement) content.push(blockContent(child, depth + 1))
    else if (child instanceof Y.XmlText) {
      for (const part of child.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
        if (typeof part.insert !== 'string' || !part.insert) continue
        const marks = Object.entries(part.attributes ?? {}).map(([key, value]) => ({
          type: key.replace(/--[A-Za-z0-9+/=_-]+$/, ''),
          ...(value && typeof value === 'object' && !Array.isArray(value) ? { attrs: value as Record<string, unknown> } : {}),
        }))
        content.push({ type: 'text', text: part.insert, ...(marks.length ? { marks } : {}) })
      }
    }
  }
  if (content.length) node.content = content
  return node
}
