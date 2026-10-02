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
import { BlockSelection, ExtraInputRules, OnePlaceholder, shortcutsExtension } from './behaviors'
import { pasteExtension } from './paste'

export function editorExtensions({ bridge, readOnly = false }: { bridge: Bridge | null; readOnly?: boolean }): AnyExtension[] {
  const exts = baseExtensions({ readOnly, wrap: nodeViewWraps({ readOnly }) })
  if (readOnly || !bridge) return [...exts, pasteExtension(null)]
  return [
    ...exts,
    Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false, superscriptTwo: false, superscriptThree: false, laquo: false, raquo: false }),
    OnePlaceholder,
    Selection.configure({ className: 'selection' }),
    BlockSelection,
    ExtraInputRules,
    shortcutsExtension(bridge),
    pasteExtension(bridge),
    suggestExtension('slash', '/', bridge, { allowSpaces: true }),
    suggestExtension('mention', '@', bridge, { allowSpaces: true }),
    suggestExtension('emoji', ':', bridge, { minQueryLength: 1 }),
    FileHandler.configure({
      onPaste: (editor, files) => void uploadFiles(editor, files),
      onDrop: (editor, files, pos) => void uploadFiles(editor, files, pos),
    }),
  ]
}
