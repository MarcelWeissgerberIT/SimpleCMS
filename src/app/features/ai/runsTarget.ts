/**
 * Where an AI-menu result goes — plain data, so a run can outlive its panel and its editor:
 *  - captureTarget(editor, mode): the selection (or the cursor block) when the menu opens.
 *  - mapTarget(target, mapping): through every change of the live editor.
 *  - reanchor(doc, target): for a re-created editor (the page was left and opened again): the text is
 *    checked at its old place, else looked for (a unique match is used), else the target is `lost` —
 *    no Replace, "Insert below" goes to the end of the page. Never a write into the wrong place.
 */
import type { Editor } from '@tiptap/core'
import type { Mapping } from '@tiptap/pm/transform'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { findBlockRange, type BlockRange } from './todb/plan'
import { transformRange } from './transform/range'

export interface RunTarget {
  mode: 'selection' | 'block'
  from: number
  to: number
  /** the selection as Markdown (selection mode) */
  selected: string
  /** the selection lies inside one textblock → inline replace */
  inlineOnly: boolean
  /** the cursor's own textblock (an empty one gets filled with the result) */
  blockFrom: number
  blockTo: number
  blockEmpty: boolean
  /** "Insert below": right after the target block, inside the callout / column / toggle it sits in */
  after: number
  /** document text before the cursor (for "continue") */
  before: string
  /** "Turn into database": the selection as whole blocks where a database block may go (null: not offered) */
  todb: BlockRange | null
  /** "Transform into": the selection as whole blocks of one container, or the one whole line selected (null: not offered; absent in runs saved before it) */
  range?: BlockRange | null
  /** the plain text the target covered (selection) / of the target block (block mode) — to find it again */
  anchor: string
  /** not found again in a re-created editor: Replace is off, Insert goes to the end of the page */
  lost?: boolean
}

/**
 * Nodes whose children are free-standing blocks — where a result may land as its own block.
 * Mirrors where the editor offers "Space for AI"; lists, quotes and tables count as one block.
 */
const BLOCK_CONTAINERS = new Set(['doc', 'column', 'callout', 'detailsContent'])

/** The position right after the block holding `$pos`, inside the nearest block container. */
export function afterBlock($pos: ResolvedPos): number {
  if (BLOCK_CONTAINERS.has($pos.parent.type.name)) return $pos.pos
  for (let d = $pos.depth; d >= 1; d--) if (BLOCK_CONTAINERS.has($pos.node(d - 1).type.name)) return $pos.after(d)
  return $pos.pos
}

/** Plain text of a range, the way targets are compared: textblocks separated by "\n", inline atoms as " ". */
export function plainBetween(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, '\n', ' ')
}

export function captureTarget(editor: Editor, wanted: 'selection' | 'block', toMarkdown: (from: number, to: number) => string): RunTarget {
  const { state } = editor
  const { from, to, empty } = state.selection
  const mode = wanted === 'selection' && !empty ? 'selection' : 'block'
  return targetAt(state.doc, mode, from, to, toMarkdown)
}

function targetAt(doc: PMNode, mode: 'selection' | 'block', from: number, to: number, toMarkdown?: (from: number, to: number) => string, keep?: RunTarget): RunTarget {
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  // the textblock the cursor is in — possibly deep inside a callout, column or toggle
  const inText = $from.depth >= 1 && $from.parent.isTextblock
  const blockFrom = inText ? $from.before() : from
  const blockTo = inText ? $from.after() : from
  const dbType = doc.type.schema.nodes.databaseBlock
  return {
    mode,
    from,
    to,
    selected: keep?.selected ?? (mode === 'selection' && toMarkdown ? toMarkdown(from, to) : ''),
    inlineOnly: $from.sameParent($to) && $from.parent.isTextblock,
    blockFrom,
    blockTo,
    blockEmpty: inText && $from.parent.content.size === 0,
    after: afterBlock(mode === 'selection' ? $to : $from),
    before: keep?.before ?? doc.textBetween(0, from, '\n\n', ' ').slice(-12000),
    todb: mode === 'selection' ? findBlockRange(doc, from, to, dbType) : null,
    range: mode === 'selection' ? transformRange(doc, from, to) : null,
    anchor: keep?.anchor ?? (mode === 'selection' ? plainBetween(doc, from, to) : plainBetween(doc, blockFrom, blockTo)),
  }
}

