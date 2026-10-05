/**
 * The file block's AI key: a mono "AI" / "KI" key in its toolbar (the compact card, the PDF viewer's bar,
 * a web PDF's card) that opens the file's actions — Claude's and the local conversions (menus/fileMenu.tsx).
 * Shown only on editable pages and for files One can work with.
 */
import type { Editor } from '@tiptap/core'
import { ChevronDown } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { fileActionsFor } from '../../features'
import { fileAIEntries } from '../menus/fileMenu'
import './fileAI.css'

export function FileAIKey({ editor, getPos, name, ghost }: { editor: Editor; getPos: () => number | undefined; name: string; ghost?: boolean }) {
  const t = useT()
  const menu = useMenu()
  if (!editor.isEditable || !fileActionsFor(name).length) return null
  const pos = menu.open ? getPos() : undefined
  const entries: MenuEntry[] = typeof pos === 'number' ? [{ kind: 'section', label: t('features.ai.file.menu') }, ...fileAIEntries(editor, pos, t)] : []
  return (
    <>
      <button
        type="button"
        className={`btn btn--sm${ghost ? ' btn--ghost' : ''} file-ai-key`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t('features.ai.file.keyTitle')}
        title={t('features.ai.file.keyTitle')}
        data-testid="file-ai-key"
        onMouseDown={(e) => e.preventDefault()}
        onClick={menu.toggle}
      >
        <span className="file-ai-key__k">{t('features.ai.file.key')}</span>
        <ChevronDown size={10} strokeWidth={2} aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} placement="bottom-end" width={264} />
    </>
  )
}
