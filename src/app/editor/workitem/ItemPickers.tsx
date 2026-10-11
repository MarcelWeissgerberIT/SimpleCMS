/**
 * Task block — the ONE picker host of an editable editor (mounted in EditorOverlays). It reads `bridge.itemPicker`
 * (editor/lib/bridge.ts) and shows the matching picker / card next to the task:
 *   status (the key's ⌄) · confirm (blocked → "mark done anyway?") · due · people · blockedBy · related · blocks ·
 *   dependents / relatedList (the BLOCKS · FREED and RELATED lists) · ref (a linked task's card).
 *
 *  - Where: `pos` is the task's position when the person acted. While a picker is open the host maps it through
 *    every transaction and finds the block again (`resolveItemTarget`: pos with an agreeing block id → the block id →
 *    nothing); the task gone → the picker closes, nothing is written.
 *  - Anchor: the chip / ghost / key the picker belongs to (`[data-wi-anchor="<kind>"]` inside the task's DOM, looked
 *    up again on every measure — React may redraw it), else the status key, else the task itself.
 *  - Writes: `commit(patch)` = `commitItem` on that very block (one transaction, one undo step, delta only).
 *  - Esc vs. outside: `ctx.escaped()` tells a picker whether the Popover closes on Esc (drafts are discarded) or on a
 *    press outside / Tab out (a touched draft is written) — §6 of the build brief.
 *  - Focus afterwards: when nothing took it (focusIsNowhere), back to the editor — the caret where it was when it
 *    sat in this task, else at the end of the task's title (touch: only when the editor had the keyboard when the
 *    person asked for the picker — `ItemPickerState.hadFocus`, read before the picker mounted; else the main region:
 *    never the body, and no phone keyboard pulled up).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import type { VirtualElement } from '@floating-ui/react'
import { useStore } from 'zustand'
import { focusIsNowhere, focusMainRegion, takeFocusHandoff } from '../../ui/focus'
import type { Bridge, ItemPickerKind, ItemPickerState } from '../lib/bridge'
import { itemAttrs, WORK_ITEM, type WorkItemAttrs } from './attrs'
import { commitItem, focusTitleEnd, openItemPickerAt, resolveItemTarget } from './keys'
import type { ItemPatch } from './patch'
import { ConfirmPopover, StatusPicker } from './StatusKey'
import { DuePicker } from './DuePicker'
import { ItemLinkPicker, PeoplePicker, RefCard, RefList } from '../../features/workitems'

/** What every picker gets from the host. */
export interface PickerCtx {
  editor: Editor
  bridge: Bridge
  pageId: string
  picker: ItemPickerState
  /** the task's fields now (the live block) */
  attrs: WorkItemAttrs
  anchor: VirtualElement
  /** the Popover closes because of Esc (discard the draft) — else a press outside / Tab (write a touched one) */
  escaped: () => boolean
  /** write to this very block (one undo step) and close; false: the task is gone (toast) */
  commit: (patch: ItemPatch) => boolean
  /** close without writing */
  close: () => void
  /** another picker on the same task (the confirm after a status pick …) */
  swap: (next: Partial<ItemPickerState>) => void
  /** a card the pointer opened: the pointer is over it / left it */
  hoverKeep: () => void
  hoverLeave: () => void
}

/** Which anchor a kind of picker sits at. */
const ANCHOR: Record<ItemPickerKind, string[]> = {
  status: ['key'],
  confirm: ['key'],
  due: ['due'],
  people: ['people'],
  blockedBy: ['blockedBy'],
  related: ['relatedList', 'blockedBy'],
  blocks: ['dependents', 'blockedBy'],
  dependents: ['dependents'],
  relatedList: ['relatedList'],
  ref: [],
}

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches

function anchorEl(editor: Editor, picker: ItemPickerState): Element | null {
  if (editor.isDestroyed) return null
  const dom = editor.view.nodeDOM(picker.pos)
  if (!(dom instanceof HTMLElement)) return null
  const keys = picker.kind === 'ref' && picker.ref ? [`ref:${picker.ref}`] : ANCHOR[picker.kind]
  for (const k of keys) {
    // the task's own chips only (never a task inside its notes — tasks never nest, but stay exact)
    const hit = [...dom.querySelectorAll<HTMLElement>(`[data-wi-anchor="${k}"]`)].find((el) => el.closest('.node-workItem') === dom && el.getClientRects().length)
    if (hit) return hit
  }
  const key = [...dom.querySelectorAll<HTMLElement>('[data-wi-anchor="key"]')].find((el) => el.closest('.node-workItem') === dom)
  return key ?? dom.querySelector('.workitem') ?? dom
}

