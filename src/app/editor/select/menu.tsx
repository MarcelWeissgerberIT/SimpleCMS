/**
 * The block menu for SEVERAL selected blocks (one grip, one menu): Turn into (when all are text),
 * Colour, Turn into page, Turn into database… (opens the AI panel on them), Transform into → a form (the AI
 * panel on them, transforming at once — features/ai/transform), Redo with instructions…,
 * Duplicate, Copy link (first block), Move to, Delete — each action one transaction.
 */
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { ArrowRightLeft, Copy, Link, Paintbrush, ReplaceAll, Repeat2, Shapes, SquareKanban, Trash2 } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import { transformChoicesAt, TRANSFORM_ICONS, type TransformPick } from '../../features'
import { shortcutLabel } from '../../ui/controls'
import { toast } from '../../store/ui'
import { pageHref } from '../../lib/router'
import type { Bridge } from '../lib/bridge'
import { TURN_INTO_ITEMS } from '../lib/catalog'
import { BlockGlyph } from '../menus/SlashMenu'
import { ColorGrid } from '../menus/BubbleToolbar'
import { topBlockKeys } from '../context/api'
import { startRedo } from '../context/redo'
import { splitMenuEntries } from '../split/menu'
import { colorBlocks, colorsOf, deleteBlocks, duplicateBlocks, fresh, turnBlocksInto } from './actions'
import type { BlockSel } from './model'

const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
/** Blocks "Turn into" converts as a group (their text changes type). */
const TEXT_LIKE = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'])
/** Blocks with text a rewrite / colour can work on. */
const HAS_TEXT = new Set([...TEXT_LIKE, 'callout', 'details', 'codeBlock', 'table'])

export interface SelectionMenuContext {
  pageId: string
  bridge: Bridge
  /** "Move to": the page picker (the block menu's own popover) */
  onMoveTo: () => void
}

/** The AI panel on the selected blocks, transforming them into `pick` at once. */
function transformWith(editor: Editor, b: BlockSel, ctx: SelectionMenuContext, pick: TransformPick) {
  const at = fresh(editor, b)
  if (!at) return
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return
    const { state } = editor
    editor.view.dispatch(state.tr.setSelection(TextSelection.between(state.doc.resolve(at.from), state.doc.resolve(at.to))))
    ctx.bridge.setState({ ai: { mode: 'selection', transform: pick } })
  })
}

export function selectionMenuEntries(editor: Editor, b: BlockSel, t: Translate, ctx: SelectionMenuContext): MenuEntry[] {
  const n = b.nodes.length
  const names = b.nodes.map((x) => x.type.name)
  const allText = names.every((x) => TEXT_LIKE.has(x))
  const someText = names.some((x) => HAS_TEXT.has(x))
  const colors = colorsOf(b)
  const items: MenuEntry[] = [{ kind: 'section', label: t('editor.select.blocks', { n }) }]
  if (allText)
    items.push({
      label: t('editor.blockMenu.turnInto'),
      icon: <Repeat2 size={15} />,
      submenu: [
        ...TURN_INTO_ITEMS.map((x) => ({
          label: t(`editor.block.${x.id}`),
          icon: <BlockGlyph item={x} size={15} />,
          hint: x.md,
          onSelect: () => void turnBlocksInto(editor, b, x.turnInto!),
        })),
        ...splitMenuEntries(editor, t, { range: { from: b.from, to: b.to }, pageId: ctx.pageId, inTurnInto: true }),
      ],
    })
  else items.push(...splitMenuEntries(editor, t, { range: { from: b.from, to: b.to }, pageId: ctx.pageId }))
  if (someText)
    items.push({
      label: t('editor.blockMenu.color'),
      icon: <Paintbrush size={15} />,
      submenu: [
        {
          kind: 'custom',
          render: () => <ColorGrid text={colors.text} bg={colors.bg} onText={(c) => void colorBlocks(editor, b, 'text', c)} onBg={(c) => void colorBlocks(editor, b, 'bg', c)} />,
        },
      ],
    })
  if (someText) {
    items.push({
      label: t('editor.select.todb'),
      icon: <SquareKanban size={15} />,
      hint: 'AI',
      keywords: 'database board table datenbank tabelle ai ki',
      // the AI panel on these blocks: "Turn into database" (Claude) is its Structure action
      onSelect: () => {
        const at = fresh(editor, b)
        if (!at) return
        requestAnimationFrame(() => {
          if (editor.isDestroyed) return
          const { state } = editor
          editor.view.dispatch(state.tr.setSelection(TextSelection.between(state.doc.resolve(at.from), state.doc.resolve(at.to))))
          ctx.bridge.setState({ ai: { mode: 'selection' } })
        })
      },
    })
    // "Transform into" (Claude): one selection → one form, the AI panel previews it first
    const picks = transformChoicesAt(editor.state.doc, b.from, b.to)
    if (picks.length)
      items.push({
        label: t('editor.select.transform'),
        icon: <Shapes size={15} />,
        hint: 'AI',
        keywords: 'transform diagram chart columns tabs toggles cards timeline verwandeln schaubild diagramm spalten karten zeitleiste ai ki',
        submenu: picks.map((pick) => {
          const Icon = TRANSFORM_ICONS[pick]
          return { label: t(`features.ai.transform.type.${pick}`), icon: <Icon size={15} />, onSelect: () => transformWith(editor, b, ctx, pick) }
        }),
      })
    items.push({
      label: t('editor.blockMenu.redo'),
      icon: <ReplaceAll size={15} />,
      onSelect: () => {
        const ids = topBlockKeys(editor, b.from, b.to)
        requestAnimationFrame(() => {
          if (editor.isDestroyed) return
          const { state } = editor
          editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(b.from + 1, state.doc.content.size)))).setMeta('addToHistory', false))
          startRedo(editor, { ids })
        })
      },
    })
  }
  items.push(
    { kind: 'separator' },
    { label: t('common.duplicate'), icon: <Copy size={15} />, hint: isTouch ? undefined : shortcutLabel('Mod+D'), onSelect: () => void duplicateBlocks(editor, b) },
    {
      label: t('editor.blockMenu.copyLink'),
      icon: <Link size={15} />,
      onSelect: async () => {
        const id = b.nodes[0]?.attrs.id as string | undefined
        const url = `${location.origin}${location.pathname}${pageHref(ctx.pageId, id)}`
        try {
          await navigator.clipboard.writeText(url)
          toast({ message: t('editor.blockMenu.linkCopied'), kind: 'success' })
        } catch {
          toast({ message: url })
        }
      },
    },
    { label: t('editor.blockMenu.moveTo'), icon: <ArrowRightLeft size={15} />, keepOpen: true, onSelect: ctx.onMoveTo },
    { kind: 'separator' },
    { label: t('common.delete'), icon: <Trash2 size={15} />, hint: isTouch ? undefined : 'Del', danger: true, onSelect: () => void deleteBlocks(editor, b) },
  )
  return items
}
