/**
 * While a presentation runs, it owns the keyboard.
 *
 * The app's global shortcuts (⌘K palette, ⌘\ sidebar, ⌘⇧L theme, ? help …) listen on window in
 * the capture phase. This listener is registered when the module loads — before the shell
 * mounts — so it runs first: the deck handles its keys, and nothing else reaches the page that
 * sits hidden behind the full-screen stage. Browser keys (copy, zoom, reload, tabs) keep working.
 */
type Handler = (e: KeyboardEvent) => boolean

let handler: Handler | null = null

/** Route every keydown to `h` until the returned release function is called. */
export function claimKeyboard(h: Handler): () => void {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

/** Combos the app binds globally (see shell/lib/global.ts): their browser default is blocked too. */
function isAppCombo(e: KeyboardEvent): boolean {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (e.altKey && (k === 'n' || e.code === 'KeyN')) return true
  if (!(e.metaKey || e.ctrlKey)) return false
  if (e.shiftKey && (k === 'l' || k === 'f')) return true
  return ['k', 'p', '\\', '/', ','].includes(k) || e.code === 'KeyK' || e.code === 'KeyP'
}

function onKey(e: KeyboardEvent) {
  if (!handler || e.isComposing) return
  const handled = handler(e)
  if (handled || isAppCombo(e)) e.preventDefault()
  // Tab still moves focus between the deck's own buttons (default action, no listeners needed)
  e.stopImmediatePropagation()
}

if (typeof window !== 'undefined') {
  const w = window as Window & { __onePresentKeys?: (e: KeyboardEvent) => void }
  if (w.__onePresentKeys) window.removeEventListener('keydown', w.__onePresentKeys, true)
  w.__onePresentKeys = onKey
  window.addEventListener('keydown', onKey, true)
}
