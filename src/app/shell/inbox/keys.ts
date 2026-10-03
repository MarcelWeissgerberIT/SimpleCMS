/** "G then I" → the inbox (Linear / Gmail style; never while typing or with an overlay open). */
import { useEffect } from 'react'
import { useUI } from '../../store/ui'
import { navigate } from '../../lib/router'
import { closeMobileSidebar } from '../lib/actions'

export const INBOX_KEYS = 'G I'
const WINDOW_MS = 1200

function typing(el: EventTarget | null): boolean {
  return !!(el as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
}

export function useInboxShortcut(): void {
  useEffect(() => {
    let armed = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const ui = useUI.getState()
      if (ui.paletteOpen || ui.modal || document.querySelector('[data-popover], .modal-scrim')) return
      const k = e.key.toLowerCase()
      if (k === 'g' && !e.shiftKey) {
        armed = Date.now()
        return
      }
      if (k === 'i' && armed && Date.now() - armed < WINDOW_MS) {
        armed = 0
        e.preventDefault()
        closeMobileSidebar()
        navigate({ name: 'inbox' })
        return
      }
      armed = 0
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
