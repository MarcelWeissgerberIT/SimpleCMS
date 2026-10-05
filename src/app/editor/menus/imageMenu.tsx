/**
 * Claude for images, the editor side: the entries of an image block's "Claude" group — in the block menu
 * (⋮⋮) and behind the image toolbar's AI key. The work happens in features/ai/image (background runs).
 */
import type { Editor } from '@tiptap/core'
import { Captions, MessageSquareText, ScanText, Table2 } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import type { BlockRef } from '../lib/blocks'
import { askAboutImage, startImageAction, type ImageAction } from '../../features'

const ICONS = { describe: Captions, read: ScanText, table: Table2 } as const

/** Describe / Read out the text / Image → table / Ask about the image… for the image at `pos`. */
export function imageAIEntries(editor: Editor, pos: number, t: Translate): MenuEntry[] {
  // after the menu closed and handed the keyboard back: the AI panel takes it
  const later = (fn: () => void) => () => requestAnimationFrame(() => !editor.isDestroyed && fn())
  const act = (a: Exclude<ImageAction, 'ask'>): MenuEntry => {
    const Icon = ICONS[a]
    return { id: `img-ai-${a}`, label: t(`features.ai.image.act.${a}`), icon: <Icon size={15} />, keywords: 'claude ai ki', onSelect: later(() => startImageAction(editor, pos, a)) }
  }
  return [
    act('describe'),
    act('read'),
    act('table'),
    { id: 'img-ai-ask', label: t('features.ai.image.act.askMenu'), icon: <MessageSquareText size={15} />, keywords: 'claude ai ki question frage', onSelect: later(() => askAboutImage(editor, pos)) },
  ]
}

/** The block menu's "Claude" group of an image with a picture (editable pages only). */
export function imageMenuEntries(editor: Editor, ref: BlockRef, t: Translate): MenuEntry[] {
  if (ref.node.type.name !== 'image' || !ref.node.attrs.src || !editor.isEditable) return []
  return [{ kind: 'separator' }, { kind: 'section', label: t('features.ai.image.menu') }, ...imageAIEntries(editor, ref.pos, t)]
}
