/** Block menu entry of a Mermaid diagram: Open large (the diagram viewer — zoom, pan, minimap, SVG). */
import type { Editor } from '@tiptap/core'
import { Maximize2 } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import type { BlockRef } from '../lib/blocks'
import { openMermaidViewer } from '../lib/mermaid'

export function diagramMenuEntries(editor: Editor, ref: BlockRef, t: Translate): MenuEntry[] {
  if (ref.node.type.name !== 'mermaid') return []
  const code = String(ref.node.attrs.code ?? '')
  if (!code.trim()) return []
  return [
    {
      id: 'block-open-large',
      label: t('ui.viewer.open'),
      icon: <Maximize2 size={15} />,
      keywords: 'zoom viewer minimap groß vergrößern',
      // after the menu closed and handed the caret back: the viewer returns focus there
      onSelect: () => requestAnimationFrame(() => !editor.isDestroyed && openMermaidViewer(code)),
    },
  ]
}
