/**
 * Workspace agent — host, mounted once by the shell. Owns the ⌘J / Ctrl+J shortcut and loads
 * the panel (and with it the loop, the tools and the SDK) only when it is first opened.
 */
import { lazy, Suspense, useEffect } from 'react'
import { toggleAgent, useAgent } from './state'

const AgentSheet = lazy(() => import('./AgentSheet'))

/** Shortcut of the agent panel ("Mod+J"), shown in the command palette. */
export const AGENT_SHORTCUT = 'Mod+J'

/** ⌘J / Ctrl+J, layout-aware (e.key first, the physical key only for non-Latin layouts). */
function isToggleKey(e: KeyboardEvent): boolean {
  if (e.isComposing || e.altKey || e.shiftKey || !(e.metaKey || e.ctrlKey)) return false
  const k = e.key.length === 1 ? e.key.toLowerCase() : ''
  return /^[\x20-\x7e]$/.test(k) ? k === 'j' : e.code === 'KeyJ'
}

export function AgentPanel() {
  const open = useAgent((s) => s.open)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return
      // a dialog or the palette is on top: leave the keystroke alone
      if (document.querySelector('.modal-scrim, .pal-scrim, .pres')) return
      e.preventDefault()
      e.stopPropagation()
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
