import type { Editor } from '@tiptap/core'
import { bridgeOf } from '../context/redo'
import type { DrawingMode } from './model'

export function openDrawing(editor: Editor, blockId?: string, mode?: DrawingMode): void {
  if (!editor.isDestroyed && editor.isEditable) bridgeOf(editor)?.setState({ drawing: { blockId, mode } })
}
