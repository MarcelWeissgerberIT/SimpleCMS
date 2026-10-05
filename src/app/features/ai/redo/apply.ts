/**
 * "Redo with instructions" — applying the accepted passages: a version snapshot first, then ONE editor
 * transaction for all of them (one ⌘Z brings everything back). A passage is found by its block id —
 * wherever edits moved it — and replaced only while its text is still the one Claude read; a passage
 * edited (or deleted) meanwhile is reported as changed and left alone.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { snapshotNow } from '../../history/snapshots'
import type { ID } from '../../../store/types'
import { passageBlocks, type RedoPassage } from './passages'

export interface RedoApplyItem {
  passage: RedoPassage
  after: string
}

export interface RedoApplyResult {
  applied: number[]
  changed: number[]
}

const plainOf = (node: PMNode) => node.textBetween(0, node.content.size, '\n', ' ')

/** Where a passage's block is now (top level, by id), when its text is still the one that was read. */
function locate(doc: PMNode, p: RedoPassage): { pos: number; node: PMNode } | 'changed' {
  let hit: { pos: number; node: PMNode } | null = null
  doc.forEach((node, pos, i) => {
    if (hit) return
    const key = typeof node.attrs.id === 'string' && node.attrs.id ? node.attrs.id : `#${i}`
    if (key === p.key) hit = { pos, node }
  })
  if (!hit) return 'changed'
  const found = hit as { pos: number; node: PMNode }
  return found.node.type.name === p.type && plainOf(found.node) === p.anchor ? found : 'changed'
}

export async function applyRedo(editor: Editor, pageId: ID, items: RedoApplyItem[]): Promise<RedoApplyResult> {
  const res: RedoApplyResult = { applied: [], changed: [] }
  if (!items.length || editor.isDestroyed) return res
  await snapshotNow(pageId, 'ai')
  if (editor.isDestroyed) return { applied: [], changed: items.map((x) => x.passage.n) }
  const { state } = editor
  const schema = state.schema
  const spots: Array<{ pos: number; node: PMNode; nodes: PMNode[]; n: number }> = []
  for (const it of items) {
    const at = locate(state.doc, it.passage)
    if (at === 'changed') {
      res.changed.push(it.passage.n)
      continue
    }
    try {
      const blocks = passageBlocks(it.after, it.passage, at.node.toJSON() as JSONContent)
      const nodes = blocks.map((b) => schema.nodeFromJSON(b))
      nodes.forEach((n) => n.check())
      if (!nodes.length) throw new Error('empty')
      spots.push({ pos: at.pos, node: at.node, nodes, n: it.passage.n })
    } catch {
      res.changed.push(it.passage.n)
    }
  }
  if (!spots.length) return res
  // from the end of the page backwards: earlier positions stay valid
  spots.sort((a, b) => b.pos - a.pos)
  const tr = closeHistory(state.tr)
  for (const s of spots) tr.replaceWith(s.pos, s.pos + s.node.nodeSize, Fragment.fromArray(s.nodes))
  editor.view.dispatch(tr.scrollIntoView())
  res.applied = spots.map((s) => s.n).sort((a, b) => a - b)
  return res
}
