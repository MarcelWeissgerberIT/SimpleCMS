/**
 * Which blocks "Transform into" works on, and which forms may go there.
 *
 *  - transformRange(doc, from, to): the selection as whole blocks of one container — like "Turn into
 *    database" (a list or a table goes as a whole) — or, for a selection of one whole line, that line's
 *    block. null: nothing to transform (inside a table cell, a quote, a code block, a few words of a line).
 *  - fitsAt(doc, range): the forms that may replace those blocks (no columns inside a column, no tabs inside
 *    a tab, a database only where a database block may go).
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { findBlockRange, type BlockRange } from '../todb/plan'
import { TRANSFORM_TYPES, type TransformType } from './types'

/** Nodes whose children are free-standing blocks (where a whole line can be transformed). */
const CONTAINERS = new Set(['doc', 'column', 'callout', 'detailsContent', 'tab'])

export function transformRange(doc: PMNode, from: number, to: number): BlockRange | null {
  if (from >= to || from < 0 || to > doc.content.size) return null
  const paragraph = doc.type.schema.nodes.paragraph
  const blocks = findBlockRange(doc, from, to, paragraph)
  if (blocks) return blocks
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  // one whole line: its block (a few words of a line are for the text actions)
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null
  const text = $from.parent.textContent.replace(/\s+/g, ' ').trim()
  if (!text || doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim() !== text) return null
  const d = $from.depth
  if (d < 1 || !CONTAINERS.has($from.node(d - 1).type.name)) return null
  return { from: $from.before(d), to: $from.after(d) }
}

const none = (): Record<TransformType, boolean> => Object.fromEntries(TRANSFORM_TYPES.map((x) => [x, false])) as Record<TransformType, boolean>

/** The forms that may go in place of the blocks at `range`. */
export function fitsAt(doc: PMNode, range: BlockRange | null): Record<TransformType, boolean> {
  if (!range || range.from < 0 || range.to > doc.content.size || range.from >= range.to) return none()
  const $a = doc.resolve(range.from)
  const $b = doc.resolve(range.to)
  if (!$a.sameParent($b) || $a.parent.inlineContent) return none()
  const parent = $a.parent
  const start = $a.index()
  const end = $b.index()
  const nodes = doc.type.schema.nodes
  const can = (name: string) => !!nodes[name] && parent.canReplaceWith(start, end, nodes[name])
  const inside = (name: string) => {
    for (let d = $a.depth; d >= 0; d--) if ($a.node(d).type.name === name) return true
    return false
  }
  const db = can('databaseBlock')
  const cols = can('columns') && !inside('column')
  return {
    board: db,
    table: db,
    timeline: db,
    diagram: can('mermaid'),
    chart: can('chart'),
    columns: cols,
    cards: cols && can('callout'),
    tabs: can('tabs') && !inside('tab'),
    toggles: can('details'),
  }
}

/** The forms that fit, in menu order. */
export const fittingTypes = (fits: Record<TransformType, boolean>): TransformType[] => TRANSFORM_TYPES.filter((x) => fits[x])
