/**
 * Gutter handle: "+" inserts a block below and opens the slash menu, "⋮⋮" drags the block
 * or opens the block menu (Turn into, Colour, Duplicate, Copy link, Move to, Delete).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state'
import type { NestedOptions } from '@tiptap/extension-drag-handle'
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
import { imageMenuEntries } from './imageMenu'
import { chartMenuEntries } from './chartMenu'
import { ColorGrid } from './BubbleToolbar'
import { blockMenuSyncedEntries } from '../synced/menu'
import { redoBlockMenuEntries } from '../context/menu'
import { splitMenuEntries } from '../split/menu'
import { blockSplitRange, type SplitRange } from '../split/range'
import { SelectionGrip, selectByLongPress, useLongPress } from '../select/SelectionGrip'
import { blockSelectionAt, extendSelection, isBlockSelection, menuSelection, readBlockSel, type BlockSel } from '../select/model'
import { gutterLeft, gutterLeftAt } from '../select/gutter'
import { selectionMenuEntries } from '../select/menu'
import { moveBlocks } from '../select/actions'

const TEXTUAL = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'details', 'codeBlock'])
const EXCLUDED = new Set(['column', 'detailsSummary', 'detailsContent', 'tab'])
const LIST_ITEMS = new Set(['listItem', 'taskItem'])
/** Within this many px of a block's left / top edge its container takes the hover (the library's 'left' preset). */
const EDGE = 12

/**
 * Which block the hover handle is for. Never a wrapper (column, toggle parts, tab) or a table cell's
 * content; near a block's left / top edge its container wins (a callout's or quote's inner line → the
 * callout) — but not for list items: an item's marker, the gap left of it and its first line belong to
 * the item itself, so every level of a nested list is reachable (the library's own edge rule handed
 * them to the parent). `pointer`: the last mouse position over the editor.
 */
