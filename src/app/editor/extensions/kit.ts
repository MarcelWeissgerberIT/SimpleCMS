/** Full extension list for the live editor (schema + node views + interactions). */
import type { AnyExtension } from '@tiptap/core'
import Typography from '@tiptap/extension-typography'
import FileHandler from '@tiptap/extension-file-handler'
import { Selection } from '@tiptap/extensions'
import { baseExtensions } from '../schema/base'
import type { Bridge } from '../lib/bridge'
import { uploadFiles } from '../lib/upload'
import { nodeViewWraps } from '../views'
import { suggestExtension } from './suggest'
import { BlockFlash, BlockSelection, ExtraInputRules, OnePlaceholder, QuietStart, shortcutsExtension, TabTrap } from './behaviors'
import { commentsExtension } from '../comments/plugin'
import { pasteExtension } from './paste'
import { ButtonKeys } from '../schema/button'
import { MediaKeys } from '../schema/media'
import type { ContentDocHandle } from '../../cloud'
import { collabExtensions } from '../collab'

const typography = () =>
  Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false, superscriptTwo: false, superscriptThree: false, laquo: false, raquo: false })

/** ":" only becomes a menu from two shortcode letters on — ":D", ":p", "1 :2" stay plain text */
const emojiQuery = (q: string) => /^(?:[a-z][a-z0-9_+-]+|[+-]1|100)$/i.test(q)

export function editorExtensions({
  bridge,
  readOnly = false,
  headingOffset = 0,
  collab,
}: {
  bridge: Bridge | null
  readOnly?: boolean
  /** 1 under a page title (<h1>): heading blocks render as <h2>–<h4>. */
  headingOffset?: number
  /** Team cloud: bind to the page's content document (live collaboration, Y undo, carets). */
  collab?: ContentDocHandle
}): AnyExtension[] {
  const exts = baseExtensions({ readOnly, wrap: nodeViewWraps({ readOnly }), headingOffset, collab: !!collab })
  if (readOnly || !bridge) return [...exts, pasteExtension(null), BlockFlash, QuietStart, ...(collab ? collabExtensions(collab) : [])]
  return [
    ...(collab ? collabExtensions(collab) : []),
    ...exts,
    typography(),
    OnePlaceholder,
    Selection.configure({ className: 'selection' }),
    BlockSelection,
    BlockFlash,
    ExtraInputRules,
    shortcutsExtension(bridge),
    TabTrap,
    pasteExtension(bridge),
    suggestExtension('slash', '/', bridge, { allowSpaces: true }),
    suggestExtension('mention', '@', bridge, { allowSpaces: true }),
    suggestExtension('emoji', ':', bridge, { shouldShow: emojiQuery }),
    ButtonKeys,
    MediaKeys,
    commentsExtension(bridge),
    QuietStart,
    FileHandler.configure({
      onPaste: (editor, files) => void uploadFiles(editor, files),
      onDrop: (editor, files, pos) => void uploadFiles(editor, files, pos),
    }),
  ]
}

/**
 * The nested editor of a button's "Insert blocks" action: same schema and node views, markdown
 * shortcuts, slash + emoji menus. No buttons inside buttons, no page-bound shortcuts (Space → AI,
 * block menu), and Tab leaves the field like in any other form control.
 */
export function templateExtensions(bridge: Bridge): AnyExtension[] {
  const exts = baseExtensions({ wrap: nodeViewWraps({ readOnly: false }) }).filter((e) => e.name !== 'button')
  return [
    ...exts,
    typography(),
    OnePlaceholder,
    Selection.configure({ className: 'selection' }),
    BlockFlash,
    ExtraInputRules,
    pasteExtension(bridge),
    suggestExtension('slash', '/', bridge, { allowSpaces: true }),
    suggestExtension('emoji', ':', bridge, { shouldShow: emojiQuery }),
    FileHandler.configure({
      onPaste: (editor, files) => void uploadFiles(editor, files),
      onDrop: (editor, files, pos) => void uploadFiles(editor, files, pos),
    }),
  ]
}
