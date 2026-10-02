// STUB — replaced by the editor area.
import type { Editor } from '@tiptap/core'
import type { ID } from '../store/types'
import { usePage } from '../store/selectors'

export interface PageEditorProps {
  pageId: ID
  readOnly?: boolean
  autoFocus?: boolean
  /** Called with the TipTap editor instance once created. */
  onReady?: (editor: Editor) => void
  className?: string
}

export function PageEditor({ pageId }: PageEditorProps) {
  const page = usePage(pageId)
  return <div className="faint">[editor stub] {page?.plain}</div>
}
