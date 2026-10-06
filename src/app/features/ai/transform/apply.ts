/**
 * "Transform" — the result into the page, in ONE transaction after a version snapshot (origin 'ai'):
 * the new block where the first consumed block was, kept blocks stay where they were, the lines Claude
 * could not place stay as text right under it, and — "Keep the original below" — the consumed blocks in a
 * collapsed toggle after that. ⌘Z brings the text back in one step.
 * Board / Table / Timeline go through "Turn into database" (todb/run convertToDatabase: placement inline |
 * own page, its own toast + Undo). Without a range (the text changed meanwhile) the result goes to the end
 * of the page and every block stays.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { t } from '../../../i18n'
import { snapshotNow } from '../../history/snapshots'
import type { BlockRange } from '../todb/plan'
import { convertToDatabase, originalToggle, sameBlocks, TodbError } from '../todb/run'
import { leftBlocks, resultBlocks } from './build'
import { applyFreeBoard } from '../freeboard/apply'
import { typeLabel } from './forms'
import { shownResult, type TransformState } from './types'

/** Put the shown result in place of `range` (null: at the end of the page). Throws TodbError. */
export async function applyTransform(editor: Editor, pageId: ID, range: BlockRange | null, state: TransformState): Promise<void> {
  const res = shownResult(state)
  const type = state.shown
  if (!res || !type) throw new TodbError('bad')
  const original = state.opts.keepOriginal ? t('features.ai.transform.original') : null
  if (res.type === 'db') {
    // the form is the view (a board without a group column / a timeline without dates opens as a table)
    const view = type === 'timeline' ? 'timeline' : type === 'board' ? 'board' : 'table'
    await convertToDatabase(editor, pageId, range, res.table, { ...res.table.draft, view }, { original })
    return
  }

  if (res.type === 'freeboard') {
    await applyFreeBoard(editor, pageId, range, res, { original })
    return
  }

  if (editor.isDestroyed) throw new TodbError('gone')
  if (range && !sameBlocks(editor.state.doc, range, res.blocks)) throw new TodbError('changed')
  await snapshotNow(pageId, 'ai')
  if (editor.isDestroyed) throw new TodbError('gone')
  const at = range ? sameBlocks(editor.state.doc, range, res.blocks) : null
  if (range && !at) throw new TodbError('changed')
  const ws = useWorkspace.getState()
  if (!ws.pages[pageId] || ws.pages[pageId].trashed) throw new TodbError('gone')

  let made: PMNode[]
  try {
    made = [...resultBlocks(res, state.opts), ...leftBlocks(res)].map((json: JSONContent) => editor.schema.nodeFromJSON(json))
    made.forEach((n) => n.check())
  } catch {
    throw new TodbError('bad')
  }
  if (!made.length) throw new TodbError('bad')

  let tr = closeHistory(editor.state.tr)
  let pos: number
  if (at) {
    // the range, block for block: kept ones as they are, the new block(s) where the first consumed one was
    const keep = new Set(res.keep)
    const consumed: PMNode[] = []
    const nodes: PMNode[] = []
    let first = -1
    at.nodes.forEach((node, i) => {
      if (keep.has(i)) return void nodes.push(node)
      if (first < 0) first = nodes.length
      consumed.push(node)
    })
    if (first < 0) first = nodes.length
    const toggle = original && consumed.length ? originalToggle(editor, original, consumed) : null
    nodes.splice(first, 0, ...made, ...(toggle ? [toggle] : []))
    const content = Fragment.from(nodes)
    if (!at.parent.canReplace(at.start, at.end, content)) throw new TodbError('changed')
    tr = tr.replaceWith(at.from, at.to, content)
    pos = at.from + nodes.slice(0, first).reduce((n, x) => n + x.nodeSize, 0)
  } else {
    pos = tr.doc.content.size
    tr = tr.insert(pos, Fragment.from(made))
  }
  const end = pos + made.reduce((n, x) => n + x.nodeSize, 0)
  // the caret right after the new block (never a node selection: typing would replace it)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  const after = editor.state.doc

  useUI.getState().toast({
    message: t('features.ai.transform.done', { type: typeLabel(type) }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        if (editor.isDestroyed) return
        if (editor.state.doc.eq(after)) editor.commands.undo()
        else useUI.getState().toast({ message: t('features.ai.transform.undoLate'), kind: 'info' })
      },
    },
  })
}
