// STUB — replaced by the editor area.
import type { JSONContent } from '@tiptap/core'
import { plainText } from '../store/store'

export function ReadOnlyDoc({ content }: { content: JSONContent | null; className?: string }) {
  return <div style={{ whiteSpace: 'pre-wrap' }}>{plainText(content)}</div>
}
