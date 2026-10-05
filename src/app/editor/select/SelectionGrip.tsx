/**
 * The pinned grip of a block selection: while blocks are selected (one or a range), "+" and the grip
 * stay next to the FIRST selected block — no hover needed — a 2px signal rule runs down the gutter
 * from the first to the last one, and a mono chip counts them ("3 BLOCKS · ESC"). The grip opens the
 * block menu for the whole selection (click, Enter, Alt+Enter, right-click on a selected block) and
 * drags the whole selection.
 *
 * Also here, as they need the page's layout: a drag in the empty margin left of the text selects the
 * blocks it passes (rubber band), and on phones a long-press on the touch grip selects its block —
 * then taps on other blocks extend the selection (tap mode).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { GripVertical, Plus } from 'lucide-react'
import type { PopoverAnchor } from '../../ui/Popover'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { toggleHeadingLevel } from '../schema/toggle'
import { useContextPicking } from '../context/read'
import { blockSelectionAt, extendSelection, isBlockSelection, readBlockSel } from './model'
import { gutterLeftAt } from './gutter'
import { inTapMode, registerBlockMenuOpener, setTapMode } from './registry'
import './select.css'

/** How far left of the text a press still counts as "in the margin" (the hover handle takes its first 50px on the pointer's line). */
const MARGIN = 104
const LONG_PRESS = 450
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
/** Room the pinned grip needs on a phone (select.css: 26px + 2px, and a little margin). */
const PHONE_GRIP = 30

function kindOf(node: PMNode): string {
  const level = node.type.name === 'heading' ? node.attrs.level : node.type.name === 'details' ? toggleHeadingLevel(node) : 0
  return level ? `h${level}` : node.type.name
}

interface Box {
  top: number
  left: number
  bottom: number
  /** the count: a chip beside the grip (room in the margin), else a badge on the grip */
  place: 'side' | 'badge'
}

export interface SelectionGripProps {
  editor: Editor
  bridge: Bridge
  pageId: string
  /** a menu of the block handle is open, or the selection is the soft one a hover-grip menu left behind */
  hidden: boolean
  /** open the block menu for the selection, anchored at `anchor` */
  onOpen: (anchor: PopoverAnchor, keyboard: boolean) => void
}

