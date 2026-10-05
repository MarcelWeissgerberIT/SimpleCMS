/**
 * The image toolbar's AI key: a mono "AI" / "KI" key that opens the image's Claude actions (describe,
 * read out the text, image → table, ask) — see menus/imageMenu.tsx.
 */
import type { Editor } from '@tiptap/core'
import { ChevronDown } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { imageAIEntries } from '../menus/imageMenu'
import './imageAI.css'

export function ImageAIKey({ editor, getPos }: { editor: Editor; getPos: () => number | undefined }) {
  const t = useT()
  const menu = useMenu()
  const pos = menu.open ? getPos() : undefined
  const entries: MenuEntry[] = typeof pos === 'number' ? [{ kind: 'section', label: t('features.ai.image.menu') }, ...imageAIEntries(editor, pos, t)] : []
  return (
    <>
      <button
        type="button"
        className="icon-btn icon-btn--sm image-view__ai"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t('features.ai.image.keyTitle')}
        title={t('features.ai.image.keyTitle')}
        data-testid="image-ai-key"
        onMouseDown={(e) => e.preventDefault()}
        onClick={menu.toggle}
      >
        <span className="image-view__ai-k">{t('features.ai.image.key')}</span>
        <ChevronDown size={10} strokeWidth={2} aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} placement="bottom-end" width={248} />
    </>
  )
}
