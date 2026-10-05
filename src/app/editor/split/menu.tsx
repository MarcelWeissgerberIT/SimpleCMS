/**
 * "Turn into page" in the block menu (Turn into → Page, or its own entry for blocks without a Turn into
 * list) and the bubble toolbar's Turn into list.
 */
import type { Editor } from '@tiptap/core'
import type { MenuEntry } from '../../ui/Menu'
import { shortcutLabel } from '../../ui/controls'
import type { Translate } from '@/shared/i18n'
import { BLOCKS } from '../lib/catalog'
import { BlockGlyph } from '../menus/SlashMenu'
import { readSplit, splitRange, type SplitRange } from './range'
import { SPLIT_SHORTCUT, turnIntoPage } from './split'

const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
const PAGE_ITEM = BLOCKS.find((b) => b.id === 'page')

/** How many blocks (or list items) a range moves (0: none). */
function countOf(editor: Editor, range: SplitRange | null): number {
  if (!range || editor.isDestroyed) return 0
  return readSplit(editor.state.doc, range)?.nodes.length ?? 0
}

/**
 * The entry: `inTurnInto` = inside a Turn into list ("Page", "Page · 3 blocks"), else on its own
 * ("Turn into page"). `range` = what moves (block menu: blockSplitRange), default the selection.
 */
export function splitMenuEntries(editor: Editor, t: Translate, opts: { range?: SplitRange | null; pageId?: string; inTurnInto?: boolean } = {}): MenuEntry[] {
  if (!editor.isEditable) return []
  const sel = editor.state.selection
  const range = opts.range !== undefined ? opts.range : splitRange(editor.state.doc, sel.from, sel.to)
  const n = countOf(editor, range)
  if (!n) return []
  const label = opts.inTurnInto ? (n > 1 ? t('editor.split.pageN', { n }) : t('editor.block.page')) : t('editor.split.toPage')
  return [
    ...(opts.inTurnInto ? [{ kind: 'separator' } as const] : []),
    {
      id: 'split-to-page',
      label,
      icon: PAGE_ITEM ? <BlockGlyph item={PAGE_ITEM} size={15} /> : undefined,
      hint: isTouch ? undefined : shortcutLabel(SPLIT_SHORTCUT),
      keywords: 'page subpage new page extract move seite unterseite neue seite auslagern verschieben',
      onSelect: () => void turnIntoPage(editor, { range, pageId: opts.pageId }),
    },
  ]
}
