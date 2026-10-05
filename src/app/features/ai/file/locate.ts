/**
 * Which file block an AI request is about, and where it is now (like image/locate.ts).
 *  - fileAt(doc, pos): the file block at `pos` with a source and a kind One can work with, or null
 *  - fileInSelection(state): a node-selected file block, or the one file block a selection holds (`only`:
 *    no text besides it) — the AI menu then offers the file's actions
 *  - findFile(doc, ref, mapped): the file again in a changed document — at the mapped position, else by its
 *    block id, else by its source when that is unique (never a guess)
 * A run's target is the block's range (image/locate.ts imageTarget works for any atom block).
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import { fileKind, type FileKind } from './kinds'

export { imageTarget as fileTarget } from '../image/locate'

export interface FileHit {
  pos: number
  node: PMNode
  kind: FileKind
}

const srcOf = (n: PMNode): string => (typeof n.attrs.src === 'string' ? n.attrs.src.trim() : '')
const kindOf = (n: PMNode | null | undefined): FileKind | null => (n && n.type.name === 'fileBlock' && srcOf(n) ? fileKind(String(n.attrs.name ?? '')) : null)

/** The file block at `pos` (with a source and a known kind), or null. */
export function fileAt(doc: PMNode, pos: number): FileHit | null {
  if (pos < 0 || pos > doc.content.size) return null
  const node = doc.nodeAt(pos)
  const kind = kindOf(node)
  return node && kind ? { pos, node, kind } : null
}

/** The file a selection is about: node-selected, or the only one in the range (`only`: nothing else but it). */
export function fileInSelection(state: EditorState): { hit: FileHit; only: boolean } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection) {
    const kind = kindOf(sel.node)
    return kind ? { hit: { pos: sel.from, node: sel.node, kind }, only: true } : null
  }
  if (sel.empty) return null
  const hits: Array<FileHit | null> = []
  state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
    if (hits.length > 1) return false
    if (node.type.name === 'fileBlock') {
      const kind = kindOf(node)
      // only a whole file block counts
      hits.push(kind && pos >= sel.from && pos + node.nodeSize <= sel.to ? { pos, node, kind } : null)
      return false
    }
    return true
  })
  const hit = hits.length === 1 ? hits[0] : null
  if (!hit) return null
  const text = state.doc.textBetween(sel.from, sel.to, ' ', '').trim()
  // the block's own text (its name) does not count as text besides it
  return { hit, only: !text || text === String(hit.node.attrs.name ?? '').trim() }
}

/** How a run remembers its file. */
export interface FileRef {
  src: string
  blockId: string | null
}

/** The file of a run in this document now (null: gone, or not found for sure). */
export function findFile(doc: PMNode, ref: FileRef, mapped: number | null): FileHit | null {
  const at = mapped !== null ? fileAt(doc, mapped) : null
  if (at && srcOf(at.node) === ref.src) return at
  let byId: FileHit | null = null
  const bySrc: FileHit[] = []
  doc.descendants((node, pos) => {
    if (byId) return false
    if (node.type.name !== 'fileBlock') return true
    const kind = kindOf(node)
    if (!kind) return false
    if (ref.blockId && node.attrs.id === ref.blockId) byId = { pos, node, kind }
    else if (srcOf(node) === ref.src) bySrc.push({ pos, node, kind })
    return false
  })
  if (byId) return byId
  return bySrc.length === 1 ? bySrc[0] : null
}
