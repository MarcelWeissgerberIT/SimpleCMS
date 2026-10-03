/**
 * Gutter handle: "+" inserts a block below and opens the slash menu, "⋮⋮" drags the block
 * or opens the block menu (Turn into, Colour, Duplicate, Copy link, Move to, Delete).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { useEditorState } from '@tiptap/react'
import { useStore } from 'zustand'
import { ArrowRightLeft, Copy, GripVertical, Link, Paintbrush, Plus, Repeat2, Trash2 } from 'lucide-react'
import { Menu, MenuList, type MenuEntry } from '../../ui/Menu'
import { Popover, type PopoverAnchor } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { shortcutLabel } from '../../ui/controls'
import { useWorkspace } from '../../store/store'
import { pageTitle, sortPages } from '../../store/selectors'
import { toast } from '../../store/ui'
import { openPage, pageHref } from '../../lib/router'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { blockTextRange, currentBlock, deleteBlock, duplicateBlock, turnBlockInto, type BlockRef, type TurnTarget } from '../lib/blocks'
import { trackMove } from '../lib/moves'
import { livePages } from '../lib/livePages'
import { TURN_INTO_ITEMS } from '../lib/catalog'
import { BlockGlyph } from './SlashMenu'
import { toggleHeadingLevel } from '../schema/toggle'
import { mediaMenuEntries } from './mediaMenu'
import { ColorGrid } from './BubbleToolbar'
import { blockMenuSyncedEntries } from '../synced/menu'

const TEXTUAL = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'details', 'codeBlock'])
const EXCLUDED = new Set(['column', 'detailsSummary', 'detailsContent', 'tab'])
const NESTED = {
  edgeDetection: 'left' as const,
  rules: [
    { id: 'noWrappers', evaluate: ({ node }: { node: PMNode }) => (EXCLUDED.has(node.type.name) ? 1000 : 0) },
    { id: 'noCellContent', evaluate: ({ parent }: { parent: PMNode | null }) => (parent && (parent.type.name === 'tableCell' || parent.type.name === 'tableHeader') ? 1000 : 0) },
  ],
}

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
  video: 'video',
  audio: 'audio',
  tabs: 'tabs',
  syncedBlock: 'synced',
  meetingNotes: 'meetingNotes',
  button: 'button',
}

const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches

/** The "Turn into" target a block currently is (for the check mark). */
function turnTargetOf(editor: Editor, ref: BlockRef): TurnTarget | null {
  const n = ref.node
  switch (n.type.name) {
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return `heading${n.attrs.level}` as TurnTarget
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return n.type.name as TurnTarget
    case 'taskItem':
      return 'taskList'
    case 'listItem': {
      const parent = editor.state.doc.resolve(ref.pos).parent.type.name
      return parent === 'orderedList' ? 'orderedList' : 'bulletList'
    }
    case 'details': {
      const level = toggleHeadingLevel(n)
      return level ? (`toggleHeading${level}` as TurnTarget) : 'toggle'
    }
    case 'blockquote':
    case 'callout':
    case 'codeBlock':
      return n.type.name as TurnTarget
  }
  return null
}

/** Uniform text colour / highlight of all text in a block (null when mixed or none). */
function blockColors(node: PMNode): { text: string | null; bg: string | null } {
  let text: string | null | undefined
  let bg: string | null | undefined
  node.descendants((child) => {
    if (!child.isText) return true
    const c = (child.marks.find((m) => m.type.name === 'textStyle')?.attrs.color as string | null) ?? null
    const h = (child.marks.find((m) => m.type.name === 'highlight')?.attrs.color as string | null) ?? null
    text = text === undefined ? c : text === c ? text : null
    bg = bg === undefined ? h : bg === h ? bg : null
    return false
  })
  return { text: text ?? null, bg: bg ?? null }
}

/** Virtual anchor at the left edge of a block's DOM. */
function blockAnchor(editor: Editor, pos: number): PopoverAnchor {
  return {
    contextElement: editor.view.dom,
    getBoundingClientRect: () => {
      const dom = editor.isDestroyed ? null : (editor.view.nodeDOM(pos) as HTMLElement | null)
      const r = dom?.getBoundingClientRect?.()
      return r ? new DOMRect(r.left - 4, r.top, 0, Math.min(r.height, 28)) : new DOMRect()
    },
  }
}