export function SelectionGrip({ editor, bridge, pageId, hidden, onOpen }: SelectionGripProps) {
  const t = useT()
  const picking = useContextPicking() === pageId
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed || !e.isEditable) return null
      const b = readBlockSel(e.state)
      return b ? { from: b.from, to: b.to, last: b.positions[b.positions.length - 1], count: b.nodes.length, kind: kindOf(b.nodes[0]) } : null
    },
  })
  const [box, setBox] = useState<Box | null>(null)

  const measure = useCallback(() => {
    if (!st || editor.isDestroyed) return setBox(null)
    const host = editor.view.dom.closest('.one-editor') as HTMLElement | null
    const first = editor.view.nodeDOM(st.from) as HTMLElement | null
    const last = editor.view.nodeDOM(st.last) as HTMLElement | null
    if (!host || !(first instanceof HTMLElement) || !last?.getBoundingClientRect) return setBox(null)
    const h = host.getBoundingClientRect()
    const a = first.getBoundingClientRect()
    const z = last.getBoundingClientRect()
    // the gutter column of the hover handle (select/gutter): the same x at every level — on a phone at
    // least the grip's width from the screen's edge (a wide "12." may leave less room)
    const left = Math.max(gutterLeftAt(editor.view, st.from) ?? a.left, COARSE ? PHONE_GRIP : 0)
    setBox({ top: a.top - h.top, left: left - h.left, bottom: Math.max(a.bottom, z.bottom) - h.top, place: left > 220 && !COARSE ? 'side' : 'badge' })
  }, [st, editor])

  useLayoutEffect(measure, [measure])
  useEffect(() => {
    if (!st) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(editor.view.dom)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [st, editor, measure])

  // the menu for the selection: Alt+Enter (BlockSelection) and a right-click on a selected block
  const openAtFirst = useCallback(
    (keyboard: boolean) => {
      const b = readBlockSel(editor.state)
      if (!b) return
      // a virtual anchor at the first block (the grip itself steps aside while the menu is open)
      const anchor: PopoverAnchor = {
        contextElement: editor.view.dom,
        getBoundingClientRect: () => {
          const r = (editor.view.nodeDOM(b.from) as HTMLElement | null)?.getBoundingClientRect?.()
          return r ? new DOMRect((gutterLeftAt(editor.view, b.from) ?? r.left) - 4, r.top, 0, Math.min(r.height, 28)) : new DOMRect()
        },
      }
      onOpen(anchor, keyboard)
    },
    [editor, onOpen],
  )
  useEffect(() => registerBlockMenuOpener(editor.view, () => openAtFirst(true)), [editor, openAtFirst])
  useEffect(() => {
    const dom = editor.view.dom
    const onContext = (e: MouseEvent) => {
      const b = readBlockSel(editor.state)
      if (!b || editor.isDestroyed) return
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (!at || at.pos < b.from || at.pos > b.to) return
      e.preventDefault()
      const x = e.clientX
      const y = e.clientY
      onOpen({ contextElement: dom, getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }, false)
    }
    dom.addEventListener('contextmenu', onContext)
    return () => dom.removeEventListener('contextmenu', onContext)
  }, [editor, onOpen])

  useMarginSelect(editor)
  useTapMode(editor)

  const plus = () => {
    const b = readBlockSel(editor.state)
    if (!b) return
    const { state, view } = editor
    const tr = state.tr.insert(b.to, state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, b.to + 1))
    view.dispatch(tr.scrollIntoView())
    view.focus()
    bridge.setState({ plusOpened: true, plusCreated: true })
    editor.commands.insertContent('/')
  }

  // the grip drags the whole selection (ProseMirror moves view.dragging's slice on drop)
  const onDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    const sel = editor.state.selection
    if (!isBlockSelection(sel) || !e.dataTransfer) return e.preventDefault()
    const slice = sel.content()
    editor.view.dragging = { slice, move: true }
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', slice.content.textBetween(0, slice.content.size, '\n\n', ' '))
    const first = st ? (editor.view.nodeDOM(st.from) as HTMLElement | null) : null
    if (first instanceof HTMLElement) e.dataTransfer.setDragImage(first, 0, 0)
  }
  // dropped elsewhere / cancelled: ProseMirror only clears a drag that started in its own DOM
  const onDragEnd = () => {
    const mine = editor.view.dragging
    window.setTimeout(() => {
      if (!editor.isDestroyed && editor.view.dragging === mine) editor.view.dragging = null
    }, 50)
  }

  if (!st || !box || hidden || picking) return null
  return (
    <>
      <div className="sel-rule" style={{ top: box.top, height: Math.max(8, box.bottom - box.top), left: box.left - 5 }} aria-hidden />
      <div className="sel-grip" style={{ top: box.top, left: box.left }} data-place={box.place} data-testid="selection-grip">
        <div className="block-handle" data-kind={st.kind}>
          <button type="button" className="sel-grip__btn sel-grip__plus" aria-label={t('editor.handle.add')} title={t('editor.handle.addHint')} onMouseDown={(e) => e.preventDefault()} onClick={plus}>
            <Plus size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="sel-grip__btn sel-grip__grip"
            aria-label={st.count > 1 ? t('editor.select.menuN', { n: st.count }) : t('editor.handle.menu')}
            title={t('editor.handle.menuHint')}
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={() => openAtFirst(false)}
          >
            <GripVertical size={16} strokeWidth={1.8} />
            {st.count > 1 && box.place === 'badge' && (
              <span className="sel-grip__badge" data-testid="selection-count" aria-hidden>
                {st.count}
              </span>
            )}
          </button>
        </div>
        {st.count > 1 && box.place === 'side' && (
          <span className="sel-grip__count label" data-testid="selection-count">
            {t('editor.select.count', { n: st.count })}
          </span>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Margin drag (rubber band)                                           */
/* ------------------------------------------------------------------ */

/** Top-level blocks whose box meets the band [y0, y1] → selected. */
function selectBand(editor: Editor, y0: number, y1: number) {
  const { state, view } = editor
  const lo = Math.min(y0, y1)
  const hi = Math.max(y0, y1)
  let first = -1
  let last = -1
  state.doc.forEach((node, offset, index) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null
    const r = dom?.getBoundingClientRect?.()
    if (!r || r.bottom < lo || r.top > hi) return
    if (first < 0) first = index
    last = index
  })
  if (first < 0) return
  const $0 = state.doc.resolve(0)
  const sel = blockSelectionAt(state.doc, $0.posAtIndex(first), $0.posAtIndex(last + 1), y1 < y0)
  if (sel && !sel.eq(state.selection)) view.dispatch(state.tr.setSelection(sel))
}

function useMarginSelect(editor: Editor) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return
      if (editor.isDestroyed || !editor.isEditable) return
      const target = e.target as Element | null
      const dom = editor.view.dom
      // only the empty margin of THIS page: an element around the editor, left of its text
      if (!target || !target.contains(dom) || target.closest('button, a, input, textarea, select, [data-popover]')) return
      const r = dom.getBoundingClientRect()
      if (e.clientX >= r.left || e.clientX < r.left - MARGIN || e.clientY < r.top || e.clientY > r.bottom) return
      e.preventDefault()
      const y0 = e.clientY
      selectBand(editor, y0, y0)
      const move = (ev: PointerEvent) => !editor.isDestroyed && selectBand(editor, y0, ev.clientY)
      const up = () => {
        window.removeEventListener('pointermove', move)
        if (!editor.isDestroyed) editor.view.focus()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up, { once: true })
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [editor])
}

