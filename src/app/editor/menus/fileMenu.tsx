/**
 * Claude for files, the editor side: the entries of a file block's "Claude" group — in the block menu (⋮⋮)
 * and behind the file block's AI key. By the file's kind: PDF → Summarise · Extract the text as a page ·
 * Extract the tables · Ask; Word / text / Markdown / HTML / RTF → Open as page · Summarise · Ask; CSV / TSV /
 * Excel → Import as database · Open as spreadsheet · Ask about the data. The work happens in
 * features/ai/file (background runs; the conversions stay on this device).
 */
import type { Editor } from '@tiptap/core'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import type { BlockRef } from '../lib/blocks'
import { askAboutFile, FILE_ACTION_ICONS, fileActionLabel, fileActionsFor, fileKindOf, isLocalFileAction, startFileAction } from '../../features'

/** The actions of the file block at `pos` ([] when it has no file One can work with). */
export function fileAIEntries(editor: Editor, pos: number, t: Translate): MenuEntry[] {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'fileBlock' || !String(node.attrs.src ?? '').trim()) return []
  const name = String(node.attrs.name ?? '')
  const kind = fileKindOf(name)
  // after the menu closed and handed the keyboard back: the AI panel takes it
  const later = (fn: () => void) => () => requestAnimationFrame(() => !editor.isDestroyed && fn())
  return fileActionsFor(name).map((a): MenuEntry => {
    const Icon = FILE_ACTION_ICONS[a]
    return {
      id: `file-ai-${a}`,
      label: fileActionLabel(t, a, kind, true),
      icon: <Icon size={15} />,
      keywords: 'claude ai ki file datei',
      // a conversion on this device: no Claude, nothing sent
      ...(isLocalFileAction(a) ? { hint: t('features.ai.file.localHint') } : {}),
      onSelect: later(() => (a === 'ask' ? askAboutFile(editor, pos) : startFileAction(editor, pos, a))),
    }
  })
}

/** The block menu's "Claude" group of a file block (editable pages only). */
export function fileMenuEntries(editor: Editor, ref: BlockRef, t: Translate): MenuEntry[] {
  if (ref.node.type.name !== 'fileBlock' || !editor.isEditable) return []
  const entries = fileAIEntries(editor, ref.pos, t)
  return entries.length ? [{ kind: 'separator' }, { kind: 'section', label: t('features.ai.file.menu') }, ...entries] : []
}