function blockLabelKey(node: PMNode): string {
  if (node.type.name === 'heading') return `editor.block.heading${node.attrs.level}`
  if (node.type.name === 'details' && toggleHeadingLevel(node)) return `editor.block.toggleHeading${toggleHeadingLevel(node)}`
  return `editor.block.${TYPE_LABEL[node.type.name] ?? 'text'}`
}

export function BlockHandle({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const current = useRef<BlockRef | null>(null)
  const [kind, setKind] = useState<string>('paragraph')
  const [menu, setMenu] = useState<{ el: PopoverAnchor; ref: BlockRef; keyboard?: boolean } | null>(null)
  const [moveFor, setMoveFor] = useState<{ el: PopoverAnchor; ref: BlockRef } | null>(null)
  const requested = useStore(bridge, (s) => s.blockMenu)

  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
    current.current = node && pos >= 0 ? { node, pos } : null
    // toggle headings align the handle with their title line like headings do
    const level = node?.type.name === 'heading' ? node.attrs.level : node?.type.name === 'details' ? toggleHeadingLevel(node) : 0
    if (node) setKind(level ? `h${level}` : node.type.name)
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
    const reuse = node.type.name === 'paragraph' && node.content.size === 0
    if (reuse) {
      caret = ref.pos + 1
    } else {
      const at = above ? ref.pos : ref.pos + node.nodeSize
      tr = tr.insert(at, state.schema.nodes.paragraph.create())
      caret = at + 1
    }
    tr.setSelection(TextSelection.create(tr.doc, caret))
    view.dispatch(tr)
    view.focus()
    bridge.setState({ plusOpened: true, plusCreated: !reuse })
    editor.commands.insertContent('/')
  }

  const openAt = useCallback(
    (el: PopoverAnchor, pos: number, keyboard = false) => {
      const node = editor.state.doc.nodeAt(pos)
      if (!node) return
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
      editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', true))
      setMenu({ el, ref: { node, pos }, keyboard })
    },
    [editor],
  )

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    const ref = current.current
    if (ref) openAt(e.currentTarget, ref.pos)
  }

  // keyboard (Alt+Enter) / touch grip → block menu anchored at the block itself
  useEffect(() => {
    if (!requested) return
    bridge.setState({ blockMenu: null })
    openAt(blockAnchor(editor, requested.pos), requested.pos, true)
  }, [requested, bridge, editor, openAt])

  /** Hand the keyboard back to the editor (the block stays selected — typing can't replace it). */
  const refocus = () => {
    if (!editor.isDestroyed && !isTouch) editor.view.focus()
  }

  const closeMenu = () => {
    setMenu(null)
    if (editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', false))
    refocus()
  }

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return []
    const { ref } = menu
    const node = ref.node
    const textual = TEXTUAL.has(node.type.name)
    const range = blockTextRange(ref)
    const currentTurn = turnTargetOf(editor, ref)
    const colors = blockColors(node)
    const items: MenuEntry[] = [{ kind: 'section', label: t(blockLabelKey(node)) }]
    if (textual)
      items.push({
        label: t('editor.blockMenu.turnInto'),
        icon: <Repeat2 size={15} />,
        submenu: TURN_INTO_ITEMS.map((b) => ({
          label: t(`editor.block.${b.id}`),
          icon: <BlockGlyph item={b} size={15} />,
          hint: b.md,
          checked: b.turnInto === currentTurn,
          onSelect: () => turnBlockInto(editor, ref, b.turnInto!),
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
                text={colors.text}
                bg={colors.bg}
                onText={(c) => {
                  // colour the whole block, keep it block-selected (focus stays in the menu)
                  const ch = editor.chain().setTextSelection(range)
                  ;(c ? ch.setTextColor(c) : ch.unsetTextColor()).setNodeSelection(ref.pos).run()
                }}
                onBg={(c) => {
                  const ch = editor.chain().setTextSelection(range)
                  ;(c ? ch.setHighlight({ color: c }) : ch.unsetHighlight()).setNodeSelection(ref.pos).run()
                }}
              />
            ),
          },
        ],
      })
    // video / audio: replace, download, copy a web link
    items.push(...mediaMenuEntries(editor, ref, t))
    items.push(
      { kind: 'separator' },
      { label: t('common.duplicate'), icon: <Copy size={15} />, hint: isTouch ? undefined : shortcutLabel('Mod+D'), onSelect: () => duplicateBlock(editor, ref) },
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
      // Copy and sync (+ the synced block's own menu when the block is / sits in one)
      ...blockMenuSyncedEntries(editor, ref.pos, t),
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
      { label: t('common.delete'), icon: <Trash2 size={15} />, hint: isTouch ? undefined : 'Del', danger: true, onSelect: () => deleteBlock(editor, ref) },
    )
    return items
  }, [menu, editor, t, pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeMove = () => {
    setMoveFor(null)
    refocus()
  }

  const moveEntries = useMemo<MenuEntry[]>(() => {
    if (!moveFor) return []
    const { pages } = useWorkspace.getState()
    // never a page inside a trashed parent: "Empty trash" would delete the moved block with it
    const targets = sortPages(livePages(pages, pageId).filter((p) => p.kind === 'page' && p.id !== pageId))
    return [
      { kind: 'section', label: t('editor.blockMenu.moveTo') },
      ...targets.map((p) => ({
        id: p.id,
        label: pageTitle(p, t('common.untitled')),
        icon: <PageIcon icon={p.icon} size={16} />,
        onSelect: () => {
          const node = editor.state.doc.nodeAt(moveFor.ref.pos)
          if (!node) return
          // the block keeps its id: undo here takes it back out of the target (see trackMove),
          // and ?b= links to the old page follow it (PageEditor)
          trackMove(editor, node.toJSON(), p.id)
          deleteBlock(editor, { node, pos: moveFor.ref.pos })
          toast({ message: t('editor.blockMenu.moved', { title: pageTitle(p, t('common.untitled')) }), kind: 'success', action: { label: t('common.open'), run: () => openPage(p.id) } })
        },
      })),
    ]
  }, [moveFor, editor, pageId, t])

  return (
    <>
      {isTouch && <TouchGrip editor={editor} hidden={!!menu || !!moveFor} onOpen={(el, pos) => openAt(el, pos)} />}
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
      <Menu open={!!menu} anchor={menu?.el ?? null} onClose={closeMenu} entries={entries} placement="left-start" width={240} searchable={!isTouch} searchPlaceholder={t('editor.blockMenu.search')} emptyLabel={t('editor.slash.empty')} />
      <Popover open={!!moveFor} anchor={moveFor?.el ?? null} onClose={closeMove} placement="left-start" style={{ width: 280 }}>
        <MenuList entries={moveEntries} onClose={closeMove} searchable searchPlaceholder={t('editor.blockMenu.movePlaceholder')} emptyLabel={t('editor.slash.empty')} />
      </Popover>
    </>
  )
}