/** The target through a change of the live editor (the text typed meanwhile stays out of it). */
export function mapTarget(t: RunTarget, m: Mapping): RunTarget {
  const from = m.map(t.from, 1)
  const to = Math.max(from, m.map(t.to, -1))
  const blockFrom = m.map(t.blockFrom, 1)
  const mapRange = (r: BlockRange | null | undefined): BlockRange | null => {
    if (!r) return null
    const a = m.map(r.from, 1)
    const b = m.map(r.to, -1)
    return b > a ? { from: a, to: b } : null
  }
  // the selected text deleted meanwhile: nothing left to replace
  const lost = t.lost || (t.mode === 'selection' && to <= from)
  return { ...t, from, to, blockFrom, blockTo: Math.max(blockFrom, m.map(t.blockTo, -1)), after: m.map(t.after, -1), todb: mapRange(t.todb), range: mapRange(t.range), lost }
}

/** Is the target still where it was in this doc? */
export function targetHolds(doc: PMNode, t: RunTarget): boolean {
  const size = doc.content.size
  if (t.mode === 'selection') return t.from >= 0 && t.to <= size && t.from < t.to && plainBetween(doc, t.from, t.to) === t.anchor
  if (t.blockFrom < 0 || t.blockTo > size || t.blockFrom > t.blockTo) return false
  if (t.blockTo === t.blockFrom) return t.after >= 0 && t.after <= size && !t.anchor
  const node = doc.nodeAt(t.blockFrom)
  return !!node && node.isTextblock && node.nodeSize === t.blockTo - t.blockFrom && node.textContent === t.anchor
}

/** The target in a doc of a re-created editor: in place, found again (unique match), or lost. */
export function reanchor(doc: PMNode, t: RunTarget): RunTarget {
  if (targetHolds(doc, t)) return { ...t, lost: false }
  if (t.anchor.trim()) {
    const hit = findUnique(doc, t.anchor)
    if (hit) {
      if (t.mode === 'selection') return { ...targetAt(doc, 'selection', hit.from, hit.to, undefined, t), lost: false }
      const $p = doc.resolve(hit.from)
      if ($p.parent.isTextblock && $p.parent.textContent === t.anchor) return { ...targetAt(doc, 'block', $p.pos, $p.pos, undefined, t), lost: false }
    }
  }
  return { ...t, lost: true }
}

/** Flat text of the doc with the position of every character (the rules of textBetween(…, '\n', ' ')). */
function flatIndex(doc: PMNode): { text: string; pos: number[] } {
  let text = ''
  const pos: number[] = []
  let first = true
  doc.nodesBetween(0, doc.content.size, (node, p) => {
    const nodeText = node.isText ? (node.text ?? '') : node.isLeaf ? ' ' : ''
    if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock)) {
      if (first) first = false
      else {
        text += '\n'
        pos.push(p)
      }
    }
    for (let i = 0; i < nodeText.length; i++) {
      text += nodeText[i]
      pos.push(node.isText ? p + i : p)
    }
  })
  return { text, pos }
}

function findUnique(doc: PMNode, needle: string): { from: number; to: number } | null {
  const { text, pos } = flatIndex(doc)
  const i = text.indexOf(needle)
  if (i < 0 || text.indexOf(needle, i + 1) >= 0) return null
  const last = i + needle.length - 1
  const from = text[i] === '\n' ? pos[i] + 1 : pos[i]
  return { from, to: pos[last] + 1 }
}
