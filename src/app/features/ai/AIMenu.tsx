// STUB — replaced by the features area.
import type { Editor } from '@tiptap/core'
export interface AIMenuProps {
  editor: Editor
  pageId: string
  /** 'selection' = act on selected text; 'block' = free prompt at cursor ("Ask AI" / space on empty line) */
  mode: 'selection' | 'block'
  onClose: () => void
}
export function AIMenu(_props: AIMenuProps) {
  return null
}
