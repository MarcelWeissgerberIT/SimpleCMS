/**
 * The Outbox's keys (the dock and #/outbox; never in a text field, a menu, a list box or a dialog — the agenda keys'
 * rules): J / K the next / previous slip · H hold (again: release) · E edit · R redraft · ⌘↵ / Ctrl+↵ Copy & open
 * (the hand path; nothing else sends) · Esc closes the question, then the dock.
 */
import type { KeyboardEvent } from 'react'
import { toggleHold } from './actions'
import { notYet } from './hand'
import { getSlip, useOutbox } from './store'
import type { SlipId } from './types'

export interface KeyContext {
  /** the slips in the order J / K walk them */
  order: SlipId[]
  focus: SlipId | null
  setFocus: (id: SlipId) => void
  edit: () => void
  redraft: () => void
  copy: () => void
  close?: () => void
}

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  if (!e || !e.closest) return false
  if (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) return true
  return !!e.closest('[role="menu"], [role="listbox"], [role="dialog"], [contenteditable="true"]')
}

/** Focus a slip's card (after the next paint: it may only now be the open one). */
export function focusSlipEl(id: SlipId): void {
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(id)}"]`)?.focus({ preventScroll: false })))
}

export function onOutboxKey(e: KeyboardEvent<HTMLElement>, ctx: KeyContext): void {
  if (e.defaultPrevented || typing(e.target)) return
  const k = e.key
  const mod = e.metaKey || e.ctrlKey
  if (mod && k === 'Enter') {
    if (e.repeat || !ctx.focus) return
    e.preventDefault()
    ctx.copy()
    return
  }
  if (mod || e.altKey) return
  if (k === 'Escape') {
    const asking = useOutbox.getState().asking
    if (asking) {
      e.preventDefault()
      notYet(asking)
      return
    }
    if (ctx.close) {
      e.preventDefault()
      ctx.close()
    }
    return
  }
  const lower = k.length === 1 ? k.toLowerCase() : k
  if (lower === 'j' || lower === 'k') {
    if (!ctx.order.length) return
    e.preventDefault()
    const i = ctx.focus ? ctx.order.indexOf(ctx.focus) : -1
    const n = lower === 'j' ? Math.min(ctx.order.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)
    const id = ctx.order[n]
    ctx.setFocus(id)
    focusSlipEl(id)
    return
  }
  if (!ctx.focus || e.repeat) return
  const s = getSlip(ctx.focus)
  if (!s) return
  if (lower === 'h') {
    e.preventDefault()
    void toggleHold(s.id)
  } else if (lower === 'e') {
    e.preventDefault()
    ctx.edit()
  } else if (lower === 'r') {
    e.preventDefault()
    ctx.redraft()
  }
}
