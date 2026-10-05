/**
 * The block menu's "Redo with instructions…": the redo picker with this block's top-level block
 * pre-marked (more passages can be marked there); on Done the AI panel opens on the passages.
 */
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { ReplaceAll } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import type { BlockRef } from '../lib/blocks'
import { topBlockKeys } from './api'
import { startRedo } from './redo'

/** Blocks with text a rewrite can work on. */
const TEXTUAL = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'details', 'codeBlock', 'table'])

export function redoBlockMenuEntries(editor: Editor, ref: BlockRef, t: Translate): MenuEntry[] {
  if (!TEXTUAL.has(ref.node.type.name) || !editor.isEditable) return []
  return [
    {
      label: t('editor.blockMenu.redo'),
      icon: <ReplaceAll size={15} />,
      onSelect: () => {
        const ids = topBlockKeys(editor, ref.pos, ref.pos + ref.node.nodeSize)
        // after the menu closed and handed the caret back: the picker takes the keyboard (the block's
        // selection gives way to a caret in it — the picker's marks show the passages)
        requestAnimationFrame(() => {
          if (editor.isDestroyed) return
          const { state } = editor
          const at = Math.min(ref.pos + 1, state.doc.content.size)
          editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))).setMeta('addToHistory', false))
          startRedo(editor, { ids })
        })
      },
    },
  ]
}
