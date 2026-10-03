/**
 * The emoji and icon pickers of an editor, anchored at the caret (/emoji, /icon) or at an inline icon
 * (click / ↵ on it: change colour or icon, remove). Esc closes and puts the caret back where it was;
 * a click outside just closes.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { useStore } from 'zustand'
import { Popover, type PopoverAnchor } from '../../ui/Popover'
import { useT } from '../../i18n'
import type { ColorName } from '../../store/types'
import type { Bridge, InlinePicker } from '../lib/bridge'
import { useEscapeFirst } from '../lib/escape'
import { posAnchor } from '../menus/common'
import { ICON, ICON_EDIT_EVENT, iconAttrs, type IconAttrs } from '../schema/icon'
import { EmojiPanel } from './EmojiPanel'
import { IconPanel } from './IconPanel'
import './icons.css'

export function InlinePickers({ editor, bridge }: { editor: Editor; bridge: Bridge }) {
  const picker = useStore(bridge, (s) => s.inlinePicker)
  // a click on an inline icon (views/InlineIconView.ts) or ↵ on a selected one
  useEffect(() => {
    const dom = editor.view.dom
    const onEdit = (e: Event) => {
      const pos = (e as CustomEvent<{ pos?: number }>).detail?.pos
      if (typeof pos === 'number' && editor.isEditable) bridge.setState({ inlinePicker: { kind: 'icon', pos, edit: true } })
    }
    dom.addEventListener(ICON_EDIT_EVENT, onEdit)
    return () => dom.removeEventListener(ICON_EDIT_EVENT, onEdit)
  }, [editor, bridge])
  if (!picker) return null
  return <PickerPopover key={`${picker.kind}:${picker.pos}:${!!picker.edit}`} editor={editor} bridge={bridge} picker={picker} />
}

function PickerPopover({ editor, bridge, picker }: { editor: Editor; bridge: Bridge; picker: InlinePicker }) {
  const t = useT()
  const iconAt = () => {
    const n = editor.state.doc.nodeAt(picker.pos)
    return n?.type.name === ICON ? n : null
  }
  const [current] = useState<IconAttrs | null>(() => (picker.edit ? iconAttrs(iconAt()?.attrs) : null))
  const anchor = useMemo<PopoverAnchor>(() => {
    if (picker.edit) {
      const el = editor.view.nodeDOM(picker.pos)
      if (el instanceof HTMLElement) return el
    }
    return posAnchor(editor, picker.pos)
  }, [editor, picker])

  const close = (refocus: boolean) => {
    bridge.setState({ inlinePicker: null })
    // focus() restores the selection the editor kept: the caret (or the icon) where it was
    if (refocus && !editor.isDestroyed) editor.commands.focus()
  }
  useEscapeFirst(() => close(true))
  // the icon went away underneath (undo, a collaborator): nothing left to edit
  useEffect(() => {
    if (!picker.edit) return
    const check = () => !iconAt() && close(false)
    editor.on('update', check)
    return () => {
      editor.off('update', check)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (content: JSONContent | string) => {
    close(false)
    editor.chain().focus().insertContent(content).run()
  }
  /** Edit mode: new attrs for the icon; it stays selected. */
  const change = (attrs: IconAttrs, keepOpen = false) => {
    if (!iconAt()) return close(true)
    const tr = editor.state.tr.setNodeMarkup(picker.pos, undefined, attrs)
    tr.setSelection(NodeSelection.create(tr.doc, picker.pos))
    editor.view.dispatch(tr)
    if (!keepOpen) {
      close(false)
      editor.view.focus()
    }
  }
  const remove = () => {
    const node = iconAt()
    close(false)
    if (node) editor.chain().focus().deleteRange({ from: picker.pos, to: picker.pos + node.nodeSize }).run()
  }
  const recolor = (color: ColorName | null) => {
    const node = iconAt()
    const a = iconAttrs(node?.attrs)
    if (node && a.kind === 'lucide') change({ ...a, color }, true)
  }

  const label = picker.kind === 'emoji' ? t('editor.emojiPicker.title') : t(picker.edit ? 'editor.iconPicker.change' : 'editor.iconPicker.title')
  return (
    <Popover open anchor={anchor} onClose={() => close(false)} placement="bottom-start" offset={6} className="ipk-pop" role="dialog" aria-label={label}>
      {picker.kind === 'emoji' ? (
        <EmojiPanel onPick={insert} />
      ) : picker.edit ? (
        <IconPanel current={current} onPick={(a) => change(a)} onColor={recolor} onRemove={remove} />
      ) : (
        <IconPanel onPick={(attrs) => insert({ type: ICON, attrs })} />
      )}
    </Popover>
  )
}
