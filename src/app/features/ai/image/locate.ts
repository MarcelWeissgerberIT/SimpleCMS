/**
 * Which image an AI request is about, and where it is now.
 *  - imageInSelection(state): a node-selected image, or the one image a selection holds (`only`: no text
 *    besides it) — the AI menu then offers the image actions
 *  - imageTarget(doc, pos): the run target of an image (runsTarget.ts): "Insert below" lands right after
 *    the image, inside the column / callout / toggle it sits in
 *  - findImage(doc, ref): the image again in a changed document — at the mapped position, else by its
 *    block id, else by its source when that is unique (never a guess)
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import { afterBlock, plainBetween, type RunTarget } from '../runsTarget'

export interface ImageHit {
  pos: number
  node: PMNode
}

const isImage = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === 'image' && typeof n.attrs.src === 'string' && !!n.attrs.src.trim()

/** The image at `pos` (with a source), or null. */
export function imageAt(doc: PMNode, pos: number): ImageHit | null {
  if (pos < 0 || pos > doc.content.size) return null
  const node = doc.nodeAt(pos)
  return isImage(node) ? { pos, node } : null
}

/** The image a selection is about: node-selected, or the only one in the range (`only`: nothing else but it). */
export function imageInSelection(state: EditorState): { hit: ImageHit; only: boolean } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection) return isImage(sel.node) ? { hit: { pos: sel.from, node: sel.node }, only: true } : null
  if (sel.empty) return null
  const hits: ImageHit[] = []
  state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
    if (hits.length > 1) return false
    if (node.type.name === 'image') {
      // only a whole image counts
      if (isImage(node) && pos >= sel.from && pos + node.nodeSize <= sel.to) hits.push({ pos, node })
      else hits.push({ pos: -1, node })
      return false
    }
    return true
  })
  if (hits.length !== 1 || hits[0].pos < 0) return null
  const text = state.doc.textBetween(sel.from, sel.to, ' ', '').trim()
  return { hit: hits[0], only: !text }
}

/** The run target of an image: its range, "Insert below" right after it. */
export function imageTarget(doc: PMNode, pos: number): RunTarget {
  const node = doc.nodeAt(pos)
  const to = pos + (node?.nodeSize ?? 1)
  return {
    mode: 'selection',
    from: pos,
    to,
    selected: '',
    inlineOnly: false,
    blockFrom: pos,
    blockTo: to,
    blockEmpty: false,
    after: afterBlock(doc.resolve(Math.min(to, doc.content.size))),
    before: '',
    todb: null,
    anchor: plainBetween(doc, pos, to),
  }
}

/** How a run remembers its image. */
export interface ImageRef {
  src: string
  blockId: string | null
}

/** The image of a run in this document now (null: gone, or not found for sure). */
export function findImage(doc: PMNode, ref: ImageRef, mapped: number | null): ImageHit | null {
  const at = mapped !== null ? imageAt(doc, mapped) : null
  if (at && at.node.attrs.src === ref.src) return at
  let byId: ImageHit | null = null
  const bySrc: ImageHit[] = []
  doc.descendants((node, pos) => {
    if (byId) return false
    if (node.type.name !== 'image') return true
    if (ref.blockId && node.attrs.id === ref.blockId && isImage(node)) byId = { pos, node }
    else if (node.attrs.src === ref.src) bySrc.push({ pos, node })
    return false
  })
  if (byId) return byId
  return bySrc.length === 1 ? bySrc[0] : null
}
