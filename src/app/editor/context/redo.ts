/**
 * "Redo with instructions" — the entry from anywhere (block menu, AI terminal): the picker on the page
 * with the purpose 'redo' (the selection or the given blocks pre-marked); on Done the page's AI panel
 * opens on the marked passages (features/ai: instructions, presets, rules page, the run, the review).
 */
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { ID } from '../../store/types'
import type { Bridge } from '../lib/bridge'
import { blockKey } from './read'
import { liveEditorOf } from './store'
import { openContextPicker, topBlockKeys } from './api'

const bridges = new WeakMap<Editor, Bridge>()

/** PageEditor: this editor's overlays (returns the release). */
export function registerBridge(editor: Editor, bridge: Bridge): () => void {
  bridges.set(editor, bridge)
  return () => {
    if (bridges.get(editor) === bridge) bridges.delete(editor)
  }
}

/** Open the AI panel of an editor on passages to redo (the caret goes to the first one). */
export function openRedoPanel(editor: Editor, ids: string[]): boolean {
  const bridge = bridges.get(editor)
  if (!bridge || editor.isDestroyed || !editor.isEditable || !ids.length) return false
  const want = new Set(ids)
  let first = -1
  editor.state.doc.forEach((node, pos, i) => {
    if (first < 0 && want.has(blockKey(node, i))) first = pos
  })
  if (first >= 0) {
    const { state } = editor
    const sel = TextSelection.near(state.doc.resolve(Math.min(first + 1, state.doc.content.size)))
    editor.view.dispatch(state.tr.setSelection(sel).setMeta('addToHistory', false))
    editor.view.focus()
  }
  bridge.setState({ ai: { mode: 'block', redo: ids } })
  return true
}

/**
 * The picker to mark passages to redo — pre-marked: `ids`, else the blocks the selection touches.
 * On Done (with passages) the AI panel opens on them. False: no editable editor for the page.
 */
export function startRedo(target: Editor | ID, opts: { ids?: string[] } = {}): boolean {
  const editor = typeof target === 'string' ? liveEditorOf(target) : target
  if (!editor || editor.isDestroyed || !editor.isEditable || !bridges.has(editor)) return false
  const { from, to } = editor.state.selection
  const ids = opts.ids ?? topBlockKeys(editor, from, to)
  return openContextPicker(editor, {
    purpose: 'redo',
    ids,
    onEnd: (done, marked) => {
      if (done && marked.length) requestAnimationFrame(() => openRedoPanel(editor, marked))
    },
  })
}
