/** Everything that floats around an editable editor. */
import { memo } from 'react'
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import type { Bridge } from '../lib/bridge'
import { AIMenuSlot, AIRunsSlot } from '../lib/lazyAreas'
import { BlockHandle } from './BlockHandle'
import { SlashMenu } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import { EmojiMenu } from './EmojiMenu'
import { BubbleToolbar } from './BubbleToolbar'
import { UrlPasteMenu } from './UrlPasteMenu'
import { TableToolbar } from './TableToolbar'
import { LinkHover } from './LinkHover'
import { InlinePickers } from '../icons/InlinePickers'
import { useUI } from '../../store/ui'
import './menus.css'

function AI({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const ai = useStore(bridge, (s) => s.ai)
  if (!ai) return null
  const close = () => {
    bridge.setState({ ai: null })
    // keep typing where you were — unless the close came from focusing something else
    requestAnimationFrame(() => {
      const el = document.activeElement
      // ⌘K opening is what closed it: the palette keeps the focus. view.focus() acts now — commands.focus()
      // would wait another frame and could take the focus from a palette that opened in between
      if (useUI.getState().paletteOpen) return
      if (!editor.isDestroyed && (!el || el === document.body)) editor.view.focus()
    })
  }
  // passages to redo (block menu, AI terminal) / a form to transform the selection into (grip menu): a fresh panel on them
  const key = ai.redo ? `redo:${ai.redo.join(',')}` : ai.transform ? `transform:${ai.transform}` : 'ai'
  return <AIMenuSlot key={key} editor={editor} pageId={pageId} mode={ai.mode} redo={ai.redo} transform={ai.transform} onClose={close} />
}

export const EditorOverlays = memo(function EditorOverlays({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  return (
    <>
      <BlockHandle editor={editor} bridge={bridge} pageId={pageId} />
      <SlashMenu editor={editor} bridge={bridge} pageId={pageId} />
      <MentionMenu editor={editor} bridge={bridge} pageId={pageId} />
      <EmojiMenu editor={editor} bridge={bridge} />
      <InlinePickers editor={editor} bridge={bridge} />
      <BubbleToolbar editor={editor} bridge={bridge} />
      <UrlPasteMenu editor={editor} bridge={bridge} />
      <TableToolbar editor={editor} />
      <LinkHover editor={editor} bridge={bridge} />
      <AI editor={editor} bridge={bridge} pageId={pageId} />
      <AIRunsSlot editor={editor} pageId={pageId} />
    </>
  )
})