/**
 * Touch devices have no hover, so the gutter handle never appears. Instead a compact grip sits
 * next to the block that holds the caret and opens the same block menu.
 */
function TouchGrip({ editor, hidden, onOpen }: { editor: Editor; hidden: boolean; onOpen: (el: HTMLElement, pos: number) => void }) {
  const t = useT()
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || !e.isFocused || !e.isEditable) return null
      const b = currentBlock(e.state)
      return b ? { pos: b.pos, size: b.node.nodeSize } : null
    },
  })
  const [top, setTop] = useState<number | null>(null)
  useEffect(() => {
    if (!st) return setTop(null)
    const dom = editor.view.nodeDOM(st.pos) as HTMLElement | null
    const host = editor.view.dom.closest('.one-editor') as HTMLElement | null
    if (!dom?.getBoundingClientRect || !host) return setTop(null)
    setTop(dom.getBoundingClientRect().top - host.getBoundingClientRect().top)
  }, [st, editor])
  if (!st || top === null || hidden) return null
  return (
    <button
      type="button"
      className="touch-grip"
      style={{ top }}
      aria-label={t('editor.handle.menu')}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => onOpen(e.currentTarget, st.pos)}
    >
      <GripVertical size={16} strokeWidth={1.8} />
    </button>
  )
}
