/**
 * AI terminal (workspace agent) — host, mounted once by the shell. Owns the shortcuts and loads the
 * terminal (and with it the loop, the tools and the SDK) only when it is first opened:
 *  - ⌘J / Ctrl+J: show / hide (opening with text selected in a page adds it as a reference)
 *  - ⌘⇧J / Ctrl+Shift+J: add the selection as a reference, open the terminal or focus it
 *  - ⌘. / Ctrl+.: stop the running task (also while the terminal is hidden)
 */
import { lazy, Suspense, useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { stopAgent, toggleAgent, useAgent } from './state'

const AgentSheet = lazy(() => import('./AgentSheet'))

/** Shortcut of the terminal ("Mod+J"), shown in the command palette. */
export const AGENT_SHORTCUT = 'Mod+J'
/** "Add to terminal": the selection becomes a reference chip. */
export const AGENT_REF_SHORTCUT = 'Mod+Shift+J'
/** Stop the running task. */
export const AGENT_STOP_SHORTCUT = 'Mod+.'

/**
 * "Add to terminal" (the bubble toolbar's button, ⌘⇧J): the editor's selection (or the DOM
 * selection, also in read-only pages) becomes a reference chip; the terminal opens or takes focus.
 */
export function addSelectionToTerminal(editor?: Editor): void {
  void import('./refs').then((m) => m.addSelectionRef(editor))
}

/** Mod+<key>, layout-aware (e.key first, the physical key only for non-Latin layouts). */
function isMod(e: KeyboardEvent, key: string, code: string, shift = false): boolean {
  if (e.isComposing || e.altKey || e.shiftKey !== shift || !(e.metaKey || e.ctrlKey)) return false
  const k = e.key.length === 1 ? e.key.toLowerCase() : ''
  return /^[\x20-\x7e]$/.test(k) ? k === key : e.code === code
}

/** A dialog, the palette or a presentation is on top: leave the keystroke alone. */
const covered = () => !!document.querySelector('.modal-scrim, .pal-scrim, .pres')

/** Text selected in a page editor (read at the keystroke, before anything moves focus). */
function editorSelected(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false
  const node = sel.getRangeAt(0).commonAncestorContainer
  return !!(node instanceof Element ? node : node.parentElement)?.closest('.ProseMirror')
}

export function AgentPanel() {
  const open = useAgent((s) => s.open)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMod(e, '.', 'Period')) {
        if (useAgent.getState().status !== 'running' || covered()) return
        e.preventDefault()
        e.stopPropagation()
        stopAgent()
        return
      }
      const add = isMod(e, 'j', 'KeyJ', true)
      if (!add && !isMod(e, 'j', 'KeyJ')) return
      if (covered()) return
      e.preventDefault()
      e.stopPropagation()
      if (add) return addSelectionToTerminal()
      // opening with text selected in a page: it goes along as a reference
      if (!useAgent.getState().open && editorSelected()) return addSelectionToTerminal()
      toggleAgent()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!open) return null
  return (
    <Suspense fallback={null}>
      <AgentSheet />
    </Suspense>
  )
}
