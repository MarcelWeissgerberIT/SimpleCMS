/** Static, non-editable render of a doc with the exact editor look (share view, history preview, presentation). */
import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { editorExtensions } from './extensions/kit'
import { sanitize } from './convert'
import './editor.css'

const EMPTY: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function ReadOnlyDoc({ content, className }: { content: JSONContent | null; className?: string }) {
  const extensions = useMemo(() => editorExtensions({ bridge: null, readOnly: true }), [])
  const editor = useEditor(
    {
      extensions,
      content: content ? sanitize(content) : EMPTY,
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: 'doc-content' } },
    },
    [],
  )
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (editor && !editor.isDestroyed) editor.commands.setContent(content ? sanitize(content) : EMPTY, { emitUpdate: false })
  }, [editor, content])
  return (
    <div className={`one-doc ${className ?? ''}`}>
      <EditorContent editor={editor} />
    </div>
  )
}
