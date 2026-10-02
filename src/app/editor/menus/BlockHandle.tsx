/**
 * Gutter handle: "+" inserts a block below and opens the slash menu, "⋮⋮" drags the block
 * or opens the block menu (Turn into, Colour, Duplicate, Copy link, Move to, Delete).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { ArrowRightLeft, Copy, GripVertical, Link, Paintbrush, Plus, Repeat2, Trash2 } from 'lucide-react'
import { Menu, MenuList, type MenuEntry } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { shortcutLabel } from '../../ui/controls'
import { useWorkspace } from '../../store/store'
import { pageTitle, sortPages } from '../../store/selectors'
import { toast } from '../../store/ui'
import { openPage, pageHref } from '../../lib/router'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { blockTextRange, deleteBlock, duplicateBlock, turnInto, type BlockRef } from '../lib/blocks'
import { TURN_INTO_ITEMS } from '../lib/catalog'
import { BlockGlyph } from './SlashMenu'
import { ColorGrid } from './BubbleToolbar'

const TEXTUAL = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'details', 'codeBlock'])
const NESTED = { edgeDetection: 'left' as const, rules: [{ id: 'noColumn', evaluate: ({ node }: { node: PMNode }) => (node.type.name === 'column' || node.type.name === 'detailsSummary' || node.type.name === 'detailsContent' ? 1000 : 0) }] }

const TYPE_LABEL: Record<string, string> = {
  paragraph: 'text',
  heading: 'heading',
  bulletList: 'bullet',
  orderedList: 'numbered',
  taskList: 'todo',
  listItem: 'bullet',
  taskItem: 'todo',
  blockquote: 'quote',
  callout: 'callout',
  details: 'toggle',
  codeBlock: 'code',
  horizontalRule: 'divider',
  image: 'image',
  table: 'table',
  columns: 'columns2',
  blockMath: 'math',
  mermaid: 'mermaid',
  pageLink: 'page',
  databaseBlock: 'dbTable',
  bookmark: 'bookmark',
  embed: 'embed',
  toc: 'toc',
  fileBlock: 'file',
}

function blockLabelKey(node: PMNode): string {
  if (node.type.name === 'heading') return `editor.block.heading${node.attrs.level}`
  return `editor.block.${TYPE_LABEL[node.type.name] ?? 'text'}`
}

export function BlockHandle({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const current = useRef<BlockRef | null>(null)
  const [kind, setKind] = useState<string>('paragraph')
  const [menu, setMenu] = useState<{ el: HTMLElement; ref: BlockRef } | null>(null)
  const [moveFor, setMoveFor] = useState<{ el: HTMLElement; ref: BlockRef } | null>(null)

  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
    current.current = node && pos >= 0 ? { node, pos } : null
    if (node) setKind(node.type.name === 'heading' ? `h${node.attrs.level}` : node.type.name)
  }, [])

  const plus = (e: React.MouseEvent) => {
    const ref = current.current
    if (!ref) return
    const { state, view } = editor
    const node = state.doc.nodeAt(ref.pos)
    if (!node) return
    const above = e.altKey
    let tr = state.tr
    let caret: number
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      caret = ref.pos + 1
    } else {
      const at = above ? ref.pos : ref.pos + node.nodeSize
      tr = tr.insert(at, state.schema.nodes.paragraph.create())
      caret = at + 1
    }
    tr.setSelection(TextSelection.create(tr.doc, caret))
    view.dispatch(tr)
    view.focus()
    bridge.setState({ plusOpened: true })
    editor.commands.insertContent('/')
  }

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    const ref = current.current
    if (!ref) return
    const node = editor.state.doc.nodeAt(ref.pos)
    if (!node) return
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, ref.pos)))
    editor.commands.lockDragHandle()
    setMenu({ el: e.currentTarget, ref: { node, pos: ref.pos } })
  }

  const closeMenu = () => {
    setMenu(null)
    editor.commands.unlockDragHandle()
  }

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return []
    const { ref } = menu
    const node = ref.node
    const textual = TEXTUAL.has(node.type.name)
    const caretInto = () => {
      const $ = editor.state.doc.resolve(Math.min(ref.pos + 1, editor.state.doc.content.size))
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($)))
    }
    const range = blockTextRange(ref)
    const items: MenuEntry[] = [{ kind: 'section', label: t(blockLabelKey(node)) }]
    if (textual)
      items.push({
        label: t('editor.blockMenu.turnInto'),
        icon: <Repeat2 size={15} />,
        submenu: TURN_INTO_ITEMS.map((b) => ({
          label: t(`editor.block.${b.id}`),
          icon: <BlockGlyph item={b} size={15} />,
          hint: b.md,
          onSelect: () => {
            caretInto()
            turnInto(editor, b.turnInto!)
          },
        })),
      })
    if (textual && node.type.name !== 'codeBlock')
      items.push({
        label: t('editor.blockMenu.color'),
        icon: <Paintbrush size={15} />,
        submenu: [
          {
            kind: 'custom',
            render: () => (
              <ColorGrid
                text={null}
                bg={null}
                onText={(c) => {
                  const ch = editor.chain().focus().setTextSelection(range)
                  ;(c ? ch.setTextColor(c) : ch.unsetTextColor()).run()
                }}
                onBg={(c) => {
                  const ch = editor.chain().focus().setTextSelection(range)
                  ;(c ? ch.setHighlight({ color: c }) : ch.unsetHighlight()).run()
                }}
              />
            ),
          },
        ],
      })
    items.push(
      { kind: 'separator' },
      { label: t('common.duplicate'), icon: <Copy size={15} />, hint: shortcutLabel('Mod+D'), onSelect: () => duplicateBlock(editor, ref) },
      {
        label: t('editor.blockMenu.copyLink'),
        icon: <Link size={15} />,
        onSelect: async () => {
          const id = editor.state.doc.nodeAt(ref.pos)?.attrs.id as string | undefined
          const url = `${location.origin}${location.pathname}${pageHref(pageId, id)}`
          try {
            await navigator.clipboard.writeText(url)
            toast({ message: t('editor.blockMenu.linkCopied'), kind: 'success' })
          } catch {
            toast({ message: url })
          }
        },
      },
      {
        label: t('editor.blockMenu.moveTo'),
        icon: <ArrowRightLeft size={15} />,
        keepOpen: true,
        onSelect: () => {
          const m = menu
          closeMenu()
          setMoveFor(m)
        },
      },
      { kind: 'separator' },
      { label: t('common.delete'), icon: <Trash2 size={15} />, hint: 'Del', danger: true, onSelect: () => deleteBlock(editor, ref) },
    )
    return items
  }, [menu, editor, t, pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const moveEntries = useMemo<MenuEntry[]>(() => {
    if (!moveFor) return []
    const { pages } = useWorkspace.getState()
    const targets = sortPages(Object.values(pages).filter((p) => p.kind === 'page' && !p.trashed && p.id !== pageId))
    return [
      { kind: 'section', label: t('editor.blockMenu.moveTo') },
      ...targets.map((p) => ({
        id: p.id,
        label: pageTitle(p, t('common.untitled')),
        icon: <PageIcon icon={p.icon} size={16} />,
        onSelect: () => {
          const node = editor.state.doc.nodeAt(moveFor.ref.pos)
          if (!node) return
          const json = node.toJSON()
          deleteBlock(editor, { node, pos: moveFor.ref.pos })
          const ws = useWorkspace.getState()
          const target = ws.pages[p.id]
          const existing = target?.content?.content ?? []
          const trimmed = existing.length && existing[existing.length - 1].type === 'paragraph' && !existing[existing.length - 1].content?.length ? existing.slice(0, -1) : existing
          ws.setContent(p.id, { type: 'doc', content: [...trimmed, json] }, 'editor-move')
          toast({ message: t('editor.blockMenu.moved', { title: pageTitle(p, t('common.untitled')) }), kind: 'success', action: { label: t('common.open'), run: () => openPage(p.id) } })
        },
      })),
    ]
  }, [moveFor, editor, pageId, t])

  return (
    <>
      <DragHandle editor={editor} onNodeChange={onNodeChange} nested={NESTED} className="block-handle-wrap">
        <div className="block-handle" data-kind={kind}>
          <button type="button" className="block-handle__btn" aria-label={t('editor.handle.add')} title={t('editor.handle.addHint')} onMouseDown={(e) => e.preventDefault()} onClick={plus}>
            <Plus size={16} strokeWidth={1.8} />
          </button>
          <button type="button" className="block-handle__btn block-handle__grip" aria-label={t('editor.handle.menu')} title={t('editor.handle.menuHint')} onClick={openMenu}>
            <GripVertical size={16} strokeWidth={1.8} />
          </button>
        </div>
      </DragHandle>
      <Menu open={!!menu} anchor={menu?.el ?? null} onClose={closeMenu} entries={entries} placement="left-start" width={240} searchable searchPlaceholder={t('editor.blockMenu.search')} emptyLabel={t('editor.slash.empty')} />
      <Popover open={!!moveFor} anchor={moveFor?.el ?? null} onClose={() => setMoveFor(null)} placement="left-start" style={{ width: 280 }}>
        <MenuList entries={moveEntries} onClose={() => setMoveFor(null)} searchable searchPlaceholder={t('editor.blockMenu.movePlaceholder')} emptyLabel={t('editor.slash.empty')} />
      </Popover>
    </>
  )
}
