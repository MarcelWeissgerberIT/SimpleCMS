/** Everything that floats around an editable editor. */
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import type { Bridge } from '../lib/bridge'
import { AIMenuSlot } from '../lib/lazyAreas'
import { BlockHandle } from './BlockHandle'
import { SlashMenu } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import { EmojiMenu } from './EmojiMenu'
import { BubbleToolbar } from './BubbleToolbar'
import { UrlPasteMenu } from './UrlPasteMenu'
import { TableToolbar } from './TableToolbar'
import './menus.css'

function AI({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const ai = useStore(bridge, (s) => s.ai)
  if (!ai) return null
  return <AIMenuSlot editor={editor} pageId={pageId} mode={ai.mode} onClose={() => bridge.setState({ ai: null })} />
}

export function EditorOverlays({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  return (
    <>
      <BlockHandle editor={editor} bridge={bridge} pageId={pageId} />
      <SlashMenu editor={editor} bridge={bridge} pageId={pageId} />
      <MentionMenu editor={editor} bridge={bridge} pageId={pageId} />
      <EmojiMenu editor={editor} bridge={bridge} />
      <BubbleToolbar editor={editor} bridge={bridge} />
      <UrlPasteMenu editor={editor} bridge={bridge} />
      <TableToolbar editor={editor} />
      <AI editor={editor} bridge={bridge} pageId={pageId} />
    </>
  )
}
