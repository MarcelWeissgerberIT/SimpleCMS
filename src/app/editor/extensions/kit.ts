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
import { BlockFlash, BlockSelection, ExtraInputRules, OnePlaceholder, shortcutsExtension, TabTrap } from './behaviors'
import { pasteExtension } from './paste'

export function editorExtensions({
  bridge,
  readOnly = false,
  headingOffset = 0,
}: {
  bridge: Bridge | null
  readOnly?: boolean
  /** 1 under a page title (<h1>): heading blocks render as <h2>–<h4>. */
  headingOffset?: number
}): AnyExtension[] {
  const exts = baseExtensions({ readOnly, wrap: nodeViewWraps({ readOnly }), headingOffset })
  if (readOnly || !bridge) return [...exts, pasteExtension(null), BlockFlash]
  return [
    ...exts,
    Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false, superscriptTwo: false, superscriptThree: false, laquo: false, raquo: false }),
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
    // ":" only becomes a menu from two shortcode letters on — ":D", ":p", "1 :2" stay plain text
    suggestExtension('emoji', ':', bridge, { shouldShow: (q) => /^(?:[a-z][a-z0-9_+-]+|[+-]1|100)$/i.test(q) }),
    FileHandler.configure({
      onPaste: (editor, files) => void uploadFiles(editor, files),
      onDrop: (editor, files, pos) => void uploadFiles(editor, files, pos),
    }),
  ]
}
