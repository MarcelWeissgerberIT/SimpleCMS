/** Static, non-editable render of a doc with the exact editor look (share view, history preview, presentation). */
import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { editorExtensions } from './extensions/kit'
import { sanitize } from './convert'
import './editor.css'

const EMPTY: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * `headingOffset`: pass 1 when the doc sits under its own page-title <h1> (share view) so heading
 * blocks render as <h2>–<h4>; the default 0 keeps <h1>–<h3> (slides, previews, AI answers).
 */
export function ReadOnlyDoc({ content, className, headingOffset = 0 }: { content: JSONContent | null; className?: string; headingOffset?: number }) {
  const extensions = useMemo(() => editorExtensions({ bridge: null, readOnly: true, headingOffset }), [headingOffset])
  const editor = useEditor(
    {
      extensions,
      content: content ? sanitize(content) : EMPTY,
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: 'doc-content' } },
    },
    [extensions],
  )
  // consumers often pass a fresh object per render: only re-render the doc when it really changed
  const key = useMemo(() => (content ? JSON.stringify(content) : ''), [content])
  const shown = useRef(key)
  useEffect(() => {
    if (key === shown.current) return
    shown.current = key
    if (editor && !editor.isDestroyed) editor.commands.setContent(content ? sanitize(content) : EMPTY, { emitUpdate: false })
  }, [editor, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`one-doc ${className ?? ''}`}>
      <EditorContent editor={editor} />
    </div>
  )
}