/* ------------------------------------------------------------------ */
/* Phones: long-press selects, taps extend                             */
/* ------------------------------------------------------------------ */

/** Long-press on a block's touch grip: the block is selected and taps on other blocks extend it. */
export function selectByLongPress(editor: Editor, pos: number): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const node = editor.state.doc.nodeAt(pos)
  if (!node?.isBlock) return false
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
  setTapMode(editor.view, true)
  navigator.vibrate?.(8)
  return true
}

/**
 * Pointer handlers for a long-press (touch / pen): `onLong` after LONG_PRESS ms without moving. The
 * click the lifted finger then makes is swallowed (the grip under it may have changed meanwhile).
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const cancel = () => {
    window.clearTimeout(timer.current)
    start.current = null
  }
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') return
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        start.current = null
        const swallow = (ev: Event) => {
          ev.preventDefault()
          ev.stopPropagation()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 800)
        onLong()
      }, LONG_PRESS)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Android's long-press menu
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
}

/** Tap mode: a tap on another block extends the selection to it; a tap on the only selected block ends it. */
function useTapMode(editor: Editor) {
  useEffect(() => {
    const view = editor.view
    const dom = view.dom
    let from: { x: number; y: number } | null = null
    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      from = touch ? { x: touch.clientX, y: touch.clientY } : null
    }
    const onEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0]
      if (!touch || !from || !inTapMode(view) || editor.isDestroyed) return
      if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > 10) return
      const b = readBlockSel(editor.state)
      const at = view.posAtCoords({ left: touch.clientX, top: touch.clientY })
      if (!b || !at) return
      e.preventDefault()
      const pos = at.inside >= 0 ? at.inside : at.pos
      if (b.nodes.length === 1 && pos >= b.from && pos < b.to) {
        // the only selected block again: back to typing in it
        setTapMode(view, false)
        view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(Math.min(b.from + 1, editor.state.doc.content.size)))))
        return
      }
      const next = extendSelection(editor.state, pos)
      if (next) view.dispatch(editor.state.tr.setSelection(next))
    }
    // leaving the block selection ends tap mode
    const onSelection = () => {
      if (inTapMode(view) && !isBlockSelection(editor.state.selection)) setTapMode(view, false)
    }
    dom.addEventListener('touchstart', onStart, { passive: true })
    dom.addEventListener('touchend', onEnd, { passive: false })
    editor.on('selectionUpdate', onSelection)
    return () => {
      dom.removeEventListener('touchstart', onStart)
      dom.removeEventListener('touchend', onEnd)
      editor.off('selectionUpdate', onSelection)
    }
  }, [editor])
}
