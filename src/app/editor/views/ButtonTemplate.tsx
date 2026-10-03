/**
 * The small nested editor of an "Insert blocks" action: same schema, node views, markdown
 * shortcuts and slash menu as the page editor — minus page-bound blocks (sub-pages, databases,
 * mentions, AI) and buttons themselves.
 */
import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { createBridge } from '../lib/bridge'
import type { BlockItem } from '../lib/catalog'
import { templateExtensions } from '../extensions/kit'
import { sanitize } from '../convert'
import { SlashMenu } from '../menus/SlashMenu'
import { BubbleToolbar } from '../menus/BubbleToolbar'
import { EmojiMenu } from '../menus/EmojiMenu'
import '../editor.css'
import '../menus/menus.css'

const NOT_IN_TEMPLATES = new Set(['page', 'dbTable', 'dbBoard', 'dbList', 'dbGallery', 'dbCalendar', 'dbTimeline', 'dbChart', 'dbLinked', 'toc', 'mention', 'ai', 'button'])
const templateBlock = (item: BlockItem) => !NOT_IN_TEMPLATES.has(item.id)

export function TemplateEditor({
  content,
  onChange,
  pageId,
  label,
  onEditor,
}: {
  content: JSONContent[]
  onChange: (content: JSONContent[]) => void
  pageId: string | null
  label: string
  onEditor?: (editor: Editor) => void
}) {
  const bridge = useMemo(() => createBridge(), [])
  const extensions = useMemo(() => templateExtensions(bridge), [bridge])
  const initial = useMemo(() => sanitize({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editor = useEditor(
    {
      extensions,
      content: initial,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: 'doc-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label } },
      onUpdate: ({ editor: ed }) => onChangeRef.current(ed.getJSON().content ?? []),
    },
    [],
  )
  useEffect(() => {
    if (editor && !editor.isDestroyed) onEditor?.(editor)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="one-editor is-editable doc--small bcfg-template">
      <EditorContent editor={editor} />
      {editor && (
        <>
          <SlashMenu editor={editor} bridge={bridge} pageId={pageId ?? ''} filter={templateBlock} />
          <BubbleToolbar editor={editor} bridge={bridge} />
          <EmojiMenu editor={editor} bridge={bridge} />
        </>
      )}
    </div>
  )
}