export function ItemPickers({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const picker = useStore(bridge, (s) => s.itemPicker)
  const open = !!picker
  // the doc changed while open: the task's fields may have (a member's edit, the picker's own write)
  const [rev, bump] = useReducer((n: number) => n + 1, 0)
  const escaped = useRef(false)

  // keep `pos` on the task through every transaction; the task gone → closed
  useEffect(() => {
    if (!open) return
    // a menu item handed its key over: the picker takes the keyboard now (nothing to give back to it)
    takeFocusHandoff()
    const onTr = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      const cur = bridge.getState().itemPicker
      if (!cur || !transaction.docChanged) return
      const mapped = transaction.mapping.map(cur.pos, 1)
      const at = resolveItemTarget(editor.state.doc, { pos: mapped, itemId: cur.itemId, blockId: cur.blockId })
      if (at === null) {
        bridge.setState({ itemPicker: null })
        return
      }
      const node = editor.state.doc.nodeAt(at)
      const itemId = (node?.attrs.itemId as string | null) ?? cur.itemId
      if (at !== cur.pos || itemId !== cur.itemId) bridge.setState({ itemPicker: { ...cur, pos: at, itemId } })
      bump()
    }
    editor.on('transaction', onTr)
    return () => {
      editor.off('transaction', onTr)
    }
  }, [open, editor, bridge])

  // Esc: the Popover closes on it (document capture); this listener runs first (window capture)
  useEffect(() => {
    if (!open) return
    escaped.current = false
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escaped.current = true
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const close = useCallback(() => {
    const cur = bridge.getState().itemPicker
    if (!cur) return
    bridge.setState({ itemPicker: null })
    // focus: back to writing in this task when nothing else took it
    requestAnimationFrame(() => {
      if (editor.isDestroyed || !focusIsNowhere()) return
      // touch, the person was not typing: no keyboard pulled up — the main region keeps the focus (never the body)
      if (isTouch() && !cur.hadFocus) return void focusMainRegion()
      // the block menu selected the whole task (Alt+Enter → Due…): writing goes on at the end of its title
      focusTitleEnd(editor, { pos: cur.pos, itemId: cur.itemId, blockId: cur.blockId }, { force: cur.from === 'menu' })
    })
  }, [editor, bridge])

  const node = picker && !editor.isDestroyed ? editor.state.doc.nodeAt(Math.min(picker.pos, editor.state.doc.content.size)) : null
  const nodeAttrs = node && node.type.name === WORK_ITEM ? node.attrs : null
  const attrs = useMemo(() => (nodeAttrs ? itemAttrs(nodeAttrs) : null), [nodeAttrs, rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickerRef = useRef(picker)
  pickerRef.current = picker
  const last = useRef(new DOMRect())
  const anchor = useMemo<VirtualElement>(
    () => ({
      contextElement: editor.isDestroyed ? undefined : editor.view.dom,
      getBoundingClientRect: () => {
        const p = pickerRef.current
        const el = p ? anchorEl(editor, p) : null
        if (el) last.current = el.getBoundingClientRect()
        return last.current
      },
    }),
    [editor],
  )

  if (!picker || !attrs) return null
  const ctx: PickerCtx = {
    editor,
    bridge,
    pageId,
    picker,
    attrs,
    anchor,
    escaped: () => escaped.current,
    commit: (patch) => {
      const cur = bridge.getState().itemPicker ?? picker
      const ok = commitItem(editor, { pos: cur.pos, itemId: cur.itemId, blockId: cur.blockId }, patch, { by: 'person' })
      close()
      return ok
    },
    close,
    swap: (next) => {
      const cur = bridge.getState().itemPicker
      if (cur) bridge.setState({ itemPicker: { ...cur, hover: false, ...next } })
    },
    hoverKeep: () => keepRefCard(bridge),
    hoverLeave: () => leaveRefCard(bridge),
  }
  // a fresh panel per task and kind (drafts never carry over)
  const key = `${picker.kind}:${picker.blockId ?? picker.itemId ?? picker.pos}:${picker.ref ?? ''}`
  switch (picker.kind) {
    case 'status':
      return <StatusPicker key={key} ctx={ctx} />
    case 'confirm':
      return <ConfirmPopover key={key} ctx={ctx} />
    case 'due':
      return <DuePicker key={key} ctx={ctx} />
    case 'people':
      return <PeoplePicker key={key} ctx={ctx} />
    case 'blockedBy':
    case 'related':
    case 'blocks':
      return <ItemLinkPicker key={key} ctx={ctx} mode={picker.kind} />
    case 'dependents':
    case 'relatedList':
      return <RefList key={key} ctx={ctx} mode={picker.kind} />
    case 'ref':
      return <RefCard key={key} ctx={ctx} />
  }
  return null
}

/* ------------------------------------------------------------------ the card a resting pointer opens */

const hoverTimers = new WeakMap<Bridge, number>()

/** The pointer rested on a blocker chip: its card (no focus taken) — unless a picker the person opened is up. */
export function hoverRefCard(editor: Editor, bridge: Bridge, pos: number, ref: string): void {
  window.clearTimeout(hoverTimers.get(bridge))
  const cur = bridge.getState().itemPicker
  if (cur && !cur.hover) return
  openItemPickerAt(editor, pos, 'ref', 'chip', { ref, hover: true })
}

/** The pointer left the chip or the card: a card it opened closes a moment later (unless it comes back). */
export function leaveRefCard(bridge: Bridge): void {
  window.clearTimeout(hoverTimers.get(bridge))
  if (!bridge.getState().itemPicker?.hover) return
  hoverTimers.set(
    bridge,
    window.setTimeout(() => {
      if (bridge.getState().itemPicker?.hover) bridge.setState({ itemPicker: null })
    }, 250),
  )
}

/** The pointer is over the card: it stays. */
export function keepRefCard(bridge: Bridge): void {
  window.clearTimeout(hoverTimers.get(bridge))
}
