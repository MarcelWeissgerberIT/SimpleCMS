/** Block menu entries of a video / audio block: replace the file, download it, copy a web link. */
import type { Editor } from '@tiptap/core'
import { Download, Link2, RefreshCw } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import type { BlockRef } from '../lib/blocks'
import { copyMediaLink, downloadMedia, mediaFileName, pickMediaFile } from '../lib/mediaSave'
import { safeMediaSrc, type MediaKind } from '../schema/media'

export function mediaMenuEntries(editor: Editor, ref: BlockRef, t: Translate): MenuEntry[] {
  const kind = ref.node.type.name as MediaKind
  if (kind !== 'video' && kind !== 'audio') return []
  const src = safeMediaSrc(ref.node.attrs.src)
  const out: MenuEntry[] = [{ label: t('editor.media.replace'), icon: <RefreshCw size={15} />, onSelect: () => void pickMediaFile(editor, ref.pos) }]
  if (src) out.push({ label: t('editor.media.download'), icon: <Download size={15} />, onSelect: () => void downloadMedia(src, mediaFileName(ref.node.attrs, kind)) })
  if (src && !src.startsWith('onefile:')) out.push({ label: t('editor.media.copyLink'), icon: <Link2 size={15} />, onSelect: () => void copyMediaLink(src) })
  return out
}