function nestedOptions(pointer: { current: { x: number; y: number } }): NestedOptions {
  return {
    edgeDetection: 'none',
    rules: [
      { id: 'noWrappers', evaluate: ({ node }) => (EXCLUDED.has(node.type.name) ? 1000 : 0) },
      { id: 'noCellContent', evaluate: ({ parent }) => (parent && (parent.type.name === 'tableCell' || parent.type.name === 'tableHeader') ? 1000 : 0) },
      {
        id: 'edgesOutsideLists',
        evaluate: ({ node, pos, depth, view }) => {
          if (LIST_ITEMS.has(node.type.name)) return 0
          const r = (view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect?.()
          const { x, y } = pointer.current
          return r && (x - r.left < EDGE || y - r.top < EDGE) ? 500 * depth : 0
        },
      },
    ],
  }
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
  chart: 'chart',
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
  breadcrumb: 'breadcrumb',
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

/** Virtual anchor at the left edge of a block's DOM (a list item's: left of its marker). */
function blockAnchor(editor: Editor, pos: number): PopoverAnchor {
  return {
    contextElement: editor.view.dom,
    getBoundingClientRect: () => {
      const dom = editor.isDestroyed ? null : (editor.view.nodeDOM(pos) as HTMLElement | null)
      const r = dom?.getBoundingClientRect?.()
      return r ? new DOMRect((gutterLeftAt(editor.view, pos) ?? r.left) - 4, r.top, 0, Math.min(r.height, 28)) : new DOMRect()
    },
  }
}

function blockLabelKey(node: PMNode): string {
  if (node.type.name === 'heading') return `editor.block.heading${node.attrs.level}`
  if (node.type.name === 'details' && toggleHeadingLevel(node)) return `editor.block.toggleHeading${toggleHeadingLevel(node)}`
  if (node.type.name === 'columns') return `editor.block.columns${Math.min(5, Math.max(2, node.childCount))}`
  return `editor.block.${TYPE_LABEL[node.type.name] ?? 'text'}`
}

export function BlockHandle({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const current = useRef<BlockRef | null>(null)
  const [kind, setKind] = useState<string>('paragraph')
  // `sel`: several selected blocks the menu acts on (editor/select), else the block at `ref`;
  // `fromHover`: opened from the hover grip with no blocks selected — the selection it makes is soft (below)
  const [menu, setMenu] = useState<{ el: PopoverAnchor; ref: BlockRef; keyboard?: boolean; sel?: BlockSel | null; fromHover?: boolean } | null>(null)
  const [moveFor, setMoveFor] = useState<{ el: PopoverAnchor; ref: BlockRef; sel?: BlockSel | null } | null>(null)
  const requested = useStore(bridge, (s) => s.blockMenu)
  /** "Turn into page": the selected blocks when the menu's block is one of them (read before the block gets selected) */
  const splitFor = useRef<SplitRange | null>(null)

  // One grip at a time: while blocks are selected, their pinned grip (editor/select) is THE handle — the
  // hover handle stays away from every block (with Shift held it shows on unselected ones: Shift+click on
  // it extends the selection). A selection the hover grip itself left behind (its menu, a drag) is
  // "soft": no pinned grip, the hover handle goes on as usual (menu on one block, then on the next).
  const soft = useRef<Selection | null>(null)
  /** the hover grip drags a block right now; `drag.current`: it was no (hard) selection's block */
  const [dragging, setDragging] = useState(false)
  const drag = useRef(false)
  const sel = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed || !e.isEditable) return null
      const b = readBlockSel(e.state)
      return b ? { from: b.from, to: b.to, soft: !!soft.current && e.state.selection.eq(soft.current) } : null
    },
  })
  useEffect(() => {
    const forget = () => {
      if (soft.current && !editor.state.selection.eq(soft.current)) soft.current = null
    }
    editor.on('transaction', forget)
    return () => {
      editor.off('transaction', forget)
    }
  }, [editor])
  const [hoverPos, setHoverPos] = useState(-1)
  const shift = useShiftKey(!!sel && !sel.soft)
  const overSelection = !!sel && hoverPos >= sel.from && hoverPos < sel.to
  const quiet = !!sel && !sel.soft && !menu?.fromHover && !dragging && (overSelection || !shift)

  // which block is hovered: the pointer over the editor feeds the edge rule (nestedOptions)
  const pointer = useRef({ x: Number.NaN, y: Number.NaN })
  const nested = useMemo(() => nestedOptions(pointer), [])
  useEffect(() => {
    const dom = editor.view.dom
    const track = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
    }
    dom.addEventListener('mousemove', track)
    return () => dom.removeEventListener('mousemove', track)
  }, [editor])
  // where the handle stands: left of the block — of a list item's bullet / number / checkbox (select/gutter)
  const reference = useCallback(() => {
    const ref = current.current
    const dom = ref && !editor.isDestroyed ? editor.view.nodeDOM(ref.pos) : null
    if (!ref || !(dom instanceof HTMLElement)) return null
    const r = dom.getBoundingClientRect()
    const left = gutterLeft(dom, ref.node)
    const rect = new DOMRect(left, r.top, r.right - left, r.height)
    return { getBoundingClientRect: () => rect }
  }, [editor])

  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
    current.current = node && pos >= 0 ? { node, pos } : null
    setHoverPos(node && pos >= 0 ? pos : -1)
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
    (el: PopoverAnchor, pos: number, keyboard = false, fromHover = false) => {
      const node = editor.state.doc.nodeAt(pos)
      if (!node) return
      splitFor.current = blockSplitRange(editor.state, pos)
      // the block is one of several selected blocks: the menu acts on all of them (they stay selected)
      const sel = menuSelection(editor.state, pos)
      const selection = sel ? blockSelectionAt(editor.state.doc, sel.from, sel.to) : null
      editor.view.dispatch(editor.state.tr.setSelection(selection ?? NodeSelection.create(editor.state.doc, pos)))
      editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', true))
      setMenu({ el, ref: { node, pos }, keyboard, sel: selection ? sel : null, fromHover })
    },
    [editor],
  )

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    const ref = current.current
    if (!ref) return
    // Shift+click on another block's grip while blocks are selected: the selection grows to it
    const grown = e.shiftKey ? extendSelection(editor.state, ref.node.isLeaf ? ref.pos : ref.pos + 1) : null
    if (grown) return void editor.view.dispatch(editor.state.tr.setSelection(grown))
    openAt(e.currentTarget, ref.pos, false, !sel || sel.soft)
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
    const closing = menu
    setMenu(null)
    if (editor.isDestroyed) return
    soft.current = closing?.fromHover && isBlockSelection(editor.state.selection) ? editor.state.selection : null
    editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', false))
    refocus()
  }

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return []
    const { ref } = menu
    // several selected blocks: one menu for all of them (editor/select)
    if (menu.sel)
      return selectionMenuEntries(editor, menu.sel, t, {
        pageId,
        bridge,
        onMoveTo: () => {
          const m = menu
          closeMenu()
          setMoveFor(m)
        },
      })
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
        submenu: [
          ...TURN_INTO_ITEMS.map((b) => ({
            label: t(`editor.block.${b.id}`),
            icon: <BlockGlyph item={b} size={15} />,
            hint: b.md,
            checked: b.turnInto === currentTurn,
            onSelect: () => turnBlockInto(editor, ref, b.turnInto!),
          })),
          // → Page: the block (or the selected blocks it belongs to) becomes a sub-page, linked here
          ...splitMenuEntries(editor, t, { range: splitFor.current, pageId, inTurnInto: true }),
        ],
      })
    // blocks without a Turn into list (image, table, columns …) still become a page
    else items.push(...splitMenuEntries(editor, t, { range: splitFor.current, pageId }))
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
    // "Redo with instructions…": the redo picker, this block pre-marked
    items.push(...redoBlockMenuEntries(editor, ref, t))
    // video / audio: replace, download, copy a web link
    items.push(...mediaMenuEntries(editor, ref, t))
    // image: the "Claude" group — describe, read out the text, image → table, ask
    items.push(...imageMenuEntries(editor, ref, t))
    // chart: edit, type, downloads, data, source
    items.push(...chartMenuEntries(editor, ref, t))
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
          if (moveFor.sel) {
            if (moveBlocks(editor, moveFor.sel, p.id))
              toast({ message: t('editor.blockMenu.moved', { title: pageTitle(p, t('common.untitled')) }), kind: 'success', action: { label: t('common.open'), run: () => openPage(p.id) } })
            return
          }
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
      <DragHandle
        editor={editor}
        onNodeChange={onNodeChange}
        nested={nested}
        getReferencedVirtualElement={reference}
        onElementDragStart={() => {
          drag.current = !sel || sel.soft
          setDragging(true)
        }}
        onElementDragEnd={() => {
          setDragging(false)
          if (!editor.isDestroyed) soft.current = drag.current && isBlockSelection(editor.state.selection) ? editor.state.selection : null
        }}
        className={quiet ? 'block-handle-wrap is-quiet' : 'block-handle-wrap'}
      >
        <div className="block-handle" data-kind={kind}>
          <button type="button" className="block-handle__btn" aria-label={t('editor.handle.add')} title={t('editor.handle.addHint')} onMouseDown={(e) => e.preventDefault()} onClick={plus}>
            <Plus size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="block-handle__btn block-handle__grip"
            aria-label={t('editor.handle.menu')}
            title={t('editor.handle.menuHint')}
            // Shift+click extends the block selection: the browser must not stretch the text selection to here first
            onMouseDown={(e) => e.shiftKey && e.preventDefault()}
            onClick={openMenu}
          >
            <GripVertical size={16} strokeWidth={1.8} />
          </button>
        </div>
      </DragHandle>
      {/* blocks selected: the grip stays at the first one (+ gutter rule, count chip) and opens this menu for all of them */}
      <SelectionGrip
        editor={editor}
        bridge={bridge}
        pageId={pageId}
        hidden={!!menu || !!moveFor || !!sel?.soft}
        onOpen={(el, keyboard) => {
          const b = readBlockSel(editor.state)
          if (b) openAt(el, b.from, keyboard)
        }}
      />
      <Menu open={!!menu} anchor={menu?.el ?? null} onClose={closeMenu} entries={entries} placement="left-start" width={240} searchable={!isTouch} searchPlaceholder={t('editor.blockMenu.search')} emptyLabel={t('editor.slash.empty')} />
      <Popover open={!!moveFor} anchor={moveFor?.el ?? null} onClose={closeMove} placement="left-start" style={{ width: 280 }}>
        <MenuList entries={moveEntries} onClose={closeMove} searchable searchPlaceholder={t('editor.blockMenu.movePlaceholder')} emptyLabel={t('editor.slash.empty')} />
      </Popover>
    </>
  )
}

/** Whether Shift is held — tracked only while `on`. */
function useShiftKey(on: boolean): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!on) return setHeld(false)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setHeld(e.type === 'keydown')
    }
    const move = (e: MouseEvent) => setHeld(e.shiftKey)
    const off = () => setHeld(false)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    window.addEventListener('mousemove', move, true)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('blur', off)
    }
  }, [on])
  return held
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
  // long-press: the block is selected; taps on other blocks then extend the selection (editor/select)
  const press = useLongPress(() => {
    if (st) selectByLongPress(editor, st.pos)
  })
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
      {...press}
    >
      <GripVertical size={16} strokeWidth={1.8} />
    </button>
  )
}
